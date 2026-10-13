"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { X, Plus, Trash2, Lock } from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import { formatPKR } from "@/lib/utils/formatters";
import { type SanitaryProduct } from "@/types";
import { fetchSanitaryProducts } from "@/lib/supabase/catalog";
import { type Party, fetchCustomers } from "@/lib/supabase/invoicing";
import {
  type Quotation,
  type QuotationItem,
  calculateQuotationLine,
  calculateQuotationTotals,
  createQuotation,
  updateQuotation,
  canAdjustQuotedRate,
  canViewQuotationMargins,
} from "@/lib/supabase/quotations";
import { fetchEstimatedCosts } from "@/lib/supabase/quotations";
import { useAuth } from "@/components/providers/AuthProvider";

interface QuotationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (quotation: Quotation) => void;
  editQuotation?: Quotation | null;
}

interface LineDraft {
  key: string;
  product_id: string;
  product_code: string;
  product_name: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  discount_pkr: string;
  tax_rate: string;
  estimated_unit_cost: number;
}

const newLine = (): LineDraft => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  product_id: "",
  product_code: "",
  product_name: "",
  description: "",
  unit: "PCS",
  quantity: "1",
  unit_price: "0",
  discount_percent: "0",
  discount_pkr: "0",
  tax_rate: "18",
  estimated_unit_cost: 0,
});

const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function lineToItem(line: LineDraft): QuotationItem {
  return {
    product_id: line.product_id || null,
    product_code: line.product_code || null,
    product_name: line.product_name.trim(),
    description: line.description.trim() || null,
    unit: line.unit || "PCS",
    quantity: num(line.quantity),
    unit_price_pkr: num(line.unit_price),
    discount_percent: num(line.discount_percent),
    discount_pkr: num(line.discount_pkr),
    tax_rate: num(line.tax_rate),
    estimated_unit_cost_pkr: line.estimated_unit_cost,
  };
}

