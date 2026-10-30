"use client";

function EntityBadge({ type }: { type?: string }) {
  if (type === "CUSTOMER") {
    return <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Customer</span>;
  }
  if (type === "VENDOR") {
    return <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25">Vendor / Supplier</span>;
  }
  if (type === "CONTRACTOR") {
    return <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">Contractor</span>;
  }
  if (type === "BOTH") {
    return <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/25">Vendor & Customer</span>;
  }
  return <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/25">Employee</span>;
}

import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Users,
  Wallet,
  Banknote,
  AlertTriangle,
  ReceiptText,
  Factory,
  Building2,
  UserRound,
  DollarSign,
  Landmark,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { PayrollStatusBadge, PayrollHeadBadge, PayrollWageGroupBadge } from "./PayrollBadges";
import { formatPKR } from "@/lib/utils/formatters";
import {
  type EmployeeLedgerAccount,
  type EmployeeLedgerMonth,
  type EmployeeMonthStatus,
} from "@/lib/supabase/payroll";

/** A ledger month, enriched with the run item id so it can be paid directly. */
type LedgerMonth = EmployeeLedgerMonth & { itemId?: string };

interface EmployeeLedgerViewProps {
  /** Pre-aggregated employee accounts (see buildEmployeeLedger). */
  ledger: EmployeeLedgerAccount[];
  /** Worker to auto-expand when navigating back from Transaction History. */
  focusWorkerId?: string | null;
  /** Jump to the Transaction History tab filtered for this employee. */
  onViewTransactions: (workerId: string, workerName: string) => void;
  /** Pay one month of this employee's account straight from the row. */
  onPayItem?: (runId: string, itemId: string) => void;
}

function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "");
  if (clean.length <= 4) return clean;
  return `•••• ${clean.slice(-4)}`;
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Client-facing month status chip: PAID / PARTIAL / UNPAID / NOT POSTED. */
function MonthStatusChip({ status }: { status: EmployeeMonthStatus }) {
  if (status === "PAID") {
    return (
      <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-status-optimal/10 text-status-optimal border border-status-optimal/25">
        Paid
      </span>
    );
  }
  if (status === "PARTIALLY_PAID") {
    return (
      <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/25">
        Partial
      </span>
    );
  }
  if (status === "NOT_POSTED") {
    return (
      <span
        className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-muted/10 text-muted border border-border-subtle"
        title="This run has not been posted to the General Ledger yet."
      >
        Not posted
      </span>
    );
  }
  return (
    <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/25">
      Unpaid
    </span>
  );
}

