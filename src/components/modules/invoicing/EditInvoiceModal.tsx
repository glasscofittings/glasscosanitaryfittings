"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { type Party, type SalesInvoice, type DispatchLineItem, updateInvoice, updateInvoiceItems } from "@/lib/supabase/invoicing";
import { formatPKR } from "@/lib/utils/formatters";

interface LineItem {
  key: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_of_measure: string;
  /** Stored per-line discount percent (raw Disc% entered at creation). */
  discount_percent?: number;
  /** Stored per-line TOTAL discount in PKR (% part + fixed Rs. part) — carried
   *  through verbatim so saving from this modal never wipes line discounts. */
  discount_pkr?: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  available_stock: number;
  unit_price: number;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface Props {
  invoice: SalesInvoice;
  customers: Party[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditInvoiceModal({ invoice, customers, open, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState(invoice.customer_id);
  const [items, setItems] = useState<LineItem[]>(() =>
    invoice.items && invoice.items.length > 0
      ? invoice.items.map((item, idx) => ({
          key: String(idx + 1),
          product_id: item.product_id ?? "",
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price_pkr,
          unit_of_measure: item.unit_of_measure || "PCS",
          discount_percent: item.discount_percent ?? 0,
          discount_pkr: item.discount_pkr ?? 0,
        }))
      : [{ key: "1", product_id: "", product_name: "", quantity: 1, unit_price: 0, unit_of_measure: "", discount_percent: 0, discount_pkr: 0 }]
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [salesTaxRate, setSalesTaxRate] = useState(invoice.sales_tax_rate ?? 0);
  const [furtherTaxRate, setFurtherTaxRate] = useState(invoice.further_tax_rate ?? 0);
  const [discountPercent, setDiscountPercent] = useState(invoice.discount_percent ?? 0);
  // Reconstruct the flat Rs. part so % + flat recombine to the stored discount.
  const [discountFlat, setDiscountFlat] = useState(() => {
    const gross0 = (invoice.items ?? []).reduce((a, item) => a + item.quantity * item.unit_price_pkr, 0);
    const stored = invoice.discount_pkr ?? 0;
    const pctPart = Math.round(gross0 * ((invoice.discount_percent ?? 0) / 100) * 100) / 100;
    return Math.max(0, Math.round((stored - pctPart) * 100) / 100);
  });

  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/rest/v1/sanitary_products?select=id,name,sku,category,available_stock,unit_price&order=name.asc`, {
      headers: {
        apikey: SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
      },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]));
  }, []);

  useEscapeToClose(open, onClose);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // Per-line discounts are preserved on save (see toDispatchItems) — net the
  // lines before the invoice-level discount so the saved taxable value stays
  // correct. Stored discount_pkr is the authoritative total line discount;
  // percent-only rows fall back to percent-of-gross.
  const lineDiscountOf = (item: LineItem) => {
    const gross = (item.quantity || 0) * (item.unit_price || 0);
    const stored = item.discount_pkr || 0;
    const disc = stored > 0 ? stored : (gross * (item.discount_percent || 0)) / 100;
    return Math.min(gross, Math.max(0, Math.round(disc * 100) / 100));
  };
  const rawGrossTotal = items.reduce((a, item) => a + item.quantity * item.unit_price, 0);
  const lineDiscountsTotal = items.reduce((a, item) => a + lineDiscountOf(item), 0);
  const grossValue = Math.max(0, Math.round((rawGrossTotal - lineDiscountsTotal) * 100) / 100);
  const discountAmount = Math.min(
    grossValue,
    Math.max(0, Math.round((grossValue * (discountPercent / 100) + discountFlat) * 100) / 100)
  );
  const taxableValue = Math.round((grossValue - discountAmount) * 100) / 100;
  const salesTaxAmount = taxableValue * (salesTaxRate / 100);
  const furtherTaxAmount = taxableValue * (furtherTaxRate / 100);
  const totalPayable = taxableValue + salesTaxAmount + furtherTaxAmount;
  const hadDiscount = (invoice.discount_pkr ?? 0) > 0 || (invoice.discount_percent ?? 0) > 0;

  const isValid = customerId && items.some((item) => item.product_id && item.quantity > 0 && item.unit_price > 0);

  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        if (field === "product_id") {
          const product = products.find((p) => p.id === value);
          if (product) {
            updated.product_name = product.name;
            updated.unit_price = product.unit_price;
          }
        }
        return updated;
      })
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: String(Date.now()), product_id: "", product_name: "", quantity: 1, unit_price: 0, unit_of_measure: "", discount_percent: 0, discount_pkr: 0 },
    ]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function toDispatchItems(): DispatchLineItem[] {
    return items.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price_pkr: item.unit_price,
      // Net of the line discount, matching what createInvoice persists at
      // creation time (gross − stored line discount).
      line_total_pkr: Math.max(0, Math.round((item.quantity * item.unit_price - lineDiscountOf(item)) * 100) / 100),
      unit_of_measure: item.unit_of_measure,
      // Carry the stored line discounts through verbatim — updateInvoiceItems
      // deletes + reinserts every row, so omitting them would wipe them.
      discount_percent: item.discount_percent || 0,
      discount_pkr: item.discount_pkr || 0,
    }));
  }

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    const ok = await updateInvoice(invoice.id, {
      customer_id: customerId,
      taxable_value_pkr: taxableValue,
      sales_tax_rate: salesTaxRate,
      sales_tax_amount_pkr: salesTaxAmount,
      further_tax_rate: furtherTaxAmount > 0 ? furtherTaxRate : 0,
      further_tax_amount_pkr: furtherTaxAmount,
      total_invoice_value_pkr: totalPayable,
      // Only patched when a discount applies now or previously (to clear it).
      ...(hadDiscount || discountAmount > 0
        ? { discount_percent: discountAmount > 0 ? discountPercent : 0, discount_pkr: discountAmount }
        : {}),
    });

    if (!ok) {
      setSubmitting(false);
      setError("Failed to update invoice. Check connection.");
      return;
    }

    const itemsOk = await updateInvoiceItems(invoice.id, toDispatchItems());
    setSubmitting(false);

    if (itemsOk) {
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      onSaved();
      onClose();
    } else {
      setError("Invoice saved but line items failed to update.");
    }
  }

  if (!open) return null;

  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-2";

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Edit Invoice</h2>
              <p className="text-caption text-muted font-mono mt-0.5">{invoice.invoice_number}</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div>
              <label className={labelCls}>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.ntn_strn ? ` (STRN: ${c.ntn_strn})` : ""}{!c.is_registered ? " (Unregistered)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="glass-card p-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-muted uppercase mb-1">Sales Tax %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={salesTaxRate}
                    onChange={(e) => setSalesTaxRate(parseFloat(e.target.value) || 0)}
                    className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted uppercase mb-1">Further Tax %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={furtherTaxRate}
                    onChange={(e) => setFurtherTaxRate(parseFloat(e.target.value) || 0)}
                    className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                  />
                </div>
              </div>
            </div>

              <div className="glass-card p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-muted uppercase mb-1">Discount %</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(Math.min(100, parseFloat(e.target.value) || 0))}
                      className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted uppercase mb-1">Discount (Rs.)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={discountFlat}
                      onChange={(e) => setDiscountFlat(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                    />
                  </div>
                </div>
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
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <div className="flex flex-col items-center">
                      <input
                        type="number"
                        value={item.quantity || ""}
                        onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                        className="h-8 w-16 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                        placeholder="Qty"
                        min={1}
                      />
                    </div>
                    <span className="h-8 flex items-center text-caption text-muted font-mono">{item.unit_of_measure}</span>
                    <input
                      type="number"
                      value={item.unit_price || ""}
                      onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
                      className="h-8 w-24 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-right focus:border-crimson-primary focus:outline-none"
                      placeholder="Price"
                      min="0"
                    />
                    <span className="h-8 flex items-center text-caption text-muted font-mono whitespace-nowrap">
                      {item.quantity > 0 && item.unit_price > 0 ? formatPKR(item.quantity * item.unit_price) : "\u2014"}
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

            {grossValue > 0 && (
              <div className="glass-card p-4 space-y-2">
                {lineDiscountsTotal > 0 && (
                  <>
                    <div className="flex justify-between text-body">
                      <span className="text-secondary">Gross Total (before line discounts)</span>
                      <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(rawGrossTotal)}</span>
                    </div>
                    <div className="flex justify-between text-body">
                      <span className="text-secondary">Line Item Discounts</span>
                      <span className="font-mono text-num-table text-status-amber whitespace-nowrap">− {formatPKR(lineDiscountsTotal)}</span>
                    </div>
                    <div className="flex justify-between text-body">
                      <span className="text-secondary">Net Line Total</span>
                      <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(grossValue)}</span>
                    </div>
                  </>
                )}
                {discountAmount > 0 && (
                  <>
                    {lineDiscountsTotal === 0 && (
                      <div className="flex justify-between text-body">
                        <span className="text-secondary">Sub Total</span>
                        <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(grossValue)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-body">
                      <span className="text-secondary">
                        Discount{discountPercent > 0 ? ` (${discountPercent}%)` : ""}
                      </span>
                      <span className="font-mono text-num-table text-status-amber whitespace-nowrap">− {formatPKR(discountAmount)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-body">
                  <span className="text-secondary">Taxable Value</span>
                  <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(taxableValue)}</span>
                </div>
                {salesTaxAmount > 0 && (
                  <div className="flex justify-between text-body">
                    <span className="text-secondary">Sales Tax ({salesTaxRate}%)</span>
                    <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(salesTaxAmount)}</span>
                  </div>
                )}
                {furtherTaxAmount > 0 && (
                  <div className="flex justify-between text-body">
                    <span className="text-secondary">Further Tax ({furtherTaxRate}%)</span>
                    <span className="font-mono text-num-table text-status-amber whitespace-nowrap">{formatPKR(furtherTaxAmount)}</span>
                  </div>
                )}
                <div className="glow-line my-2" />
                <div className="flex justify-between text-body font-semibold">
                  <span className="text-foreground">Total Payable</span>
                  <span className="font-mono text-num-kpi text-crimson-primary whitespace-nowrap">{formatPKR(totalPayable)}</span>
                </div>
              </div>
            )}

            {error && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>

          <div className="p-5 border-t border-border-subtle shrink-0">
            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting || !isValid}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={onClose}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:text-foreground hover:bg-bg-subtle transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