export default function QuotationFormModal({
  isOpen,
  onClose,
  onSuccess,
  editQuotation,
}: QuotationFormModalProps) {
  const { profile } = useAuth();
  const role = profile?.role;

  const [products, setProducts] = useState<SanitaryProduct[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);

  const [quotationDate, setQuotationDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [additionalCharges, setAdditionalCharges] = useState("");
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastSubmitRef = useRef(0);

  const allowRateOverride = canAdjustQuotedRate(role);
  const showMargins = canViewQuotationMargins(role);

  useEffect(() => {
    if (!isOpen) return;
    fetchSanitaryProducts()
      .then(setProducts)
      .catch(() => {});
    fetchCustomers()
      .then(setCustomers)
      .catch(() => {});
  }, [isOpen]);

  // Populate when editing an existing quotation
  useEffect(() => {
    if (!isOpen) return;
    if (editQuotation) {
      setQuotationDate(editQuotation.quotation_date.slice(0, 10));
      setValidUntil(editQuotation.valid_until?.slice(0, 10) ?? "");
      setCustomerId(editQuotation.customer_id ?? "");
      setCustomerName(editQuotation.customer_name ?? "");
      setCustomerPhone(editQuotation.customer_phone ?? "");
      setCustomerAddress(editQuotation.customer_address ?? "");
      setAdditionalCharges(String(editQuotation.additional_charges_pkr ?? 0));
      setTerms(editQuotation.terms ?? "");
      setNotes(editQuotation.notes ?? "");
      setInternalNotes(editQuotation.internal_notes ?? "");
      setLines(
        (editQuotation.items ?? []).map((item) => ({
          key: `${item.id ?? item.product_name}-${Math.random().toString(36).slice(2, 6)}`,
          product_id: item.product_id ?? "",
          product_code: item.product_code ?? "",
          product_name: item.product_name,
          description: item.description ?? "",
          unit: item.unit || "PCS",
          quantity: String(item.quantity),
          unit_price: String(item.unit_price_pkr),
          discount_percent: String(item.discount_percent ?? 0),
          discount_pkr: String(item.discount_pkr ?? 0),
          tax_rate: String(item.tax_rate ?? 0),
          estimated_unit_cost: Number(item.estimated_unit_cost_pkr) || 0,
        })),
      );
    } else {
      setQuotationDate(new Date().toISOString().slice(0, 10));
      const d = new Date();
      d.setDate(d.getDate() + 30);
      setValidUntil(d.toISOString().slice(0, 10));
      setCustomerId("");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerAddress("");
      setAdditionalCharges("");
      setTerms("");
      setNotes("");
      setInternalNotes("");
      setLines([newLine()]);
      setErrors({});
    }
  }, [editQuotation, isOpen]);

  const items = useMemo(() => lines.map(lineToItem), [lines]);
  const totals = useMemo(
    () => calculateQuotationTotals(items, num(additionalCharges)),
    [items, additionalCharges],
  );

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const handleProductSelect = async (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateLine(key, { product_id: "", product_code: "", product_name: "" });
      return;
    }
    // Quoted rate defaults to the product's default selling price. Adjusting it
    // later only changes this line — the catalog price is never written to.
    updateLine(key, {
      product_id: product.id,
      product_code: product.sku,
      product_name: product.name,
      unit: "PCS",
      unit_price: String(product.unit_price ?? 0),
    });
    try {
      const costs = await fetchEstimatedCosts([product.id]);
      const cost = costs.get(product.id);
      if (typeof cost === "number") {
        updateLine(key, { estimated_unit_cost: cost });
      }
    } catch {
      /* cost lookup is best-effort */
    }
  };

  const handleCustomerSelect = (partyId: string) => {
    setCustomerId(partyId);
    const party = customers.find((c) => c.id === partyId);
    if (party) {
      setCustomerName(party.name);
      setCustomerPhone(party.phone ?? "");
      setCustomerAddress(party.address ?? "");
    }
  };

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!customerName.trim()) errs.customerName = "Customer name is required.";
    if (validUntil && validUntil < quotationDate) {
      errs.validUntil = "Valid-until date cannot be before the quotation date.";
    }
    if (lines.length === 0) errs.lines = "Add at least one line item.";
    lines.forEach((line, i) => {
      if (!line.product_name.trim()) {
        errs[`line-${line.key}`] = `Line ${i + 1}: select a product.`;
      } else if (num(line.quantity) <= 0) {
        errs[`line-${line.key}`] = `Line ${i + 1}: quantity must be greater than zero.`;
      } else if (num(line.unit_price) < 0) {
        errs[`line-${line.key}`] = `Line ${i + 1}: price cannot be negative.`;
      }
    });
    if (num(additionalCharges) < 0) {
      errs.additionalCharges = "Additional charges cannot be negative.";
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (isSubmitting || now - lastSubmitRef.current < 1500) return;

    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Please correct the errors in the quotation.");
      return;
    }

    setIsSubmitting(true);
    lastSubmitRef.current = now;
    try {
      const payload = {
        quotation_date: quotationDate,
        valid_until: validUntil || null,
        customer_id: customerId || null,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        customer_address: customerAddress.trim() || null,
        additional_charges_pkr: num(additionalCharges),
        terms: terms.trim() || null,
        notes: notes.trim() || null,
        internal_notes: showMargins ? internalNotes.trim() || null : (editQuotation?.internal_notes ?? null),
        operator_name: profile?.email || "Terminal Operator",
        device_node: profile?.device_name ?? undefined,
        items,
      };

      const result = editQuotation
        ? await updateQuotation(editQuotation.id, payload)
        : await createQuotation(payload);

      if (result.error || !result.quotation) {
        toast.error(result.error ?? "Failed to save the quotation.");
        return;
      }

      toast.success(
        editQuotation
          ? `Quotation ${result.quotation.quotation_number} updated.`
          : `Quotation ${result.quotation.quotation_number} created as draft.`,
      );
      onSuccess(result.quotation);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputCls =
    "w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary";
  const errInputCls = (has: boolean) =>
    has ? "border-red-500" : "border-border-subtle focus:border-crimson-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-neutral-900/40">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {editQuotation ? `Edit Quotation ${editQuotation.quotation_number}` : "New Quotation"}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Offer document — does not post to the ledger, affect balances or move stock
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Dates + Customer */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Quotation Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={quotationDate}
                onChange={(e) => setQuotationDate(e.target.value)}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Valid Until</label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className={`${inputCls} ${errors.validUntil ? "border-red-500" : ""}`}
              />
              {errors.validUntil && (
                <p className="text-[11px] text-red-500 mt-1">{errors.validUntil}</p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1">
                Customer <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={customerId}
                  onChange={(e) => handleCustomerSelect(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Walk-in (type name manually)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                placeholder="Customer name *"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={`${inputCls} mt-2 ${
                  errors.customerName ? "border-red-500" : ""
                }`}
                required
              />
              {errors.customerName && (
                <p className="text-[11px] text-red-500 mt-1">{errors.customerName}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Phone</label>
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Address</label>
              <input
                type="text"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                Line Items
              </label>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, newLine()])}
                className="flex items-center gap-1 text-xs font-semibold text-crimson-primary hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> Add Line
              </button>
            </div>

            {lines.map((line, index) => {
              const calc = calculateQuotationLine(lineToItem(line));
              return (
                <div
                  key={line.key}
                  className="p-3 rounded-lg bg-white border border-border-subtle space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                      Line {index + 1}
                    </span>
                    <div className="flex items-center gap-3">
                      {showMargins && line.estimated_unit_cost > 0 && (
                        <span className="text-[10px] font-mono text-gray-500">
                          Est. cost {formatPKR(line.estimated_unit_cost)}
                        </span>
                      )}
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) => prev.filter((l) => l.key !== line.key))
                          }
                          className="p-1 rounded text-muted hover:text-red-400 transition-colors"
                          title="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <div className="md:col-span-4">
                      <select
                        value={line.product_id}
                        onChange={(e) => handleProductSelect(line.key, e.target.value)}
                        className={`${inputCls} text-xs ${
                          errors[`line-${line.key}`] ? "border-red-500" : ""
                        }`}
                      >
                        <option value="">— Select product —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name}
                          </option>
                        ))}
                      </select>
                      {errors[`line-${line.key}`] && (
                        <p className="text-[11px] text-red-500 mt-1">
                          {errors[`line-${line.key}`]}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        className={`${inputCls} text-xs font-mono`}
                      />
                    </div>
                    <div className="md:col-span-2 relative">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="Rate"
                        value={line.unit_price}
                        readOnly={!allowRateOverride}
                        onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                        title={
                          allowRateOverride
                            ? "Quoted rate (does not change the product's default price)"
                            : "Only OWNER accounts can adjust quoted rates"
                        }
                        className={`${inputCls} text-xs font-mono pr-7 ${
                          allowRateOverride ? "" : "opacity-70 cursor-not-allowed"
                        }`}
                      />
                      {!allowRateOverride && (
                        <Lock className="w-3.5 h-3.5 text-muted absolute right-2 top-2.5" />
                      )}
                    </div>
                    <div className="md:col-span-1">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="100"
                        placeholder="Disc%"
                        value={line.discount_percent}
                        onChange={(e) => updateLine(line.key, { discount_percent: e.target.value })}
                        className={`${inputCls} text-xs font-mono`}
                      />
                    </div>
                    <div className="md:col-span-1">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="Tax%"
                        value={line.tax_rate}
                        onChange={(e) => updateLine(line.key, { tax_rate: e.target.value })}
                        className={`${inputCls} text-xs font-mono`}
                      />
                    </div>
                    <div className="md:col-span-2 flex items-center justify-between px-1">
                      <span className="text-[10px] text-gray-500">Line total</span>
                      <span className="text-xs font-mono font-bold text-foreground">
                        {formatPKR(calc.lineTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <input
                      type="text"
                      placeholder="Description (optional)"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      className={`${inputCls} text-xs md:col-span-2`}
                    />
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Flat discount Rs."
                      value={line.discount_pkr}
                      onChange={(e) => updateLine(line.key, { discount_pkr: e.target.value })}
                      className={`${inputCls} text-xs font-mono`}
                    />
                    <div className="text-[10px] text-gray-500 font-mono self-center text-right">
                      {calc.discount > 0
                        ? `less ${formatPKR(calc.discount)} → ${formatPKR(calc.net)}`
                        : `net ${formatPKR(calc.net)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals preview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Additional Charges (PKR)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Delivery / handling etc."
                  value={additionalCharges}
                  onChange={(e) => setAdditionalCharges(e.target.value)}
                  className={`${inputCls} font-mono ${
                    errors.additionalCharges ? "border-red-500" : ""
                  }`}
                />
                {errors.additionalCharges && (
                  <p className="text-[11px] text-red-500 mt-1">{errors.additionalCharges}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Terms &amp; Delivery / Payment Conditions
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Delivery within 7 working days. 50% advance, balance before delivery. Prices valid for 30 days."
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  className={`${inputCls} resize-none`}
                />
              </div>
            </div>

            <div className="p-4 rounded-lg bg-slate-50 border border-border-subtle space-y-1.5 text-sm">
              {[
                ["Subtotal", totals.subtotal_pkr],
                ...(totals.discount_pkr > 0 ? [["Less: Discount", -totals.discount_pkr] as [string, number]] : []),
                ["Sales Tax", totals.tax_amount_pkr],
                ...(totals.additional_charges_pkr > 0
                  ? [["Additional Charges", totals.additional_charges_pkr] as [string, number]]
                  : []),
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-gray-500">
                  <span>{label as string}</span>
                  <span className="font-mono">{formatPKR(value as number)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 mt-1 border-t border-border-subtle text-foreground font-bold">
                <span>Grand Total</span>
                <span className="font-mono">{formatPKR(totals.grand_total_pkr)}</span>
              </div>
              {showMargins && (
                <div className="pt-2 mt-1 border-t border-border-subtle space-y-1">
                  <div className="flex justify-between text-[11px] text-gray-500">
                    <span>Internal — est. cost</span>
                    <span className="font-mono">{formatPKR(totals.estimated_cost_pkr)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-500">
                    <span>Internal — est. profit</span>
                    <span className="font-mono">{formatPKR(totals.estimated_profit_pkr)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-500">
                    <span>Internal — margin</span>
                    <span className="font-mono">{totals.margin_percent.toFixed(2)}%</span>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-500 pt-1">
                Never shown to the customer — printed documents exclude internal figures.
              </p>
            </div>
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Notes (shown on document)
              </label>
              <textarea
                rows={2}
                placeholder="Any message for the customer…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${inputCls} resize-none`}
              />
            </div>
            {showMargins && (
              <div>
                <label className="block text-xs font-medium text-foreground mb-1 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Internal Notes (never printed)
                </label>
                <textarea
                  rows={2}
                  placeholder="Negotiation context, floor price, approvals…"
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  className={`${inputCls} resize-none`}
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
            >
              Cancel
            </button>
            <CrimsonButton type="submit" disabled={isSubmitting} className="min-w-[150px]">
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </span>
              ) : editQuotation ? (
                "Save Changes"
              ) : (
                "Create Quotation"
              )}
            </CrimsonButton>
          </div>
        </form>
      </div>
    </div>
  );
}
