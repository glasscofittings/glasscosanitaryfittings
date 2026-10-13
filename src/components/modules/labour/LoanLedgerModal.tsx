"use client";

import { useState, useEffect } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { fetchLoans, recordRepayment, type WorkerLoan } from "@/lib/supabase/loans";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MOCK_LOANS: WorkerLoan[] = [
  { id: "ln1", worker_id: "w1", original_loan_amount: 120000, current_balance: 85000, monthly_deduction_rate: 5000, created_at: "2026-03-01T00:00:00Z", workers: { id: "w1", full_name: "Ahmad Khan", role_designation: "Senior Fitter", base_salary_pkr: 45000 } },
  { id: "ln2", worker_id: "w2", original_loan_amount: 60000, current_balance: 22000, monthly_deduction_rate: 3000, created_at: "2026-06-15T00:00:00Z", workers: { id: "w2", full_name: "Bilal Ahmed", role_designation: "CNC Operator", base_salary_pkr: 52000 } },
  { id: "ln3", worker_id: "w5", original_loan_amount: 40000, current_balance: 40000, monthly_deduction_rate: 2000, created_at: "2026-08-01T00:00:00Z", workers: { id: "w5", full_name: "Hamza Tariq", role_designation: "Polishing Worker", base_salary_pkr: 35000 } },
];

export default function LoanLedgerModal({ open, onClose }: Props) {
  const [loans, setLoans] = useState<WorkerLoan[]>(MOCK_LOANS);
  const [repayId, setRepayId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<"CASH" | "BANK_TRANSFER" | "SALARY_DEDUCTION">("CASH");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchLoans().then((l) => { if (l.length > 0) setLoans(l); });
  }, [open]);

  useEscapeToClose(open, onClose);

  if (!open) return null;

  const totalOriginal = loans.reduce((a, l) => a + l.original_loan_amount, 0);
  const totalBalance = loans.reduce((a, l) => a + l.current_balance, 0);
  const totalRepaid = totalOriginal - totalBalance;
  const totalMonthlyDeduction = loans.reduce((a, l) => a + l.monthly_deduction_rate, 0);

  async function handleRepay(loanId: string) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return;
    setSubmitting(true);
    const result = await recordRepayment(loanId, amt, source);
    setSubmitting(false);
    if (result.loan) {
      setLoans((prev) =>
        prev.map((l) => (l.id === loanId ? { ...l, current_balance: result.loan!.current_balance } : l))
      );
    }
    setRepayId(null);
    setAmount("");
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel" style={{ zIndex: 80 }}>
        <div className="drawer-header">
          <div>
            <h2 className="text-h2 font-semibold">Loan Ledger</h2>
            <p className="text-caption text-muted mt-0.5">All worker loans &amp; repayments</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="drawer-body space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-3">
              <p className="text-[10px] text-muted uppercase tracking-wider">Total Loaned</p>
              <p className="text-num-kpi font-mono font-bold text-foreground mt-1">PKR {totalOriginal.toLocaleString()}</p>
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-muted uppercase tracking-wider">Outstanding</p>
              <p className="text-num-kpi font-mono font-bold text-status-alert mt-1">PKR {totalBalance.toLocaleString()}</p>
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-muted uppercase tracking-wider">Repaid</p>
              <p className="text-num-kpi font-mono font-bold text-status-optimal mt-1">PKR {totalRepaid.toLocaleString()}</p>
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-muted uppercase tracking-wider">Monthly Salary Ded.</p>
              <p className="text-num-kpi font-mono font-bold text-status-amber mt-1">PKR {totalMonthlyDeduction.toLocaleString()}</p>
            </div>
          </div>

          <div className="glow-line" />

          <div className="space-y-3">
            {loans.map((loan) => {
              const paidPct = loan.original_loan_amount > 0
                ? ((loan.original_loan_amount - loan.current_balance) / loan.original_loan_amount) * 100
                : 0;
              const isFullyPaid = loan.current_balance <= 0;
              const salary = loan.workers?.base_salary_pkr ?? 0;
              const deductionPct = salary > 0 ? ((loan.monthly_deduction_rate / salary) * 100).toFixed(1) : "0";

              return (
                <div key={loan.id} className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-body font-medium text-foreground">{loan.workers?.full_name}</p>
                      <p className="text-caption text-muted">{loan.workers?.role_designation}</p>
                    </div>
                    <button
                      onClick={() => { setRepayId(loan.id); setAmount(""); }}
                      disabled={isFullyPaid}
                      className="crimson-btn text-caption px-3 py-1 disabled:opacity-40"
                    >
                      Repay
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2 mb-2">
                    <div>
                      <p className="text-[10px] text-muted uppercase">Original</p>
                      <p className="text-caption font-mono text-secondary">PKR {loan.original_loan_amount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted uppercase">Balance</p>
                      <p className={`text-caption font-mono ${isFullyPaid ? "text-status-optimal" : "text-status-alert"}`}>
                        PKR {loan.current_balance.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted uppercase">Monthly Ded.</p>
                      <p className="text-caption font-mono text-secondary">PKR {loan.monthly_deduction_rate.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted uppercase">Ded. of Salary</p>
                      <p className="text-caption font-mono text-secondary">{deductionPct}%</p>
                    </div>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-crimson-primary transition-all" style={{ width: `${Math.min(paidPct, 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-muted mt-1">{paidPct.toFixed(0)}% repaid</p>

                  {repayId === loan.id && (
                    <div className="mt-3 p-3 rounded-lg bg-bg-muted border border-border-default space-y-2">
                      <p className="text-caption font-medium text-foreground">Record Cash Repayment</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="glass-input flex-1 text-caption font-mono"
                          placeholder="Amount (PKR)"
                          min="0"
                          autoFocus
                        />
                        <select
                          value={source}
                          onChange={(e) => setSource(e.target.value as typeof source)}
                          className="glass-input text-caption w-36"
                        >
                          <option value="CASH">Cash</option>
                          <option value="BANK_TRANSFER">Bank Transfer</option>
                          <option value="SALARY_DEDUCTION">Salary Deduction</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRepay(loan.id)}
                          disabled={submitting}
                          className="crimson-btn text-caption px-3 py-1"
                        >
                          {submitting ? "Saving..." : "Confirm"}
                        </button>
                        <button onClick={() => setRepayId(null)} className="text-caption text-muted hover:text-foreground px-2">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
