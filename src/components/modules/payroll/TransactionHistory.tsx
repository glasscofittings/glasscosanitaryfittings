"use client";

import React, { useMemo, useState } from "react";
import {
  Search,
  ReceiptText,
  Banknote,
  Landmark,
  ArrowLeft,
  Download,
  UserRound,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { PayrollHeadBadge } from "./PayrollBadges";
import { formatPKR } from "@/lib/utils/formatters";
import { type PayrollPaymentLog, type EmployeeLedgerAccount, reversePayrollPayment } from "@/lib/supabase/payroll";
import { monthLabelOf } from "@/lib/salary";

/** The storno RPC stamps reversals on the row — not part of the TS shape yet. */
type ReversibleLog = PayrollPaymentLog & { reversed_at?: string | null };

const PAGE_SIZE = 50;

interface TransactionHistoryProps {
  logs: PayrollPaymentLog[];
  allAccounts?: EmployeeLedgerAccount[];
  /** Pre-select this employee or party when navigating from the Account Ledger. */
  focusWorkerId?: string | null;
  focusWorkerName?: string | null;
  /** Operator recorded against a storno reversal. */
  operatorName?: string;
  /** Jump back to the Account Ledger focused on this employee. */
  onOpenLedger?: (workerId: string, workerName: string) => void;
  /** Called after a payment is reversed so the parent can reload. */
  onReversed?: () => Promise<void> | void;
  onExport?: () => void;
}

function formatDate(date: string): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function TransactionHistory({
  logs,
  allAccounts = [],
  focusWorkerId,
  focusWorkerName,
  operatorName,
  onOpenLedger,
  onReversed,
  onExport,
}: TransactionHistoryProps) {
  // focusWorkerId seeds the employee filter — the parent remounts this view
  // via `key` whenever the focused employee changes.
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<"ALL" | "CASH" | "BANK">("ALL");
  const [headFilter, setHeadFilter] = useState<"ALL" | "PRODUCTION" | "ADMIN">("ALL");
  const [employeeFilter, setEmployeeFilter] = useState<string>(focusWorkerId ?? "ALL");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [reversalTarget, setReversalTarget] = useState<PayrollPaymentLog | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [submittingReversal, setSubmittingReversal] = useState(false);
  /** Reversed in this session — flips the badge instantly, before the reload. */
  const [reversedNow, setReversedNow] = useState<string[]>([]);

  const isReversed = (log: PayrollPaymentLog) =>
    reversedNow.includes(log.id) || !!(log as ReversibleLog).reversed_at;

  /** Cross-ledger rows come from CRM vouchers, not from payroll_payment_logs. */
  const isCrossLedger = (log: PayrollPaymentLog) => !!log.run_id?.startsWith("cross-ledger");
  /** Customer receipt vouchers — money coming in, never a disbursement. */
  const isInflow = (log: PayrollPaymentLog) => log.run_id === "cross-ledger-crv";

  // Distinct accounts (employees, vendors, and customers)
  const employees = useMemo(() => {
    const map = new Map<string, { id: string; name: string; type?: string }>();
    for (const log of logs) {
      const id = log.item?.worker_id;
      const name = log.item?.worker_name;
      if (id && name && !map.has(id)) {
        map.set(id, { id, name, type: log.item?.cost_class });
      }
    }
    for (const acc of allAccounts) {
      if (acc.workerId && !map.has(acc.workerId)) {
        map.set(acc.workerId, { id: acc.workerId, name: acc.workerName, type: acc.entityType });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [logs, allAccounts]);

  // Chronological (newest first) filtering
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selAcc = employeeFilter !== "ALL" ? employees.find((e) => e.id === employeeFilter) : null;
    const selNameLower = selAcc?.name.toLowerCase().trim();

    return logs
      .filter((log) => {
        if (methodFilter !== "ALL" && log.payment_method !== methodFilter) return false;
        if (headFilter !== "ALL" && log.item?.cost_class !== headFilter) return false;
        if (employeeFilter !== "ALL") {
          const matchId = log.item?.worker_id === employeeFilter;
          const matchName = selNameLower && log.item?.worker_name?.toLowerCase().trim() === selNameLower;
          if (!matchId && !matchName) return false;
        }
        if (!q) return true;
        return [
          log.item?.worker_name,
          log.disbursement_batch_no,
          log.reference_no,
          log.run?.run_no,
          log.run?.period?.period_code,
          log.payment_account?.account_name,
          log.payment_account?.account_code,
          log.operator_name,
          log.notes,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort(
        (a, b) =>
          (b.payment_date || "").localeCompare(a.payment_date || "") ||
          (b.created_at || "").localeCompare(a.created_at || "")
      );
  }, [logs, search, methodFilter, headFilter, employeeFilter, employees]);

  const totals = useMemo(() => {
    // Reversed payouts and customer receipts are not disbursements.
    const live = filtered.filter((l) => !isReversed(l) && !isInflow(l));
    const amount = live.reduce((s, l) => s + Number(l.amount || 0), 0);
    const cash = live
      .filter((l) => l.payment_method === "CASH")
      .reduce((s, l) => s + Number(l.amount || 0), 0);
    return { amount, cash, bank: amount - cash };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, reversedNow]);

  const handleReverse = async () => {
    if (!reversalTarget || !reversalReason.trim()) return;
    setSubmittingReversal(true);
    try {
      const res = await reversePayrollPayment(reversalTarget.id, reversalReason.trim(), operatorName);
      if (!res.success) {
        setReversalTarget(null);
        setReversalReason("");
        return;
      }
      setReversedNow((prev) => [...prev, reversalTarget.id]);
      setReversalTarget(null);
      setReversalReason("");
      await onReversed?.();
    } finally {
      setSubmittingReversal(false);
    }
  };

  const focusedName =
    employeeFilter !== "ALL"
      ? employees.find((e) => e.id === employeeFilter)?.name ?? focusWorkerName ?? null
      : null;

  const summaryCards = [
    {
      label: "Transactions Shown",
      value: String(filtered.length),
      sub: `of ${logs.length} total disbursements`,
      icon: ReceiptText,
      color: "text-foreground",
    },
    {
      label: "Total Disbursed",
      value: formatPKR(totals.amount),
      sub: "Reversed & receipts excluded",
      icon: Banknote,
      color: "text-status-optimal",
    },
    {
      label: "Via Cash",
      value: formatPKR(totals.cash),
      sub: "Paid out of cash-in-hand",
      icon: Banknote,
      color: "text-emerald-400",
    },
    {
      label: "Via Bank",
      value: formatPKR(totals.bank),
      sub: "Bank transfers & cheques",
      icon: Landmark,
      color: "text-sky-400",
    },
  ];

  const selectClass =
    "h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption";

  const visibleLogs = filtered.slice(0, visibleCount);

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

      {/* ─── Transaction Register ──────────────────────────────────────── */}
      <GlassCard className="overflow-hidden">
        <div className="p-4 border-b border-border-subtle space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-h2 font-semibold text-foreground flex items-center gap-2">
                <ReceiptText className="w-4 h-4 text-crimson-primary" />
                Transactions
              </h3>
              <p className="text-caption text-muted">
                Chronological payroll disbursements — cash &amp; bank, audited against general ledger vouchers
              </p>
            </div>
            {onExport && (
              <button
                onClick={onExport}
                className="h-8 px-3 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-caption flex items-center gap-1.5 self-start"
              >
                <Download className="w-3.5 h-3.5" />
                Export Sheet PDF
              </button>
            )}
          </div>

          {/* Filter bar */}
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                placeholder="Search employee, batch ref, run, account, operator..."
                className="h-9 pl-9 pr-3 w-full rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption placeholder:text-muted"
              />
            </div>
            <select
              value={employeeFilter}
              onChange={(e) => {
                setEmployeeFilter(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`${selectClass} md:w-56`}
            >
              <option value="ALL">All Accounts (Employees & Parties)</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} {emp.type ? `(${emp.type})` : ""}
                </option>
              ))}
            </select>
            <select
              value={headFilter}
              onChange={(e) => {
                setHeadFilter(e.target.value as typeof headFilter);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`${selectClass} md:w-44`}
            >
              <option value="ALL">All Heads</option>
              <option value="PRODUCTION">Production · COGS</option>
              <option value="ADMIN">Admin · OPEX</option>
            </select>
            <select
              value={methodFilter}
              onChange={(e) => {
                setMethodFilter(e.target.value as typeof methodFilter);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`${selectClass} md:w-40`}
            >
              <option value="ALL">All Methods</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
            </select>
          </div>

          {/* Active employee focus banner */}
          {focusedName && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-crimson-primary/5 border border-crimson-primary/20 text-caption">
              <UserRound className="w-3.5 h-3.5 text-crimson-primary shrink-0" />
              <span className="text-secondary">
                Showing transactions for <strong className="text-foreground">{focusedName}</strong>
              </span>
              {onOpenLedger && (
                <button
                  onClick={() =>
                    onOpenLedger(employeeFilter, focusedName)
                  }
                  className="ml-auto text-crimson-primary hover:underline font-medium flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Account Ledger
                </button>
              )}
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center text-muted">
            <ReceiptText className="w-10 h-10 mx-auto text-muted/50 mb-2" />
            <p className="text-body font-medium">
              {logs.length === 0 ? "No payroll transactions recorded yet." : "No transactions match your filters."}
            </p>
            <p className="text-caption mt-1">
              {logs.length === 0
                ? "Disburse payroll from a posted run to see transactions here."
                : "Try clearing the employee, head, or method filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-caption text-left">
                <thead className="bg-bg-subtle text-secondary uppercase text-[10px] border-b border-border-subtle">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Employee</th>
                    <th className="p-3">Month Paid For</th>
                    <th className="p-3">Run</th>
                    <th className="p-3">Method</th>
                    <th className="p-3">Account</th>
                    <th className="p-3 text-right">Amount (PKR)</th>
                    <th className="p-3">Operator</th>
                    <th className="p-3">Batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {visibleLogs.map((log) => {
                    const reversed = isReversed(log);
                    const monthLabel = log.run?.period?.start_date
                      ? monthLabelOf(log.run.period.start_date)
                      : log.run?.period?.period_code || "—";
                    return (
                    <tr key={log.id} className={`transition-colors ${reversed ? "opacity-60" : "hover:bg-bg-subtle/50"}`}>
                      <td className="p-3 font-mono text-secondary whitespace-nowrap">
                        {formatDate(log.payment_date)}
                        {log.reference_no && (
                          <p className="text-[10px] text-crimson-primary font-mono font-medium">
                            Ref: {log.reference_no}
                          </p>
                        )}
                      </td>
                      <td className="p-3">
                        {onOpenLedger && log.item?.worker_id ? (
                          <button
                            onClick={() => onOpenLedger(log.item!.worker_id!, log.item!.worker_name || "Unknown")}
                            className="font-sans font-medium text-foreground hover:text-crimson-primary hover:underline transition-colors text-left"
                            title="Open this employee's account ledger"
                          >
                            {log.item?.worker_name || "—"}
                          </button>
                        ) : (
                          <span className="font-sans font-medium text-foreground">
                            {log.item?.worker_name || "—"}
                          </span>
                        )}
                        {log.item?.cost_class && (
                          <span className="ml-1.5 inline-block align-middle">
                            <PayrollHeadBadge costClass={log.item.cost_class} />
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-sans text-secondary whitespace-nowrap">{monthLabel}</td>
                      <td className="p-3 font-mono text-secondary whitespace-nowrap">
                        {log.run?.run_no || "—"}
                      </td>
                      <td className="p-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            log.payment_method === "BANK"
                              ? "bg-blue-500/10 text-blue-500"
                              : "bg-emerald-500/10 text-emerald-500"
                          }`}
                        >
                          {log.payment_method}
                        </span>
                        {isInflow(log) && (
                          <span
                            className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                            title="Customer receipt — money received, not a disbursement"
                          >
                            In
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-sans text-secondary">
                        {log.payment_account?.account_code} {log.payment_account?.account_name}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-status-optimal whitespace-nowrap">
                        {formatPKR(log.amount)}
                      </td>
                      <td className="p-3 font-sans text-muted whitespace-nowrap">
                        {log.operator_name || "System"}
                      </td>
                      <td className="p-3">
                        <p className="font-mono text-foreground">
                          {log.disbursement_batch_no || "—"}
                        </p>
                        {reversed ? (
                          <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-status-alert/10 text-status-alert border border-status-alert/25 mt-1">
                            <RotateCcw className="w-2.5 h-2.5" />
                            Reversed
                          </span>
                        ) : isCrossLedger(log) ? (
                          <span
                            className="mt-1 text-[9px] text-muted"
                            title="Cross-ledger entry — reverse it from the CRM / Vouchers module."
                          >
                            Managed in CRM
                          </span>
                        ) : (
                          <button
                            onClick={() => setReversalTarget(log)}
                            title="Reverse this single payment (storno)"
                            className="mt-1 text-[10px] px-1.5 py-0.5 rounded border border-status-alert/30 text-status-alert hover:bg-status-alert/10 transition-colors inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-bg-subtle font-mono text-[11px] uppercase tracking-wider">
                    <td colSpan={6} className="p-3 text-secondary font-semibold">
                      Showing {visibleLogs.length} of {filtered.length} transaction
                      {filtered.length === 1 ? "" : "s"} · Live Total
                    </td>
                    <td className="p-3 text-right font-bold text-status-optimal whitespace-nowrap">
                      {formatPKR(totals.amount)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {filtered.length > visibleCount && (
              <div className="p-3 border-t border-border-subtle flex justify-center">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="h-8 px-4 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-caption font-medium transition-colors"
                >
                  Load more ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </GlassCard>

      {/* ─── SINGLE PAYMENT REVERSAL MODAL ─────────────────────────────── */}
      {reversalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-h2 font-semibold text-status-alert flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5" /> Reverse Payment
              </h3>
              <button onClick={() => setReversalTarget(null)} className="text-muted hover:text-foreground">✕</button>
            </div>

            <p className="text-caption text-secondary">
              This reverses the disbursement of <strong className="text-foreground">{formatPKR(reversalTarget.amount)}</strong>{" "}
              to <strong className="text-foreground">{reversalTarget.item?.worker_name || "Unknown"}</strong> (batch{" "}
              {reversalTarget.disbursement_batch_no || "—"}) with a balanced storno entry, restoring that amount as pending.
            </p>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Reason for Reversal</label>
              <textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                rows={3}
                placeholder="e.g., Wrong amount entered, payment made to the wrong account..."
                className="w-full p-2.5 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <button
                onClick={() => setReversalTarget(null)}
                className="h-9 px-3 rounded-lg bg-bg-muted text-secondary hover:text-foreground text-caption"
              >
                Cancel
              </button>
              <button
                onClick={handleReverse}
                disabled={submittingReversal || !reversalReason.trim()}
                className="h-9 px-4 rounded-lg bg-status-alert text-white hover:bg-red-700 text-caption font-semibold disabled:opacity-50"
              >
                {submittingReversal ? "Reversing..." : "Execute Reversal"}
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
