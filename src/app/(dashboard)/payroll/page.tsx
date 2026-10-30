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
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import GlassCard from "@/components/ui/GlassCard";
import { formatPKR } from "@/lib/utils/formatters";
import { fetchAccounts, fetchAvailableFunds, type Account, type AvailableFunds } from "@/lib/supabase/ledger";
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
  fetchRunItemLines,
  fetchPayrollPaymentLogs,
  fetchPayrollCrossLedgerTransactions,
  fetchPayrollParties,
  buildEmployeeLedger,
  type PayrollParty,
  type PayrollPeriod,
  type PayrollWageType,
  type PayrollRun,
  type PayrollPaymentLog,
} from "@/lib/supabase/payroll";
import { monthLabelOf, round2 } from "@/lib/salary";
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

  const [activeTab, setActiveTab] = useState<TabKey>("ledger");
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
  const [simUnmarkedConfirmed, setSimUnmarkedConfirmed] = useState(false);

  // Selected Run & Modals
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [expandedRunIds, setExpandedRunIds] = useState<string[]>([]);
  const [payModalRun, setPayModalRun] = useState<PayrollRun | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  /** Editable per-employee disbursement amounts: { [item_id]: amount }. */
  const [payAmounts, setPayAmounts] = useState<Record<string, number>>({});
  const [availableFunds, setAvailableFunds] = useState<AvailableFunds | null>(null);
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
      const [pList, wtList, rList, accList, logs, workerList, partyList, crossList] = await Promise.all([
        fetchPayrollPeriods(),
        fetchPayrollWageTypes(),
        fetchPayrollRuns(),
        fetchAccounts(),
        fetchPayrollPaymentLogs(),
        fetchPayrollEmployeeProfiles(),
        fetchPayrollParties(),
        fetchPayrollCrossLedgerTransactions(),
      ]);
      setPeriods(pList);
      setWageTypes(wtList);
      setRuns(rList);
      setAccounts(accList);
      setPaymentLogs(logs);
      setWorkers(workerList);
      // CRM parties (customers, suppliers) + cross-ledger receipts/vouchers — these
      // are what give the Employee Accounts ledger its customer & vendor rows.
      setParties(partyList);
      setCrossLogs(crossList);
    } catch (err) {
      console.error("Load payroll error:", err);
      toast.error("Failed to load payroll data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
      setSimUnmarkedConfirmed(false);
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
    const unmarkedWorkers = simResult.items.filter((it) => (it.unmarkedDays || 0) > 0);
    if (unmarkedWorkers.length > 0 && !simUnmarkedConfirmed) {
      toast.error(
        `${unmarkedWorkers.length} worker${unmarkedWorkers.length === 1 ? " has" : "s have"} unmarked attendance days. Review and tick the confirmation before approving.`
      );
      return;
    }
    try {
      const { data, error } = await createPayrollRunFromSimulation(simResult, operatorName);
      if (error || !data) {
        toast.error(error || "Failed to approve payroll run.");
        return;
      }
      toast.success(`Payroll Run ${data.run_no} created and approved.`);
      setSimResult(null);
      setSimUnmarkedConfirmed(false);
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

    // Enforce method ⇄ account pairing: CASH cannot pay from a bank account and vice versa.
    const account = accounts.find((a) => a.id === paymentAccountId);
    const accountIsCash = !!account && (account.is_default_cash || account.account_code === "1000");
    const accountIsBank = !!account && ((account.is_liquid_funds && !accountIsCash) || account.account_code === "1002");
    if (paymentMethod === "CASH" && !accountIsCash) {
      toast.error("Cash disbursements must be paid from a Cash in Hand account.");
      return;
    }
    if (paymentMethod === "BANK" && !accountIsBank) {
      toast.error("Bank transfers must be paid from a Bank account.");
      return;
    }

    // Build explicit per-employee amounts (defaults to the full pending amount).
    const amounts: Record<string, number> = {};
    let total = 0;
    for (const item of payModalRun.items || []) {
      if (!selectedItemIds.includes(item.id)) continue;
      const pending = round2(Number(item.net_pay) - Number(item.amount_paid));
      const raw = payAmounts[item.id];
      const amount = round2(Number.isFinite(raw) && raw !== undefined ? raw : pending);
      if (amount <= 0) {
        toast.error(`${item.worker_name}: payment amount must be greater than zero.`);
        return;
      }
      if (amount > pending) {
        toast.error(
          `${item.worker_name}: amount ${formatPKR(amount)} exceeds the pending ${formatPKR(pending)}.`
        );
        return;
      }
      amounts[item.id] = amount;
      total = round2(total + amount);
    }
    if (total <= 0) {
      toast.error("Selected payment total must be greater than zero.");
      return;
    }

    const balance = paymentMethod === "CASH" ? availableFunds?.cashBalance : availableFunds?.bankBalance;
    if (typeof balance === "number" && total > balance) {
      toast.error(
        `Insufficient ${paymentMethod === "CASH" ? "cash in hand" : "bank balance"}: ${formatPKR(balance)} available vs ${formatPKR(total)} selected.`
      );
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
        amounts,
      });
      if (!res.success) {
        toast.error(res.error || "Payment execution failed.");
        return;
      }
      toast.success(
        `Disbursed ${formatPKR(total)} to ${selectedItemIds.length} employee${selectedItemIds.length === 1 ? "" : "s"} via batch ${res.batchNo}`
      );
      setPayModalRun(null);
      setSelectedItemIds([]);
      setPayAmounts({});
      setPaymentAccountId("");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Payment execution failed.");
    } finally {
      setSubmittingPayment(false);
    }
  };

  /** Open the pay modal pre-selected for a set of items (defaults to every pending one). */
  const openPayModal = (run: PayrollRun, itemIds?: string[]) => {
    const pendingItems = (run.items || []).filter((i) => round2(i.net_pay - i.amount_paid) > 0);
    const ids = itemIds ?? pendingItems.map((i) => i.id);
    const seed: Record<string, number> = {};
    for (const item of pendingItems) {
      if (ids.includes(item.id)) seed[item.id] = round2(item.net_pay - item.amount_paid);
    }
    setPaymentMethod(
      itemIds && itemIds.length === 1
        ? (pendingItems.find((i) => i.id === itemIds[0])?.worker?.default_pay_method === "BANK" ? "BANK" : "CASH")
        : "CASH"
    );
    setPaymentAccountId("");
    setSelectedItemIds(ids);
    setPayAmounts(seed);
    setPayModalRun(run);
    fetchAvailableFunds()
      .then(setAvailableFunds)
      .catch(() => setAvailableFunds(null));
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

  // Print Payslip — always re-load the run's wage-type lines so the slip prints
  // the real earnings/deduction breakdown instead of a head-less summary row.
  const handlePrintSlip = async (run: PayrollRun, itemId: string) => {
    try {
      const items = await fetchRunItemLines(run.id);
      const item = items.find((i) => i.id === itemId);
      if (!item) {
        toast.error("Could not load this payslip's wage-type lines.");
        return;
      }
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

  // Export Disbursement List — one row per real payment log, carrying the actual
  // method (cash vs bank) and the worker's bank name / IBAN.
  // Reads the raw log state (not the memoized union) so React Compiler can keep
  // the surrounding memoization intact.
  const handleExportDisbursement = (run?: PayrollRun) => {
    const source = [...paymentLogs, ...crossLogs];
    // Reversals are stamped on the row (`reversed_at`) by the storno RPC but are not
    // part of the TS shape yet — read them defensively so reversed payouts never
    // show as live cash outflows.
    const reversedIds = source
      .filter((l) => !!(l as PayrollPaymentLog & { reversed_at?: string | null }).reversed_at)
      .map((l) => l.id);
    const logs = source.filter(
      (l) =>
        !reversedIds.includes(l.id) &&
        (l.payment_method === "CASH" || l.payment_method === "BANK") &&
        // Customer receipts are inflows — never a disbursement.
        l.run_id !== "cross-ledger-crv" &&
        (run ? l.run?.id === run.id : true)
    );
    const list = logs.map((log) => {
      const worker = workers.find((w) => w.id === log.item?.worker_id);
      return {
        worker_name: log.item?.worker_name || "—",
        cost_class: log.item?.cost_class || "—",
        payment_method: log.payment_method,
        bank_name: worker?.bank_name ?? null,
        account_iban: worker?.account_iban ?? null,
        amount: Number(log.amount || 0),
        disbursement_batch_no: log.disbursement_batch_no,
        reference_no: log.reference_no,
      };
    });
    if (list.length === 0) {
      toast.error("No disbursed payments to export.");
      return;
    }
    exportDisbursementListPDF(list, `Disbursement Sheet - ${run?.run_no || "All Runs"}`, operatorName);
  };

  // Filter liquid accounts for payment modal
  const liquidAccounts = useMemo(() => {
    return accounts.filter(
      (a) => a.is_liquid_funds || a.is_default_cash || a.account_code === "1000" || a.account_code === "1002"
    );
  }, [accounts]);

  // Combined payroll runs & cross-ledger transaction logs
  const allPaymentLogs = useMemo(() => [...paymentLogs, ...crossLogs], [paymentLogs, crossLogs]);

  /** runId:workerId → run item id, so a single month can be paid directly. */
  const payItemIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of runs) {
      for (const item of run.items || []) {
        map.set(`${run.id}:${item.worker_id}`, item.id);
      }
    }
    return map;
  }, [runs]);

  // Unified account ledger (employees, vendors, contractors & customers).
  // Payroll logs and cross-ledger CRM logs are passed separately — buildEmployeeLedger
  // merges them itself, and handing it the pre-merged union would double-count rows.
  const employeeLedger = useMemo(() => {
    const base = buildEmployeeLedger(runs, paymentLogs, workers, parties, crossLogs);
    return base.map((acc) => ({
      ...acc,
      months: acc.months.map((m) => ({
        ...m,
        itemId: m.isLegacy ? undefined : payItemIndex.get(`${m.runId}:${acc.workerId}`),
      })),
    }));
  }, [runs, paymentLogs, crossLogs, workers, parties, payItemIndex]);

  /** Simulated workers whose attendance has unmarked days. */
  const simUnmarkedWorkers = useMemo(
    () => (simResult ? simResult.items.filter((it) => (it.unmarkedDays || 0) > 0) : []),
    [simResult]
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

  // ─── Pay modal derived values ─────────────────────────────────────────
  const payRunItems = payModalRun?.items || [];

  /** Only accounts that match the chosen method — cash cannot pay from a bank and vice versa. */
  const paymentAccountOptions = liquidAccounts.filter((a) => {
    const isCash = a.is_default_cash || a.account_code === "1000";
    const isBank = (a.is_liquid_funds && !isCash) || a.account_code === "1002";
    return paymentMethod === "CASH" ? isCash : isBank;
  });

  const paySelectedTotal = round2(
    selectedItemIds.reduce((sum, id) => {
      const item = payRunItems.find((i) => i.id === id);
      if (!item) return sum;
      const pending = round2(item.net_pay - item.amount_paid);
      const raw = payAmounts[id];
      return sum + (typeof raw === "number" && Number.isFinite(raw) ? raw : pending);
    }, 0)
  );

  const payMethodBalance =
    paymentMethod === "CASH" ? availableFunds?.cashBalance : availableFunds?.bankBalance;

  const payOverdrafted = typeof payMethodBalance === "number" && paySelectedTotal > payMethodBalance;

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
              setActiveTab("simulation");
            }}
            className="flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            New Payroll Run
          </CrimsonButton>
        </div>
      </div>

      {/* ─── Navigation Tabs ─────────────────────────────────────────────── */}
      <div className="flex border-b border-border-default gap-2 overflow-x-auto pb-px">
        {[
          { key: "ledger", label: "Employee Accounts", icon: BookUser, count: employeeLedger.length },
          { key: "transactions", label: "Transactions", icon: ReceiptText, count: allPaymentLogs.length },
          { key: "runs", label: "Payroll Runs", icon: Layers, count: runs.length },
          { key: "simulation", label: "Calculation Wizard", icon: Play },
          { key: "periods", label: "Periods", icon: Calendar, count: periods.length },
          { key: "wage_types", label: "Wage Types", icon: FileText, count: wageTypes.length },
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
                const expanded = expandedRunIds.includes(run.id);
                const runPending = round2(run.net_payable - run.amount_paid);

                return (
                  <GlassCard key={run.id} className="overflow-hidden">
                    <div className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
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
                        {run.status === "APPROVED" && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/25 flex items-center gap-1"
                            title="This run has not been posted to the General Ledger yet."
                          >
                            <AlertTriangle className="w-3 h-3" />
                            Not posted to accounts
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
                        <span>Staff: <strong className="text-foreground">{run.total_workers}</strong></span>
                        <span>Gross: <strong className="text-foreground">{formatPKR(run.gross_earnings)}</strong></span>
                        <span>Deductions: <strong className="text-foreground">{formatPKR(run.total_deductions)}</strong></span>
                        <span>Net Payable: <strong className="text-crimson-primary font-mono">{formatPKR(run.net_payable)}</strong></span>
                        <span>Paid: <strong className="text-status-optimal font-mono">{formatPKR(run.amount_paid)}</strong></span>
                        <span>Pending: <strong className={runPending > 0 ? "text-amber-500 font-mono" : "text-muted font-mono"}>{formatPKR(runPending)}</strong></span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Post to GL */}
                      {run.status === "APPROVED" && (
                        <CrimsonButton onClick={() => handlePostToAccounting(run)} className="h-8 text-caption">
                          Post Accrual (GL)
                        </CrimsonButton>
                      )}

                      {/* Pay whole run */}
                      {isPosted && runPending > 0 && (
                        <button
                          onClick={() => openPayModal(run)}
                          className="h-8 px-3 rounded-lg bg-status-optimal text-white hover:bg-emerald-600 text-caption font-medium transition-colors flex items-center gap-1.5"
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          Disburse Pay
                        </button>
                      )}

                      {/* Expand items */}
                      <button
                        onClick={() =>
                          setExpandedRunIds((prev) =>
                            expanded ? prev.filter((id) => id !== run.id) : [...prev, run.id]
                          )
                        }
                        className="h-8 px-3 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-caption font-medium transition-colors flex items-center gap-1.5"
                      >
                        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {expanded ? "Hide Employees" : "Employees"}
                      </button>

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
                    </div>

                    {/* ── Expanded per-employee items ─────────────────────── */}
                    {expanded && (
                      <div className="border-t border-border-subtle bg-bg-subtle/30 overflow-x-auto">
                        <table className="w-full text-caption text-left">
                          <thead className="bg-bg-subtle text-secondary uppercase text-[10px] border-b border-border-subtle">
                            <tr>
                              <th className="p-2.5">Employee</th>
                              <th className="p-2.5 text-right">Gross</th>
                              <th className="p-2.5 text-right">Deductions</th>
                              <th className="p-2.5 text-right">Net</th>
                              <th className="p-2.5 text-right">Paid</th>
                              <th className="p-2.5 text-right">Pending</th>
                              <th className="p-2.5">Status</th>
                              <th className="p-2.5 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-subtle font-mono">
                            {(run.items || []).length === 0 ? (
                              <tr>
                                <td colSpan={8} className="p-4 text-center font-sans text-muted">
                                  No employee lines stored on this run.
                                </td>
                              </tr>
                            ) : (
                              (run.items || []).map((item) => {
                                const pending = round2(item.net_pay - item.amount_paid);
                                return (
                                  <tr key={item.id} className="hover:bg-bg-subtle/50 transition-colors">
                                    <td className="p-2.5 font-sans font-medium text-foreground">{item.worker_name}</td>
                                    <td className="p-2.5 text-right text-secondary">{formatPKR(item.gross_earnings)}</td>
                                    <td className="p-2.5 text-right text-status-alert">−{formatPKR(item.total_deductions)}</td>
                                    <td className="p-2.5 text-right font-bold text-foreground">{formatPKR(item.net_pay)}</td>
                                    <td className="p-2.5 text-right font-semibold text-status-optimal">{formatPKR(item.amount_paid)}</td>
                                    <td className={`p-2.5 text-right font-semibold ${pending > 0 ? "text-amber-500" : "text-muted"}`}>
                                      {formatPKR(pending)}
                                    </td>
                                    <td className="p-2.5">
                                      <span
                                        className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                          item.status === "PAID"
                                            ? "bg-status-optimal/10 text-status-optimal"
                                            : item.status === "REVERSED"
                                            ? "bg-status-alert/10 text-status-alert"
                                            : "bg-amber-500/10 text-amber-500"
                                        }`}
                                      >
                                        {item.status}
                                      </span>
                                    </td>
                                    <td className="p-2.5">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <button
                                          onClick={() => handlePrintSlip(run, item.id)}
                                          title="Print payslip (loads wage-type lines)"
                                          className="h-7 px-2.5 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-[11px] font-medium transition-colors flex items-center gap-1"
                                        >
                                          <FileText className="w-3 h-3" />
                                          Print Slip
                                        </button>
                                        {isPosted && pending > 0 && (
                                          <button
                                            onClick={() => openPayModal(run, [item.id])}
                                            className="h-7 px-2.5 rounded-lg bg-status-optimal text-white hover:bg-emerald-600 text-[11px] font-medium transition-colors flex items-center gap-1"
                                          >
                                            <DollarSign className="w-3 h-3" />
                                            Pay
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
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
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">
                  Period <span className="text-status-alert">*</span>
                </label>
                <select
                  value={simPeriodId}
                  onChange={(e) => setSimPeriodId(e.target.value)}
                  required
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  <option value="">Select a payroll period...</option>
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
                <CrimsonButton
                  onClick={handleRunSimulation}
                  disabled={simulating || !simPeriodId}
                  className="w-full h-9"
                >
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
                <div className="p-4 border-b border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-body font-semibold text-foreground">Worker Simulation Register</h4>
                    <p className="text-caption text-muted">
                      Gross-to-net per worker: OT pay, undertime, loan recovery & net
                    </p>
                  </div>
                  <CrimsonButton
                    onClick={handleApproveAndSaveRun}
                    disabled={simUnmarkedWorkers.length > 0 && !simUnmarkedConfirmed}
                  >
                    Approve Run ({formatPKR(simResult.totals.netPayable)})
                  </CrimsonButton>
                </div>

                {/* Unmarked attendance warning — approval is gated behind a confirmation */}
                {simUnmarkedWorkers.length > 0 && (
                  <div className="p-3 md:p-4 bg-amber-500/5 border-b border-amber-500/25 space-y-2">
                    <div className="flex items-start gap-2 text-caption text-amber-500">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold">
                          {simUnmarkedWorkers.length} worker{simUnmarkedWorkers.length === 1 ? " has" : "s have"} unmarked attendance days — they are paid as unpaid.
                        </p>
                        <p className="text-[11px] text-amber-500/80">
                          Mark the missing attendance in the Labour module before approving, or confirm you have reviewed them.
                        </p>
                      </div>
                    </div>
                    <label className="flex items-start gap-2 text-caption text-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={simUnmarkedConfirmed}
                        onChange={(e) => setSimUnmarkedConfirmed(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>I have reviewed the unmarked days listed below and want to approve this run anyway.</span>
                    </label>
                  </div>
                )}

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
                        <th className="p-3 text-right">Undertime</th>
                        <th className="p-3 text-right">Loan Recovery</th>
                        <th className="p-3 text-right">Net Salary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle font-mono">
                      {simResult.items.map((it) => {
                        const unmarked = it.unmarkedDays || 0;
                        return (
                        <tr key={it.workerId} className="hover:bg-bg-subtle/50 transition-colors">
                          <td className="p-3 font-sans font-medium text-foreground">{it.workerName}</td>
                          <td className="p-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${it.costClass === "PRODUCTION" ? "bg-amber-500/10 text-amber-500" : "bg-blue-500/10 text-blue-500"}`}>
                              {it.costClass}
                            </span>
                          </td>
                          <td className="p-3 text-secondary text-[11px]">
                            <span className="inline-flex items-center gap-1.5">
                              P: {it.attendance.presentDays} | A: {it.attendance.absentDays} | L: {it.attendance.leaveDays}
                              {unmarked > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 text-amber-500 font-semibold"
                                  title={`${unmarked} day${unmarked === 1 ? "" : "s"} with no attendance marked (paid as absent)`}
                                >
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {unmarked} unmarked
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="p-3 text-right">{formatPKR(it.baseEarnings)}</td>
                          <td className="p-3 text-right text-status-optimal">+{formatPKR(it.overtimePay)}</td>
                          <td className="p-3 text-right font-bold text-foreground">{formatPKR(it.grossEarnings)}</td>
                          <td className="p-3 text-right text-status-alert">−{formatPKR(it.undertimeDeductions)}</td>
                          <td className="p-3 text-right text-status-alert">−{formatPKR(it.loanRecoveryDeduction)}</td>
                          <td className="p-3 text-right font-bold text-crimson-primary">{formatPKR(it.netPayable)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: EMPLOYEE ACCOUNTS ─────────────────────────────────────── */}
      {activeTab === "ledger" && (
        <EmployeeLedgerView
          key={`ledger-${ledgerFocus?.id ?? "all"}`}
          ledger={employeeLedger}
          focusWorkerId={ledgerFocus?.id ?? null}
          onViewTransactions={goToEmployeeTransactions}
          onPayItem={(runId, itemId) => {
            const run = runs.find((r) => r.id === runId);
            if (!run) {
              toast.error("Payroll run not found — refresh and try again.");
              return;
            }
            openPayModal(run, [itemId]);
          }}
        />
      )}

      {/* ─── TAB: TRANSACTIONS ──────────────────────────────────────────── */}
      {activeTab === "transactions" && (
        <TransactionHistory
          key={`txn-${txnFocus?.id ?? "all"}`}
          logs={allPaymentLogs}
          allAccounts={employeeLedger}
          focusWorkerId={txnFocus?.id ?? null}
          focusWorkerName={txnFocus?.name ?? null}
          operatorName={operatorName}
          onOpenLedger={goToEmployeeLedger}
          onReversed={loadData}
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
          <GlassCard className="max-w-2xl w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-h2 font-semibold text-foreground">Disburse Payroll</h3>
              <button onClick={() => setPayModalRun(null)} className="text-muted hover:text-foreground">✕</button>
            </div>

            <div className="p-3 bg-bg-subtle rounded-lg border border-border-subtle text-caption space-y-1">
              <p>
                Run: <strong>{payModalRun.run_no}</strong> ({monthLabelOf(payModalRun.period?.start_date || "") || payModalRun.period?.period_code})
              </p>
              <p className="flex items-center gap-3 flex-wrap">
                <span>
                  Selected: <strong>{selectedItemIds.length}</strong> / {payRunItems.length || payModalRun.total_workers}
                </span>
                <span>
                  Total to disburse:{" "}
                  <strong className="text-crimson-primary font-mono">{formatPKR(paySelectedTotal)}</strong>
                </span>
                <span>
                  {paymentMethod === "CASH" ? "Cash in hand" : "Bank balance"}:{" "}
                  <strong className={payOverdrafted ? "text-status-alert font-mono" : "text-foreground font-mono"}>
                    {typeof payMethodBalance === "number" ? formatPKR(payMethodBalance) : "—"}
                  </strong>
                </span>
              </p>
              {payOverdrafted && (
                <p className="text-status-alert text-[11px] flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Selected amount exceeds the account balance.
                </p>
              )}
            </div>

            {/* Employee picker — one checkbox + editable amount per employee */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-caption text-secondary uppercase tracking-wider">Employees</label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setSelectedItemIds(payRunItems.map((i) => i.id));
                      setPayAmounts(
                        Object.fromEntries(
                          payRunItems.map((i) => [i.id, round2(i.net_pay - i.amount_paid)])
                        )
                      );
                    }}
                    className="h-7 px-2.5 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-[11px] font-medium"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => {
                      setSelectedItemIds([]);
                      setPayAmounts({});
                    }}
                    className="h-7 px-2.5 rounded-lg bg-bg-muted border border-border-default text-secondary hover:text-foreground text-[11px] font-medium"
                  >
                    Select none
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle">
                {payRunItems.length === 0 ? (
                  <p className="p-3 text-caption text-muted">No employee lines available on this run.</p>
                ) : (
                  payRunItems.map((item) => {
                    const pending = round2(item.net_pay - item.amount_paid);
                    const checked = selectedItemIds.includes(item.id);
                    const amount = payAmounts[item.id] ?? pending;
                    return (
                      <div key={item.id} className="p-2.5 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setSelectedItemIds((prev) =>
                              on ? [...prev, item.id] : prev.filter((id) => id !== item.id)
                            );
                            setPayAmounts((prev) => {
                              const next = { ...prev };
                              if (on) next[item.id] = pending;
                              else delete next[item.id];
                              return next;
                            });
                          }}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-caption font-medium text-foreground truncate">{item.worker_name}</p>
                          <p className="text-[11px] text-muted font-mono">
                            Net {formatPKR(item.net_pay)} · Pending {formatPKR(pending)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] text-muted">PKR</span>
                          <input
                            type="number"
                            min={0}
                            max={pending}
                            step="any"
                            disabled={!checked}
                            value={amount}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setPayAmounts((prev) => ({ ...prev, [item.id]: Number.isFinite(v) ? v : 0 }));
                            }}
                            className="w-28 h-8 px-2 rounded-lg bg-obsidian-bg border border-border-default text-right text-foreground text-caption font-mono disabled:opacity-40"
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">Disbursement Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => {
                    const method = e.target.value as "CASH" | "BANK";
                    setPaymentMethod(method);
                    // Drop a selected account that no longer matches the method.
                    const sel = accounts.find((a) => a.id === paymentAccountId);
                    if (sel) {
                      const selIsCash = sel.is_default_cash || sel.account_code === "1000";
                      const selIsBank = (sel.is_liquid_funds && !selIsCash) || sel.account_code === "1002";
                      if ((method === "CASH" && !selIsCash) || (method === "BANK" && !selIsBank)) {
                        setPaymentAccountId("");
                      }
                    }
                  }}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  <option value="CASH">Cash in Hand</option>
                  <option value="BANK">Bank Account / Transfer</option>
                </select>
              </div>

              <div>
                <label className="text-caption text-secondary uppercase tracking-wider block mb-1">
                  Payment Account{" "}
                  <span className="text-[10px] normal-case text-muted">
                    ({paymentMethod === "CASH" ? "cash accounts only" : "bank accounts only"})
                  </span>
                </label>
                <select
                  value={paymentAccountId}
                  onChange={(e) => setPaymentAccountId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-caption"
                >
                  <option value="">Select Account...</option>
                  {paymentAccountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_code} {a.account_name}
                    </option>
                  ))}
                </select>
                {paymentAccountOptions.length === 0 && (
                  <p className="text-[11px] text-amber-500 mt-1">
                    No {paymentMethod === "CASH" ? "cash" : "bank"} account found in the Chart of Accounts.
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
              <button
                onClick={() => setPayModalRun(null)}
                className="h-9 px-3 rounded-lg bg-bg-muted text-secondary hover:text-foreground text-caption"
              >
                Cancel
              </button>
              <CrimsonButton
                onClick={handleExecutePayment}
                disabled={
                  submittingPayment ||
                  !paymentAccountId ||
                  selectedItemIds.length === 0 ||
                  paySelectedTotal <= 0 ||
                  payOverdrafted
                }
              >
                {submittingPayment ? "Executing..." : `Confirm & Post ${formatPKR(paySelectedTotal)}`}
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
