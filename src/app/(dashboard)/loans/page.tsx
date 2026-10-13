"use client";

import { useEffect, useState } from "react";
import { fetchLoans, type WorkerLoan } from "@/lib/supabase/loans";
import RepaymentModal from "@/components/modules/loans/RepaymentModal";
import { formatPKR } from "@/lib/utils/formatters";

const MOCK_LOANS: WorkerLoan[] = [];

function recoveryMonths(balance: number, rate: number): number {
  if (rate <= 0) return 0;
  return Math.ceil(balance / rate);
}

export default function LoansPage() {
  const [loans, setLoans] = useState<WorkerLoan[]>(MOCK_LOANS);
  const [selectedLoan, setSelectedLoan] = useState<WorkerLoan | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await fetchLoans();
      if (cancelled) return;
      if (data.length > 0) {
        setLoans(data);
        setIsLive(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const totalOriginal = loans.reduce((a, l) => a + l.original_loan_amount, 0);
  const totalOutstanding = loans.reduce((a, l) => a + l.current_balance, 0);
  const totalMonthlyDeduction = loans.reduce((a, l) => a + l.monthly_deduction_rate, 0);
  const totalRepaid = totalOriginal - totalOutstanding;

  function handleRepay(loan: WorkerLoan) {
    setSelectedLoan(loan);
    setModalOpen(true);
  }

  function handleRefresh() {
    fetchLoans().then((data) => { if (data.length > 0) setLoans(data); });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display font-bold tracking-tight">Loans</h1>
          <p className="text-body text-secondary mt-1">Advance Loan Register &amp; Repayments</p>
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      </div>

      <div className="glow-line" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Disbursed" value={formatPKR(totalOriginal)} accent="crimson" />
        <KPICard label="Outstanding Balance" value={formatPKR(totalOutstanding)} accent="red" />
        <KPICard label="Total Repaid" value={formatPKR(totalRepaid)} accent="green" />
        <KPICard label="Monthly Deductions" value={formatPKR(totalMonthlyDeduction)} accent="amber" />
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h2 font-semibold">Monthly Auto-Deduction Schedule</h2>
            <span className="badge">{loans.length} active loans</span>
          </div>
          <div className="glow-line mb-4" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-36">Worker</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32">Designation</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32 text-right">Original</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32 text-right">Balance</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Monthly</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-center">Months Left</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-center">Progress</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28" />
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => {
                const worker = loan.workers;
                const paidPct = loan.original_loan_amount > 0
                  ? ((loan.original_loan_amount - loan.current_balance) / loan.original_loan_amount) * 100
                  : 0;
                const months = recoveryMonths(loan.current_balance, loan.monthly_deduction_rate);
                return (
                  <tr
                    key={loan.id}
                    className="border-b border-border-subtle hover:bg-bg-subtle transition-colors"
                  >
                    <td className="px-5 py-3 text-body text-foreground font-medium">{worker?.full_name ?? "—"}</td>
                    <td className="px-5 py-3 text-body text-secondary">{worker?.role_designation ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-mono text-num-table text-secondary">{formatPKR(loan.original_loan_amount)}</td>
                    <td className="px-5 py-3 text-right font-mono text-num-kpi font-bold text-status-alert">{formatPKR(loan.current_balance)}</td>
                    <td className="px-5 py-3 text-right font-mono text-num-table text-foreground">{formatPKR(loan.monthly_deduction_rate)}</td>
                    <td className="px-5 py-3 text-center font-mono text-num-table text-secondary">{months}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-crimson-primary transition-all"
                            style={{ width: `${Math.min(100, paidPct)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-muted w-8 text-right">{paidPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {loan.current_balance > 0 && (
                        <button
                          onClick={() => handleRepay(loan)}
                          className="h-7 px-3 rounded-md bg-crimson-primary/10 text-crimson-light text-caption font-medium border border-crimson-primary/20 hover:bg-crimson-primary/20 transition-colors"
                        >
                          Repay
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <RepaymentModal
        loan={selectedLoan}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSelectedLoan(null); }}
        onRecorded={handleRefresh}
      />
    </div>
  );
}

function KPICard({ label, value, accent }: { label: string; value: string; accent: "crimson" | "red" | "green" | "amber" }) {
  const accentMap = {
    crimson: { dot: "bg-crimson-primary", text: "text-crimson-primary" },
    red: { dot: "bg-status-alert", text: "text-status-alert" },
    green: { dot: "bg-status-optimal", text: "text-status-optimal" },
    amber: { dot: "bg-status-amber", text: "text-status-amber" },
  };
  return (
    <div className="glass-card p-4 flex items-center justify-between">
      <div>
        <p className="text-caption text-muted uppercase tracking-wider font-medium">{label}</p>
        <p className={`font-bold mt-1 font-mono ${accentMap[accent].text}`} style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }}>{value}</p>
      </div>
      <span className={`h-2.5 w-2.5 rounded-full ${accentMap[accent].dot}`} />
    </div>
  );
}
