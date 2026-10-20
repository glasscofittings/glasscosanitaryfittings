"use client";

import {
  type DispatchRecord,
  type DispatchLineItem,
  type DispatchStatus,
} from "@/lib/supabase/invoicing";
import { formatPKR } from "@/lib/utils/formatters";

/**
 * Status badge rules (light mode):
 *  - Pending Approval → warning/amber
 *  - Approved         → info/blue (#1D5298 brand blue)
 *  - Dispatched       → success/green
 * Rows without a status (database predates migration 20261107010000) are
 * legacy completed dispatches and render as "Dispatched".
 */
function StatusBadge({ status }: { status?: DispatchStatus }) {
  const resolved: DispatchStatus = status ?? "dispatched";
  const styles: Record<DispatchStatus, string> = {
    pending_approval: "bg-status-amber/15 text-status-amber",
    approved: "bg-brand-blue/15 text-brand-blue",
    dispatched: "bg-status-optimal/15 text-status-optimal",
  };
  const labels: Record<DispatchStatus, string> = {
    pending_approval: "Pending Approval",
    approved: "Approved",
    dispatched: "Dispatched",
  };
  return (
    <span
      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${styles[resolved]}`}
    >
      {labels[resolved]}
    </span>
  );
}

interface Props {
  records: DispatchRecord[];
  /** Id of the row currently calling approve_dispatch (drives its spinner). */
  approvingId: string | null;
  onApprove: (record: DispatchRecord) => void;
  onEdit: (record: DispatchRecord) => void;
  onDelete: (record: DispatchRecord) => void;
}

export default function DispatchHistoryTable({
  records,
  approvingId,
  onApprove,
  onEdit,
  onDelete,
}: Props) {
  if (records.length === 0) return null;

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">Dispatch History</h2>
          <span className="badge">{records.length} dispatches</span>
        </div>
        <div className="glow-line mb-4" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[140px]">Invoice #</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[160px]">Customer</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[200px]">Products</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Taxable</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px] text-right">Tax</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Total</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[130px]">Status</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[140px]">Dispatched</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px]">Operator</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[240px] text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const items = Array.isArray(rec.line_items) ? rec.line_items : [];
              const productNames = items.length > 0
                ? items.map((i: DispatchLineItem) => `${i.product_name} (${i.quantity})`).join(", ")
                : "—";
              const status: DispatchStatus = rec.status ?? "dispatched";
              const pending = status === "pending_approval";
              const busy = approvingId !== null;
              return (
                <tr key={rec.id} className="border-b border-border-subtle hover:bg-bg-subtle transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-num-code text-secondary whitespace-nowrap">{rec.invoice_number}</span>
                  </td>
                  <td className="px-4 py-3 text-body text-foreground truncate">{rec.customer_name || rec.parties?.name || "—"}</td>
                  <td className="px-4 py-3 text-caption text-secondary truncate max-w-[200px]" title={productNames}>{productNames}</td>
                  <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">{formatPKR(rec.taxable_value_pkr)}</td>
                  <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">
                    {formatPKR(rec.sales_tax_amount_pkr + rec.further_tax_amount_pkr)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-num-kpi font-bold text-foreground whitespace-nowrap">{formatPKR(rec.total_invoice_value_pkr)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={rec.status} />
                  </td>
                  <td className="px-4 py-3 text-caption text-secondary whitespace-nowrap">
                    {new Date(rec.posted_at).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-caption text-secondary">{rec.operator_name || "—"}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-2">
                      {pending && (
                        <button
                          onClick={() => onApprove(rec)}
                          disabled={busy}
                          title={`Approve dispatch ${rec.invoice_number} — deduct stock and post the customer ledger debit`}
                          className="h-7 px-2.5 rounded-md bg-brand-blue text-white text-caption font-medium border border-brand-blue hover:bg-brand-blue/90 transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {approvingId === rec.id ? (
                            <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" />
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {approvingId === rec.id ? "Approving..." : "Approve"}
                        </button>
                      )}
                      <button
                        onClick={() => onEdit(rec)}
                        title={`Edit dispatch ${rec.invoice_number}`}
                        className="h-7 px-2.5 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground hover:bg-bg-subtle transition-colors inline-flex items-center gap-1"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(rec)}
                        title={`Delete dispatch ${rec.invoice_number}`}
                        className="h-7 px-2.5 rounded-md bg-status-alert/10 text-status-alert text-caption font-medium border border-status-alert/20 hover:bg-status-alert/20 transition-colors inline-flex items-center gap-1"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
