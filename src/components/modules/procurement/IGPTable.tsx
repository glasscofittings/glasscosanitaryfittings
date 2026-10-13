"use client";

import { useState, useMemo } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  type InwardGatePass,
  type Party,
  convertIGPToGRN,
  effectiveAcceptedQty,
  updateIGP,
  deleteIGP,
} from "@/lib/supabase/procurement";
import { generateGRNFromIGP } from "@/lib/supabase/purchase-invoices";
import { useOperatorStore } from "@/lib/store/useOperatorStore";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { capitalizeFirst } from "@/lib/utils";

// ─── Status helpers ──────────────────────────────────────────────────────────

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

const EDITABLE_STATUSES: InwardGatePass["status"][] = ["CONVERTED_TO_GRN"];

function statusPill(status: InwardGatePass["status"]) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING_INSPECTION: {
      label: "Pending Inspection",
      cls: "bg-status-amber/15 text-status-amber border-status-amber/20",
    },
    PENDING_QC: {
      label: "Pending QC",
      cls: "bg-status-amber/15 text-status-amber border-status-amber/20",
    },
    CONVERTED_TO_GRN: {
      label: "Converted to GRN",
      cls: "bg-status-optimal/15 text-status-optimal border-status-optimal/20",
    },
    REJECTED: {
      label: "Rejected",
      cls: "bg-status-alert/15 text-status-alert border-status-alert/20",
    },
  };
  const s = map[status] ?? { label: status, cls: "bg-bg-muted text-muted border-border-default" };
  return (
    <span className={`inline-block text-caption font-medium px-2 py-0.5 rounded border ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────

type ToastType = "success" | "error";

function Toast({ message, type, onDismiss }: { message: string; type: ToastType; onDismiss: () => void }) {
  return (
    <div
      style={{ zIndex: 9999 }}
      className={`fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-body font-medium transition-all animate-fade-in
        ${type === "success"
          ? "bg-status-optimal/10 border-status-optimal/30 text-status-optimal"
          : "bg-status-alert/10 border-status-alert/30 text-status-alert"
        }`}
    >
      {type === "success" ? (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100 transition-opacity">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

function DeleteConfirmModal({
  igp,
  onConfirm,
  onCancel,
  busy,
}: {
  igp: InwardGatePass;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  useEscapeToClose(true, onCancel);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        style={{ zIndex: 200 }}
        onClick={onCancel}
      />
      <div
        className="fixed inset-0 flex items-center justify-center pointer-events-none"
        style={{ zIndex: 201 }}
      >
        <div className="glass-card p-6 w-full max-w-sm pointer-events-auto shadow-2xl border border-status-alert/30">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-status-alert/10 border border-status-alert/20 flex items-center justify-center shrink-0">
              <svg className="h-5 w-5 text-status-alert" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-h3 font-semibold text-foreground">Delete Gate Pass</h3>
              <p className="text-body text-secondary mt-1">
                Are you sure you want to delete{" "}
                <span className="font-mono font-semibold text-foreground">{igp.igp_code}</span>?
                This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-5">
            <button
              onClick={onCancel}
              disabled={busy}
              className="h-9 px-4 rounded-lg text-body font-medium bg-bg-muted text-secondary border border-border-default hover:bg-bg-subtle hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="h-9 px-4 rounded-lg text-body font-medium bg-status-alert text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2"
            >
              {busy ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({
  igp,
  parties,
  onSave,
  onClose,
}: {
  igp: InwardGatePass;
  parties: Party[];
  onSave: (updated: Partial<InwardGatePass>) => Promise<void>;
  onClose: () => void;
}) {
  const [material, setMaterial] = useState(igp.material_description);
  const [supplierId, setSupplierId] = useState(igp.supplier_id);
  const [acceptedQty, setAcceptedQty] = useState(String(effectiveAcceptedQty(igp)));
  const [rejectedQty, setRejectedQty] = useState(String(igp.rejected_qty ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEscapeToClose(true, onClose);

  const uom = igp.uom ?? "KG";

  async function handleSave() {
    if (!material.trim()) { setError("Material description is required."); return; }
    const accNum = parseFloat(acceptedQty);
    if (isNaN(accNum) || accNum < 0) { setError("Accepted quantity cannot be negative."); return; }
    const rejNum = parseFloat(rejectedQty) || 0;
    if (rejNum < 0) { setError("Rejected quantity cannot be negative."); return; }

    setBusy(true);
    setError("");
    await onSave({
      material_description: material.trim(),
      supplier_id: supplierId,
      inward_qty: accNum,
      net_weight_kg: accNum,
      accepted_qty: accNum,
      rejected_qty: rejNum,
      vendor_lot_code: rejNum > 0 ? String(rejNum) : undefined,
      coa_code: rejNum > 0 ? `REJ:${rejNum}` : undefined,
    });
    setBusy(false);
  }

  const fieldClass =
    "w-full h-9 px-3 rounded-lg bg-bg-muted border border-border-default text-body text-foreground placeholder:text-muted focus:outline-none focus:border-crimson-primary/60 focus:ring-1 focus:ring-crimson-primary/20 transition-colors";
  const labelClass = "block text-caption text-secondary font-medium mb-1.5 uppercase tracking-wider";

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        style={{ zIndex: 200 }}
        onClick={onClose}
      />
      <div
        className="fixed inset-0 flex items-center justify-center pointer-events-none"
        style={{ zIndex: 201 }}
      >
        <div className="glass-card p-6 w-full max-w-md pointer-events-auto shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-h3 font-semibold text-foreground">Edit Gate Pass</h3>
              <p className="text-caption text-muted mt-0.5 font-mono">{igp.igp_code}</p>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="glow-line mb-5" />

          {/* Fields */}
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Material Description</label>
              <input
                type="text"
                value={material}
                onChange={(e) => setMaterial(capitalizeFirst(e.target.value))}
                className={fieldClass}
                placeholder="e.g. Sodium Chloride"
              />
            </div>

            <div>
              <label className={labelClass}>Supplier</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className={fieldClass}
              >
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Accepted Weight ({uom})</label>
                <input
                  type="number"
                  value={acceptedQty}
                  onChange={(e) => setAcceptedQty(e.target.value)}
                  className={fieldClass}
                  placeholder="0"
                  min={0}
                />
              </div>
              <div>
                <label className={labelClass}>Rejected Weight ({uom})</label>
                <input
                  type="number"
                  value={rejectedQty}
                  onChange={(e) => setRejectedQty(e.target.value)}
                  className={fieldClass}
                  placeholder="0"
                  min={0}
                />
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-3 text-caption text-status-alert bg-status-alert/10 border border-status-alert/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 justify-end mt-5">
            <button
              onClick={onClose}
              disabled={busy}
              className="h-9 px-4 rounded-lg text-body font-medium bg-bg-muted text-secondary border border-border-default hover:bg-bg-subtle hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              className="h-9 px-4 rounded-lg text-body font-medium bg-crimson-primary text-white hover:bg-crimson-dark disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {busy && (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  igps: InwardGatePass[];
  parties?: Party[];
  onConverted: () => void;
  onIgpsChange?: (updated: InwardGatePass[]) => void;
}

export default function IGPTable({ igps: initialIgps, parties = [], onConverted, onIgpsChange }: Props) {
  const openOperatorModal = useOperatorStore((s) => s.open);
  const nodeId = useDeviceStore((s) => s.nodeId);

  // ── Local IGP state (so we can optimistically update without re-fetch) ──
  const [igps, setIgps] = useState<InwardGatePass[]>(initialIgps);

  // Sync when parent passes new data (e.g. after refresh)
  // We use a simple comparison: if parent length or first id changed, reset.
  const [prevIgps, setPrevIgps] = useState<InwardGatePass[]>(initialIgps);
  if (initialIgps !== prevIgps) {
    setPrevIgps(initialIgps);
    setIgps(initialIgps);
  }

  // ── UI state ──
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingIGP, setEditingIGP] = useState<InwardGatePass | null>(null);
  const [deletingIGP, setDeletingIGP] = useState<InwardGatePass | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  // ── Search / filter ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return igps;
    return igps.filter((igp) => {
      const supplier = igp.parties?.name ?? "";
      return (
        igp.igp_code.toLowerCase().includes(q) ||
        igp.material_description.toLowerCase().includes(q) ||
        supplier.toLowerCase().includes(q) ||
        igp.status.toLowerCase().includes(q)
      );
    });
  }, [igps, search]);

  // ── 1-Click GRN Engine ──
  async function handleConvertToGRN(igp: InwardGatePass) {
    let operatorName: string;
    try {
      operatorName = await openOperatorModal(`Generate GRN for ${igp.igp_code}`);
    } catch {
      return;
    }

    setConvertingId(igp.id);
    try {
      const result = await generateGRNFromIGP({
        igp_id: igp.id,
        unit_price: 0,
        device_node: nodeId,
        operator_name: operatorName,
      });

      setConvertingId(null);
      if (result.success && result.grn_number) {
        showToast(`GRN # ${result.grn_number} created & moved to Pending Invoices`, "success");
        onConverted();
      } else {
        showToast(result.error || "Failed to generate GRN", "error");
      }
    } catch (err) {
      setConvertingId(null);
      console.error("IGP Table GRN Generation Error:", err);
      showToast("Error generating GRN", "error");
    }
  }

  // ── Edit ──
  async function handleEditSave(igp: InwardGatePass, updates: Partial<InwardGatePass>) {
    const ok = await updateIGP(igp.id, {
      material_description: updates.material_description,
      supplier_id: updates.supplier_id,
      inward_qty: updates.inward_qty,
      net_weight_kg: updates.net_weight_kg,
      accepted_qty: updates.accepted_qty,
      rejected_qty: updates.rejected_qty,
      vendor_lot_code: updates.vendor_lot_code,
      coa_code: updates.coa_code,
    });

    if (ok) {
      // Optimistic update
      const updated = igps.map((r) =>
        r.id === igp.id
          ? {
              ...r,
              ...updates,
              // Re-link party if supplier_id changed
              parties:
                updates.supplier_id && updates.supplier_id !== r.supplier_id
                  ? parties.find((p) => p.id === updates.supplier_id) ?? r.parties
                  : r.parties,
            }
          : r
      );
      setIgps(updated);
      onIgpsChange?.(updated);
      setEditingIGP(null);
      showToast(`${igp.igp_code} updated successfully.`, "success");
    } else {
      showToast(`Failed to update ${igp.igp_code}. Please try again.`, "error");
    }
  }

  // ── Delete ──
  async function handleDeleteConfirm() {
    if (!deletingIGP) return;
    setDeleteLoading(true);
    const ok = await deleteIGP(deletingIGP.id);
    setDeleteLoading(false);

    if (ok) {
      const updated = igps.filter((r) => r.id !== deletingIGP.id);
      setIgps(updated);
      onIgpsChange?.(updated);
      showToast(`${deletingIGP.igp_code} deleted.`, "success");
      setDeletingIGP(null);
    } else {
      showToast(`Failed to delete ${deletingIGP.igp_code}. Please try again.`, "error");
      setDeletingIGP(null);
    }
  }

  // ── Render ──
  return (
    <>
      <div className="glass-card overflow-hidden">
        <div className="p-5 pb-0">
          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h2 font-semibold">Inward Gate Passes</h2>
            <span className="badge">{filtered.length} / {igps.length} records</span>
          </div>

          {/* Live Search */}
          <div className="relative mb-4">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by IGP Code, Material, Supplier, or Status…"
              className="w-full h-9 pl-9 pr-9 rounded-lg bg-bg-muted border border-border-default text-body text-foreground placeholder:text-muted focus:outline-none focus:border-crimson-primary/60 focus:ring-1 focus:ring-crimson-primary/20 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="glow-line mb-0" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-center" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b bg-bg-muted/40 border-border-subtle">
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32">IGP Code</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider">Material</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-36">Supplier</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Rejected</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Accepted</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32 text-center">Status</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28">Date</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-44" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted">
                    {search ? (
                      <span>
                        No records match{" "}
                        <span className="font-mono font-medium text-foreground">"{search}"</span>.{" "}
                        <button
                          onClick={() => setSearch("")}
                          className="text-crimson-light underline underline-offset-2 hover:no-underline"
                        >
                          Clear search
                        </button>
                      </span>
                    ) : (
                      "No inward gate passes found."
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((igp) => {
                  const canEdit = EDITABLE_STATUSES.includes(igp.status);
                  const uom = igp.uom ?? "KG";
                  const acceptedQty = effectiveAcceptedQty(igp);
                  const rejectedQty = igp.rejected_qty ?? 0;
                  return (
                    <tr
                      key={igp.id}
                      className="border-b border-border-subtle hover:bg-bg-subtle transition-colors"
                    >
                      <td className="px-5 py-3">
                        <span className="font-mono text-num-code text-secondary">{igp.igp_code}</span>
                      </td>
                      <td className="px-5 py-3 text-body text-foreground truncate">{igp.material_description}</td>
                      <td className="px-5 py-3 text-body text-secondary">{igp.parties?.name ?? "—"}</td>
                      {/* Rejected Qty (replaces Lot #) */}
                      <td className="px-5 py-3 text-right font-mono text-num-table">
                        {rejectedQty > 0 ? (
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-caption border bg-status-alert/10 text-status-alert border-status-alert/30 font-medium"
                            title={igp.rejection_reason ? `Reason: ${igp.rejection_reason}` : `${fmtQty(rejectedQty)} ${uom} rejected`}
                          >
                            {fmtQty(rejectedQty)} {uom}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      {/* Accepted Qty (Net Weight accepted) */}
                      <td className="px-5 py-3 text-right font-mono text-num-table text-foreground">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded bg-status-optimal/10 border border-status-optimal/20 text-status-optimal font-medium"
                          title={`${fmtQty(acceptedQty)} ${uom} accepted`}
                        >
                          {fmtQty(acceptedQty)} {uom}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">{statusPill(igp.status)}</td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-num-code text-muted">
                          {new Date(igp.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {/* Generate GRN — only for PENDING_INSPECTION */}
                          {igp.status === "PENDING_INSPECTION" && (
                            <button
                              onClick={() => handleConvertToGRN(igp)}
                              disabled={convertingId === igp.id}
                              className="h-7 px-3 rounded-md bg-status-optimal/10 text-status-optimal text-caption font-medium border border-status-optimal/20 hover:bg-status-optimal/20 disabled:opacity-40 transition-colors inline-flex items-center gap-1"
                              title="1-Click GRN & Pending Invoice"
                            >
                              {convertingId === igp.id ? "…" : "Generate GRN"}
                            </button>
                          )}

                          {/* Edit — strictly only if status allows it */}
                          {canEdit && (
                            <button
                              onClick={() => setEditingIGP(igp)}
                              title="Edit record"
                              className="h-7 w-7 rounded-md flex items-center justify-center bg-bg-muted border border-border-default text-secondary hover:text-foreground hover:bg-bg-subtle transition-colors"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                          )}

                          {/* Delete — always visible */}
                          <button
                            onClick={() => setDeletingIGP(igp)}
                            title={`Delete ${igp.igp_code}`}
                            className="h-7 w-7 rounded-md flex items-center justify-center bg-status-alert/5 border border-status-alert/20 text-status-alert hover:bg-status-alert/15 transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingIGP && (
        <EditModal
          igp={editingIGP}
          parties={parties}
          onClose={() => setEditingIGP(null)}
          onSave={(updates) => handleEditSave(editingIGP, updates)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingIGP && (
        <DeleteConfirmModal
          igp={deletingIGP}
          busy={deleteLoading}
          onConfirm={handleDeleteConfirm}
          onCancel={() => !deleteLoading && setDeletingIGP(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
