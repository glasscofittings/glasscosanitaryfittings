"use client";

import { type InventoryLot } from "@/lib/supabase/inventory";

function expiryBadge(days: number | undefined) {
  if (days === undefined) return null;
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded border bg-status-alert/15 text-status-alert border-status-alert/20">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        EXPIRED
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded border bg-status-amber/15 text-status-amber border-status-amber/20">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {days}d left
      </span>
    );
  }
  return (
    <span className="inline-block text-caption font-medium px-2 py-0.5 rounded border bg-status-optimal/15 text-status-optimal border-status-optimal/20">
      {days}d
    </span>
  );
}

function unitTag(unit: string) {
  const u = unit.toUpperCase();
  const colorMap: Record<string, string> = {
    KG: "bg-crimson-primary/15 text-crimson-light border-crimson-primary/20",
    L: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    BUCKET: "bg-status-amber/15 text-status-amber border-status-amber/20",
    BUCKETS: "bg-status-amber/15 text-status-amber border-status-amber/20",
    PCS: "bg-status-optimal/15 text-status-optimal border-status-optimal/20",
    SET: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    M: "bg-bg-muted text-secondary border-border-default",
  };
  return (
    <span className={`inline-block text-caption font-mono font-medium px-1.5 py-0.5 rounded border ${colorMap[u] ?? colorMap.M}`}>
      {u === "BUCKETS" ? "buckets" : u.toLowerCase()}
    </span>
  );
}

function qcBadge(status: InventoryLot["qc_status"]) {
  const map = {
    PASSED: { label: "PASS", cls: "bg-status-optimal/15 text-status-optimal border-status-optimal/20" },
    PENDING: { label: "PEND", cls: "bg-status-amber/15 text-status-amber border-status-amber/20" },
    FLAGGED_WARNING: { label: "FLAG", cls: "bg-status-alert/15 text-status-alert border-status-alert/20" },
  };
  const s = map[status];
  return (
    <span className={`inline-block text-caption font-mono font-medium px-1.5 py-0.5 rounded border ${s.cls}`}>
      {s.label}
    </span>
  );
}

interface Props {
  lots: InventoryLot[];
  warehouseCode: string;
}

export default function InventoryTable({ lots, warehouseCode }: Props) {
  const expiredCount = lots.filter((l) => (l.days_until_expiry ?? 0) < 0).length;
  const expiringCount = lots.filter((l) => (l.days_until_expiry ?? 999) <= 30 && (l.days_until_expiry ?? 0) >= 0).length;

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">
            {warehouseCode === "WH-01" ? "Raw Material Lots" : "Finished Goods Lots"}
          </h2>
          <div className="flex items-center gap-3">
            {expiredCount > 0 && (
              <span className="flex items-center gap-1.5 text-caption text-status-alert">
                <span className="h-1.5 w-1.5 rounded-full bg-status-alert animate-pulse" />
                {expiredCount} expired
              </span>
            )}
            {expiringCount > 0 && (
              <span className="flex items-center gap-1.5 text-caption text-status-amber">
                <span className="h-1.5 w-1.5 rounded-full bg-status-amber animate-pulse" />
                {expiringCount} expiring
              </span>
            )}
            <span className="badge">{lots.length} lots</span>
          </div>
        </div>
        <div className="glow-line mb-4" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28">Lot #</th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider">Product</th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-24">Lot Code</th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-20 text-center">Unit</th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Remaining</th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-center">Expiry</th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-20 text-center">QC</th>
            </tr>
          </thead>
          <tbody>
            {lots.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                  No lot data found for this warehouse.
                </td>
              </tr>
            ) : (
              lots.map((lot) => {
                const isExpired = (lot.days_until_expiry ?? 0) < 0;
                const isExpiring = (lot.days_until_expiry ?? 999) <= 30 && !isExpired;
                return (
                  <tr
                    key={lot.id}
                    className={`border-b border-border-subtle transition-colors ${
                      isExpired
                        ? "bg-status-alert/[0.04] hover:bg-status-alert/[0.08]"
                        : isExpiring
                        ? "bg-status-amber/[0.03] hover:bg-status-amber/[0.06]"
                        : "hover:bg-bg-subtle"
                    }`}
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-num-code text-secondary">{lot.lot_number}</span>
                    </td>
                    <td className="px-5 py-3 text-body text-foreground truncate">{lot.product?.name ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-caption text-muted">{lot.vendor_lot_code}</span>
                    </td>
                    <td className="px-5 py-3 text-center">{unitTag(lot.product?.unit_of_measure ?? "")}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-mono text-num-table ${isExpired ? "text-status-alert" : "text-foreground"}`}>
                        {lot.remaining_qty.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">{expiryBadge(lot.days_until_expiry)}</td>
                    <td className="px-5 py-3 text-center">{qcBadge(lot.qc_status)}</td>
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
