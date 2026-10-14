"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { type Party, type TaxBreakdown, type SalesInvoiceItem, calculateTax, createInvoice, postGSTPaintsInvoice, createDispatchRecord } from "@/lib/supabase/invoicing";
import { formatPKR } from "@/lib/utils/formatters";
import { useOperatorStore } from "@/lib/store/useOperatorStore";

interface LineItem {
  key: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_of_measure: string;
}

interface GSTInvoiceFormProps {
  customers: Party[];
  onSaved: (result: { invoice_number: string; total_payable: number }) => void;
  onClose: () => void;
}

export default function GSTInvoiceForm({ customers, onSaved, onClose }: GSTInvoiceFormProps) {
  const [customerId, setCustomerId] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { key: "1", product_id: "", product_name: "", quantity: 1, unit_price: 0, unit_of_measure: "NOS" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [applyFurtherTax, setApplyFurtherTax] = useState(false);
  const [showOperatorModal, setShowOperatorModal] = useState(false);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const taxableValue = items.reduce((a, item) => a + item.quantity * item.unit_price, 0);
  const breakdown: TaxBreakdown | null = taxableValue > 0
    ? calculateTax(taxableValue, selectedCustomer?.is_registered ?? true)
    : null;

  const isValid = customerId && items.some((item) => item.product_id && item.quantity > 0 && item.unit_price > 0);

  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: typeof value === "number" ? value : parseFloat(value) || 0 };
        if (field === "product_id") {
          const product = ["fg1", "fg2", "fg3", "fg4", "fg5", "fg6", "fg7"].find((p) => p === value);
          if (product) {
            const names: Record<string, string> = {
              fg1: "Ceramic Wash Basin",
              fg2: "Health Faucet Set",
              fg3: "Bib Cock 1/2 inch Chrome",
              fg4: "Flush Tank Complete",
              fg5: "Toilet Seat Cover Soft Close",
              fg6: "Shower Mixer Tap",
              fg7: "Kitchen Sink Tap",
            };
            updated.product_name = names[value] || "";
            updated.unit_of_measure = "NOS";
          }
        }
        return updated;
      })
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: String(Date.now()), product_id: "", product_name: "", quantity: 1, unit_price: 0, unit_of_measure: "NOS" },
    ]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveDraft() {
    if (!isValid || !breakdown) return;
    setSubmitting(true);
    setError("");
    setDuplicateWarning("");

    const today = new Date().toISOString().slice(0, 10);
    const isDup = await checkDuplicateInvoice(customerId, taxableValue, today);
    if (isDup) {
      setDuplicateWarning("Possible duplicate: same customer, value, and date.");
      setSubmitting(false);
      return;
    }

    const { invoice: created, error: createError } = await createInvoice({
      customer_id: customerId,
      taxable_value_pkr: taxableValue,
      sales_tax_amount_pkr: breakdown.sales_tax_amount,
      further_tax_amount_pkr: breakdown.further_tax_amount,
      total_invoice_value_pkr: breakdown.total_payable,
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: "Accounts Dept",
    });

    setSubmitting(false);
    if (created) {
      onSaved({ 
        invoice_number: created.invoice_number, 
        total_payable: created.total_invoice_value_pkr ?? breakdown.total_payable 
      });
      onClose();
    } else {
      setError(createError ?? "Failed to save draft. Check connection.");
    }
  }

  async function handlePostInvoice() {
    if (!isValid || !breakdown) return;
    setSubmitting(true);
    setError("");

    const operatorName = await (useOperatorStore.getState ? useOperatorStore.getState().open("Post Invoice") : "Accounts Dept");

    // Create draft first to get invoice_id
    const { invoice: draft, error: draftError } = await createInvoice({
      customer_id: customerId,
      taxable_value_pkr: taxableValue,
      sales_tax_amount_pkr: breakdown.sales_tax_amount,
      further_tax_amount_pkr: breakdown.further_tax_amount,
      total_invoice_value_pkr: breakdown.total_payable,
      sales_tax_rate: breakdown.sales_tax_rate,
      further_tax_rate: breakdown.further_tax_rate,
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: operatorName,
    });

    if (!draft) {
      setSubmitting(false);
      setError(draftError ?? "Failed to create invoice draft. Check connection.");
      return;
    }

    const lineItems = items.map((item) => ({
      product_id: item.product_id,
      lot_id: "",
      qty_buckets: item.quantity,
      unit_price_pkr: item.unit_price,
    }));

    const payload = {
      invoice_id: draft.id ?? draft.invoice_number,
      customer_id: customerId,
      taxable_value_pkr: taxableValue,
      apply_further_tax: !selectedCustomer?.is_registered,
      operator_name: operatorName,
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      line_items: lineItems,
    };

    const result = await postGSTPaintsInvoice(payload);

    if (result && result.data) {
      // Write dispatch record with full snapshot. If selectedCustomer was not
      // resolvable here, createDispatchRecord backfills customer_name from
      // the parties table via customer_id so the Dispatch History is never blank.
      const dispatchRecord = await createDispatchRecord({
        invoice_id: draft.id ?? draft.invoice_number,
        invoice_number: result.data.invoice_number,
        customer_id: customerId,
        customer_name: selectedCustomer?.name ?? "",
        taxable_value_pkr: taxableValue,
        sales_tax_rate: breakdown.sales_tax_rate,
        sales_tax_amount_pkr: breakdown.sales_tax_amount,
        further_tax_rate: breakdown.further_tax_rate,
        further_tax_amount_pkr: breakdown.further_tax_amount,
        total_invoice_value_pkr: result.data.total_payable,
        line_items: items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price_pkr: item.unit_price,
          line_total_pkr: item.quantity * item.unit_price,
          unit_of_measure: item.unit_of_measure,
        })),
        operator_name: operatorName,
        device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      });
      if (!dispatchRecord) {
        toast.warning(
          `Invoice ${result.data.invoice_number} was posted, but its dispatch record could not be saved.`
        );
      }

      setSubmitting(false);
      onSaved({
        invoice_number: result.data.invoice_number,
        total_payable: result.data.total_payable,
      });
      onClose();
    } else {
      setSubmitting(false);
      setError(result?.error || "Failed to post invoice. Check connection.");
    }
  }

  async function checkDuplicateInvoice(customerId: string, taxableValue: number, date: string): Promise<boolean> {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return false;
    try {
      const startOfDay = date;
      const endOfDay = date + "T23:59:59Z";
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sales_invoices?customer_id=eq.${customerId}&taxable_value_pkr=eq.${taxableValue}&created_at=gte.${startOfDay}&created_at=lte.${endOfDay}&select=id`,
        {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (!res.ok) return false;
      const data = await res.json();
      return data.length > 0;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Re-validate on visibility change
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [customerId, items]);

  return (
    <div className="space-y-5">
      <div>
        <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">Customer</label>
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
        >
          <option value="">Select customer...</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {!c.is_registered ? " (Unregistered)" : ""}
            </option>
          ))}
        </select>
      </div>





      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-caption text-secondary uppercase tracking-wider font-medium">Line Items</label>
          <button onClick={addItem} className="text-caption text-crimson-light hover:text-crimson-primary transition-colors">+ Add Item</button>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={item.key} className="flex gap-2 items-start p-2 rounded-lg bg-bg-subtle border border-border-subtle">
              <select
                value={item.product_id}
                onChange={(e) => updateItem(idx, "product_id", e.target.value)}
                className="h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground text-caption flex-1 focus:border-crimson-primary focus:outline-none"
              >
                <option value="">Product...</option>
                {[{ id: "fg1", name: "Ceramic Wash Basin", unit: "NOS" }, { id: "fg2", name: "Health Faucet Set", unit: "NOS" }, { id: "fg3", name: "Bib Cock 1/2 inch Chrome", unit: "NOS" }, { id: "fg4", name: "Flush Tank Complete", unit: "NOS" }, { id: "fg5", name: "Toilet Seat Cover Soft Close", unit: "NOS" }, { id: "fg6", name: "Shower Mixer Tap", unit: "NOS" }, { id: "fg7", name: "Kitchen Sink Tap", unit: "NOS" }].map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="number"
                value={item.quantity || ""}
                onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                className="h-8 w-16 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                placeholder="Qty"
                min="0"
              />
              <span className="h-8 flex items-center text-caption text-muted font-mono">{item.unit_of_measure}</span>
              <input
                type="number"
                value={item.unit_price || ""}
                onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
                className="h-8 w-24 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-right focus:border-crimson-primary focus:outline-none"
                placeholder="Price"
                min="0"
              />
              <span className="h-8 flex items-center text-caption text-muted font-mono">
                {item.quantity > 0 && item.unit_price > 0 ? formatPKR(item.quantity * item.unit_price) : "—"}
              </span>
              {items.length > 1 && (
                <button onClick={() => removeItem(idx)} className="h-8 w-8 flex items-center justify-center text-muted hover:text-status-alert transition-colors">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {duplicateWarning && (
        <div className="flex items-center gap-2 text-caption text-status-amber bg-status-amber/10 px-3 py-2 rounded-lg border border-status-amber/20">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {duplicateWarning}
        </div>
      )}

      {breakdown && (
        <div className="glass-card p-4 space-y-2">
          <div className="flex justify-between text-body">
            <span className="text-secondary">Taxable Value</span>
            <span className="font-mono text-num-table text-foreground JetBrainsMono">{formatPKR(breakdown.taxable_value)}</span>
          </div>
          <div className="flex justify-between text-body">
            <span className="text-secondary">GST ({breakdown.sales_tax_rate}%)</span>
            <span className="font-mono text-num-table text-foreground JetBrainsMono">{formatPKR(breakdown.sales_tax_amount)}</span>
          </div>
          {breakdown.further_tax_amount > 0 && (
            <div className="flex justify-between text-body">
              <span className="text-secondary">Further Tax ({breakdown.further_tax_rate}%)</span>
              <span className="font-mono text-num-table text-status-amber JetBrainsMono">{formatPKR(breakdown.further_tax_amount)}</span>
            </div>
          )}
          <div className="glow-line my-2" />
          <div className="flex justify-between text-body font-semibold">
            <span className="text-foreground">Grand Total</span>
            <span className="font-mono text-num-kpi text-crimson-primary JetBrainsMono">{formatPKR(breakdown.total_payable)}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSaveDraft}
          disabled={submitting || !isValid}
          className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Saving..." : "Save Draft"}
        </button>
        <button
          onClick={handlePostInvoice}
          disabled={submitting || !isValid}
          className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Posting..." : "Post Invoice"}
        </button>
        <button
          onClick={onClose}
          className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}