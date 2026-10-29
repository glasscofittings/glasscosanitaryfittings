"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  DollarSign,
  RotateCcw,
  AlertTriangle,
  Play,
  Layers,
  Calendar,
  FileText,
  Download,
  Users,
  BookUser,
  ReceiptText,
} from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import GlassCard from "@/components/ui/GlassCard";
import { formatPKR } from "@/lib/utils/formatters";
import { fetchAccounts, type Account } from "@/lib/supabase/ledger";
import {
  fetchPayrollPeriods,
  fetchPayrollWageTypes,
  fetchPayrollRuns,
  fetchPayrollEmployeeProfiles,
  createPayrollPeriod,
  simulatePayrollRun,
  createPayrollRunFromSimulation,
  postPayrollRun,
  payPayrollItems,
  reversePayrollRun,
  fetchPayrollPaymentLogs,
  fetchPayrollCrossLedgerTransactions,
  fetchPayrollParties,
  buildEmployeeLedger,
  type PayrollParty,
  type PayrollPeriod,
  type PayrollWageType,
  type PayrollRun,
  type PayrollPaymentLog,
  type PayrollRunItem,
} from "@/lib/supabase/payroll";
import { type Worker } from "@/lib/supabase/labour";
import EmployeeLedgerView from "@/components/modules/payroll/EmployeeLedgerView";
import TransactionHistory from "@/components/modules/payroll/TransactionHistory";
import { exportPayrollRunSlipPDF, exportDisbursementListPDF } from "@/lib/pdf-exporter";
import { useAuth } from "@/components/providers/AuthProvider";

type TabKey = "runs" | "ledger" | "transactions" | "simulation" | "wage_types" | "periods";

/** Cross-tab focus for seamless employee ↔ transaction navigation. */
interface EmployeeFocus {
  id: string;
  name: string;
}

