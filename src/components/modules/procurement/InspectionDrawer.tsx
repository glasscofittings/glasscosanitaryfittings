"use client";

import { useState, useEffect } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { type InwardGatePass, convertIGPToGRN, rejectIGP, effectiveAcceptedQty, updateIGP } from "@/lib/supabase/procurement";
import { generateGRNFromIGP } from "@/lib/supabase/purchase-invoices";
import { useOperatorStore } from "@/lib/store/useOperatorStore";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { formatPKR } from "@/lib/utils/formatters";
import { capitalizeFirst } from "@/lib/utils";

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

interface Props {
  igp: InwardGatePass | null;
  open: boolean;
  onClose: () => void;
  onConverted: () => void;
}

export default function InspectionDrawer({ igp, open, onClose, onConverted }: Props) {
  const openOperatorModal = useOperatorStore((s) => s.open);
  const nodeId = useDeviceStore((s) => s.nodeId);
  const [acceptedQty, setAcceptedQty] = useState("");
  const [rejectedQty, setRejectedQty] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Default accepted quantity to inward_qty when opening for a new IGP
  useEffect(() => {
    if (igp && open) {
      setAcceptedQty(String(igp.inward_qty));
      setRejectedQty("0");
    }
  }, [igp?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEscapeToClose(open, onClose);

  if (!igp) return null;

  const uom = igp.uom ?? "KG";
  const totalQty = igp.inward_qty;
  const accepted = parseFloat(acceptedQty) || 0;
  const rejected = parseFloat(rejectedQty) || 0;
  const price = parseFloat(unitPrice) || 0;
  const totalValue = accepted * price;
  const qtyValid = Math.abs(accepted + rejected - totalQty) < 0.001;

  /** Keep accepted + rejected = totalQty while typing either quantity. */
  function balanceOnQuantityChange(field: "accepted" | "rejected", raw: string) {
    const entered = Number(raw);
    if (!Number.isFinite(entered)) return;
    const counterpart = Math.round((totalQty - entered) * 10000) / 10000;
    if (field === "accepted") {
      setAcceptedQty(raw);
      setRejectedQty(String(Math.max(0, counterpart)));
    } else {
      setRejectedQty(raw);
      setAcceptedQty(String(Math.max(0, counterpart)));
    }
  }

  async function handleConvert() {
    if (!igp) return;
    if (!qtyValid) { setError("Accepted + Rejected must equal inward quantity"); return; }
    if (price <= 0) { setError("Unit price must be greater than zero"); return; }

    let operatorName: string;
    try {
      operatorName = await openOperatorModal(`Convert ${igp.igp_code} to GRN`);
    } catch {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // Update gate pass with inspected accepted & rejected weights
      await updateIGP(igp.id, {
        net_weight_kg: accepted,
        inward_qty: accepted,
        accepted_qty: accepted,
        rejected_qty: rejected,
        rejection_reason: rejectionReason || null,
        vendor_lot_code: rejected > 0 ? String(rejected) : undefined,
        coa_code: rejected > 0 ? `REJ:${rejected}` : undefined,
      });

      // Convert to GRN and generate pending purchase invoice
      await generateGRNFromIGP({
        igp_id: igp.id,
        unit_price: price,
        device_node: nodeId,
        operator_name: operatorName,
      });

      setSubmitting(false);
      onConverted();
      onClose();
      resetForm();
    } catch (err: any) {
      setSubmitting(false);
      console.error("GRN Conversion Error:", err);
      setError(err?.message || "GRN Conversion failed. Please check connection.");
    }
  }

  async function handleReject() {
    if (!igp) return;

    try {
      await openOperatorModal(`Reject ${igp.igp_code}`);
    } catch {
      return;
    }

    setSubmitting(true);
    const ok = await rejectIGP(igp.id, rejectionReason || "Rejected during inspection");
    setSubmitting(false);
    if (ok) {
      onConverted();
      onClose();
      resetForm();
    } else {
      setError("Rejection failed. Check connection.");
    }
  }

  function resetForm() {
    setAcceptedQty("");
    setRejectedQty("");
    setRejectionReason("");
    setUnitPrice("");
    setError("");
  }

  return (
    <>
      {open && <div className="drawer-overlay" onClick={onClose} />}

      <div className={`drawer-panel ${open ? "" : "closed"}`}>
        <div className="drawer-header">
          <div>
            <h2 className="text-h2 font-semibold">Quality Inspection</h2>
            <p className="text-caption text-muted font-mono mt-0.5">{igp.igp_code}</p>
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

        <div className="drawer-body space-y-6">
          <div className="glass-card p-4 space-y-3">
            <div className="flex justify-between text-body">
              <span className="text-secondary">Material</span>
              <span className="text-foreground font-medium">{igp.material_description}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-secondary">Inward Quantity</span>
              <span className="font-mono text-foreground">{fmtQty(totalQty)} {uom}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-secondary">Supplier</span>
              <span className="text-foreground">{igp.parties?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-secondary">Batch Lot #</span>
              <span className="font-mono text-foreground">{igp.vendor_lot_code ?? "—"}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-secondary">CoA Code</span>
              <span className="font-mono text-foreground">{igp.coa_code ?? "—"}</span>
            </div>
          </div>

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
              Accepted Quantity ({uom})
            </label>
            <input
              type="number"
              step="0.0001"
              min="0"
              max={totalQty}
              value={acceptedQty}
              onChange={(e) => balanceOnQuantityChange("accepted", e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
              placeholder="0.0000"
            />
          </div>

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
              Rejected Quantity ({uom})
            </label>
            <input
              type="number"
              step="0.0001"
              min="0"
              max={totalQty}
              value={rejectedQty}
              onChange={(e) => balanceOnQuantityChange("rejected", e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
              placeholder="0.0000"
            />
          </div>

          {!qtyValid && (accepted > 0 || rejected > 0) && (
            <p className="text-caption text-status-alert">
              Qty mismatch: {fmtQty(accepted + rejected)} / {fmtQty(totalQty)} {uom}
            </p>
          )}

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
              Rejection Reason
            </label>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(capitalizeFirst(e.target.value))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors resize-none"
              placeholder="Describe rejection reason..."
            />
          </div>

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
              Unit Price (PKR)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
              placeholder="0.00"
            />
            {price > 0 && (
              <p className="text-caption text-muted mt-1 font-mono">
                Total Value: {formatPKR(totalValue)}
              </p>
            )}
          </div>

          {error && (
            <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleConvert}
              disabled={submitting || !qtyValid || price <= 0}
              className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Converting..." : "Convert to GRN"}
            </button>
            <button
              onClick={handleReject}
              disabled={submitting}
              className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-status-alert/10 hover:text-status-alert hover:border-status-alert/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-body"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
