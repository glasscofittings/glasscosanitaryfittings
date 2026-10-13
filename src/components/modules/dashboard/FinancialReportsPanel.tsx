"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Lock,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { useModuleVisibility } from "@/components/providers/ModuleVisibilityContext";
import { useAuth } from "@/components/providers/AuthProvider";
import { formatPKR } from "@/lib/utils/formatters";
import {
  applyReportPreset,
  emptyDashboardReports,
  fetchDashboardReports,
  normalizeReportPeriod,
  resolveReportSections,
  todayISO,
  type DashboardReports,
  type ReportPeriodPreset,
} from "@/lib/supabase/financial-reports";
import {
  canViewQuotationMargins,
  QUOTATION_STATUSES,
  QUOTATION_STATUS_LABELS,
  type QuotationStatus,
} from "@/lib/supabase/quotations";

type PresetChoice = ReportPeriodPreset | "CUSTOM";

const PRESETS: { key: ReportPeriodPreset; label: string }[] = [
  { key: "ALL", label: "All Time" },
  { key: "TODAY", label: "Today" },
  { key: "THIS_MONTH", label: "Month" },
  { key: "LAST_30_DAYS", label: "Last 30 Days" },
];

const STATUS_BADGES: Record<QuotationStatus, string> = {
  DRAFT: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  ISSUED: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  ACCEPTED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  REJECTED: "bg-red-500/15 text-red-400 border-red-500/30",
  EXPIRED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  CANCELLED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

const TABLE_HEAD =
  "px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium";
const TABLE_HEAD_RIGHT = `${TABLE_HEAD} text-right`;
const TABLE_CELL = "px-3 py-2 border-t border-border-subtle text-foreground";
const TABLE_CELL_RIGHT = `${TABLE_CELL} text-right font-mono`;

export default function FinancialReportsPanel() {
  const { visibility, hydrated } = useModuleVisibility();
  const { profile } = useAuth();
  // COGS / gross profit / margin are internal cost data — OWNER only,
  // the same permission the quotation margin panel uses.
  const showCosts = canViewQuotationMargins(profile?.role);

  const [preset, setPreset] = useState<PresetChoice>("THIS_MONTH");
  const [range, setRange] = useState(() => applyReportPreset("THIS_MONTH"));
  const [reports, setReports] = useState<DashboardReports>(emptyDashboardReports);
  /** Key of the last completed load; loading = derived, never set inside the effect. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const sections = useMemo(() => resolveReportSections(visibility), [visibility]);
  const period = useMemo(
    () => normalizeReportPeriod(range.startDate, range.endDate),
    [range],
  );
  const sectionsKey = JSON.stringify(sections);
  const periodKey = `${period.startDate ?? "*"}|${period.endDate ?? "*"}`;
  const requestKey = `${periodKey}|${sectionsKey}|${showCosts ? "cost" : "nocost"}|${refreshTick}`;
  const loading = !hydrated || loadedKey !== requestKey;
  const anySection =
    sections.sales ||
    sections.expenses ||
    sections.purchases ||
    sections.suppliers ||
    sections.quotations ||
    sections.ledger;

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    fetchDashboardReports({ period, sections, includeCosts: showCosts })
      .then((next) => {
        if (cancelled) return;
        setReports(next);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err) => {
        console.error("[dashboard financial reports]", err);
        if (cancelled) return;
        setReports(emptyDashboardReports());
        setError("Could not load report data. Try refreshing.");
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
    // period / sections / showCosts are captured through requestKey, which
    // changes exactly when any of them changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, requestKey]);

  const handlePreset = (p: ReportPeriodPreset) => {
    setPreset(p);
    setRange(applyReportPreset(p));
  };

  const handleDateInput = (field: "startDate" | "endDate", value: string) => {
    setPreset("CUSTOM");
    setRange((prev) => ({ ...prev, [field]: value }));
  };

  const periodLabel =
    period.startDate || period.endDate
      ? `${period.startDate ?? "…"} → ${period.endDate ?? "…"}`
      : "All time";

  const sales = reports.sales;
  const expenses = reports.expenses;
  const purchases = reports.purchases;
  const suppliers = reports.suppliers;
  const quotations = reports.quotations;
  const ledger = reports.ledgerRevenue;

  const revenueVsLedger =
    sales && ledger
      ? r2(sales.revenue_excl_tax - ledger.revenue_pkr)
      : null;

  return (
    <GlassCard hover={false} className="space-y-5">
      {/* Header + date filters (same presets/inputs as the Expenses page) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
            Financial Reports
          </h2>
          <p className="text-[11px] text-muted mt-0.5">
            Period: <span className="font-mono">{periodLabel}</span> · Posted
            invoices only — quotations are never counted as sales
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => handlePreset(p.key)}
                className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                  preset === p.key
                    ? "border-crimson-primary bg-crimson-primary/15 text-crimson-primary"
                    : "border-border-subtle text-muted hover:bg-neutral-800/30"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={range.startDate ?? ""}
              onChange={(e) => handleDateInput("startDate", e.target.value)}
              className="px-2 py-1.5 text-[11px] rounded bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              title="Start Date"
            />
            <span className="text-muted text-xs">to</span>
            <input
              type="date"
              value={range.endDate ?? ""}
              onChange={(e) => handleDateInput("endDate", e.target.value)}
              className="px-2 py-1.5 text-[11px] rounded bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              title="End Date"
            />
          </div>
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            className="p-1.5 rounded border border-border-subtle text-muted hover:text-foreground transition-colors"
            title="Refresh report data"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-xs text-muted">
          <div className="w-5 h-5 border-2 border-crimson-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Loading report data…
        </div>
      ) : error ? (
        <p className="p-4 text-xs text-status-alert">{error}</p>
      ) : !anySection ? (
        <p className="p-4 text-xs text-muted">
          All report modules are hidden. Enable them in Settings → Menu
          Visibility.
        </p>
      ) : (
        <div className="space-y-8">
          {/* ── Sales & Profit ─────────────────────────────────────────── */}
          {sections.sales && sales && (
            <Section
              title="Sales & Profit"
              icon={<TrendingUp className="w-3.5 h-3.5 text-brand-ocean" />}
              accent="bg-brand-ocean/10"
              href="/invoicing/"
              note="Posted invoices in period · revenue excludes sales & further tax"
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat
                  label="Sales Revenue (excl. Tax)"
                  value={formatPKR(sales.revenue_excl_tax)}
                  sub={`${sales.posted_invoice_count} posted invoice(s)`}
                />
                <Stat
                  label="Cost of Goods Sold (FIFO)"
                  value={sales.cogs === null ? "Owner only" : formatPKR(sales.cogs)}
                  muted={sales.cogs === null}
                  sub={
                    sales.cogs === null
                      ? "Cost data requires owner access"
                      : sales.unpriced_line_count > 0
                        ? `⚠ ${sales.unpriced_line_count} line(s) without cost data`
                        : "Oldest open lot cost → latest purchase rate"
                  }
                />
                <Stat
                  label="Gross Profit"
                  value={
                    sales.gross_profit === null ? "Owner only" : formatPKR(sales.gross_profit)
                  }
                  muted={sales.gross_profit === null}
                  sub="Revenue − COGS"
                />
                <Stat
                  label="Gross Margin"
                  value={
                    sales.gross_margin_percent === null
                      ? "Owner only"
                      : `${sales.gross_margin_percent}%`
                  }
                  muted={sales.gross_margin_percent === null}
                  sub={
                    sales.markup_percent !== null
                      ? `Markup ${sales.markup_percent}%`
                      : "Profit ÷ revenue"
                  }
                />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-muted">
                <span>Sales tax: {formatPKR(sales.sales_tax)}</span>
                <span>Further tax: {formatPKR(sales.further_tax)}</span>
                <span>Document total: {formatPKR(sales.total_invoice_value)}</span>
                {sections.ledger && ledger && (
                  <span>
                    Ledger revenue (A/c 4001): {formatPKR(ledger.revenue_pkr)}{" "}
                    {revenueVsLedger === null ? "" : revenueVsLedger === 0 ? "· reconciled ✓" : `· variance ${formatPKR(revenueVsLedger)}`}
                  </span>
                )}
              </div>
              {sales.posted_invoice_count === 0 && (
                <p className="text-[11px] text-muted mt-1">
                  No posted invoices in this period.
                </p>
              )}
            </Section>
          )}

          {/* ── Expenses ───────────────────────────────────────────────── */}
          {sections.expenses && expenses && (
            <Section
              title="Expenses"
              icon={<Wallet className="w-3.5 h-3.5 text-brand-coral" />}
              accent="bg-brand-coral/10"
              href="/expenses/"
              note="Draft and cancelled expenses excluded from totals"
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat
                  label="Expenses Today"
                  value={formatPKR(expenses.todayTotal)}
                  sub="UTC calendar day"
                />
                <Stat
                  label="Expenses This Month"
                  value={formatPKR(expenses.monthTotal)}
                  sub="Current month to date"
                />
                <Stat
                  label="Expenses in Period"
                  value={formatPKR(expenses.periodTotal)}
                  sub={`${expenses.periodCount} expense(s) · ${periodLabel}`}
                />
                <Stat
                  label="Paid / Unpaid (Period)"
                  value={`${formatPKR(expenses.periodPaidTotal)} / ${formatPKR(expenses.periodUnpaidTotal)}`}
                  sub={`Draft ${formatPKR(expenses.periodDraftTotal)} · Cancelled ${formatPKR(expenses.periodCancelledTotal)}`}
                />
              </div>

              {expenses.categoryRows.length === 0 ? (
                <p className="text-[11px] text-muted mt-2">
                  No expenses in this period.
                </p>
              ) : (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-neutral-900/40 text-muted uppercase tracking-wider text-[10px]">
                        <th className={TABLE_HEAD}>Category</th>
                        <th className={TABLE_HEAD_RIGHT}>Count</th>
                        <th className={TABLE_HEAD_RIGHT}>Amount</th>
                        <th className={TABLE_HEAD_RIGHT}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.categoryRows.map((row) => (
                        <tr key={row.category} className="hover:bg-neutral-800/25">
                          <td className={TABLE_CELL}>{row.label}</td>
                          <td className={TABLE_CELL_RIGHT}>{row.count}</td>
                          <td className={TABLE_CELL_RIGHT}>
                            {formatPKR(row.amount)}
                          </td>
                          <td className={TABLE_CELL_RIGHT}>
                            {row.percentage}%
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-neutral-900/30">
                        <td className={`${TABLE_CELL} font-bold`}>Total</td>
                        <td className={`${TABLE_CELL_RIGHT} font-bold`}>
                          {expenses.categoryRows.reduce((s, r) => s + r.count, 0)}
                        </td>
                        <td className={`${TABLE_CELL_RIGHT} font-bold`}>
                          {formatPKR(expenses.periodTotal)}
                        </td>
                        <td className={TABLE_CELL_RIGHT}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {/* ── Purchases ──────────────────────────────────────────────── */}
          {sections.purchases && purchases && (
            <Section
              title="Purchases"
              icon={<ShoppingCart className="w-3.5 h-3.5 text-brand-ocean" />}
              accent="bg-brand-ocean/10"
              href="/catalog/"
              note="Buying activity in period — not Cost of Goods Sold"
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat
                  label="Purchases in Period"
                  value={formatPKR(purchases.totals.total_purchase_pkr)}
                  sub={`${purchases.totals.purchase_count} purchase(s)${
                    purchases.totals.draft_count > 0
                      ? ` · incl. ${formatPKR(purchases.totals.draft_total_pkr)} draft`
                      : ""
                  } · cancelled excluded`}
                />
                <Stat
                  label="Quantity Purchased"
                  value={String(purchases.totals.total_quantity)}
                  sub="Units across all products"
                />
                <Stat
                  label="Freight / Additional Cost"
                  value={formatPKR(purchases.totals.total_additional_cost_pkr)}
                  sub={`Tax ${formatPKR(purchases.totals.total_tax_pkr)} · Discount ${formatPKR(purchases.totals.total_discount_pkr)}`}
                />
                <Stat
                  label="Suppliers (by spend)"
                  value={String(purchases.bySupplier.length)}
                  sub={`${purchases.byProduct.length} product(s) purchased`}
                />
              </div>

              {purchases.bySupplier.length === 0 ? (
                <p className="text-[11px] text-muted mt-2">
                  No purchases in this period.
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
                  <ReportTable
                    head={
                      <>
                        <th className={TABLE_HEAD}>Supplier</th>
                        <th className={TABLE_HEAD_RIGHT}>Purchases</th>
                        <th className={TABLE_HEAD_RIGHT}>Total</th>
                      </>
                    }
                  >
                    {purchases.bySupplier.slice(0, 8).map((row) => (
                      <tr key={row.group_key} className="hover:bg-neutral-800/25">
                        <td className={TABLE_CELL}>{row.group_label}</td>
                        <td className={TABLE_CELL_RIGHT}>{row.purchase_count}</td>
                        <td className={TABLE_CELL_RIGHT}>
                          {formatPKR(row.total_purchase_pkr)}
                        </td>
                      </tr>
                    ))}
                  </ReportTable>
                  <ReportTable
                    head={
                      <>
                        <th className={TABLE_HEAD}>Product</th>
                        <th className={TABLE_HEAD_RIGHT}>Qty</th>
                        <th className={TABLE_HEAD_RIGHT}>Total</th>
                      </>
                    }
                  >
                    {purchases.byProduct.slice(0, 8).map((row) => (
                      <tr key={row.group_key} className="hover:bg-neutral-800/25">
                        <td className={TABLE_CELL}>{row.group_label}</td>
                        <td className={TABLE_CELL_RIGHT}>{row.total_quantity}</td>
                        <td className={TABLE_CELL_RIGHT}>
                          {formatPKR(row.total_purchase_pkr)}
                        </td>
                      </tr>
                    ))}
                  </ReportTable>
                </div>
              )}
            </Section>
          )}

          {/* ── Supplier outstanding balances ──────────────────────────── */}
          {sections.suppliers && suppliers && (
            <Section
              title="Supplier Outstanding"
              icon={<Users className="w-3.5 h-3.5 text-brand-coral" />}
              accent="bg-brand-coral/10"
              href="/crm/"
              note={`Balance as of ${todayISO()} (all dates · same figures as CRM)`}
            >
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <Stat
                  label="Total Payables"
                  value={formatPKR(suppliers.total_outstanding_pkr)}
                  sub="Σ supplier outstanding balances"
                />
                <Stat
                  label="Suppliers with Balance"
                  value={String(suppliers.supplier_count)}
                  sub="Suppliers with invoices or open balance"
                />
                <Stat
                  label="Top Outstanding"
                  value={
                    suppliers.rows.length > 0
                      ? formatPKR(suppliers.rows[0].outstanding_balance_pkr)
                      : formatPKR(0)
                  }
                  sub={suppliers.rows[0]?.party_name ?? "—"}
                />
              </div>

              {suppliers.rows.length === 0 ? (
                <p className="text-[11px] text-muted mt-2">
                  No supplier invoices or balances yet.
                </p>
              ) : (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-neutral-900/40 text-muted uppercase tracking-wider text-[10px]">
                        <th className={TABLE_HEAD}>Supplier</th>
                        <th className={TABLE_HEAD_RIGHT}>Invoices</th>
                        <th className={TABLE_HEAD_RIGHT}>Billed</th>
                        <th className={TABLE_HEAD_RIGHT}>Paid</th>
                        <th className={TABLE_HEAD_RIGHT}>Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suppliers.rows.slice(0, 10).map((row) => (
                        <tr key={row.party_id} className="hover:bg-neutral-800/25">
                          <td className={TABLE_CELL}>{row.party_name}</td>
                          <td className={TABLE_CELL_RIGHT}>{row.invoice_count}</td>
                          <td className={TABLE_CELL_RIGHT}>
                            {formatPKR(row.total_invoice_value_pkr)}
                          </td>
                          <td className={TABLE_CELL_RIGHT}>
                            {formatPKR(row.total_paid_pkr)}
                          </td>
                          <td
                            className={`${TABLE_CELL_RIGHT} font-bold ${
                              row.outstanding_balance_pkr > 0
                                ? "text-crimson-primary"
                                : "text-status-optimal"
                            }`}
                          >
                            {formatPKR(row.outstanding_balance_pkr)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-neutral-900/30">
                        <td className={`${TABLE_CELL} font-bold`} colSpan={4}>
                          Total outstanding (
                          {suppliers.rows.length > 10 ? "top 10 shown · " : ""}
                          {suppliers.supplier_count} suppliers)
                        </td>
                        <td className={`${TABLE_CELL_RIGHT} font-bold`}>
                          {formatPKR(suppliers.total_outstanding_pkr)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {/* ── Quotations ─────────────────────────────────────────────── */}
          {sections.quotations && quotations && (
            <Section
              title="Quotations"
              icon={<FileText className="w-3.5 h-3.5 text-brand-ocean" />}
              accent="bg-brand-ocean/10"
              href="/quotations/"
              note="Offers only — value counts as sales solely after conversion to an invoice"
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat
                  label="Quoted Value (period)"
                  value={formatPKR(quotations.total_value_pkr)}
                  sub={`${quotations.total_count} quotation(s) · cancelled excluded`}
                />
                <Stat
                  label="Accepted Value"
                  value={formatPKR(quotations.accepted_value_pkr)}
                  sub={`${quotations.accepted_count} accepted`}
                />
                <Stat
                  label="Conversion Rate"
                  value={`${quotations.conversion_rate_percent}%`}
                  sub={`${quotations.converted_count} of ${quotations.sent_count} issued converted`}
                />
                <Stat
                  label="Converted to Invoice"
                  value={formatPKR(quotations.converted_value_pkr)}
                  sub={`${quotations.converted_count} invoice(s) created`}
                />
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {QUOTATION_STATUSES.map((status) => (
                  <span
                    key={status}
                    className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGES[status]}`}
                  >
                    {QUOTATION_STATUS_LABELS[status]}:{" "}
                    {statusCount(quotations, status)}
                  </span>
                ))}
                {quotations.total_count === 0 && (
                  <span className="text-[11px] text-muted">
                    No quotations in this period.
                  </span>
                )}
              </div>
            </Section>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/* ─── Small presentational helpers ────────────────────────────────────────── */

function Section({
  title,
  icon,
  accent,
  note,
  href,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  note?: string;
  /** Drill-down to the module's detailed report (same permission as the section). */
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-6 w-6 rounded-md ${accent} flex items-center justify-center shrink-0`}
          >
            {icon}
          </span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {note && <p className="text-[10px] text-muted">{note}</p>}
          {href && (
            <Link
              href={href}
              className="text-[10px] text-muted hover:text-foreground underline-offset-2 hover:underline whitespace-nowrap"
            >
              View details →
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  muted = false,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-subtle/50 p-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted truncate">
        {label}
      </p>
      <p
        className={`font-mono font-bold text-sm mt-1 truncate ${
          muted ? "text-muted" : "text-foreground"
        }`}
        title={value}
      >
        {muted && <Lock className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function ReportTable({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-neutral-900/40 text-muted uppercase tracking-wider text-[10px]">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function statusCount(
  quotations: NonNullable<DashboardReports["quotations"]>,
  status: QuotationStatus,
): number {
  switch (status) {
    case "DRAFT":
      return quotations.draft_count;
    case "ISSUED":
      return quotations.issued_count;
    case "ACCEPTED":
      return quotations.accepted_count;
    case "REJECTED":
      return quotations.rejected_count;
    case "EXPIRED":
      return quotations.expired_count;
    case "CANCELLED":
      return quotations.cancelled_count;
  }
}
