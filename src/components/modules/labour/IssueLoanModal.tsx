"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { issueLoan, type Worker } from "@/lib/supabase/labour";
import { fetchAccounts, type Account } from "@/lib/supabase/ledger";
import { isLiquidFundsAccount } from "@/lib/ledger/voucher-rules";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  open: boolean;
  worker: Worker | null;
  onClose: () => void;
  onCreated: () => void;
}

export default function IssueLoanModal({ open, worker, onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [monthlyDeduction, setMonthlyDeduction] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setAmount("");
      setMonthlyDeduction("");
      setIssueDate(new Date().toISOString().slice(0, 10));
      setReason("");
      setAccountId("");
      setError("");
      // Cash in Hand / Bank rows only — the loan money has to come FROM somewhere.
      fetchAccounts().then((all) => setAccounts(all.filter(isLiquidFundsAccount)));
    }
  }, [open]);

  useEscapeToClose(open, onClose);

  if (!open || !worker) return null;

  const amountNum = amount ? parseFloat(amount) : 0;
  const deductionNum = monthlyDeduction ? parseFloat(monthlyDeduction) : 0;
  const isValid =
    amountNum > 0 && deductionNum > 0 && issueDate && reason.trim().length >= 2 && !!accountId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || !worker) return;
    setSaving(true);
    setError("");

    const result = await issueLoan({
      worker_id: worker.id,
      amount: amountNum,
      monthly_deduction_rate: deductionNum,
      reason: reason.trim(),
      account_id: accountId,
      operator_name: "Labour Manager",
    });

    setSaving(false);
    if (result.loan) {
      queryClient.invalidateQueries({ queryKey: ["labour"] });
      queryClient.invalidateQueries({ queryKey: ["workers"] });
      onCreated();
      onClose();
    } else {
      setError(result.error || "Failed to issue loan. Check connection.");
    }
  }

  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-2";

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div
          className="glass-card w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Issue Loan / Advance</h2>
              <p className="text-caption text-muted mt-0.5">{worker.full_name}</p>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="glass-card p-3 space-y-1">
                <div className="flex justify-between text-caption">
                  <span className="text-muted">Worker</span>
                  <span className="text-foreground font-medium">{worker.full_name}</span>
                </div>
                <div className="flex justify-between text-caption">
                  <span className="text-muted">Role</span>
                  <span className="text-foreground">{worker.role_designation}</span>
                </div>
                <div className="flex justify-between text-caption">
                  <span className="text-muted">Monthly Salary</span>
                  <span className="text-foreground font-mono">PKR {worker.base_salary_pkr.toLocaleString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Loan Amount (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={`${inputCls} font-mono`}
                    placeholder="50000"
                  />
                </div>
                <div>
                  <label className={labelCls}>Monthly Deduction (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={monthlyDeduction}
                    onChange={(e) => setMonthlyDeduction(e.target.value)}
                    className={`${inputCls} font-mono`}
                    placeholder="5000"
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Paid From (Cash / Bank) *</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_code} — {a.account_name}
                    </option>
                  ))}
                </select>
                {accounts.length === 0 && (
                  <p className="text-[10px] text-muted mt-1">
                    No Cash in Hand / Bank account found in the chart of accounts.
                  </p>
                )}
              </div>

              {amountNum > 0 && deductionNum > 0 && (
                <div className="glass-card p-3 text-caption text-muted space-y-1">
                  <p>
                    Repayment Period:{" "}
                    <span className="text-foreground font-medium">
                      {Math.ceil(amountNum / deductionNum)} months
                    </span>
                  </p>
                  <p>
                    Monthly Deduction:{" "}
                    <span className="text-foreground font-mono">
                      PKR {deductionNum.toLocaleString()} ({((deductionNum / worker.base_salary_pkr) * 100).toFixed(1)}% of salary)
                    </span>
                  </p>
                </div>
              )}

              <div>
                <label className={labelCls}>Issue Date</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Reason / Remarks</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(capitalizeFirst(e.target.value))}
                  className={inputCls}
                  placeholder="e.g. Emergency Advance, Medical"
                />
              </div>

              {error && (
                <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="crimson-btn flex-1" style={{ backgroundColor: "transparent", border: "1px solid var(--border-default)" }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving || !isValid} className="crimson-btn flex-1 disabled:opacity-40 disabled:cursor-not-allowed">
                  {saving ? "Issuing..." : "Issue Loan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