export default function EmployeeLedgerView({
  ledger,
  focusWorkerId,
  onViewTransactions,
  onPayItem,
}: EmployeeLedgerViewProps) {
  // focusWorkerId seeds the expansion — the parent remounts this view via `key`
  // whenever the focused employee changes.
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(focusWorkerId ?? null);
  const [entityFilter, setEntityFilter] = useState<"ALL" | "EMPLOYEE" | "VENDOR" | "CUSTOMER">("ALL");
  const [unpaidOnly, setUnpaidOnly] = useState(false);

  const entityCounts = useMemo(() => {
    let emp = 0;
    let ven = 0;
    let cust = 0;
    for (const a of ledger) {
      const ent = a.entityType || "EMPLOYEE";
      if (ent === "EMPLOYEE") emp++;
      else if (ent === "VENDOR" || ent === "CONTRACTOR") ven++;
      else if (ent === "CUSTOMER" || ent === "BOTH") cust++;
    }
    return { all: ledger.length, emp, ven, cust };
  }, [ledger]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledger.filter((a) => {
      if (unpaidOnly && a.totalPending <= 0) return false;
      if (entityFilter !== "ALL") {
        const ent = a.entityType || "EMPLOYEE";
        if (entityFilter === "EMPLOYEE" && ent !== "EMPLOYEE") return false;
        if (entityFilter === "VENDOR" && ent !== "VENDOR" && ent !== "CONTRACTOR") return false;
        if (entityFilter === "CUSTOMER" && ent !== "CUSTOMER" && ent !== "BOTH") return false;
      }
      if (!q) return true;
      return (
        a.workerName.toLowerCase().includes(q) ||
        (a.roleDesignation ?? "").toLowerCase().includes(q) ||
        (a.entityType ?? "").toLowerCase().includes(q) ||
        (a.paymentProfile.bankName ?? "").toLowerCase().includes(q)
      );
    });
  }, [ledger, search, entityFilter, unpaidOnly]);

  const totals = useMemo(() => {
    const net = ledger.reduce((s, a) => s + a.totalNetPay, 0);
    const paid = ledger.reduce((s, a) => s + a.totalPaid, 0);
    const pending = ledger.reduce((s, a) => s + a.totalPending, 0);
    const loans = ledger.reduce((s, a) => s + (a.loanBalance || 0), 0);
    const outstanding = ledger.filter((a) => a.totalPending > 0).length;
    return { net, paid, pending, loans, outstanding };
  }, [ledger]);

  /** "employees" / "vendors" / "customers" — for filter-aware empty states. */
  const noun =
    entityFilter === "VENDOR"
      ? "vendors"
      : entityFilter === "CUSTOMER"
      ? "customers"
      : entityFilter === "EMPLOYEE"
      ? "employees"
      : "accounts";

  const summaryCards = [
    {
      label: "Accounts Tracked",
      value: String(ledger.length),
      sub: `${totals.outstanding} with outstanding balance`,
      icon: Users,
      color: "text-foreground",
    },
    {
      label: "Total Payable (All Months)",
      value: formatPKR(totals.net),
      sub: "Net gross-to-net across periods",
      icon: Wallet,
      color: "text-crimson-primary",
    },
    {
      label: "Total Disbursed",
      value: formatPKR(totals.paid),
      sub: "Cash + bank payments executed",
      icon: Banknote,
      color: "text-status-optimal",
    },
    {
      label: "Outstanding / Pending",
      value: formatPKR(totals.pending),
      sub: `Loans outstanding ${formatPKR(totals.loans)}`,
      icon: AlertTriangle,
      color: totals.pending > 0 ? "text-amber-500" : "text-status-optimal",
    },
  ];

  return (
    <div className="space-y-4">
      {/* ─── Summary Tiles ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map((card) => (
          <GlassCard key={card.label} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-muted uppercase tracking-wider truncate">{card.label}</p>
                <p className={`text-h2 font-bold font-mono mt-0.5 truncate ${card.color}`}>{card.value}</p>
                <p className="text-[10px] text-muted mt-0.5 truncate">{card.sub}</p>
              </div>
              <div className="bg-bg-muted p-2 rounded-lg shrink-0">
                <card.icon className="w-4 h-4 text-secondary" />
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* ─── Employee Directory ────────────────────────────────────────── */}
      <GlassCard className="overflow-hidden">
        <div className="p-4 border-b border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-h2 font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-crimson-primary" />
              Employee Accounts
            </h3>
            <p className="text-caption text-muted">
              Employees, vendors &amp; customers — click a row for the month-by-month paid vs unpaid breakdown
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {/* Entity filter tabs */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-muted border border-border-subtle self-start">
              {(["ALL", "EMPLOYEE", "VENDOR", "CUSTOMER"] as const).map((tab) => {
                const count = tab === "ALL" ? entityCounts.all : tab === "EMPLOYEE" ? entityCounts.emp : tab === "VENDOR" ? entityCounts.ven : entityCounts.cust;
                const label = tab === "ALL" ? "All" : tab === "EMPLOYEE" ? "Employees" : tab === "VENDOR" ? "Vendors" : "Customers";
                return (
                  <button
                    key={tab}
                    onClick={() => setEntityFilter(tab)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                      entityFilter === tab
                        ? "bg-crimson-primary text-white font-semibold"
                        : "text-secondary hover:text-foreground"
                    }`}
                  >
                    {label}
                    <span className="text-[9px] px-1 rounded-full bg-black/20 font-mono">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Unpaid-only toggle */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-muted border border-border-subtle self-start">
              {([false, true] as const).map((only) => (
                <button
                  key={String(only)}
                  onClick={() => setUnpaidOnly(only)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    unpaidOnly === only
                      ? "bg-amber-500/15 text-amber-500 font-semibold border border-amber-500/30"
                      : "text-secondary hover:text-foreground"
                  }`}
                >
                  {only ? "Unpaid only" : "All"}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee, vendor, customer, role..."
                className="h-9 pl-9 pr-3 w-full sm:w-64 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption placeholder:text-muted"
              />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center text-muted">
            <Users className="w-10 h-10 mx-auto text-muted/50 mb-2" />
            <p className="text-body font-medium">
              {ledger.length === 0
                ? "No payroll accounts yet."
                : unpaidOnly
                ? `Every ${noun.replace(/s$/, "")} account is fully paid.`
                : `No ${noun} match your search.`}
            </p>
            <p className="text-caption mt-1">
              {ledger.length === 0
                ? "Approve a payroll run from the Calculation Wizard to add employees — customers and vendors come from the CRM parties."
                : "Try a different name, role, or bank."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-caption text-left">
              <thead className="bg-bg-subtle text-secondary uppercase text-[10px] border-b border-border-subtle">
                <tr>
                  <th className="p-3 pl-4">Employee</th>
                  <th className="p-3">Head / Category</th>
                  <th className="p-3">Payment Profile</th>
                  <th className="p-3 text-center">Months</th>
                  <th className="p-3 text-right">Net Payable</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3 text-right">Unpaid</th>
                  <th className="p-3 text-right">Loan Balance</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filtered.map((acc) => {
                  const expanded = expandedId === acc.workerId;
                  return (
                    <React.Fragment key={acc.workerId || acc.workerName}>
                      <tr
                        onClick={() => setExpandedId(expanded ? null : acc.workerId)}
                        className={`hover:bg-bg-subtle/60 cursor-pointer transition-colors ${
                          expanded ? "bg-bg-subtle/40" : ""
                        }`}
                      >
                        <td className="p-3 pl-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-crimson-primary/10 border border-crimson-primary/20 flex items-center justify-center shrink-0">
                              <span className="text-[11px] font-bold text-crimson-primary">
                                {acc.workerName
                                  .split(" ")
                                  .map((p) => p[0])
                                  .slice(0, 2)
                                  .join("")
                                  .toUpperCase() || "?"}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate flex items-center gap-1.5">
                                {acc.workerName}
                                <EntityBadge type={acc.entityType} />
                                {acc.isActive === false && (
                                  <span className="text-[9px] px-1.5 py-px rounded bg-muted/10 text-muted border border-border-subtle font-semibold">
                                    INACTIVE
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-muted truncate">
                                {acc.roleDesignation || "—"} · {acc.employmentType.replace(/_/g, " ")}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {acc.costClass === "PRODUCTION" ? (
                              <Factory className="w-3.5 h-3.5 text-amber-500" />
                            ) : (
                              <Building2 className="w-3.5 h-3.5 text-blue-500" />
                            )}
                            <PayrollHeadBadge costClass={acc.costClass} />
                            <PayrollWageGroupBadge employmentType={acc.employmentType} />
                          </div>
                        </td>
                        <td className="p-3">
                          {acc.paymentProfile.bankName ? (
                            <div>
                              <p className="text-foreground font-medium">{acc.paymentProfile.bankName}</p>
                              <p className="text-[11px] text-muted font-mono">
                                {maskIban(acc.paymentProfile.accountIban) || "IBAN on file"}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted">Cash / No bank on file</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono text-secondary">{acc.months.length}</td>
                        <td className="p-3 text-right font-mono font-semibold text-foreground">
                          {formatPKR(acc.totalNetPay)}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-status-optimal">
                          {formatPKR(acc.totalPaid)}
                        </td>
                        <td
                          className={`p-3 text-right font-mono font-semibold ${
                            acc.totalPending > 0 ? "text-amber-500" : "text-muted"
                          }`}
                        >
                          {formatPKR(acc.totalPending)}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold">
                          {(acc.loanBalance || 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 text-blue-400" title="Outstanding staff-loan balance">
                              <Landmark className="w-3.5 h-3.5" />
                              {formatPKR(acc.loanBalance)}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          <PayrollStatusBadge status={acc.status} />
                        </td>
                        <td className="p-3 pr-4 text-muted">
                          {expanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>
                      </tr>

                      {/* ── Expanded month-by-month breakdown ────────────── */}
                      {expanded && (
                        <tr className="bg-bg-subtle/30">
                          <td colSpan={10} className="p-0">
                            <EmployeeBreakdown
                              acc={acc}
                              onViewTransactions={onViewTransactions}
                              onPayItem={onPayItem}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function EmployeeBreakdown({
  acc,
  onViewTransactions,
  onPayItem,
}: {
  acc: EmployeeLedgerAccount;
  onViewTransactions: (workerId: string, workerName: string) => void;
  onPayItem?: (runId: string, itemId: string) => void;
}) {
  const months = acc.months as LedgerMonth[];

  return (
    <div className="p-4 md:p-5 border-t border-border-subtle space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-body font-semibold text-foreground">
          <UserRound className="w-4 h-4 text-crimson-primary" />
          {acc.workerName}
          <span className="text-caption text-muted font-normal">
            — Month-by-month payment tracking ({months.length} period{months.length === 1 ? "" : "s"})
          </span>
        </div>
        <div className="flex items-center gap-2 self-start">
          {(acc.loanBalance || 0) > 0 && (
            <span className="h-8 px-3 rounded-lg bg-blue-500/10 border border-blue-500/25 text-blue-400 text-caption font-medium flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5" />
              Loan balance {formatPKR(acc.loanBalance)}
            </span>
          )}
          <button
            onClick={() => onViewTransactions(acc.workerId, acc.workerName)}
            className="h-8 px-3 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-caption font-medium transition-colors flex items-center gap-1.5"
          >
            <ReceiptText className="w-3.5 h-3.5" />
            View Transactions
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-caption text-left">
          <thead className="bg-bg-subtle text-secondary uppercase text-[10px]">
            <tr>
              <th className="p-2.5">Month</th>
              <th className="p-2.5">Run Ref</th>
              <th className="p-2.5 text-right">Gross</th>
              <th className="p-2.5 text-right">Deductions</th>
              <th className="p-2.5 text-right">Net</th>
              <th className="p-2.5 text-right">Paid</th>
              <th className="p-2.5 text-right">Unpaid</th>
              <th className="p-2.5">Status</th>
              <th className="p-2.5">Last Payment</th>
              <th className="p-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle font-mono">
            {months.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-4 text-center font-sans text-muted">
                  No payroll months recorded for this account yet.
                </td>
              </tr>
            ) : (
              months.map((m: LedgerMonth) => {
                const canPay = m.pendingAmount > 0 && !m.isLegacy && !!m.itemId;
                return (
                <tr key={m.runId} className="hover:bg-bg-subtle/50 transition-colors">
                  <td className="p-2.5 font-sans font-semibold text-foreground">
                    {m.monthLabel || m.periodCode}
                    {m.isLegacy && (
                      <span className="ml-1.5 text-[9px] px-1.5 py-px rounded bg-muted/10 text-muted border border-border-subtle font-semibold">
                        LEGACY
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 text-secondary text-[11px]">{m.runNo}</td>
                  <td className="p-2.5 text-right text-secondary">{formatPKR(m.grossEarnings)}</td>
                  <td className="p-2.5 text-right text-status-alert">−{formatPKR(m.totalDeductions)}</td>
                  <td className="p-2.5 text-right font-bold text-foreground">{formatPKR(m.netPay)}</td>
                  <td className="p-2.5 text-right font-semibold text-status-optimal">{formatPKR(m.amountPaid)}</td>
                  <td
                    className={`p-2.5 text-right font-semibold ${
                      m.pendingAmount > 0 ? "text-amber-500" : "text-muted"
                    }`}
                  >
                    {formatPKR(m.pendingAmount)}
                  </td>
                  <td className="p-2.5">
                    <MonthStatusChip status={m.status} />
                  </td>
                  <td className="p-2.5 font-sans text-muted text-[11px]">{formatDate(m.lastPaymentDate)}</td>
                  <td className="p-2.5">
                    <div className="flex items-center justify-end">
                      {canPay ? (
                        <button
                          onClick={() => onPayItem?.(m.runId, m.itemId as string)}
                          title={`Pay ${formatPKR(m.pendingAmount)} for ${m.monthLabel || m.periodCode}`}
                          className="h-7 px-2.5 rounded-lg bg-status-optimal text-white hover:bg-emerald-600 text-[11px] font-medium transition-colors flex items-center gap-1"
                        >
                          <DollarSign className="w-3 h-3" />
                          Pay {formatPKR(m.pendingAmount)}
                        </button>
                      ) : m.pendingAmount > 0 && m.status === "NOT_POSTED" ? (
                        <span className="text-[10px] text-muted" title="Post the run to the General Ledger before paying.">
                          Awaiting posting
                        </span>
                      ) : m.pendingAmount > 0 ? (
                        <span className="text-[10px] text-muted">
                          {m.runNo === "OPENING" ? "Opening balance" : "Legacy entry"}
                        </span>
                      ) : (
                        <span className="text-[10px] text-status-optimal">Settled</span>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-bg-subtle font-mono text-[11px] uppercase tracking-wider">
              <td colSpan={4} className="p-2.5 text-secondary font-semibold">
                Account Totals
              </td>
              <td className="p-2.5 text-right font-bold text-foreground">{formatPKR(acc.totalNetPay)}</td>
              <td className="p-2.5 text-right font-bold text-status-optimal">{formatPKR(acc.totalPaid)}</td>
              <td
                className={`p-2.5 text-right font-bold ${
                  acc.totalPending > 0 ? "text-amber-500" : "text-muted"
                }`}
              >
                {formatPKR(acc.totalPending)}
              </td>
              <td colSpan={3} className="p-2.5 font-sans text-[11px] text-muted">
                Last paid: {formatDate(acc.lastPaymentDate)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
