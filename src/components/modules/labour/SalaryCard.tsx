"use client";

import { useEffect, useState } from "react";
import {
  fetchWorkerLoans,
  type Worker,
  type AttendanceMap,
  type TimeLogMap,
  type WorkerLoan,
} from "@/lib/supabase/labour";
import { calculateGrossToNetPayslip, formatMinutes } from "@/lib/salary";
import { exportWorkerPayslipPDF } from "@/lib/pdf-exporter";

interface Props {
  worker: Worker;
  attendance: AttendanceMap;
  /** Arrival / departure times — drives overtime pay. */
  timeLogs?: TimeLogMap;
  year: number;
  month: number;
  /** Bump to re-fetch loans (e.g. after issue/repay in LoanTrackingPanel). */
  refreshKey?: number;
  /** Optional callback after a salary-related action (parent can refresh). */
  onPaid?: () => void;
}

export default function SalaryCard({ worker, attendance, timeLogs = {}, year, month, refreshKey = 0 }: Props) {
  const [loans, setLoans] = useState<WorkerLoan[] | null>(null);
  const [printing, setPrinting] = useState(false);

  const periodRef = `SALARY-${year}-${String(month).padStart(2, "0")}`;
  const monthLabel = new Date(year, month - 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

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

  const loansLoading = loans === null;
  const loanList = loans ?? [];
  const hasLoan = loanList.length > 0;
  const loanTaken = loanList.reduce((a, l) => a + l.original_loan_amount, 0);
  const loanRemaining = loanList.reduce((a, l) => a + l.current_balance, 0);

  // The month's first → last day IS the payroll period, so this card runs the
  // exact same gross-to-net engine as /payroll (loan recovery + caps included).
  // What is shown here is what Payroll will disburse — one engine, no drift.
  const period = {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`,
  };
  const slip = calculateGrossToNetPayslip(worker, attendance, period, {
    timeLogs,
    activeLoans: loanList,
  });
  const att = slip.attendance;
  const baseLine = slip.lines.find((l) => l.wageTypeCode === "BASIC" || l.wageTypeCode === "DAILY_WAGE");
  const paidDays = baseLine?.qty ?? 0;
  const baseRate = baseLine?.rate ?? 0;
  const baseLabel = slip.employmentType === "PERMANENT_SALARY" ? "Basic salary" : "Daily wage";

  async function handlePrint() {
    if (printing) return;
    setPrinting(true);
    try {
      await exportWorkerPayslipPDF(worker, attendance, loanList, year, month, timeLogs);
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
            Same gross-to-net engine as Payroll · loan recovery included · paid from /payroll
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/payroll"
            title="Manage and disburse salaries via the unified SAP Payroll module"
            className="h-8 px-3 rounded-md bg-bg-muted border border-border-default text-foreground text-caption font-medium hover:bg-bg-subtle transition-colors flex items-center gap-1.5"
          >
            <svg className="h-3.5 w-3.5 text-crimson-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Payroll Module
          </a>
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

      <div className="mb-3 text-caption text-secondary bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 flex items-center justify-between">
        <span>Salaries are disbursed only through the Payroll Runs wizard — this card is the live preview of that payslip.</span>
        <span className="font-mono text-caption text-muted">{periodRef}</span>
      </div>

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
            {att.presentDays} day{att.presentDays === 1 ? "" : "s"}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Absent</p>
          <p className="text-body font-mono font-medium text-status-alert mt-0.5">
            {att.absentDays} day{att.absentDays === 1 ? "" : "s"}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Leave</p>
          <p className="text-body font-mono font-medium text-status-amber mt-0.5">
            {att.leaveDays} day{att.leaveDays === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle flex flex-col justify-center">
          <p className="text-[10px] text-muted uppercase">Gross Earnings — {monthLabel}</p>
          <p className="text-num-kpi font-mono font-bold text-foreground mt-1">
            PKR {slip.grossEarnings.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted mt-1">
            {baseLabel}: {paidDays} paid day{paidDays === 1 ? "" : "s"} (P {att.presentDays} + L{" "}
            {att.leaveDays}) × PKR {baseRate.toFixed(2)}/day = PKR{" "}
            {slip.baseEarnings.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted mt-0.5">
            Overtime: {formatMinutes(att.overtimeMinutes)} = + PKR {slip.overtimePay.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted mt-0.5">
            Undertime: {formatMinutes(att.undertimeMinutes)} = − PKR{" "}
            {slip.undertimeDeductions.toLocaleString()}
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
            Recovered from this month&apos;s net pay:{" "}
            <span className="font-mono text-foreground">PKR {slip.loanRecoveryDeduction.toLocaleString()}</span>
            {slip.loanRecoveryDeduction === 0 && hasLoan ? " (capped at 50% of net / loan rate)" : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Total Deductions</p>
          <p className="text-body font-mono font-medium text-status-alert mt-0.5">
            PKR {slip.totalDeductions.toLocaleString()}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Loan Recovery</p>
          <p className="text-body font-mono font-medium text-foreground mt-0.5">
            PKR {slip.loanRecoveryDeduction.toLocaleString()}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
          <p className="text-[10px] text-muted uppercase">Net Pay</p>
          <p className="text-num-kpi font-mono font-bold text-foreground mt-1">
            PKR {slip.netPayable.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
