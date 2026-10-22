/**
 * Payroll Entries — Supabase data layer
 *
 * Handles:
 *  - CRUD for `payroll_entries` table
 *  - Double-entry journal posting on every entry:
 *      Dr  Expense Account (COGS or Admin Fixed)
 *      Cr  Payment Account (Cash or Bank)
 *  - Query helpers (filter, summary, fetch by id)
 *
 * Note: the legacy PayrollRun / PayrollSlip helpers are preserved below
 * for backward compatibility with the Labour module's salary card.
 */

import { fetchWorkers, fetchAttendance, fetchWorkerLoans } from "./labour";
import { type Account } from "./ledger";

// ─── Enums & Types ─────────────────────────────────────────────────────────

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
  /** joined */
  expense_account?: Account | null;
  payment_account?: Account | null;
}

export interface CreatePayrollEntryInput {
  employee_name: string;
  amount: number;
  payroll_type: PayrollType;
  employment_type: EmploymentType;
  payment_method: PayrollPaymentMethod;
  expense_account_id: string;
  payment_account_id: string;
  notes?: string | null;
  payroll_date: string;
  operator_name?: string;
}

export interface PayrollFilter {
  startDate?: string;
  endDate?: string;
  payrollType?: PayrollType | "ALL";
  employmentType?: EmploymentType | "ALL";
  paymentMethod?: PayrollPaymentMethod | "ALL";
  searchQuery?: string;
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

// ─── Supabase helpers ───────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validatePayrollEntry(input: Partial<CreatePayrollEntryInput>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!input.employee_name?.trim()) {
    errors.employee_name = "Employee name is required.";
  }
  if (typeof input.amount !== "number" || isNaN(input.amount) || input.amount <= 0) {
    errors.amount = "Amount must be a positive number.";
  }
  if (!input.payroll_date) {
    errors.payroll_date = "Payroll date is required.";
  }
  if (!input.payroll_type) {
    errors.payroll_type = "Payroll category (Production vs Admin) is required.";
  }
  if (!input.employment_type) {
    errors.employment_type = "Employment type is required.";
  }
  if (!input.payment_method) {
    errors.payment_method = "Payment method is required.";
  }
  if (!input.expense_account_id) {
    errors.expense_account_id = "Expense account (debit) is required.";
  }
  if (!input.payment_account_id) {
    errors.payment_account_id = "Payment account (cash/bank) is required.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchPayrollEntries(filter?: PayrollFilter): Promise<PayrollEntry[]> {
  if (!SUPABASE_URL) return [];
  try {
    let url =
      `${SUPABASE_URL}/rest/v1/payroll_entries` +
      `?select=*,expense_account:accounts_chart!payroll_entries_expense_account_id_fkey(id,account_code,account_name,account_type)` +
      `,payment_account:accounts_chart!payroll_entries_payment_account_id_fkey(id,account_code,account_name,account_type)` +
      `&order=payroll_date.desc,created_at.desc`;

    if (filter?.payrollType && filter.payrollType !== "ALL") {
      url += `&payroll_type=eq.${filter.payrollType}`;
    }
    if (filter?.employmentType && filter.employmentType !== "ALL") {
      url += `&employment_type=eq.${filter.employmentType}`;
    }
    if (filter?.paymentMethod && filter.paymentMethod !== "ALL") {
      url += `&payment_method=eq.${filter.paymentMethod}`;
    }
    if (filter?.startDate) {
      url += `&payroll_date=gte.${filter.startDate}`;
    }
    if (filter?.endDate) {
      url += `&payroll_date=lte.${filter.endDate}`;
    }

    let res = await fetch(url, { headers: headers() });

    // Fallback: plain select without joins
    if (!res.ok) {
      const fallback = `${SUPABASE_URL}/rest/v1/payroll_entries?select=*&order=payroll_date.desc,created_at.desc`;
      res = await fetch(fallback, { headers: headers() });
    }

    if (!res.ok) {
      console.warn("Supabase Warning [fetchPayrollEntries]:", res.status);
      return [];
    }

    const json = await res.json();
    let records = (Array.isArray(json) ? json : []) as PayrollEntry[];

    // Client-side search
    if (filter?.searchQuery?.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      records = records.filter(
        (e) =>
          e.entry_number?.toLowerCase().includes(q) ||
          e.employee_name?.toLowerCase().includes(q) ||
          e.notes?.toLowerCase().includes(q)
      );
    }

    return records;
  } catch (err) {
    console.error("Supabase Error [fetchPayrollEntries]:", err);
    return [];
  }
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

// ─── Create (with double-entry journal) ──────────────────────────────────────

export async function createPayrollEntry(
  input: CreatePayrollEntryInput
): Promise<{ data: PayrollEntry | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };

  const validation = validatePayrollEntry(input);
  if (!validation.valid) {
    return { data: null, error: Object.values(validation.errors).join(" ") };
  }

  const entryNumber = `PAY-${input.payroll_date.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`;

  try {
    // 1. Post journal entry: Dr Expense / Cr Cash or Bank
    const jeNumber = `JE-${input.payroll_date.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`;
    const typeLabel = PAYROLL_TYPE_LABELS[input.payroll_type];
    const empLabel = EMPLOYMENT_TYPE_LABELS[input.employment_type];
    const narration = `Payroll ${entryNumber} — ${input.employee_name} [${typeLabel} | ${empLabel}]`;

    const jeRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        entry_number: jeNumber,
        entry_date: input.payroll_date,
        narration,
        is_balanced: true,
        status: "POSTED",
        customer_name: input.employee_name,
      }),
    });

    if (!jeRes.ok) {
      return { data: null, error: "Failed to post the payroll journal entry — nothing was saved." };
    }

    const jeRows = await jeRes.json();
    const jeId = jeRows?.[0]?.id;
    if (!jeId) {
      return { data: null, error: "Journal entry response did not include an id." };
    }

    // 2. Post balanced journal lines
    const linesRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify([
        {
          journal_entry_id: jeId,
          account_id: input.expense_account_id,
          debit_pkr: input.amount,
          credit_pkr: 0,
        },
        {
          journal_entry_id: jeId,
          account_id: input.payment_account_id,
          debit_pkr: 0,
          credit_pkr: input.amount,
        },
      ]),
    });

    if (!linesRes.ok) {
      // Compensate: delete orphan journal entry
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${jeId}`, {
        method: "DELETE",
        headers: headers(),
      });
      return { data: null, error: "Failed to post balanced journal lines." };
    }

    // 3. Insert payroll_entry row
    const entryRes = await fetch(`${SUPABASE_URL}/rest/v1/payroll_entries`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        entry_number: entryNumber,
        employee_name: input.employee_name,
        amount: input.amount,
        payroll_type: input.payroll_type,
        employment_type: input.employment_type,
        payment_method: input.payment_method,
        expense_account_id: input.expense_account_id,
        payment_account_id: input.payment_account_id,
        journal_entry_id: jeId,
        notes: input.notes || null,
        payroll_date: input.payroll_date,
        operator_name: input.operator_name || "System Operator",
      }),
    });

    if (!entryRes.ok) {
      const errText = await entryRes.text();
      // Compensate: remove orphan journal
      await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${jeId}`, {
        method: "DELETE",
        headers: headers(),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${jeId}`, {
        method: "DELETE",
        headers: headers(),
      });
      return { data: null, error: `Failed to insert payroll record: ${errText}` };
    }

    const createdRows = await entryRes.json();
    const created = createdRows?.[0] as PayrollEntry;

    // Audit log (fire-and-forget)
    fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        operator_name: input.operator_name || "System Operator",
        action_type: "PAYROLL_ENTRY_POSTED",
        module: "PAYROLL",
        details: {
          entry_number: entryNumber,
          employee_name: input.employee_name,
          amount: input.amount,
          payroll_type: input.payroll_type,
          employment_type: input.employment_type,
          payment_method: input.payment_method,
        },
      }),
    }).catch(() => {});

    return { data: created, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [createPayrollEntry]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

// ─── Update (edit record + re-post the double-entry journal) ────────────────

export interface UpdatePayrollEntryInput {
  employee_name: string;
  amount: number;
  payroll_type: PayrollType;
  employment_type: EmploymentType;
  payment_method: PayrollPaymentMethod;
  expense_account_id: string;
  payment_account_id: string;
  notes?: string | null;
  payroll_date: string;
  operator_name?: string;
}

/**
 * Updates a payroll entry AND re-posts its journal so the General Ledger,
 * Cash/Bank and P&L statements reflect the new values:
 *
 *   1. PATCH journal_entries  (entry_date, narration, customer_name)
 *   2. DELETE old journal_lines, then POST the two fresh balanced lines
 *      Dr Expense (new account/amount) / Cr Cash-Bank (new account/amount)
 *   3. PATCH payroll_entries
 *
 * PostgREST has no cross-request transaction, so every step that could fail
 * after a change carries a compensating restore (previous header + previous
 * lines) — the GL is never left disagreeing with the payroll record. The
 * journal balance trigger is DEFERRABLE INITIALLY DEFERRED and each request is
 * its own transaction, so the delete step (0 lines = balanced) and the bulk
 * re-insert (both lines in one statement) each commit cleanly.
 */
export async function updatePayrollEntry(
  id: string,
  input: UpdatePayrollEntryInput
): Promise<{ data: PayrollEntry | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };

  const validation = validatePayrollEntry(input);
  if (!validation.valid) {
    return { data: null, error: Object.values(validation.errors).join(" ") };
  }

  try {
    // 1. Snapshot the current row (rollback source for the journal).
    const curRes = await fetch(`${SUPABASE_URL}/rest/v1/payroll_entries?id=eq.${id}&select=*`, {
      headers: headers(),
    });
    const previous = curRes.ok ? ((await curRes.json()) as PayrollEntry[])?.[0] : undefined;
    if (!previous) return { data: null, error: "Payroll entry not found." };

    const journalId = previous.journal_entry_id;
    let oldLines: Array<{ account_id: string; debit_pkr: number; credit_pkr: number }> = [];
    let oldHeader: { entry_date?: string; narration?: string; customer_name?: string | null } | null =
      null;

    const restoreHeader = async () => {
      if (!journalId || !oldHeader) return;
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${journalId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          entry_date: oldHeader.entry_date,
          narration: oldHeader.narration,
          customer_name: oldHeader.customer_name,
        }),
      }).catch(() => {});
    };

    const restoreOldLines = async () => {
      if (!journalId || oldLines.length === 0) return;
      await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(oldLines.map((l) => ({ ...l, journal_entry_id: journalId }))),
      }).catch(() => {});
    };

    // 2. Re-post the journal entry: header first, then both lines.
    if (journalId) {
      const linesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${journalId}&select=account_id,debit_pkr,credit_pkr`,
        { headers: headers() }
      );
      oldLines = linesRes.ok ? await linesRes.json() : [];

      const headerRes = await fetch(
        `${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${journalId}&select=entry_date,narration,customer_name`,
        { headers: headers() }
      );
      oldHeader = headerRes.ok ? ((await headerRes.json())?.[0] ?? null) : null;

      const typeLabel = PAYROLL_TYPE_LABELS[input.payroll_type];
      const empLabel = EMPLOYMENT_TYPE_LABELS[input.employment_type];
      const narration = `Payroll ${previous.entry_number} — ${input.employee_name} [${typeLabel} | ${empLabel}]`;

      const jeRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${journalId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          entry_date: input.payroll_date,
          narration,
          customer_name: input.employee_name,
        }),
      });
      if (!jeRes.ok) {
        return { data: null, error: "Failed to update the journal header — no changes were saved." };
      }

      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${journalId}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!delRes.ok) {
        // Lines untouched — only the header needs to go back.
        await restoreHeader();
        return { data: null, error: "Failed to re-post the journal lines — no changes were saved." };
      }

      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify([
          {
            journal_entry_id: journalId,
            account_id: input.expense_account_id,
            debit_pkr: input.amount,
            credit_pkr: 0,
          },
          {
            journal_entry_id: journalId,
            account_id: input.payment_account_id,
            debit_pkr: 0,
            credit_pkr: input.amount,
          },
        ]),
      });
      if (!insRes.ok) {
        // New lines rejected — restore the previous header + previous lines.
        await restoreHeader();
        await restoreOldLines();
        return {
          data: null,
          error: "Failed to re-post the journal lines — the entry was left unchanged.",
        };
      }
    }

    // 3. Update the payroll record itself.
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/payroll_entries?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        employee_name: input.employee_name,
        amount: input.amount,
        payroll_type: input.payroll_type,
        employment_type: input.employment_type,
        payment_method: input.payment_method,
        expense_account_id: input.expense_account_id,
        payment_account_id: input.payment_account_id,
        notes: input.notes || null,
        payroll_date: input.payroll_date,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      // Roll the journal back so the GL never disagrees with the record.
      if (journalId) {
        await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${journalId}`, {
          method: "DELETE",
          headers: headers(),
        }).catch(() => {});
        await restoreHeader();
        await restoreOldLines();
      }
      return { data: null, error: `Failed to update payroll record: ${errText}` };
    }

    const patched = ((await patchRes.json()) as PayrollEntry[])?.[0];

    // 4. Refetch with account joins so the UI shows fresh account labels.
    const joinedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payroll_entries?id=eq.${id}` +
        `&select=*,expense_account:accounts_chart!payroll_entries_expense_account_id_fkey(id,account_code,account_name,account_type)` +
        `,payment_account:accounts_chart!payroll_entries_payment_account_id_fkey(id,account_code,account_name,account_type)`,
      { headers: headers() }
    );
    const refreshed = joinedRes.ok ? ((await joinedRes.json()) as PayrollEntry[])?.[0] : undefined;
    const result = refreshed ?? patched ?? null;
    if (!result) {
      return { data: null, error: "Update saved, but the refreshed record could not be loaded." };
    }

    // Audit log (fire-and-forget)
    fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        operator_name: input.operator_name || "System Operator",
        action_type: "PAYROLL_ENTRY_UPDATED",
        module: "PAYROLL",
        details: {
          entry_number: previous.entry_number,
          employee_name: input.employee_name,
          amount: input.amount,
          previous_amount: previous.amount,
          payroll_type: input.payroll_type,
          employment_type: input.employment_type,
          payment_method: input.payment_method,
        },
      }),
    }).catch(() => {});

    return { data: result, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [updatePayrollEntry]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deletePayrollEntry(id: string): Promise<{ error: string | null }> {
  if (!SUPABASE_URL) return { error: "Database URL not configured." };
  try {
    // Fetch the entry to get journal_entry_id
    const entryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payroll_entries?id=eq.${id}&select=journal_entry_id`,
      { headers: headers() }
    );
    const rows = entryRes.ok ? await entryRes.json() : [];
    const journalEntryId = rows?.[0]?.journal_entry_id;

    // Delete the payroll entry
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/payroll_entries?id=eq.${id}`, {
      method: "DELETE",
      headers: headers(),
    });

    if (!delRes.ok) {
      return { error: "Failed to delete payroll entry." };
    }

    // Cascade delete journal lines + entry
    if (journalEntryId) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${journalEntryId}`,
        { method: "DELETE", headers: headers() }
      );
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${journalEntryId}`, {
        method: "DELETE",
        headers: headers(),
      });
    }

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Legacy PayrollRun helpers (Labour module) ────────────────────────────────

