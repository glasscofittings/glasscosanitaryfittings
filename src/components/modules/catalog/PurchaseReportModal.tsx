"use client";

import React, { useMemo, useState } from "react";
import { X, FileDown } from "lucide-react";
import { formatPKR } from "@/lib/utils/formatters";
import { exportProductPurchasesReportPDF } from "@/lib/pdf-exporter";
import {
  type ProductPurchase,
  type PurchaseReportRow,
  filterPurchases,
  buildPurchaseReportByProduct,
  buildPurchaseReportBySupplier,
  summarizePurchases,
} from "@/lib/supabase/purchases";
import { useAuth } from "@/components/providers/AuthProvider";

interface PurchaseReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchases: ProductPurchase[];
}

type GroupBy = "product" | "supplier";

/**
 * Purchase report with product / supplier grouping and a date-range filter.
 * Cancelled purchases are counted but never included in financial totals.
 */
export default function PurchaseReportModal({
  isOpen,
  onClose,
  purchases,
}: PurchaseReportModalProps) {
  const { profile } = useAuth();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("product");
  const [exporting, setExporting] = useState(false);

  const filter = useMemo(
    () => ({ startDate: startDate || undefined, endDate: endDate || undefined }),
    [startDate, endDate]
  );

  const filtered = useMemo(() => filterPurchases(purchases, filter), [purchases, filter]);

  const rows: PurchaseReportRow[] = useMemo(() => {
    return groupBy === "product"
      ? buildPurchaseReportByProduct(filtered)
      : buildPurchaseReportBySupplier(filtered);
  }, [groupBy, filtered]);

  const totals = useMemo(() => summarizePurchases(filtered), [filtered]);

  const rangeLabel = startDate || endDate ? `${startDate || "…"} → ${endDate || "…"}` : "All dates";

  async function handleExport() {
    if (filtered.length === 0 || exporting) return;
    setExporting(true);
    try {
      await exportProductPurchasesReportPDF(filtered, {
        subtitle: `Grouped by ${groupBy} | ${rangeLabel} | ${rows.length} group(s)`,
        operatorName: profile?.email || "Purchase Report",
      });
    } finally {
      setExporting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-neutral-900/40">
          <div>
            <h2 className="text-lg font-bold text-foreground">Purchase Report</h2>
            <p className="text-xs text-muted mt-0.5">
              Purchases by {groupBy === "product" ? "product" : "supplier"} &amp; date range —
              cancelled rows excluded from totals
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              />
            </div>

            <div className="flex bg-bg-muted p-0.5 rounded-lg border border-border-default">
              <button
                type="button"
                onClick={() => setGroupBy("product")}
                className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${
                  groupBy === "product"
                    ? "bg-bg-subtle text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                By Product
              </button>
              <button
                type="button"
                onClick={() => setGroupBy("supplier")}
                className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${
                  groupBy === "supplier"
                    ? "bg-bg-subtle text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                By Supplier
              </button>
            </div>

            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="h-8 px-3 rounded-lg text-xs text-muted hover:text-foreground border border-border-subtle transition-colors"
              >
                Clear dates
              </button>
            )}

            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0 || exporting}
              className="ml-auto h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-xs hover:bg-bg-subtle hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <FileDown className="h-4 w-4" />
              {exporting ? "Exporting…" : "Export PDF"}
            </button>
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-surface-subtle border border-border-subtle rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted">Purchases</p>
              <p className="text-lg font-bold font-mono text-foreground">
                {totals.purchase_count}
              </p>
            </div>
            <div className="bg-surface-subtle border border-border-subtle rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted">Total Quantity</p>
              <p className="text-lg font-bold font-mono text-foreground">
                {totals.total_quantity}
              </p>
            </div>
            <div className="bg-surface-subtle border border-border-subtle rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted">Discounts</p>
              <p className="text-lg font-bold font-mono text-foreground">
                {formatPKR(totals.total_discount_pkr)}
              </p>
            </div>
            <div className="bg-surface-subtle border border-border-subtle rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted">Grand Total</p>
              <p className="text-lg font-bold font-mono text-crimson-primary">
                {formatPKR(totals.total_purchase_pkr)}
              </p>
            </div>
          </div>

          {/* Report table */}
          <div className="overflow-x-auto border border-border-subtle rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-neutral-900/40 text-muted text-left">
                  <th className="px-3 py-2 font-medium">{groupBy === "product" ? "Product" : "Supplier"}</th>
                  <th className="px-3 py-2 font-medium">Purchases</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">Avg Rate</th>
                  <th className="px-3 py-2 font-medium text-right">Min / Max</th>
                  <th className="px-3 py-2 font-medium text-right">Latest</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted">
                      No purchases match the selected filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr
                    key={r.group_key}
                    className="border-t border-border-subtle hover:bg-neutral-800/20"
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold text-foreground">{r.group_label}</div>
                      {r.sku && <div className="text-[10px] text-muted font-mono">{r.sku}</div>}
                    </td>
                    <td className="px-3 py-2 text-secondary">
                      {r.purchase_count}
                      <span className="text-[10px] text-muted">
                        {" "}
                        ({r.confirmed_count} confirmed, {r.draft_count} draft
                        {r.cancelled_count > 0 ? `, ${r.cancelled_count} cancelled` : ""})
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">
                      {r.total_quantity}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">
                      {formatPKR(r.avg_rate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted">
                      {formatPKR(r.min_rate)} / {formatPKR(r.max_rate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-secondary">
                      {formatPKR(r.latest_rate)}
                      {r.latest_date && (
                        <div className="text-[10px] text-muted">{r.latest_date}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">
                      {formatPKR(r.total_purchase_pkr)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border-subtle bg-neutral-900/30 font-mono">
                    <td className="px-3 py-2 font-semibold text-foreground">Total</td>
                    <td className="px-3 py-2 text-secondary">{totals.purchase_count}</td>
                    <td className="px-3 py-2 text-right text-foreground">
                      {totals.total_quantity}
                    </td>
                    <td className="px-3 py-2 text-right" />
                    <td className="px-3 py-2 text-right" />
                    <td className="px-3 py-2 text-right" />
                    <td className="px-3 py-2 text-right font-bold text-crimson-primary">
                      {formatPKR(totals.total_purchase_pkr)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <p className="text-[10px] text-muted">
            {rangeLabel} · {filtered.length} raw record(s) · Draft purchases never affect stock or
            the ledger; cancelled purchases never affect totals.
          </p>
        </div>
      </div>
    </div>
  );
}