export default function SAPPayrollPage() {
  const { profile } = useAuth();
  const operatorName = profile?.device_name || profile?.email || "Accounts Dept";

  const [activeTab, setActiveTab] = useState<TabKey>("runs");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Core Master & Transaction Data
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [wageTypes, setWageTypes] = useState<PayrollWageType[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [paymentLogs, setPaymentLogs] = useState<PayrollPaymentLog[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [parties, setParties] = useState<PayrollParty[]>([]);
  const [crossLogs, setCrossLogs] = useState<PayrollPaymentLog[]>([]);

  // Cross-tab employee focus (Account Ledger ↔ Transaction History)
  const [ledgerFocus, setLedgerFocus] = useState<EmployeeFocus | null>(null);
  const [txnFocus, setTxnFocus] = useState<EmployeeFocus | null>(null);

  // Simulation Wizard state
  const [simPeriodId, setSimPeriodId] = useState<string>("");
  const [simCostClass, setSimCostClass] = useState<"ALL" | "PRODUCTION" | "ADMIN">("ALL");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<Awaited<ReturnType<typeof simulatePayrollRun>> | null>(null);

  // Selected Run & Modals
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [payModalRun, setPayModalRun] = useState<PayrollRun | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK">("CASH");
  const [paymentAccountId, setPaymentAccountId] = useState<string>("");
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Reversal Modal
  const [reversalRun, setReversalRun] = useState<PayrollRun | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [submittingReversal, setSubmittingReversal] = useState(false);

  // New Period Form Modal
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [newPeriodCode, setNewPeriodCode] = useState("");
  const [newPeriodType, setNewPeriodType] = useState<"MONTHLY" | "WEEKLY">("MONTHLY");
  const [newPeriodStart, setNewPeriodStart] = useState("");
  const [newPeriodEnd, setNewPeriodEnd] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [pList, wtList, rList, accList, logs, workerList] = await Promise.all([
        fetchPayrollPeriods(),
        fetchPayrollWageTypes(),
        fetchPayrollRuns(),
        fetchAccounts(),
        fetchPayrollPaymentLogs(),
        fetchPayrollEmployeeProfiles(),
      ]);
      setPeriods(pList);
      setWageTypes(wtList);
      setRuns(rList);
      setAccounts(accList);
      setPaymentLogs(logs);
      setWorkers(workerList);

      if (pList.length > 0 && !simPeriodId) {
        setSimPeriodId(pList[0].id);
      }
    } catch (err) {
      console.error("Load payroll error:", err);
      toast.error("Failed to load payroll data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [simPeriodId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    toast.success("Payroll data synchronized.");
  };

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleRunSimulation = async () => {
    if (!simPeriodId) {
      toast.error("Please select a payroll period.");
      return;
    }
    setSimulating(true);
    try {
      const sim = await simulatePayrollRun({
        periodId: simPeriodId,
        costClassFilter: simCostClass === "ALL" ? null : simCostClass,
      });
      setSimResult(sim);
      setActiveTab("simulation");
      toast.success(`Simulation complete for ${sim.totals.totalWorkers} employees.`);
    } catch (err: any) {
      toast.error(err.message || "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  };

  const handleApproveAndSaveRun = async () => {
    if (!simResult) return;
    try {
      const { data, error } = await createPayrollRunFromSimulation(simResult, operatorName);
      if (error || !data) {
        toast.error(error || "Failed to approve payroll run.");
        return;
      }
      toast.success(`Payroll Run ${data.run_no} created and approved.`);
      setSimResult(null);
      await loadData();
      setActiveTab("runs");
    } catch (err: any) {
      toast.error(err.message || "Failed to create run.");
    }
  };

  const handlePostToAccounting = async (run: PayrollRun) => {
    try {
      const res = await postPayrollRun(run.id, operatorName);
      if (!res.success) {
        toast.error(res.error || "Failed to post payroll run.");
        return;
      }
      toast.success(`Run ${run.run_no} posted to Accounting (Journal ${res.journalNumber}).`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Accounting posting failed.");
    }
  };

  const handleExecutePayment = async () => {
    if (!payModalRun || selectedItemIds.length === 0 || !paymentAccountId) {
      toast.error("Please select employees and a liquid cash/bank account.");
      return;
    }
    setSubmittingPayment(true);
    try {
      const res = await payPayrollItems({
        runId: payModalRun.id,
        itemIds: selectedItemIds,
        paymentMethod,
        accountId: paymentAccountId,
        operatorName,
      });
      if (!res.success) {
        toast.error(res.error || "Payment execution failed.");
        return;
      }
      toast.success(`Disbursed PKR via batch ${res.batchNo}`);
      setPayModalRun(null);
      setSelectedItemIds([]);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Payment execution failed.");
    } finally {
      setSubmittingPayment(false);
    }
  };

  const handleExecuteReversal = async () => {
    if (!reversalRun || !reversalReason.trim()) {
      toast.error("Please provide a cancellation / reversal reason.");
      return;
    }
    setSubmittingReversal(true);
    try {
      const res = await reversePayrollRun(reversalRun.id, reversalReason, operatorName);
      if (!res.success) {
        toast.error(res.error || "Reversal failed.");
        return;
      }
      toast.success(`Run ${reversalRun.run_no} Storno reversed (Journal ${res.reversalJournalNo}).`);
      setReversalRun(null);
      setReversalReason("");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Reversal failed.");
    } finally {
      setSubmittingReversal(false);
    }
  };

  const handleCreatePeriod = async () => {
    if (!newPeriodCode || !newPeriodStart || !newPeriodEnd) {
      toast.error("All period fields are required.");
      return;
    }
    try {
      const { data, error } = await createPayrollPeriod({
        period_code: newPeriodCode,
        period_type: newPeriodType,
        start_date: newPeriodStart,
        end_date: newPeriodEnd,
      });
      if (error || !data) {
        toast.error(error || "Failed to create period.");
        return;
      }
      toast.success(`Period ${data.period_code} created.`);
      setPeriodModalOpen(false);
      setNewPeriodCode("");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Period creation failed.");
    }
  };

  // Print Payslip
  const handlePrintSlip = async (item: PayrollRunItem, run: PayrollRun) => {
    try {
      await exportPayrollRunSlipPDF(
        {
          worker_name: item.worker_name,
          cost_class: item.cost_class,
          employment_type: item.employment_type,
          days_in_period: item.days_in_period,
          present_days: item.present_days,
          absent_days: item.absent_days,
          leave_days: item.leave_days,
          overtime_minutes: item.overtime_minutes,
          undertime_minutes: item.undertime_minutes,
          gross_earnings: item.gross_earnings,
          total_deductions: item.total_deductions,
          net_pay: item.net_pay,
          amount_paid: item.amount_paid,
          status: item.status,
          lines: item.lines?.map((l) => ({
            wage_type_name: l.wage_type_name,
            category: l.category,
            amount: l.amount,
          })),
        },
        { run_no: run.run_no, period_code: run.period?.period_code || "CURRENT" },
        { operatorName }
      );
    } catch (err) {
      toast.error("Failed to generate payslip PDF.");
    }
  };

  // Export Disbursement List
  const handleExportDisbursement = (run?: PayrollRun) => {
    const list = (run ? run.items || [] : runs.flatMap((r) => r.items || []))
      .filter((i) => i.amount_paid > 0)
      .map((i) => ({
        worker_name: i.worker_name,
        cost_class: i.cost_class,
        payment_method: "BANK",
        bank_name: i.worker?.bank_name,
        account_iban: i.worker?.account_iban,
        amount: i.amount_paid,
        disbursement_batch_no: run?.run_no,
      }));
    if (list.length === 0) {
      toast.error("No disbursed payments to export.");
      return;
    }
    exportDisbursementListPDF(list, `Disbursement Sheet - ${run?.run_no || "All Runs"}`);
  };

  // Filter liquid accounts for payment modal
  const liquidAccounts = useMemo(() => {
    return accounts.filter(
      (a) => a.is_liquid_funds || a.is_default_cash || a.account_code === "1000" || a.account_code === "1002"
    );
  }, [accounts]);

  // Combined payroll runs & cross-ledger transaction logs
  const allPaymentLogs = useMemo(() => [...paymentLogs, ...crossLogs], [paymentLogs, crossLogs]);

  // Unified account ledger (employees, vendors, contractors & customers)
  const employeeLedger = useMemo(
    () => buildEmployeeLedger(runs, allPaymentLogs, workers, parties, crossLogs),
    [runs, allPaymentLogs, workers, parties, crossLogs]
  );

  // ─── Cross-tab navigation (Ledger ⇄ Transactions) ─────────────────────

  const goToEmployeeTransactions = (workerId: string, workerName: string) => {
    setTxnFocus({ id: workerId, name: workerName });
    setActiveTab("transactions");
  };

  const goToEmployeeLedger = (workerId: string, workerName: string) => {
    setLedgerFocus({ id: workerId, name: workerName });
    setActiveTab("ledger");
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-h1 font-bold text-foreground tracking-tight flex items-center gap-2">
            SAP Payroll & FI Integration
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-crimson-primary/10 text-crimson-primary font-mono font-medium">
              HCM Engine
            </span>
          </h1>
          <p className="text-caption text-muted mt-1">
            End-to-end Payroll Runs, Gross-to-Net Calculations, COGS vs OPEX General Ledger Accruals & Disbursements
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-9 px-3 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-caption font-medium transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <CrimsonButton
            onClick={() => {
              if (periods.length === 0) {
                toast.error("Create an active period first.");
                return;
              }
              handleRunSimulation();
            }}
            disabled={simulating}
            className="flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            {simulating ? "Simulating..." : "New Payroll Run"}
          </CrimsonButton>
        </div>
      </div>

      {/* ─── Navigation Tabs ─────────────────────────────────────────────── */}
      <div className="flex border-b border-border-default gap-2 overflow-x-auto pb-px">
        {[
          { key: "runs", label: "Payroll Runs", icon: Layers, count: runs.length },
          { key: "ledger", label: "Account Ledger", icon: BookUser, count: employeeLedger.length },
          { key: "transactions", label: "Transaction History", icon: ReceiptText, count: allPaymentLogs.length },
          { key: "simulation", label: "Calculation Wizard", icon: Play },
          { key: "wage_types", label: "Wage Types (COA Mapping)", icon: FileText, count: wageTypes.length },
          { key: "periods", label: "Payroll Periods", icon: Calendar, count: periods.length },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabKey)}
              className={`h-10 px-4 flex items-center gap-2 text-caption font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                active
                  ? "border-crimson-primary text-crimson-primary font-semibold"
                  : "border-transparent text-secondary hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.count !== undefined && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-muted text-muted font-mono">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── TAB 1: PAYROLL RUNS ─────────────────────────────────────────── */}
      {activeTab === "runs" && (
        <div className="space-y-4">
          {runs.length === 0 ? (
            <GlassCard className="p-8 text-center text-muted">
              <Users className="w-10 h-10 mx-auto text-muted/50 mb-2" />
              <p className="text-body font-medium">No payroll runs recorded.</p>
              <p className="text-caption mt-1">Click "New Payroll Run" above to simulate and approve monthly payroll.</p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {runs.map((run) => {
                const isPosted = run.status === "POSTED" || run.status === "PAID" || run.status === "PARTIALLY_PAID";
                const isReversed = run.status === "REVERSED";

                return (
                  <GlassCard key={run.id} className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-body font-mono font-bold text-foreground">{run.run_no}</span>
                        <span className="text-caption px-2 py-0.5 rounded bg-bg-subtle border border-border-subtle font-mono text-secondary">
                          {run.period?.period_code || "MONTHLY"}
                        </span>
                        <span
                          className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                            run.status === "PAID"
                              ? "bg-status-optimal/10 text-status-optimal border border-status-optimal/20"
                              : run.status === "POSTED"
                              ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                              : run.status === "REVERSED"
                              ? "bg-status-alert/10 text-status-alert border border-status-alert/20"
                              : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                          }`}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
                        <span>Staff: <strong className="text-foreground">{run.total_workers}</strong></span>
                        <span>Gross: <strong className="text-foreground">{formatPKR(run.gross_earnings)}</strong></span>
                        <span>Deductions: <strong className="text-foreground">{formatPKR(run.total_deductions)}</strong></span>
                        <span>Net Payable: <strong className="text-crimson-primary font-mono">{formatPKR(run.net_payable)}</strong></span>
                        <span>Paid: <strong className="text-status-optimal font-mono">{formatPKR(run.amount_paid)}</strong></span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Post to GL */}
                      {run.status === "APPROVED" && (
                        <CrimsonButton onClick={() => handlePostToAccounting(run)} className="h-8 text-caption">
                          Post Accrual (GL)
                        </CrimsonButton>
                      )}

                      {/* Pay Items */}
                      {isPosted && run.amount_paid < run.net_payable && (
                        <button
                          onClick={() => {
                            setPayModalRun(run);
                            setSelectedItemIds((run.items || []).filter((i) => (i.net_pay - i.amount_paid) > 0).map((i) => i.id));
                          }}
                          className="h-8 px-3 rounded-lg bg-status-optimal text-white hover:bg-emerald-600 text-caption font-medium transition-colors flex items-center gap-1.5"
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          Disburse Pay
                        </button>
                      )}

                      {/* Disbursement Sheet Export */}
                      <button
                        onClick={() => handleExportDisbursement(run)}
                        title="Download bank transfer & cash disbursement list"
                        className="h-8 px-2.5 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-caption transition-colors flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Disbursement PDF
                      </button>

                      {/* Storno Reversal */}
                      {run.status === "POSTED" && run.amount_paid === 0 && (
                        <button
                          onClick={() => setReversalRun(run)}
                          className="h-8 px-2.5 rounded-lg border border-status-alert/30 text-status-alert hover:bg-status-alert/10 text-caption transition-colors flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Storno Reverse
                        </button>
                      )}
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: CALCULATION / SIMULATION WIZARD ──────────────────────── */}
      {activeTab === "simulation" && (
        <div className="space-y-6">
          <GlassCard className="p-5">
            <h3 className="text-h2 font-semibold text-foreground mb-3">Simulation Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Period</label>
                <select
                  value={simPeriodId}
                  onChange={(e) => setSimPeriodId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.period_code} ({p.start_date} to {p.end_date}) [{p.status}]
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Cost Classification</label>
                <select
                  value={simCostClass}
                  onChange={(e) => setSimCostClass(e.target.value as any)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  <option value="ALL">All Factory & Admin Staff</option>
                  <option value="PRODUCTION">Production / Direct Labour (COGS only)</option>
                  <option value="ADMIN">Administration & Management (OPEX only)</option>
                </select>
              </div>

              <div className="flex items-end">
                <CrimsonButton onClick={handleRunSimulation} disabled={simulating} className="w-full h-9">
                  {simulating ? "Re-computing..." : "Run Simulation"}
                </CrimsonButton>
              </div>
            </div>
          </GlassCard>

          {simResult && (
            <div className="space-y-4">
              {/* Summary Tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <GlassCard className="p-4">
                  <p className="text-[10px] text-muted uppercase">Total Staff</p>
                  <p className="text-h2 font-bold font-mono text-foreground mt-0.5">{simResult.totals.totalWorkers}</p>
                </GlassCard>
                <GlassCard className="p-4">
                  <p className="text-[10px] text-muted uppercase">Gross Earnings</p>
                  <p className="text-h2 font-bold font-mono text-foreground mt-0.5">{formatPKR(simResult.totals.grossEarnings)}</p>
                </GlassCard>
                <GlassCard className="p-4">
                  <p className="text-[10px] text-muted uppercase">Direct Labour (COGS)</p>
                  <p className="text-h2 font-bold font-mono text-amber-500 mt-0.5">{formatPKR(simResult.totals.productionCost)}</p>
                </GlassCard>
                <GlassCard className="p-4">
                  <p className="text-[10px] text-muted uppercase">Net Payable</p>
                  <p className="text-h2 font-bold font-mono text-crimson-primary mt-0.5">{formatPKR(simResult.totals.netPayable)}</p>
                </GlassCard>
              </div>

              {/* Employee Calculation Grid */}
              <GlassCard className="overflow-hidden">
                <div className="p-4 border-b border-border-subtle flex justify-between items-center">
                  <h4 className="text-body font-semibold text-foreground">Worker Simulation Register</h4>
                  <CrimsonButton onClick={handleApproveAndSaveRun}>
                    Approve Run ({formatPKR(simResult.totals.netPayable)})
                  </CrimsonButton>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-caption text-left">
                    <thead className="bg-bg-subtle text-secondary uppercase text-[10px] border-b border-border-subtle">
                      <tr>
                        <th className="p-3">Worker</th>
                        <th className="p-3">Cost Class</th>
                        <th className="p-3">Attendance</th>
                        <th className="p-3 text-right">Basic</th>
                        <th className="p-3 text-right">OT Pay</th>
                        <th className="p-3 text-right">Gross</th>
                        <th className="p-3 text-right">Loan Recovery</th>
                        <th className="p-3 text-right">Net Salary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle font-mono">
                      {simResult.items.map((it) => (
                        <tr key={it.workerId} className="hover:bg-bg-subtle/50 transition-colors">
                          <td className="p-3 font-sans font-medium text-foreground">{it.workerName}</td>
                          <td className="p-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${it.costClass === "PRODUCTION" ? "bg-amber-500/10 text-amber-500" : "bg-blue-500/10 text-blue-500"}`}>
                              {it.costClass}
                            </span>
                          </td>
                          <td className="p-3 text-secondary text-[11px]">
                            P: {it.attendance.presentDays} | A: {it.attendance.absentDays} | L: {it.attendance.leaveDays}
                          </td>
                          <td className="p-3 text-right">{formatPKR(it.baseEarnings)}</td>
                          <td className="p-3 text-right text-status-optimal">+{formatPKR(it.overtimePay)}</td>
                          <td className="p-3 text-right font-bold text-foreground">{formatPKR(it.grossEarnings)}</td>
                          <td className="p-3 text-right text-status-alert">−{formatPKR(it.loanRecoveryDeduction)}</td>
                          <td className="p-3 text-right font-bold text-crimson-primary">{formatPKR(it.netPayable)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: EMPLOYEE ACCOUNT LEDGER ────────────────────────────── */}
      {activeTab === "ledger" && (
        <EmployeeLedgerView
          key={`ledger-${ledgerFocus?.id ?? "all"}`}
          ledger={employeeLedger}
          focusWorkerId={ledgerFocus?.id ?? null}
          onViewTransactions={goToEmployeeTransactions}
        />
      )}

      {/* ─── TAB 4: TRANSACTION HISTORY ────────────────────────────────── */}
      {activeTab === "transactions" && (
        <TransactionHistory
          key={`txn-${txnFocus?.id ?? "all"}`}
          logs={allPaymentLogs}
          allAccounts={employeeLedger}
          focusWorkerId={txnFocus?.id ?? null}
          focusWorkerName={txnFocus?.name ?? null}
          onOpenLedger={goToEmployeeLedger}
          onExport={() => handleExportDisbursement()}
        />
      )}

      {/* ─── TAB 5: WAGE TYPES ────────────────────────────────────────────── */}
      {activeTab === "wage_types" && (
        <GlassCard className="p-5">
          <div className="mb-4">
            <h3 className="text-h2 font-semibold text-foreground">SAP Wage Type Catalog</h3>
            <p className="text-caption text-muted">Defines gross-to-net calculation logic and automated General Ledger account determination</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-caption text-left">
              <thead className="bg-bg-subtle text-secondary uppercase text-[10px] border-b border-border-subtle">
                <tr>
                  <th className="p-3">Code</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Calc Type</th>
                  <th className="p-3">Production GL (COGS)</th>
                  <th className="p-3">Admin GL (OPEX)</th>
                  <th className="p-3">Liability / Recovery GL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono text-[12px]">
                {wageTypes.map((wt) => (
                  <tr key={wt.code} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="p-3 font-bold text-foreground">{wt.code}</td>
                    <td className="p-3 font-sans font-medium text-foreground">{wt.name}</td>
                    <td className="p-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${wt.category === "EARNING" ? "bg-status-optimal/10 text-status-optimal" : "bg-status-alert/10 text-status-alert"}`}>
                        {wt.category}
                      </span>
                    </td>
                    <td className="p-3 text-muted">{wt.calc_type}</td>
                    <td className="p-3 text-amber-500 font-sans">
                      {accounts.find((a) => a.id === wt.gl_account_production)?.account_code || "5010/5011"}
                    </td>
                    <td className="p-3 text-blue-500 font-sans">
                      {accounts.find((a) => a.id === wt.gl_account_admin)?.account_code || "5002"}
                    </td>
                    <td className="p-3 text-secondary font-sans">
                      {accounts.find((a) => a.id === wt.gl_account_liability)?.account_code || "2300"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* ─── TAB 6: PAYROLL PERIODS ───────────────────────────────────────── */}
      {activeTab === "periods" && (
        <GlassCard className="p-5">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-h2 font-semibold text-foreground">Payroll Period Master</h3>
              <p className="text-caption text-muted">Configures active and locked accounting periods for payroll control</p>
            </div>
            <CrimsonButton onClick={() => setPeriodModalOpen(true)} className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              New Period
            </CrimsonButton>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-caption text-left">
              <thead className="bg-bg-subtle text-secondary uppercase text-[10px] border-b border-border-subtle">
                <tr>
                  <th className="p-3">Period Code</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Start Date</th>
                  <th className="p-3">End Date</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono">
                {periods.map((p) => (
                  <tr key={p.id} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="p-3 font-bold text-foreground">{p.period_code}</td>
                    <td className="p-3 text-secondary font-sans">{p.period_type}</td>
                    <td className="p-3 text-muted">{p.start_date}</td>
                    <td className="p-3 text-muted">{p.end_date}</td>
                    <td className="p-3">
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold ${p.status === "OPEN" ? "bg-status-optimal/10 text-status-optimal" : "bg-muted/10 text-muted"}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* ─── PAYMENT MODAL ────────────────────────────────────────────────── */}
      {payModalRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-h2 font-semibold text-foreground">Disburse Payroll</h3>
              <button onClick={() => setPayModalRun(null)} className="text-muted hover:text-foreground">✕</button>
            </div>

            <div className="p-3 bg-bg-subtle rounded-lg border border-border-subtle text-caption space-y-1">
              <p>Run: <strong>{payModalRun.run_no}</strong> ({payModalRun.period?.period_code})</p>
              <p>Selected Staff: <strong>{selectedItemIds.length}</strong></p>
              <p>Total Payable: <strong className="text-crimson-primary font-mono">{formatPKR(
                (payModalRun.items || [])
                  .filter((i) => selectedItemIds.includes(i.id))
                  .reduce((sum, i) => sum + (i.net_pay - i.amount_paid), 0)
              )}</strong></p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Disbursement Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  <option value="CASH">Cash in Hand</option>
                  <option value="BANK">Bank Account / Transfer</option>
                </select>
              </div>

              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Payment Account</label>
                <select
                  value={paymentAccountId}
                  onChange={(e) => setPaymentAccountId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  <option value="">Select Account...</option>
                  {liquidAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_code} {a.account_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <button
                onClick={() => setPayModalRun(null)}
                className="h-9 px-3 rounded-lg bg-bg-muted text-secondary hover:text-foreground text-caption"
              >
                Cancel
              </button>
              <CrimsonButton onClick={handleExecutePayment} disabled={submittingPayment || !paymentAccountId}>
                {submittingPayment ? "Executing..." : "Confirm & Post Payment"}
              </CrimsonButton>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ─── STORNO REVERSAL MODAL ────────────────────────────────────────── */}
      {reversalRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-h2 font-semibold text-status-alert flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5" /> Storno Reversal
              </h3>
              <button onClick={() => setReversalRun(null)} className="text-muted hover:text-foreground">✕</button>
            </div>

            <p className="text-caption text-secondary">
              This will create a balanced reversing journal entry (storno) restoring all general ledger balances, reversing worker loan deductions, and marking run <strong>{reversalRun.run_no}</strong> as REVERSED.
            </p>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Reason for Reversal</label>
              <textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                rows={3}
                placeholder="e.g., Erroneous overtime calculation, period correction..."
                className="w-full p-2.5 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <button
                onClick={() => setReversalRun(null)}
                className="h-9 px-3 rounded-lg bg-bg-muted text-secondary hover:text-foreground text-caption"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteReversal}
                disabled={submittingReversal || !reversalReason.trim()}
                className="h-9 px-4 rounded-lg bg-status-alert text-white hover:bg-red-700 text-caption font-semibold"
              >
                {submittingReversal ? "Reversing..." : "Execute Storno Reversal"}
              </button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ─── NEW PERIOD MODAL ─────────────────────────────────────────────── */}
      {periodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-h2 font-semibold text-foreground">Create Payroll Period</h3>
              <button onClick={() => setPeriodModalOpen(false)} className="text-muted hover:text-foreground">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Period Code</label>
                <input
                  type="text"
                  placeholder="e.g. 2026-M11"
                  value={newPeriodCode}
                  onChange={(e) => setNewPeriodCode(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                />
              </div>

              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Type</label>
                <select
                  value={newPeriodType}
                  onChange={(e) => setNewPeriodType(e.target.value as any)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="WEEKLY">Weekly</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newPeriodStart}
                    onChange={(e) => setNewPeriodStart(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                  />
                </div>
                <div>
                  <label className="text-caption text-secondary uppercase tracking-wider block mb-1">End Date</label>
                  <input
                    type="date"
                    value={newPeriodEnd}
                    onChange={(e) => setNewPeriodEnd(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <button
                onClick={() => setPeriodModalOpen(false)}
                className="h-9 px-3 rounded-lg bg-bg-muted text-secondary hover:text-foreground text-caption"
              >
                Cancel
              </button>
              <CrimsonButton onClick={handleCreatePeriod}>Save Period</CrimsonButton>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
