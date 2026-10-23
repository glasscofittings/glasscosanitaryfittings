/**
 * SAP HCM / FI Payroll Module Data Layer
 *
 * Consolidates all payroll runs, simulation, approval, atomic posting,
 * cash/bank disbursements, storno reversals, and wage types.
 */

import { fetchWorkers, fetchAttendance, fetchWorkerLoans, type Worker, type AttendanceMap, type TimeLogMap, type WorkerLoan } from "./labour";
import { type Account } from "./ledger";
import {
  calculateGrossToNetPayslip,
  round2,
  type FullPayslipCalculationResult,
  type ManualAdjustmentInput,
  type RecurringComponentInput,
} from "@/lib/salary";

// ─── Enums & Models ────────────────────────────────────────────────────────

export type PayrollCostClass = "PRODUCTION" | "ADMIN";
export type PayrollRunType = "REGULAR" | "OFF_CYCLE" | "ADJUSTMENT" | "LEGACY";
export type PayrollRunStatus =
  | "DRAFT"
  | "SIMULATED"
  | "APPROVED"
  | "POSTED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CLOSED"
  | "REVERSED";

export type PeriodType = "MONTHLY" | "WEEKLY" | "DAILY";
export type PeriodStatus = "OPEN" | "LOCKED" | "CLOSED";
export type PaymentMethod = "CASH" | "BANK";

export interface PayrollPeriod {
  id: string;
  period_code: string;
  period_type: PeriodType;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
  created_at: string;
}

export interface PayrollWageType {
  code: string;
  name: string;
  category: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
  calc_type: "FIXED" | "PER_DAY" | "PER_HOUR" | "PERCENT_OF_BASIC" | "MANUAL";
  is_recurring: boolean;
  gl_account_production?: string | null;
  gl_account_admin?: string | null;
  gl_account_liability?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PayrollRunItemLine {
  id?: string;
  item_id?: string;
  wage_type_code: string;
  wage_type_name: string;
  category: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
  qty: number;
  rate: number;
  amount: number;
  gl_account_id?: string | null;
}

export interface PayrollRunItem {
  id: string;
  run_id: string;
  worker_id: string;
  worker_name: string;
  cost_class: PayrollCostClass;
  employment_type: string;
  cost_center?: string | null;
  days_in_period: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  overtime_minutes: number;
  undertime_minutes: number;
  basic_rate: number;
  gross_earnings: number;
  total_deductions: number;
  net_pay: number;
  amount_paid: number;
  status: "DRAFT" | "POSTED" | "PAID" | "PARTIALLY_PAID" | "REVERSED";
  created_at: string;
  lines?: PayrollRunItemLine[];
  worker?: Worker;
}

export interface PayrollRun {
  id: string;
  run_no: string;
  period_id: string;
  run_type: PayrollRunType;
  cost_class_filter?: PayrollCostClass | null;
  status: PayrollRunStatus;
  total_workers: number;
  gross_earnings: number;
  total_deductions: number;
  employer_cost: number;
  net_payable: number;
  amount_paid: number;
  journal_entry_id?: string | null;
  reversal_journal_id?: string | null;
  reversal_reason?: string | null;
  notes?: string | null;
  created_by?: string | null;
  approved_by?: string | null;
  created_at: string;
  updated_at: string;
  period?: PayrollPeriod | null;
  items?: PayrollRunItem[];
}

export interface PayrollPaymentLog {
  id: string;
  run_id: string;
  item_id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_account_id: string;
  journal_entry_id?: string | null;
  payment_date: string;
  disbursement_batch_no?: string | null;
  notes?: string | null;
  operator_name?: string | null;
  created_at: string;
  payment_account?: Account | null;
  item?: PayrollRunItem | null;
}

// ─── Headers helper ────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

// ─── Fetch Periods, Wage Types & Runs ──────────────────────────────────────

export async function fetchPayrollPeriods(): Promise<PayrollPeriod[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payroll_periods?order=start_date.desc`, {
      headers: headers(),
    });
    if (!res.ok) return [];
    return (await res.json()) as PayrollPeriod[];
  } catch (err) {
    console.error("fetchPayrollPeriods error:", err);
    return [];
  }
}

export async function createPayrollPeriod(input: {
  period_code: string;
  period_type: PeriodType;
  start_date: string;
  end_date: string;
}): Promise<{ data: PayrollPeriod | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_payroll_period`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_period_code: input.period_code,
        p_period_type: input.period_type,
        p_start_date: input.start_date,
        p_end_date: input.end_date,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { data: null, error: err };
    }
    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchPayrollWageTypes(): Promise<PayrollWageType[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payroll_wage_types?order=category.asc,code.asc`, {
      headers: headers(),
    });
    if (!res.ok) return [];
    return (await res.json()) as PayrollWageType[];
  } catch (err) {
    console.error("fetchPayrollWageTypes error:", err);
    return [];
  }
}

export async function fetchPayrollRuns(): Promise<PayrollRun[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/payroll_runs_v2?select=*,period:payroll_periods(*),items:payroll_run_items(*)&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      // Fallback without joins
      const fallback = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs_v2?order=created_at.desc`, {
        headers: headers(),
      });
      if (!fallback.ok) return [];
      return (await fallback.json()) as PayrollRun[];
    }
    return (await res.json()) as PayrollRun[];
  } catch (err) {
    console.error("fetchPayrollRuns error:", err);
    return [];
  }
}