export interface PayrollRun {
  id: string;
  payroll_no: string;
  month: number;
  year: number;
  total_workers: number;
  gross_salaries: number;
  total_deductions: number;
  total_loan_repayments: number;
  net_payable: number;
  status: "DRAFT" | "POSTED" | "PAID";
  journal_entry_id?: string;
  created_at: string;
  slips?: PayrollSlip[];
}

export interface PayrollSlip {
  id?: string;
  payroll_run_id?: string;
  worker_id: string;
  worker_name: string;
  role_designation: string;
  base_salary: number;
  days_in_month: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  daily_rate: number;
  earned_salary: number;
  loan_deduction: number;
  net_salary: number;
}

export async function fetchPayrollRuns(): Promise<PayrollRun[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/payroll_runs?select=*,slips:payroll_slips(*)&order=year.desc,month.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs?order=created_at.desc`, {
        headers: headers(),
      });
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Supabase Error [fetchPayrollRuns]:", err);
    return [];
  }
}

export async function generateMonthlyPayroll(
  year: number,
  month: number
): Promise<{ success: boolean; payroll?: PayrollRun; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    const [workers, attendanceRecords] = await Promise.all([
      fetchWorkers(),
      fetchAttendance(year, month),
    ]);

    if (workers.length === 0) {
      return { success: false, error: "No active workers found in roster" };
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const payrollNo = `PAY-${year}-${String(month).padStart(2, "0")}`;

    const attMap = new Map<string, { present: number; absent: number; leave: number }>();
    attendanceRecords.forEach((r) => {
      if (!attMap.has(r.worker_id)) attMap.set(r.worker_id, { present: 0, absent: 0, leave: 0 });
      const stats = attMap.get(r.worker_id)!;
      if (r.status === "P") stats.present += 1;
      else if (r.status === "A") stats.absent += 1;
      else if (r.status === "L") stats.leave += 1;
    });

    const slips: PayrollSlip[] = [];
    let grossTotal = 0;
    let deductionTotal = 0;
    let loanRepaymentTotal = 0;
    let netTotal = 0;

    for (const w of workers) {
      const stats = attMap.get(w.id) || { present: 0, absent: 0, leave: 0 };
      const dailyRate = Math.round((w.base_salary_pkr / daysInMonth) * 100) / 100;
      const absenceDeduction = Math.round(stats.absent * dailyRate * 100) / 100;
      const earnedSalary = Math.max(
        0,
        Math.round((w.base_salary_pkr - absenceDeduction) * 100) / 100
      );

      const loans = await fetchWorkerLoans(w.id);
      let loanDed = 0;
      loans.forEach((l) => {
        if (l.current_balance > 0) {
          loanDed += Math.min(l.current_balance, l.monthly_deduction_rate);
        }
      });
      loanDed = Math.round(loanDed * 100) / 100;

      const netSalary = Math.max(0, Math.round((earnedSalary - loanDed) * 100) / 100);

      grossTotal += w.base_salary_pkr;
      deductionTotal += absenceDeduction;
      loanRepaymentTotal += loanDed;
      netTotal += netSalary;

      slips.push({
        worker_id: w.id,
        worker_name: w.full_name,
        role_designation: w.role_designation,
        base_salary: w.base_salary_pkr,
        days_in_month: daysInMonth,
        present_days: stats.present,
        absent_days: stats.absent,
        leave_days: stats.leave,
        daily_rate: dailyRate,
        earned_salary: earnedSalary,
        loan_deduction: loanDed,
        net_salary: netSalary,
      });
    }

    const runRes = await fetch(`${SUPABASE_URL}/rest/v1/payroll_runs`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        payroll_no: payrollNo,
        month,
        year,
        total_workers: workers.length,
        gross_salaries: Math.round(grossTotal * 100) / 100,
        total_deductions: Math.round(deductionTotal * 100) / 100,
        total_loan_repayments: Math.round(loanRepaymentTotal * 100) / 100,
        net_payable: Math.round(netTotal * 100) / 100,
        status: "POSTED",
      }),
    });

    if (!runRes.ok) {
      const err = await runRes.json().catch(() => ({}));
      return { success: false, error: (err as any).message || "Failed to create payroll run" };
    }

    const runRows = await runRes.json();
    const createdRun = Array.isArray(runRows) ? runRows[0] : runRows;

    if (createdRun?.id) {
      const slipRows = slips.map((s) => ({ ...s, payroll_run_id: createdRun.id }));
      await fetch(`${SUPABASE_URL}/rest/v1/payroll_slips`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(slipRows),
      });
    }

    return { success: true, payroll: { ...createdRun, slips } };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to generate payroll" };
  }
}
