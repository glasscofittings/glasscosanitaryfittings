"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  type DispatchRecord,
  type DispatchLineItem,
  type DispatchRecordPatch,
  type DispatchStatus,
  updateDispatchRecord,
  updateInvoice,
  updateInvoiceItems,
} from "@/lib/supabase/invoicing";
import { formatPKR } from "@/lib/utils/formatters";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Per-line discount amount, mirroring calcLineDiscountAmount for dispatch lines. */
function lineDiscount(item: DispatchLineItem): number {
  const gross = Number(item.quantity ?? 0) * Number(item.unit_price_pkr ?? 0);
  const disc =
    Number(item.discount_pkr) > 0
      ? Number(item.discount_pkr)
      : (gross * (Number(item.discount_percent) || 0)) / 100;
  return Math.min(gross, Math.max(0, round2(disc)));
}

interface Props {
  record: DispatchRecord | null;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: DispatchRecord) => void;
}

/**
 * Edit dispatch parameters.
 *
 * Before approval (status 'pending_approval') everything is editable: line
 * items with live-recalculated totals (taxable → sales/further tax → grand
 * total), dispatch date, transport details, and operator notes. Saving item
 * changes keeps the sales invoice's items and totals in sync — no stock moves
 * because nothing was deducted yet.
 *
 * After approval the financial fields are locked (the ledger entry and stock
 * deduction were already posted); transport details, operator notes, date, and
 * the approved → dispatched transition stay editable. Use Delete to revert an
 * approved dispatch — that path reverses stock and the ledger entry first.
 */