export async function fetchPayrollRunById(id: string): Promise<PayrollRun | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/payroll_runs_v2?id=eq.${id}&select=*,period:payroll_periods(*),items:payroll_run_items(*,lines:payroll_run_item_lines(*))`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
  } catch (err) {
    console.error("fetchPayrollRunById error:", err);
    return null;
  }
}

// ─── Simulation & Creation Wizard ──────────────────────────────────────────

export interface SimulateRunInput {
  periodId: string;
  costClassFilter?: PayrollCostClass | null;
  runType?: PayrollRunType;
  manualAdjustmentsByWorker?: Record<string, ManualAdjustmentInput[]>;
}

export async function simulatePayrollRun(
  input: SimulateRunInput
): Promise<{
  period: PayrollPeriod;
  items: FullPayslipCalculationResult[];
  totals: {
    totalWorkers: number;
    grossEarnings: number;
    totalDeductions: number;
    netPayable: number;
    productionCost: number;
    adminCost: number;
  };
}> {
  const periods = await fetchPayrollPeriods();
  const period = periods.find((p) => p.id === input.periodId);
  if (!period) throw new Error("Payroll period not found.");

  const [workers, attendanceRecords, allLoans] = await Promise.all([
    fetchWorkers(),
    fetchAttendance(
      new Date(period.start_date).getFullYear(),
      new Date(period.start_date).getMonth() + 1
    ),
    Promise.all((await fetchWorkers()).map((w) => fetchWorkerLoans(w.id))),
  ]);

  const activeWorkers = workers.filter((w) => {
    if (!w.is_active) return false;
    if (input.costClassFilter && w.cost_class && w.cost_class !== input.costClassFilter) return false;
    return true;
  });

  const year = new Date(period.start_date).getFullYear();
  const month = new Date(period.start_date).getMonth() + 1;

  // Build attendance map
  const attMap: AttendanceMap = {};
  attendanceRecords.forEach((r) => {
    if (!attMap[r.worker_id]) attMap[r.worker_id] = {};
    attMap[r.worker_id][r.attendance_date] = r.status;
  });

  const workerLoansMap = new Map<string, WorkerLoan[]>();
  workers.forEach((w, i) => {
    workerLoansMap.set(w.id, allLoans[i] || []);
  });

  let grossSum = 0;
  let dedSum = 0;
  let netSum = 0;
  let prodCost = 0;
  let adminCost = 0;

  const items: FullPayslipCalculationResult[] = [];

  for (const w of activeWorkers) {
    const loans = workerLoansMap.get(w.id) || [];
    const manualAdjustments = input.manualAdjustmentsByWorker?.[w.id] || [];

    const slip = calculateGrossToNetPayslip(w, attMap, year, month, {
      activeLoans: loans,
      manualAdjustments,
      maxLoanDeductionPercent: 50,
    });

    items.push(slip);

    grossSum = round2(grossSum + slip.grossEarnings);
    dedSum = round2(dedSum + slip.totalDeductions);
    netSum = round2(netSum + slip.netPayable);

    if (slip.costClass === "PRODUCTION") {
      prodCost = round2(prodCost + slip.grossEarnings);
    } else {
      adminCost = round2(adminCost + slip.grossEarnings);
    }
  }

  return {
    period,
    items,
    totals: {
      totalWorkers: activeWorkers.length,
      grossEarnings: grossSum,
      totalDeductions: dedSum,
      netPayable: netSum,
      productionCost: prodCost,
      adminCost: adminCost,
    },
  };
}

export async function createPayrollRunFromSimulation(
  sim: Awaited<ReturnType<typeof simulatePayrollRun>>,
  operatorName = "System Operator"
): Promise<{ data: PayrollRun | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database not configured." };

  try {
    const runNo = `PR-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    // 1. Insert Run Header
    const runRes = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs_v2`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        run_no: runNo,
        period_id: sim.period.id,
        run_type: "REGULAR",
        status: "APPROVED",
        total_workers: sim.totals.totalWorkers,
        gross_earnings: sim.totals.grossEarnings,
        total_deductions: sim.totals.totalDeductions,
        net_payable: sim.totals.netPayable,
        created_by: operatorName,
      }),
    });

    if (!runRes.ok) {
      const err = await runRes.text();
      return { data: null, error: `Failed to create payroll run header: ${err}` };
    }

    const createdRuns = await runRes.json();
    const run = createdRuns[0] as PayrollRun;

    // 2. Insert Items & Lines
    for (const item of sim.items) {
      const itemRes = await fetch(`${SUPABASE_URL}/rest/v1/payroll_run_items`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({
          run_id: run.id,
          worker_id: item.workerId,
          worker_name: item.workerName,
          cost_class: item.costClass,
          employment_type: item.employmentType,
          days_in_period: item.attendance.daysInPeriod,
          present_days: item.attendance.presentDays,
          absent_days: item.attendance.absentDays,
          leave_days: item.attendance.leaveDays,
          overtime_minutes: item.attendance.overtimeMinutes,
          undertime_minutes: item.attendance.undertimeMinutes,
          basic_rate: item.baseEarnings,
          gross_earnings: item.grossEarnings,
          total_deductions: item.totalDeductions,
          net_pay: item.netPayable,
          status: "DRAFT",
        }),
      });

      if (itemRes.ok) {
        const itemRows = await itemRes.json();
        const itemId = itemRows[0].id;

        const linesPayload = item.lines.map((l) => ({
          item_id: itemId,
          wage_type_code: l.wageTypeCode,
          wage_type_name: l.wageTypeName,
          category: l.category,
          qty: l.qty,
          rate: l.rate,
          amount: l.amount,
        }));

        await fetch(`${SUPABASE_URL}/rest/v1/payroll_run_item_lines`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(linesPayload),
        });
      }
    }

    return { data: run, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Post Accrual, Pay & Reversals via RPC ──────────────────────────────────

export async function postPayrollRun(
  runId: string,
  operatorName = "System Operator"
): Promise<{ success: boolean; error?: string; journalNumber?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Database not configured." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/post_payroll_run`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_run_id: runId,
        p_operator_name: operatorName,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: body.message || body.hint || "Post payroll run RPC failed." };
    }

    return { success: true, journalNumber: body.journal_entry_number };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function payPayrollItems(input: {
  runId: string;
  itemIds: string[];
  paymentMethod: PaymentMethod;
  accountId: string;
  paymentDate?: string;
  operatorName?: string;
  allowOverdraft?: boolean;
}): Promise<{ success: boolean; error?: string; batchNo?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Database not configured." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pay_payroll_items`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_run_id: input.runId,
        p_item_ids: input.itemIds,
        p_payment_method: input.paymentMethod,
        p_account_id: input.accountId,
        p_payment_date: input.paymentDate || new Date().toISOString().slice(0, 10),
        p_operator_name: input.operatorName || "System Operator",
        p_allow_overdraft: Boolean(input.allowOverdraft),
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: body.message || body.hint || "Payroll payment RPC failed." };
    }

    return { success: true, batchNo: body.batch_no };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function reversePayrollRun(
  runId: string,
  reason: string,
  operatorName = "System Operator"
): Promise<{ success: boolean; error?: string; reversalJournalNo?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Database not configured." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reverse_payroll_run`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_run_id: runId,
        p_reason: reason,
        p_operator_name: operatorName,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: body.message || body.hint || "Reversal RPC failed." };
    }

    return { success: true, reversalJournalNo: body.reversal_journal_number };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchPayrollPaymentLogs(runId?: string): Promise<PayrollPaymentLog[]> {
  if (!SUPABASE_URL) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/payroll_payment_logs?select=*,payment_account:accounts_chart(id,account_code,account_name),item:payroll_run_items(id,worker_name,net_pay)&order=payment_date.desc,created_at.desc`;
    if (runId) {
      url += `&run_id=eq.${runId}`;
    }
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return [];
    return (await res.json()) as PayrollPaymentLog[];
  } catch (err) {
    console.error("fetchPayrollPaymentLogs error:", err);
    return [];
  }
}

// ─── Legacy compatibility types (for existing components) ──────────────────

export type PayrollType = "PRODUCTION_COGS" | "ADMIN_FIXED";
export type EmploymentType = "PERMANENT_SALARY" | "PART_TIME_WAGE" | "DAILY_PAY";
export type PayrollPaymentMethod = "CASH" | "BANK";

export const PAYROLL_TYPE_LABELS: Record<PayrollType, string> = {
  PRODUCTION_COGS: "Production / COGS",
  ADMIN_FIXED: "Admin / Fixed Overhead",
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PERMANENT_SALARY: "Permanent Salary",
  PART_TIME_WAGE: "Part-Time / Daily Wage",
  DAILY_PAY: "Daily Pay",
};

export const PAYMENT_METHOD_LABELS: Record<PayrollPaymentMethod, string> = {
  CASH: "Cash Payment",
  BANK: "Bank Transfer",
};

export interface PayrollEntry {
  id: string;
  entry_number: string;
  employee_name: string;
  amount: number;
  payroll_type: PayrollType;
  employment_type: EmploymentType;
  payment_method: PayrollPaymentMethod;
  expense_account_id: string | null;
  payment_account_id: string | null;
  journal_entry_id: string | null;
  notes: string | null;
  payroll_date: string;
  operator_name: string | null;
  created_at: string;
  updated_at: string;
  expense_account?: Account | null;
  payment_account?: Account | null;
}

export async function fetchPayrollEntries(): Promise<PayrollEntry[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/payroll_entries?select=*,expense_account:accounts_chart!payroll_entries_expense_account_id_fkey(id,account_code,account_name,account_type),payment_account:accounts_chart!payroll_entries_payment_account_id_fkey(id,account_code,account_name,account_type)&order=payroll_date.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const fb = await fetch(`${SUPABASE_URL}/rest/v1/payroll_entries?order=payroll_date.desc`, { headers: headers() });
      if (!fb.ok) return [];
      return (await fb.json()) as PayrollEntry[];
    }
    return (await res.json()) as PayrollEntry[];
  } catch {
    return [];
  }
}

export interface PayrollSummary {
  total: number;
  totalCogs: number;
  totalAdmin: number;
  totalSalaries: number;
  totalWages: number;
  totalCash: number;
  totalBank: number;
  count: number;
  todayTotal: number;
  monthTotal: number;
}

export function calculatePayrollSummary(entries: PayrollEntry[]): PayrollSummary {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";

  const summary: PayrollSummary = {
    total: 0,
    totalCogs: 0,
    totalAdmin: 0,
    totalSalaries: 0,
    totalWages: 0,
    totalCash: 0,
    totalBank: 0,
    count: 0,
    todayTotal: 0,
    monthTotal: 0,
  };

  for (const e of entries) {
    summary.total += e.amount;
    summary.count++;
    if (e.payroll_type === "PRODUCTION_COGS") summary.totalCogs += e.amount;
    else summary.totalAdmin += e.amount;
    if (e.employment_type === "PERMANENT_SALARY") summary.totalSalaries += e.amount;
    else summary.totalWages += e.amount;
    if (e.payment_method === "CASH") summary.totalCash += e.amount;
    else summary.totalBank += e.amount;
    if (e.payroll_date === today) summary.todayTotal += e.amount;
    if (e.payroll_date >= monthStart) summary.monthTotal += e.amount;
  }

  return summary;
}

export async function createPayrollEntry(input: any): Promise<{ data: any; error: string | null }> {
  return { data: null, error: "Legacy direct payroll entry retired. Use SAP Payroll Runs." };
}

export async function updatePayrollEntry(id: string, input: any): Promise<{ data: any; error: string | null }> {
  return { data: null, error: "Legacy direct payroll entry retired. Use SAP Payroll Runs." };
}

export async function deletePayrollEntry(id: string): Promise<{ error: string | null }> {
  return { error: "Direct deletion is disabled. Use Storno Reversal on the payroll run." };
}

