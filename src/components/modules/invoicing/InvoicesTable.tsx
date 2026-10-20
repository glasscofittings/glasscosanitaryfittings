"use client";

import { type SalesInvoice } from "@/lib/supabase/invoicing";
import { formatPKR } from "@/lib/utils/formatters";

interface Props {
  invoices: SalesInvoice[];
  onPost: (invoice: SalesInvoice) => void;
  onView: (invoice: SalesInvoice) => void;
  onEdit: (invoice: SalesInvoice) => void;
  onDelete: (invoice: SalesInvoice) => void;
  emptyMessage?: string;
}

/** Total discount given on an invoice = header discount + sum of per-line discounts. */
function totalInvoiceDiscount(inv: SalesInvoice): number {
  const header = inv.discount_pkr ?? 0;
  const lines = (inv.items ?? []).reduce((a, i) => a + (i.discount_pkr ?? 0), 0);
  return Math.round((header + lines) * 100) / 100;
}

/** Comma-separated product names; when there are more than 2, show the first two + a "+N more" badge. */
function productSummary(inv: SalesInvoice): { label: string; extra: number; full: string } {
  const names = (inv.items ?? [])
    .map((i) => i.product_name)
    .filter((n): n is string => !!n);
  const full = names.join(", ");
  if (names.length === 0) return { label: "—", extra: 0, full };
  if (names.length <= 2) return { label: full, extra: 0, full };
  return { label: names.slice(0, 2).join(", "), extra: names.length - 2, full };
}

export default function InvoicesTable({ invoices, onPost, onView, onEdit, onDelete, emptyMessage }: Props) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">Recent Invoices</h2>
          <span className="badge">{invoices.length} records</span>
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
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Discount</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Taxable</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px] text-right">Tax</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Total</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[90px] text-center">Status</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[220px] text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted">
                  {emptyMessage || "No invoices found matching your search"}
                </td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const discount = totalInvoiceDiscount(inv);
                const products = productSummary(inv);
                return (
                <tr
                  key={inv.id}
                  className="border-b border-border-subtle hover:bg-bg-subtle transition-colors cursor-pointer"
                  onClick={() => onView(inv)}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-num-code text-secondary whitespace-nowrap">{inv.invoice_number}</span>
                  </td>
                  <td className="px-4 py-3 text-body text-foreground truncate">{inv.parties?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-caption text-secondary truncate max-w-[200px]" title={products.full}>
                    {products.label}
                    {products.extra > 0 && (
                      <span className="ml-1.5 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-bg-muted border border-border-default text-muted align-middle">
                        +{products.extra} more
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">
                    {discount > 0 ? formatPKR(discount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">{formatPKR(inv.taxable_value_pkr)}</td>
                  <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">
                    {formatPKR(inv.sales_tax_amount_pkr + inv.further_tax_amount_pkr)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-num-kpi font-bold text-foreground whitespace-nowrap">{formatPKR(inv.total_invoice_value_pkr)}</td>
                  <td className="px-4 py-3 text-center">
                    {inv.is_posted ? (
                      <span className="inline-block text-caption font-medium px-2 py-0.5 rounded border bg-status-optimal/15 text-status-optimal border-status-optimal/20">
                        Posted
                      </span>
                    ) : (
                      <span className="inline-block text-caption font-medium px-2 py-0.5 rounded border bg-status-amber/15 text-status-amber border-status-amber/20">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => onEdit(inv)}
                        className="h-7 px-2.5 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground hover:bg-bg-subtle transition-colors inline-flex items-center gap-1"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                      {!inv.is_posted && (
                        <button
                          onClick={() => onPost(inv)}
                          className="h-7 px-2.5 rounded-md bg-crimson-primary/10 text-crimson-light text-caption font-medium border border-crimson-primary/20 hover:bg-crimson-primary/20 transition-colors"
                        >
                          Print
                        </button>
                      )}
                      <button
                        onClick={() => onDelete(inv)}
                        title={`Delete invoice ${inv.invoice_number}`}
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
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
