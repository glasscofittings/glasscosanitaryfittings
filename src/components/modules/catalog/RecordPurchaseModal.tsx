"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { X, Check, Calculator, AlertCircle } from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import { formatPKR } from "@/lib/utils/formatters";
import { type SanitaryProduct } from "@/types";
import { fetchParties, type Party } from "@/lib/supabase/crm";
import {
  type RecordPurchaseInput,
  type ProductPurchase,
  calculatePurchaseLine,
  calculateProfitMargins,
  recordProductPurchase,
} from "@/lib/supabase/purchases";
import { useAuth } from "@/components/providers/AuthProvider";

interface RecordPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: SanitaryProduct[];
  selectedProduct?: SanitaryProduct | null;
  onSuccess: (purchase: ProductPurchase) => void;
}

/** Unique key identifying one purchase-submission attempt-session. */
function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function RecordPurchaseModal({
  isOpen,
  onClose,
  products,
  selectedProduct,
  onSuccess,
}: RecordPurchaseModalProps) {
  const { profile } = useAuth();
  const [parties, setParties] = useState<Party[]>([]);

  // Form states
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [productId, setProductId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [unitOfMeasure, setUnitOfMeasure] = useState("PCS");
  const [purchaseRate, setPurchaseRate] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [discountPkr, setDiscountPkr] = useState("0");
  const [taxRate, setTaxRate] = useState("0");
  const [additionalCostPkr, setAdditionalCostPkr] = useState("0");
  const [status, setStatus] = useState<"confirmed" | "draft">("confirmed");
  const [notes, setNotes] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastSubmitRef = useRef(0);

  // One idempotency key per modal session: retries after a failed attempt
  // replay the same submission instead of duplicating stock/ledger postings.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  useEffect(() => {
    if (isOpen) idempotencyKeyRef.current = newIdempotencyKey();
  }, [isOpen]);

  // Load parties
  useEffect(() => {
    if (isOpen) {
      fetchParties("ALL").then(setParties).catch(() => {});
    }
  }, [isOpen]);

  // Pre-fill selected product
  useEffect(() => {
    if (isOpen && selectedProduct) {
      setProductId(selectedProduct.id);
    } else if (isOpen && products.length > 0 && !productId) {
      setProductId(products[0].id);
    }
  }, [isOpen, selectedProduct, products, productId]);

  const activeProduct = useMemo(() => {
    return products.find((p) => p.id === productId) || null;
  }, [products, productId]);

  // Suppliers from CRM
  const suppliers = useMemo(() => {
    return parties.filter((p) => p.party_type === "SUPPLIER" || p.party_type === "BOTH");
  }, [parties]);

  // Live calculations
  const metrics = useMemo(() => {
    const qty = parseFloat(quantity) || 0;
    const rate = parseFloat(purchaseRate) || 0;
    const discPct = parseFloat(discountPercent) || 0;
    const discFlat = parseFloat(discountPkr) || 0;
    const tax = parseFloat(taxRate) || 0;
    const addCost = parseFloat(additionalCostPkr) || 0;

    return calculatePurchaseLine({
      quantity: qty,
      purchase_rate: rate,
      discount_percent: discPct,
      discount_pkr: discFlat,
      tax_rate: tax,
      additional_cost_pkr: addCost,
    });
  }, [quantity, purchaseRate, discountPercent, discountPkr, taxRate, additionalCostPkr]);

  // Live profit margins preview based on current product selling price
  const marginPreview = useMemo(() => {
    if (!activeProduct || metrics.effectiveUnitCost <= 0) {
      return null;
    }
    return calculateProfitMargins({
      sellingPrice: activeProduct.unit_price,
      unitCost: metrics.effectiveUnitCost,
    });
  }, [activeProduct, metrics.effectiveUnitCost]);

  const handleSupplierSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sId = e.target.value;
    setSupplierId(sId);
    const found = parties.find((p) => p.id === sId);
    if (found) {
      setSupplierName(found.name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (isSubmitting || now - lastSubmitRef.current < 2000) return;

    if (!productId) {
      toast.error("Please select a product.");
      return;
    }

    const numQty = parseFloat(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      toast.error("Valid purchase quantity is required.");
      return;
    }

    const numRate = parseFloat(purchaseRate);
    if (isNaN(numRate) || numRate < 0) {
      toast.error("Valid purchase rate is required.");
      return;
    }

    if (!supplierName.trim()) {
      toast.error("Supplier name is required.");
      return;
    }

    setIsSubmitting(true);
    lastSubmitRef.current = now;

    try {
      const operatorName = profile?.email || "Purchasing Dept";
      const payload: RecordPurchaseInput = {
        purchase_date: purchaseDate,
        supplier_id: supplierId || null,
        supplier_name: supplierName.trim(),
        product_id: productId,
        quantity: numQty,
        unit_of_measure: unitOfMeasure,
        purchase_rate: numRate,
        discount_percent: parseFloat(discountPercent) || 0,
        discount_pkr: parseFloat(discountPkr) || 0,
        tax_rate: parseFloat(taxRate) || 0,
        additional_cost_pkr: parseFloat(additionalCostPkr) || 0,
        status,
        notes: notes.trim() || undefined,
        operator_name: operatorName,
        product_name: activeProduct?.name,
        sku: activeProduct?.sku,
        idempotency_key: idempotencyKeyRef.current,
      };

      const { data, error } = await recordProductPurchase(payload);
      if (error) {
        toast.error(`Purchase record failed: ${error}`);
        setIsSubmitting(false);
        return;
      }

      if (data) {
        toast.success(
          status === "confirmed"
            ? `Purchase ${data.purchase_number} confirmed: stock and AP ledger updated!`
            : `Purchase ${data.purchase_number} saved as draft.`
        );
        onSuccess(data);
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record purchase.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-neutral-900/40">
          <div>
            <h2 className="text-lg font-bold text-foreground">Record Product Purchase</h2>
            <p className="text-xs text-muted mt-0.5">
              Tracks purchase rate, line discount, landed cost, and updates inventory/AP ledger
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Status Selection */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStatus("confirmed")}
              className={`p-3 rounded-lg text-xs font-semibold border text-left transition-all ${
                status === "confirmed"
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                  : "border-border-subtle text-muted hover:bg-neutral-800/30"
              }`}
            >
              <div className="font-bold">✓ Confirm & Post Purchase</div>
              <div className="text-[10px] font-normal opacity-80 mt-0.5">
                Increases inventory stock + posts debit inventory & credit AP ledger
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStatus("draft")}
              className={`p-3 rounded-lg text-xs font-semibold border text-left transition-all ${
                status === "draft"
                  ? "border-amber-500 bg-amber-500/15 text-amber-400"
                  : "border-border-subtle text-muted hover:bg-neutral-800/30"
              }`}
            >
              <div className="font-bold">📝 Save as Draft</div>
              <div className="text-[10px] font-normal opacity-80 mt-0.5">
                Does NOT alter inventory stock or post to ledger
              </div>
            </button>
          </div>

          {/* Product & Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Select Product <span className="text-red-500">*</span>
              </label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
                required
              >
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.sku}] {p.name} — Selling: PKR {p.unit_price}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Purchase Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
                required
              />
            </div>
          </div>

          {/* Supplier Linkage */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Select Supplier (CRM)
              </label>
              <select
                value={supplierId}
                onChange={handleSupplierSelect}
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              >
                <option value="">Select CRM vendor or enter name below…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Supplier Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. AGD Sanitary Hardware, Master Brass"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
                required
              />
            </div>
          </div>

          {/* Quantity, Unit & Purchase Rate */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Quantity <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Unit of Measure</label>
              <input
                type="text"
                value={unitOfMeasure}
                onChange={(e) => setUnitOfMeasure(e.target.value.toUpperCase())}
                placeholder="PCS / KG / MTR"
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Purchase Rate (PKR) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={purchaseRate}
                onChange={(e) => setPurchaseRate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
                required
              />
            </div>
          </div>

          {/* Per-Product Discount & Additional Landed Costs */}
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-crimson-primary" />
                Line Discounts & Landed Costs Allocation
              </span>
              <span className="text-[10px] text-slate-600">Per-product discount supported</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Discount %</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="100"
                  value={discountPercent}
                  onChange={(e) => {
                    setDiscountPercent(e.target.value);
                    setDiscountPkr("0");
                  }}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-surface-subtle border border-border-subtle text-foreground"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Discount Flat (PKR)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={discountPkr}
                  onChange={(e) => {
                    setDiscountPkr(e.target.value);
                    setDiscountPercent("0");
                  }}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-surface-subtle border border-border-subtle text-foreground"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Tax Rate %</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-surface-subtle border border-border-subtle text-foreground"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Allocated Freight/Costs</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={additionalCostPkr}
                  onChange={(e) => setAdditionalCostPkr(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded bg-surface-subtle border border-border-subtle text-foreground"
                />
              </div>
            </div>

            {/* Calculations Breakdown Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border-subtle text-xs">
              <div>
                <span className="text-[10px] text-slate-600 block">Subtotal:</span>
                <span className="font-mono font-semibold text-foreground">
                  {formatPKR(metrics.subtotal)}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-600 block">Discount:</span>
                <span className="font-mono font-semibold text-amber-400">
                  - {formatPKR(metrics.discountAmount)}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-600 block">Landed Cost / Unit:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {formatPKR(metrics.effectiveUnitCost)}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-600 block">Purchase Total:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatPKR(metrics.total)}
                </span>
              </div>
            </div>
          </div>

          {/* Live Profit Margin & Markup Preview Card */}
          {activeProduct && marginPreview && (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
              <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                Estimated Profit Margin Preview (Selling: PKR {activeProduct.unit_price})
              </span>
              <div className="grid grid-cols-3 gap-2 text-center pt-1">
                <div className="p-2 rounded bg-slate-50 border border-border-subtle">
                  <div className="text-[10px] text-slate-600">Unit Gross Profit</div>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {formatPKR(marginPreview.grossProfit)}
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-50 border border-border-subtle">
                  <div className="text-[10px] text-slate-600">Gross Margin %</div>
                  <div
                    className={`font-bold text-sm mt-0.5 ${
                      marginPreview.grossMarginPercent >= 25
                        ? "text-emerald-400"
                        : marginPreview.grossMarginPercent > 0
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {marginPreview.grossMarginPercent}%
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-50 border border-border-subtle">
                  <div className="text-[10px] text-slate-600">Markup %</div>
                  <div className="font-bold text-sm text-blue-400 mt-0.5">
                    {marginPreview.markupPercent}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Notes / Remarks</label>
            <textarea
              rows={2}
              placeholder="e.g. PO reference, supplier invoice #, terms…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary resize-none"
            />
          </div>

          {/* Submit Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium rounded-lg text-slate-600 hover:text-foreground hover:bg-neutral-800/40 transition-colors"
            >
              Cancel
            </button>

            <CrimsonButton type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Recording…"
                : status === "confirmed"
                ? "Confirm Purchase & Post"
                : "Save Draft"}
            </CrimsonButton>
          </div>
        </form>
      </div>
    </div>
  );
}