export default function EditDispatchModal({ record, open, onClose, onSaved }: Props) {
  // The parent mounts this modal only while a record is selected, so state is
  // initialised straight from the record (see page.tsx: {editDispatch && ...}).
  const [items, setItems] = useState<DispatchLineItem[]>(() =>
    (record?.line_items ?? []).map((i) => ({ ...i })),
  );
  const [dispatchDate, setDispatchDate] = useState(() =>
    (record?.dispatch_date ?? record?.posted_at ?? "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10),
  );
  const [transportDetails, setTransportDetails] = useState(record?.transport_details ?? "");
  const [operatorNotes, setOperatorNotes] = useState(record?.operator_notes ?? "");
  const [targetStatus, setTargetStatus] = useState<DispatchStatus>(record?.status ?? "dispatched");
  const [saving, setSaving] = useState(false);

  useEscapeToClose(open, () => {
    if (!saving) onClose();
  });

  if (!record || !open) return null;

  const resolvedStatus: DispatchStatus = record.status ?? "dispatched";
  const itemsLocked = resolvedStatus !== "pending_approval";
  const pending = resolvedStatus === "pending_approval";

  // ── Live totals (pending rows only) ──────────────────────────────────────
  const originalGross = (record.line_items ?? []).reduce(
    (sum, i) => sum + i.quantity * i.unit_price_pkr,
    0,
  );
  const originalDisc = (record.line_items ?? []).reduce(
    (sum, i) => sum + lineDiscount(i),
    0,
  );
  // Carry the invoice-level discount (XD) across edits: whatever the original
  // taxable differed from gross-minus-line-discounts is preserved as-is.
  const invoiceAdjustment = round2(
    record.taxable_value_pkr - (originalGross - originalDisc),
  );
  const newGross = items.reduce((s, i) => s + i.quantity * i.unit_price_pkr, 0);
  const newDisc = items.reduce((s, i) => s + lineDiscount(i), 0);
  const taxable = Math.max(0, round2(newGross - newDisc + invoiceAdjustment));
  const salesTax = round2((taxable * (record.sales_tax_rate ?? 0)) / 100);
  const furtherTax =
    (record.further_tax_rate ?? 0) > 0
      ? round2((taxable * (record.further_tax_rate ?? 0)) / 100)
      : 0;
  const total = round2(taxable + salesTax + furtherTax);

  const itemsChanged =
    pending &&
    items.length !== (record.line_items ?? []).length
      ? true
      : pending &&
        items.some((it, idx) => {
          const orig = (record.line_items ?? [])[idx];
          return (
            !orig ||
            orig.quantity !== it.quantity ||
            orig.unit_price_pkr !== it.unit_price_pkr ||
            orig.product_id !== it.product_id
          );
        });

  function updateItem(index: number, patch: Partial<DispatchLineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!record || saving) return;
    if (pending) {
      if (items.length === 0) {
        toast.error("A dispatch needs at least one line item.");
        return;
      }
      if (items.some((it) => !(Number(it.quantity) > 0))) {
        toast.error("Every line needs a quantity greater than zero.");
        return;
      }
      if (items.some((it) => Number(it.unit_price_pkr) < 0)) {
        toast.error("Unit prices cannot be negative.");
        return;
      }
    }

    setSaving(true);
    try {
      // ── 1. Keep the sales invoice in sync when line items changed ─────────
      if (itemsChanged) {
        const itemsOk = await updateInvoiceItems(record.invoice_id, items);
        if (!itemsOk) {
          toast.error(`Could not update invoice items for ${record.invoice_number}.`);
          return;
        }
        const headerOk = await updateInvoice(record.invoice_id, {
          taxable_value_pkr: taxable,
          sales_tax_rate: record.sales_tax_rate,
          sales_tax_amount_pkr: salesTax,
          further_tax_rate: record.further_tax_rate ?? 0,
          further_tax_amount_pkr: furtherTax,
          total_invoice_value_pkr: total,
        });
        if (!headerOk) {
          toast.error(`Could not update invoice totals for ${record.invoice_number}.`);
          return;
        }
      }

      // ── 2. Patch the dispatch record ──────────────────────────────────────
      const patch: DispatchRecordPatch = {
        dispatch_date: dispatchDate || undefined,
        transport_details: transportDetails,
        operator_notes: operatorNotes,
      };
      if (itemsChanged) {
        patch.line_items = items;
        patch.taxable_value_pkr = taxable;
        patch.sales_tax_amount_pkr = salesTax;
        patch.further_tax_amount_pkr = furtherTax;
        patch.total_invoice_value_pkr = total;
      }
      if (resolvedStatus === "approved" && targetStatus === "dispatched") {
        patch.status = "dispatched";
      }

      const updated = await updateDispatchRecord(record.id, patch);
      if (!updated) {
        toast.error(`Could not update dispatch ${record.invoice_number}.`);
        return;
      }

      toast.success(`Dispatch ${record.invoice_number} updated`);
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "w-full h-9 px-3 rounded-lg bg-bg-canvas border border-border-default text-body text-foreground focus:outline-none focus:border-brand-blue transition-colors";

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={() => { if (!saving) onClose(); }} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="p-5 border-b border-border-subtle flex items-start justify-between gap-3">
            <div>
              <h2 className="text-h2 font-semibold">Edit Dispatch</h2>
              <p className="text-body text-secondary mt-1 font-mono">{record.invoice_number}</p>
            </div>
            <button
              onClick={onClose}
              disabled={saving}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Status */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-secondary">Status</span>
              {resolvedStatus === "pending_approval" ? (
                <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full bg-status-amber/15 text-status-amber">
                  Pending Approval — approve from Dispatch History to deduct stock and post the ledger
                </span>
              ) : resolvedStatus === "dispatched" ? (
                <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full bg-status-optimal/15 text-status-optimal">
                  Dispatched
                </span>
              ) : (
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as DispatchStatus)}
                  className="h-8 px-2 rounded-lg bg-bg-canvas border border-border-default text-body text-foreground focus:outline-none focus:border-brand-blue"
                >
                  <option value="approved">Approved</option>
                  <option value="dispatched">Dispatched (goods left)</option>
                </select>
              )}
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption text-muted font-medium uppercase tracking-wider">Items Dispatched</span>
                {itemsLocked && (
                  <span className="text-caption text-muted">
                    Locked after approval — delete the dispatch to re-issue it
                  </span>
                )}
              </div>
              <div className="border border-border-subtle rounded-lg overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-subtle bg-bg-subtle">
                      <th className="px-3 py-2 text-caption text-muted font-medium">Product</th>
                      <th className="px-3 py-2 text-caption text-muted font-medium w-[90px] text-right">Qty</th>
                      <th className="px-3 py-2 text-caption text-muted font-medium w-[120px] text-right">Unit Price</th>
                      <th className="px-3 py-2 text-caption text-muted font-medium w-[130px] text-right">Line Total</th>
                      {!itemsLocked && <th className="px-3 py-2 w-[40px]" />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-caption text-muted">
                          No line items — add items by editing the invoice before approval.
                        </td>
                      </tr>
                    )}
                    {items.map((it, idx) => (
                      <tr key={`${it.product_id || it.product_name}-${idx}`} className="border-b border-border-subtle last:border-b-0">
                        <td className="px-3 py-2 text-body text-foreground">
                          {it.product_name || "—"}
                          <span className="text-caption text-muted ml-1">({it.unit_of_measure || "NOS"})</span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            disabled={itemsLocked}
                            value={it.quantity}
                            onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                            className="w-full h-8 px-2 text-right rounded-md bg-bg-canvas border border-border-default font-mono text-num-table text-foreground focus:outline-none focus:border-brand-blue disabled:bg-bg-muted disabled:text-secondary"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            disabled={itemsLocked}
                            value={it.unit_price_pkr}
                            onChange={(e) => updateItem(idx, { unit_price_pkr: Number(e.target.value) })}
                            className="w-full h-8 px-2 text-right rounded-md bg-bg-canvas border border-border-default font-mono text-num-table text-foreground focus:outline-none focus:border-brand-blue disabled:bg-bg-muted disabled:text-secondary"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-num-table text-secondary whitespace-nowrap">
                          {formatPKR(it.quantity * it.unit_price_pkr)}
                        </td>
                        {!itemsLocked && (
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => removeItem(idx)}
                              title="Remove line"
                              className="h-6 w-6 rounded-md text-status-alert hover:bg-status-alert/10 transition-colors inline-flex items-center justify-center"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="mt-3 ml-auto w-full max-w-[280px] space-y-1">
                <div className="flex justify-between text-body">
                  <span className="text-secondary">Taxable Value</span>
                  <span className="font-mono text-num-table text-foreground">
                    {formatPKR(pending ? taxable : record.taxable_value_pkr)}
                  </span>
                </div>
                <div className="flex justify-between text-body">
                  <span className="text-secondary">Sales Tax ({record.sales_tax_rate ?? 0}%)</span>
                  <span className="font-mono text-num-table text-foreground">
                    {formatPKR(pending ? salesTax : record.sales_tax_amount_pkr)}
                  </span>
                </div>
                {(record.further_tax_rate ?? 0) > 0 && (
                  <div className="flex justify-between text-body">
                    <span className="text-secondary">Further Tax ({record.further_tax_rate}%)</span>
                    <span className="font-mono text-num-table text-status-amber">
                      {formatPKR(pending ? furtherTax : record.further_tax_amount_pkr)}
                    </span>
                  </div>
                )}
                <div className="glow-line my-1" />
                <div className="flex justify-between text-body font-semibold">
                  <span className="text-foreground">Grand Total</span>
                  <span className="font-mono text-num-kpi text-crimson-primary">
                    {formatPKR(pending ? total : record.total_invoice_value_pkr)}
                  </span>
                </div>
              </div>
            </div>

            {/* Dispatch parameters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-caption text-muted font-medium mb-1.5">Dispatch Date</label>
                <input
                  type="date"
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="block text-caption text-muted font-medium mb-1.5">Transport Details</label>
                <input
                  type="text"
                  value={transportDetails}
                  onChange={(e) => setTransportDetails(e.target.value)}
                  placeholder="Vehicle / transporter / remarks"
                  className={fieldClass}
                />
              </div>
            </div>
            <div>
              <label className="block text-caption text-muted font-medium mb-1.5">Operator Notes</label>
              <textarea
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes for this dispatch"
                className={`${fieldClass} h-auto py-2 resize-none`}
              />
            </div>
          </div>

          <div className="p-5 border-t border-border-subtle flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-brand-blue text-white font-medium text-body hover:bg-brand-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {saving && <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
