"use client";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  fetchWorkerLoans,
  type Worker,
  type AttendanceMap,
  type WorkerLoan,
} from "@/lib/supabase/labour";
import { calculateEarnedSalary } from "@/lib/salary";
import { exportWorkerPayslipPDF } from "@/lib/pdf-exporter";
import {
  createPaymentVoucher,
  fetchAccounts,
  numberToWords,
  salaryAlreadyPaid,
  type Account,
} from "@/lib/supabase/payment-vouchers";
import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";

interface Props {
  worker: Worker;
  attendance: AttendanceMap;
  year: number;
  month: number;
  /** Bump to re-fetch loans (e.g. after issue/repay in LoanTrackingPanel). */
  refreshKey?: number;
  /** Optional callback after a successful salary payment (parent can refresh). */
  onPaid?: () => void;
}

export default function SalaryCard({ worker, attendance, year, month, refreshKey = 0, onPaid }: Props) {
  // null = still loading; the parent remounts this card via `key={worker.id}` so
  // a worker switch resets to null without a synchronous setState in the effect.
  const [loans, setLoans] = useState<WorkerLoan[] | null>(null);
  const [printing, setPrinting] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [payCheckLoading, setPayCheckLoading] = useState(true);

  const periodRef = `SALARY-${year}-${String(month).padStart(2, "0")}`;
  const salary = calculateEarnedSalary(worker, attendance, year, month);

  useEffect(() => {
    let cancelled = false;
    fetchWorkerLoans(worker.id).then((lw: WorkerLoan[]) => {
      if (cancelled) return;
      setLoans(lw);
    });
    return () => {
      cancelled = true;
    };
  }, [worker.id, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    salaryAlreadyPaid(worker.full_name, periodRef).then((paid) => {
      if (cancelled) return;
      setAlreadyPaid(paid);
      setPayCheckLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [worker.full_name, periodRef, refreshKey]);

  const loansLoading = loans === null;
  const loanList = loans ?? [];
  const hasLoan = loanList.length > 0;
  const loanTaken = loanList.reduce((a, l) => a + l.original_loan_amount, 0);
  const loanRemaining = loanList.reduce((a, l) => a + l.current_balance, 0);
  const monthLabel = new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const paidDays = salary.presentDays + salary.leaveDays;
  const canPay = !alreadyPaid && !payCheckLoading && salary.earnedSalary > 0;

  async function handlePrint() {
    if (printing) return;
    setPrinting(true);
    try {
      await exportWorkerPayslipPDF(worker, attendance, loanList, year, month);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-body font-semibold text-foreground">
            Salary — {monthLabel}
          </h2>
          <p className="text-caption text-muted mt-0.5">
            Computed from attendance · loans are not deducted
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPayOpen(true)}
            disabled={!canPay}
            title={
              alreadyPaid
                ? `Already paid for ${periodRef}`
                : salary.earnedSalary <= 0
                  ? "Earned salary is zero — nothing to pay"
                  : "Post salary payment to the ledger (Dr Salary Expense / Cr Cash or Bank)"
            }
            className="h-8 px-3 rounded-md bg-crimson-primary text-white text-caption font-medium hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            {payCheckLoading ? "…" : alreadyPaid ? "Paid" : "Pay Salary"}
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            title="Print payslip for this worker"
            className="h-8 px-3 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v3" />
            </svg>
            {printing ? "Preparing..." : "Print"}
          </button>
        </div>
      </div>

      {alreadyPaid && (
        <div className="mb-3 text-caption text-status-optimal bg-status-optimal/10 border border-status-optimal/20 rounded-lg px-3 py-2">
          Already paid for {periodRef} — double-pay blocked. Voucher stores reference_no = {periodRef}.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Base Salary</p>
          <p className="text-body font-mono font-medium text-foreground mt-0.5">
            PKR {worker.base_salary_pkr.toLocaleString()}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Present</p>
          <p className="text-body font-mono font-medium text-status-optimal mt-0.5">
            {salary.presentDays} day{salary.presentDays === 1 ? "" : "s"}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Absent</p>
          <p className="text-body font-mono font-medium text-status-alert mt-0.5">
            {salary.absentDays} day{salary.absentDays === 1 ? "" : "s"}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Leave</p>
          <p className="text-body font-mono font-medium text-status-amber mt-0.5">
            {salary.leaveDays} day{salary.leaveDays === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle flex flex-col justify-center">
          <p className="text-[10px] text-muted uppercase">Earned Salary — {monthLabel}</p>
          <p className="text-num-kpi font-mono font-bold text-foreground mt-1">
            PKR {salary.earnedSalary.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted mt-1">
            {paidDays} paid day{paidDays === 1 ? "" : "s"} (P {salary.presentDays} + L{" "}
            {salary.leaveDays}) × PKR {salary.dailyRate.toFixed(2)}/day
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] text-muted uppercase">Loan Taken</p>
              {loansLoading ? (
                <p className="text-caption text-muted mt-0.5">Loading...</p>
              ) : hasLoan ? (
                <p className="text-body font-mono font-medium text-foreground mt-0.5">
                  PKR {loanTaken.toLocaleString()}
                </p>
              ) : (
                <p className="text-body text-secondary mt-0.5">No active loan</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted uppercase">Loan Remaining</p>
              {loansLoading ? (
                <p className="text-caption text-muted mt-0.5">—</p>
              ) : hasLoan ? (
                <p className="text-body font-mono font-medium text-status-alert mt-0.5">
                  PKR {loanRemaining.toLocaleString()}
                </p>
              ) : (
                <p className="text-body text-secondary mt-0.5">—</p>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted mt-2 border-t border-border-subtle pt-2">
            Informational only — not deducted from salary
          </p>
        </div>
      </div>

      {payOpen && (
        <PaySalaryModal
          worker={worker}
          amount={salary.earnedSalary}
          periodRef={periodRef}
          monthLabel={monthLabel}
          onClose={() => setPayOpen(false)}
          onPaid={() => {
            setPayOpen(false);
            setAlreadyPaid(true);
            onPaid?.();
          }}
        />
      )}
    </div>
  );
}

/**
 * Posts salary via create_payment_voucher:
 *   Dr Salary & Wages Expense (5002) · Cr Cash (1000) or Bank (1002)
 * Double-pay guard: reference_no = SALARY-YYYY-MM (see salaryAlreadyPaid).
 */
function PaySalaryModal({
  worker,
  amount,
  periodRef,
  monthLabel,
  onClose,
  onPaid,
}: {
  worker: Worker;
  amount: number;
  periodRef: string;
  monthLabel: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [creditChoice, setCreditChoice] = useState<"CASH" | "BANK">("CASH");
  const [saving, setSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous lock — blocks a second click before React re-renders the
  // disabled button (see PaymentVoucherForm for the full rationale).
  const submitLockRef = useRef(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAccounts().then((all) => {
      if (cancelled) return;
      setAccounts(all);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEscapeToClose(true, onClose);

  const salaryExpense =
    accounts.find((a) => a.account_code === "5002") ||
    accounts.find((a) => a.account_name.toLowerCase().includes("salary"));
  const cashAcct =
    accounts.find((a) => a.is_default_cash) ||
    accounts.find((a) => a.account_code === ACCOUNT_CODES.CASH);
  const bankAcct = accounts.find((a) => a.account_code === ACCOUNT_CODES.BANK);
  const creditAcct = creditChoice === "BANK" ? bankAcct : cashAcct;

  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      await submitVoucher();
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function submitVoucher() {
    if (!(amount > 0)) {
      setError("Earned salary is zero.");
      return;
    }
    if (!salaryExpense?.id || !creditAcct?.id) {
      setError(
        !salaryExpense
          ? "Salary & Wages Expense (5002) not found — run COA migration."
          : creditChoice === "BANK"
            ? "Bank account (1002) not found."
            : "Cash account (1000) not found."
      );
      return;
    }
    setSaving(true);
    setError("");

    const { data, error: err } = await createPaymentVoucher({
      voucher_type: "SALARY_PAYMENT",
      voucher_date: new Date().toISOString().slice(0, 10),
      payee_name: worker.full_name,
      purpose: `Salary for ${monthLabel}`,
      reference_no: periodRef,
      debit_account_id: salaryExpense.id,
      credit_account_id: creditAcct.id,
      amount,
      amount_in_words: numberToWords(amount),
      remarks: `Salary payment ${periodRef} · ${worker.role_designation}`,
    });

    setSaving(false);
    if (err || !data) {
      setError(err ?? "Failed to create salary payment voucher.");
      return;
    }
    toast.success(`Salary paid — ${data.voucher_no} posted to ledger`);
    onPaid();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm glass-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-h2 font-semibold">Pay Salary</h2>
            <p className="text-caption text-muted mt-0.5">
              {worker.full_name} · {monthLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-caption text-status-alert bg-status-alert/10 border border-status-alert/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
            <p className="text-[10px] text-muted uppercase">Amount</p>
            <p className="text-body font-mono font-bold text-foreground mt-0.5">
              PKR {amount.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted mt-1">Ref: {periodRef}</p>
          </div>

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
              Pay From
            </label>
            <select
              value={creditChoice}
              onChange={(e) => setCreditChoice(e.target.value as "CASH" | "BANK")}
              className={inputCls}
            >
              <option value="CASH">Cash in Hand (1000)</option>
              <option value="BANK">Bank Account (1002)</option>
            </select>
          </div>

          <div className="text-[10px] text-muted space-y-0.5">
            <p>Dr {salaryExpense ? `${salaryExpense.account_code} ${salaryExpense.account_name}` : "5200/5002 Salary Expense"}</p>
            <p>Cr {creditAcct ? `${creditAcct.account_code} ${creditAcct.account_name}` : creditChoice}</p>
            <p>Voucher type: SALARY_PAYMENT (SPV) · creates POSTED journal entry</p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || isSubmitting || !loaded || !salaryExpense || !creditAcct}
              className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors disabled:opacity-50"
            >
              {saving || isSubmitting ? "Posting..." : "Pay & Post"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
