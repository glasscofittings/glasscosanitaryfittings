"use client";

import { useState } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { type WorkerLoan, recordRepayment } from "@/lib/supabase/loans";
import { formatPKR } from "@/lib/utils/formatters";

interface Props {
  loan: WorkerLoan | null;
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}

export default function RepaymentModal({ loan, open, onClose, onRecorded }: Props) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<"CASH" | "BANK_TRANSFER" | "SALARY_DEDUCTION">("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEscapeToClose(open, onClose);

  if (!loan || !open) return null;

  const worker = loan.workers;
  const amountNum = parseFloat(amount) || 0;
  const isValid = amountNum > 0 && amountNum <= loan.current_balance;

  async function handleRecord() {
    if (!isValid || !loan) return;
    setSubmitting(true);
    setError("");

    const result = await recordRepayment(loan.id, amountNum, source);

    setSubmitting(false);
    if (result.loan) {
      onRecorded();
      onClose();
      setAmount("");
    } else {
      setError("Failed to record repayment. Check connection.");
    }
  }

  const remaining = loan.current_balance - amountNum;

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-md p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border-subtle">
            <h2 className="text-h2 font-semibold">Loan Repayment</h2>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="glass-card p-4 space-y-2">
              <div className="flex justify-between text-body">
                <span className="text-secondary">Worker</span>
                <span className="text-foreground font-medium">{worker?.full_name ?? "—"}</span>
              </div>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Designation</span>
                <span className="text-secondary">{worker?.role_designation ?? "—"}</span>
              </div>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Original Loan</span>
                <span className="font-mono text-num-table text-foreground">{formatPKR(loan.original_loan_amount)}</span>
              </div>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Current Balance</span>
                <span className="font-mono text-num-kpi font-bold text-status-alert">{formatPKR(loan.current_balance)}</span>
              </div>
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                Repayment Amount (PKR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max={loan.current_balance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                placeholder="0.00"
              />
              {amountNum > 0 && (
                <p className="text-caption text-muted mt-1 font-mono">
                  Remaining after payment: {formatPKR(Math.max(0, remaining))}
                </p>
              )}
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
                Payment Source
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["CASH", "BANK_TRANSFER", "SALARY_DEDUCTION"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    className={`h-9 rounded-lg text-caption font-medium border transition-all ${
                      source === s
                        ? "bg-crimson-primary/15 text-crimson-light border-crimson-primary/30"
                        : "bg-bg-subtle text-secondary border-border-default hover:bg-bg-muted"
                    }`}
                  >
                    {s === "CASH" ? "Cash" : s === "BANK_TRANSFER" ? "Bank" : "Salary Ded."}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <button
              onClick={handleRecord}
              disabled={submitting || !isValid}
              className="w-full h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Recording..." : "Record Repayment"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
