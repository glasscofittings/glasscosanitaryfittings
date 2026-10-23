"use client";

import { useEffect, useState } from "react";
import {
  fetchWorkerLoans,
  type Worker,
  type AttendanceMap,
  type TimeLogMap,
  type WorkerLoan,
} from "@/lib/supabase/labour";
import { calculateEarnedSalary, formatMinutes } from "@/lib/salary";
import { exportWorkerPayslipPDF } from "@/lib/pdf-exporter";
import { salaryAlreadyPaid } from "@/lib/supabase/payment-vouchers";

interface Props {
  worker: Worker;
  attendance: AttendanceMap;
  /** Arrival / departure times — drives overtime pay. */
  timeLogs?: TimeLogMap;
  year: number;
  month: number;
  /** Bump to re-fetch loans (e.g. after issue/repay in LoanTrackingPanel). */
  refreshKey?: number;
  /** Optional callback after a successful salary payment (parent can refresh). */
  onPaid?: () => void;
}

export default function SalaryCard({ worker, attendance, timeLogs = {}, year, month, refreshKey = 0, onPaid }: Props) {
  const [loans, setLoans] = useState<WorkerLoan[] | null>(null);
  const [printing, setPrinting] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [payCheckLoading, setPayCheckLoading] = useState(true);

  const periodRef = `SALARY-${year}-${String(month).padStart(2, "0")}`;
  const salary = calculateEarnedSalary(worker, attendance, year, month, timeLogs);

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
            Computed from attendance, overtime & undertime · loans are not deducted
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
        <span>Unified Payroll: Salary disbursements and accounting postings are managed through the central Payroll Runs wizard.</span>
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
            Basic: {paidDays} paid day{paidDays === 1 ? "" : "s"} (P {salary.presentDays} + L{" "}
            {salary.leaveDays}) × PKR {salary.dailyRate.toFixed(2)}/day = PKR{" "}
            {salary.basicSalary.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted mt-0.5">
            Overtime: {formatMinutes(salary.overtimeMinutes)} × PKR{" "}
            {salary.overtimeRate.toLocaleString()}/hr = + PKR {salary.overtimePay.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted mt-0.5">
            Undertime: {formatMinutes(salary.undertimeMinutes)} × PKR {salary.hourlyRate.toFixed(2)}/hr = − PKR{" "}
            {salary.undertimeDeduction.toLocaleString()}
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
    </div>
  );
}

