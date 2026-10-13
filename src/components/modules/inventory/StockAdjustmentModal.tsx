"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { type InventoryLot, adjustStock } from "@/lib/supabase/inventory";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  open: boolean;
  lots: InventoryLot[];
  onClose: () => void;
  onCreated: () => void;
}

type AdjustmentType = "DAMAGED" | "EXPIRED" | "AUDIT_CORRECTION";

const ADJUSTMENT_LABELS: Record<AdjustmentType, { label: string; desc: string }> = {
  DAMAGED: { label: "Damaged", desc: "Record damaged or spoiled stock" },
  EXPIRED: { label: "Expired", desc: "Write off expired materials" },
  AUDIT_CORRECTION: { label: "Audit Correction", desc: "Reconcile physical count discrepancy" },
};

export default function StockAdjustmentModal({ open, lots, onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const [lotId, setLotId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("DAMAGED");
  const [adjustmentQty, setAdjustmentQty] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEscapeToClose(open, () => { onClose(); resetForm(); });

  if (!open) return null;

  const selectedLot = lots.find((l) => l.id === lotId);
  const qtyNum = adjustmentQty ? parseFloat(adjustmentQty) : 0;
  const isDeduction = adjustmentType !== "AUDIT_CORRECTION";
  const finalAdjustmentQty = isDeduction ? -Math.abs(qtyNum) : Math.abs(qtyNum);
  const isValid =
    lotId &&
    adjustmentQty &&
    qtyNum > 0 &&
    reason.trim().length >= 3 &&
    (adjustmentType !== "AUDIT_CORRECTION" || true);

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");
    setSuccess(false);

    const result = await adjustStock({
      lot_id: lotId,
      adjustment_qty: finalAdjustmentQty,
      adjustment_type: adjustmentType,
      reason: reason.trim(),
    });

    setSubmitting(false);
    if (result) {
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onCreated();
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1200);
    } else {
      setError("Failed to apply adjustment. Check connection.");
    }
  }

  function resetForm() {
    setLotId("");
    setAdjustmentType("DAMAGED");
    setAdjustmentQty("");
    setReason("");
    setError("");
    setSuccess(false);
  }

  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-2";

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm"
        onClick={() => { onClose(); resetForm(); }}
      />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div
          className="glass-card w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Stock Adjustment</h2>
              <p className="text-caption text-muted mt-0.5">Physical count reconciliation</p>
            </div>
            <button
              onClick={() => { onClose(); resetForm(); }}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div>
              <label className={labelCls}>Adjustment Reason</label>
              <div className="flex gap-2">
                {(Object.keys(ADJUSTMENT_LABELS) as AdjustmentType[]).map((type) => {
                  const cfg = ADJUSTMENT_LABELS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAdjustmentType(type)}
                      className={`flex-1 px-3 py-2 rounded-lg text-caption font-medium border transition-all text-left ${
                        adjustmentType === type
                          ? "bg-crimson-primary/15 text-crimson-light border-crimson-primary/30"
                          : "bg-bg-subtle text-secondary border-border-default hover:bg-bg-muted"
                      }`}
                    >
                      <span className="block">{cfg.label}</span>
                      <span className="block text-[10px] text-muted mt-0.5">{cfg.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={labelCls}>Select Lot</label>
              <select value={lotId} onChange={(e) => setLotId(e.target.value)} className={inputCls}>
                <option value="">Choose a lot...</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lot_number} — {l.product?.name ?? "Unknown"} ({l.remaining_qty.toLocaleString()} remaining)
                  </option>
                ))}
              </select>
            </div>

            {selectedLot && (
              <div className="glass-card p-3 text-caption text-muted space-y-1">
                <p>
                  Current Stock: <span className="text-foreground font-mono font-medium">{selectedLot.remaining_qty.toLocaleString()}</span>
                </p>
                <p>
                  Product: <span className="text-foreground font-medium">{selectedLot.product?.name ?? "—"}</span>
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  Quantity to {isDeduction ? "Deduct" : "Add"}
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={adjustmentQty}
                  onChange={(e) => setAdjustmentQty(e.target.value)}
                  className={`${inputCls} font-mono`}
                  placeholder="0.0000"
                />
              </div>

              <div>
                <label className={labelCls}>Projected Result</label>
                <div className="h-9 px-3 rounded-lg bg-bg-subtle border border-border-default flex items-center">
                  <span className="font-mono text-body">
                    {selectedLot ? (
                      <>
                        <span className="text-muted">{selectedLot.remaining_qty.toLocaleString()}</span>
                        <span className={`mx-1 ${finalAdjustmentQty >= 0 ? "text-status-optimal" : "text-status-alert"}`}>
                          {finalAdjustmentQty >= 0 ? "+" : ""}
                          {finalAdjustmentQty.toLocaleString()}
                        </span>
                        <span className="text-foreground font-medium">
                          = {(selectedLot.remaining_qty + finalAdjustmentQty).toLocaleString()}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Reason (min. 3 characters)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(capitalizeFirst(e.target.value))}
                className={`${inputCls} h-20 resize-none`}
                placeholder="Describe the reason for this adjustment..."
              />
            </div>

            {success && (
              <div className="bg-status-optimal/10 border border-status-optimal/20 rounded-lg p-3 text-caption text-status-optimal">
                Stock adjustment applied successfully.
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
                disabled={submitting || !isValid || success}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Applying..." : success ? "Applied" : "Apply Adjustment"}
              </button>
              <button
                onClick={() => { onClose(); resetForm(); }}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
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
