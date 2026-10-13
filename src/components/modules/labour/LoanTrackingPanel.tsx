"use client";

import { useEffect, useState } from "react";
import { fetchWorkerLoans, type WorkerLoan, type Worker } from "@/lib/supabase/labour";
import { recordRepayment } from "@/lib/supabase/loans";
import IssueLoanModal from "./IssueLoanModal";

interface Props {
  selectedWorker: Worker | null;
  onRefresh: () => void;
}

export default function LoanTrackingPanel({ selectedWorker, onRefresh }: Props) {
  const [loans, setLoans] = useState<WorkerLoan[]>([]);
  const [loading, setLoading] = useState(false);
  const [repayModal, setRepayModal] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repaySource, setRepaySource] = useState<"CASH" | "BANK_TRANSFER" | "SALARY_DEDUCTION">("SALARY_DEDUCTION");
  const [showIssueModal, setShowIssueModal] = useState(false);

  useEffect(() => {
    if (!selectedWorker) { setLoans([]); return; }
    setLoading(true);
    fetchWorkerLoans(selectedWorker.id).then((lw: WorkerLoan[]) => {
      setLoans(lw);
      setLoading(false);
    });
  }, [selectedWorker]);

  const totalOutstanding = loans.reduce((a, l) => a + l.current_balance, 0);

  async function handleRepay(loanId: string) {
    const amount = parseFloat(repayAmount);
    if (isNaN(amount) || amount <= 0) return;
    const result = await recordRepayment(loanId, amount, repaySource);
    if (result.loan) {
      setLoans((prev) =>
        prev.map((l) =>
          l.id === loanId ? { ...l, current_balance: result.loan!.current_balance } : l
        )
      );
      onRefresh();
    }
    setRepayModal(null);
    setRepayAmount("");
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-h2 font-semibold">Worker Loans</h2>
          {selectedWorker && (
            <p className="text-caption text-muted mt-0.5">Showing: {selectedWorker.full_name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="badge font-mono text-status-alert">
            PKR {totalOutstanding.toLocaleString()} outstanding
          </span>
          {selectedWorker && (
            <button
              onClick={() => setShowIssueModal(true)}
              className="crimson-btn text-caption px-3 py-1"
            >
              + Issue Loan
            </button>
          )}
        </div>
      </div>
      <div className="glow-line mb-4" />

      <div className="space-y-3">
        {loading ? (
          <p className="text-caption text-muted text-center py-4">Loading loans...</p>
        ) : loans.length === 0 ? (
          <p className="text-caption text-muted text-center py-4">
            {selectedWorker ? "No loans for this worker." : "Select a worker to view loans."}
          </p>
        ) : (
          loans.map((loan) => {
            const paidPct = loan.original_loan_amount > 0
              ? ((loan.original_loan_amount - loan.current_balance) / loan.original_loan_amount) * 100
              : 0;
            const isFullyPaid = loan.current_balance <= 0;
            return (
              <div
                key={loan.id}
                className="p-3 rounded-lg bg-bg-subtle border border-border-subtle"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-body font-medium text-foreground">
                      {isFullyPaid ? "Fully Repaid" : "Active Loan"}
                    </p>
                    <p className="text-caption text-muted">
                      Issued: {new Date(loan.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {!isFullyPaid && (
                    <button
                      onClick={() => setRepayModal(loan.id)}
                      className="crimson-btn text-caption px-3 py-1"
                    >
                      Repay
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
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
                </div>
                <div className="w-full h-1.5 rounded-full bg-bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-crimson-primary transition-all"
                    style={{ width: `${Math.min(paidPct, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted mt-1">{paidPct.toFixed(0)}% repaid</p>

                {repayModal === loan.id && (
                  <div className="mt-3 p-3 rounded-lg bg-bg-muted border border-border-default space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={repayAmount}
                        onChange={(e) => setRepayAmount(e.target.value)}
                        className="glass-input flex-1 text-caption font-mono"
                        placeholder="Amount (PKR)"
                        min="0"
                        autoFocus
                      />
                      <select
                        value={repaySource}
                        onChange={(e) => setRepaySource(e.target.value as typeof repaySource)}
                        className="glass-input text-caption w-36"
                      >
                        <option value="SALARY_DEDUCTION">Salary Deduction</option>
                        <option value="CASH">Cash</option>
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleRepay(loan.id)} className="crimson-btn text-caption px-3 py-1">
                        Confirm
                      </button>
                      <button onClick={() => setRepayModal(null)} className="text-caption text-muted hover:text-foreground px-2">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {selectedWorker && (
        <IssueLoanModal
          open={showIssueModal}
          worker={selectedWorker}
          onClose={() => setShowIssueModal(false)}
          onCreated={() => {
            fetchWorkerLoans(selectedWorker.id).then(setLoans);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
