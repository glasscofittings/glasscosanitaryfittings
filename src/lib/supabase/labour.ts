import { createClient } from "@/lib/supabase/client";

export interface Worker {
  id: string;
  full_name: string;
  role_designation: string;
  base_salary_pkr: number;
  /** Extra pay per hour worked after the shift ends (17:00). */
  overtime_rate_pkr: number;
  joining_date: string;
  is_active: boolean;
  employment_type?: "PERMANENT_SALARY" | "DAILY_PAY" | "PART_TIME_WAGE";
  cost_class?: "PRODUCTION" | "ADMIN";
  cost_center?: string;
  default_pay_method?: "CASH" | "BANK";
  bank_name?: string | null;
  account_iban?: string | null;
  cnic_no?: string | null;
}

export interface AttendanceRecord {
  id: string;
  worker_id: string;
  attendance_date: string;
  status: "P" | "A" | "L";
  /** "HH:MM:SS" — Postgres TIME. Only set on Present days. */
  check_in_time: string | null;
  check_out_time: string | null;
}

export interface TimeLog {
  checkIn: string | null;
  checkOut: string | null;
}

export interface TimeLogMap {
  [workerId: string]: {
    [date: string]: TimeLog;
  };
}

export interface AttendanceMap {
  [workerId: string]: {
    [date: string]: "P" | "A" | "L";
  };
}

export interface WorkerLoan {
  id: string;
  worker_id: string;
  original_loan_amount: number;
  current_balance: number;
  monthly_deduction_rate: number;
  created_at: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

function extractSupabaseError(body: unknown): {
  message: string;
  details: string | null;
  hint: string | null;
  code: string | null;
} {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    return {
      message: (typeof b.message === "string" && b.message) || (typeof b.msg === "string" && b.msg) || JSON.stringify(body),
      details: typeof b.details === "string" ? b.details : null,
      hint: typeof b.hint === "string" ? b.hint : null,
      code: typeof b.code === "string" ? b.code : null,
    };
  }
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return extractSupabaseError(parsed);
    } catch {
      return { message: body || "Unknown error", details: null, hint: null, code: null };
    }
  }
  return { message: String(body || "Unknown error"), details: null, hint: null, code: null };
}

function logSupabaseError(context: string, status: number, body: unknown) {
  const err = extractSupabaseError(body);
  console.error(`[Supabase ${context}]`, {
    status,
    message: err.message,
    details: err.details,
    hint: err.hint,
    code: err.code,
  });
  return err;
}

export async function fetchWorkers(): Promise<Worker[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/workers?is_active=eq.true&order=full_name.asc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("workers", res.status, body);
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as Worker[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase workers]", { message: msg });
    return [];
  }
}

export async function fetchAttendance(year: number, month: number): Promise<AttendanceRecord[]> {
  if (!SUPABASE_URL) return [];
  try {
    const lastDay = new Date(year, month, 0).getDate();
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_attendance?attendance_date=gte.${start}&attendance_date=lte.${end}`,
      { headers: headers() }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("worker_attendance", res.status, body);
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as AttendanceRecord[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase worker_attendance]", { message: msg });
    return [];
  }
}

/**
 * Attendance records for an inclusive date range (YYYY-MM-DD .. YYYY-MM-DD).
 * Same shape as fetchAttendance but scoped to an arbitrary period
 * (a payroll week, half-month, etc.) instead of a calendar month.
 */
export async function fetchAttendanceRange(
  startDate: string,
  endDate: string
): Promise<AttendanceRecord[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_attendance?attendance_date=gte.${startDate}&attendance_date=lte.${endDate}`,
      { headers: headers() }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("worker_attendance range", res.status, body);
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as AttendanceRecord[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase worker_attendance range]", { message: msg });
    return [];
  }
}

/** Every loan with an outstanding balance — ONE request for all workers. */
export async function fetchActiveLoansAll(): Promise<WorkerLoan[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/worker_loans?current_balance=gt.0`, {
      headers: headers(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("worker_loans active", res.status, body);
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as WorkerLoan[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase worker_loans active]", { message: msg });
    return [];
  }
}

export async function upsertAttendance(
  workerId: string,
  date: string,
  status: "P" | "A" | "L"
): Promise<AttendanceRecord | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_attendance?on_conflict=worker_id,attendance_date`,
      {
        method: "POST",
        headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          worker_id: workerId,
          attendance_date: date,
          status,
          // Arrival/departure times only belong to a Present day.
          ...(status === "P" ? {} : { check_in_time: null, check_out_time: null }),
        }),
      }
    );
    const body = await res.json();
    if (!res.ok) {
      logSupabaseError("worker_attendance upsert", res.status, body);
      return null;
    }
    const data = Array.isArray(body) ? body : [];
    return data[0] ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase worker_attendance upsert]", { message: msg });
    return null;
  }
}

/**
 * Removes the attendance row for one day (the last step of the P → A → L → blank
 * cycle). Returns true only when the server really accepted the delete.
 */
export async function deleteAttendance(workerId: string, date: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_attendance?worker_id=eq.${workerId}&attendance_date=eq.${date}`,
      { method: "DELETE", headers: headers() }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("worker_attendance delete", res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase worker_attendance delete]", { message: msg });
    return false;
  }
}

/**
 * Log arrival / departure for a day. Marks the day Present (times only exist
 * on Present days). Pass null to clear a time. Times are "HH:MM".
 */
export async function saveTimeLog(
  workerId: string,
  date: string,
  checkIn: string | null,
  checkOut: string | null
): Promise<{ record: AttendanceRecord | null; error: string | null }> {
  if (!SUPABASE_URL) return { record: null, error: "Server URL is not configured" };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_attendance?on_conflict=worker_id,attendance_date`,
      {
        method: "POST",
        headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          worker_id: workerId,
          attendance_date: date,
          status: "P",
          check_in_time: checkIn,
          check_out_time: checkOut,
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = logSupabaseError("worker_attendance time log", res.status, body);
      return { record: null, error: err.message };
    }
    const data = Array.isArray(body) ? body : [];
    return { record: (data[0] as AttendanceRecord) ?? null, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase worker_attendance time log]", { message: msg });
    return { record: null, error: msg };
  }
}

export type EmploymentType = "PERMANENT_SALARY" | "DAILY_PAY" | "PART_TIME_WAGE";
export type CostClass = "PRODUCTION" | "ADMIN";
export type PayMethod = "CASH" | "BANK";

export async function createWorker(data: {
  full_name: string;
  role_designation: string;
  base_salary_pkr: number;
  overtime_rate_pkr: number;
  joining_date: string;
  employment_type: EmploymentType;
  cost_class: CostClass;
  default_pay_method: PayMethod;
  cost_center?: string | null;
  bank_name?: string | null;
  account_iban?: string | null;
  cnic_no?: string | null;
}): Promise<Worker> {
  const client = createClient();
  const payload = {
    full_name: data.full_name,
    role_designation: data.role_designation,
    base_salary_pkr: data.base_salary_pkr,
    overtime_rate_pkr: data.overtime_rate_pkr,
    joining_date: data.joining_date,
    is_active: true,
    designation: data.role_designation,
    daily_rate_pkr: data.base_salary_pkr / 30,
    status: "ACTIVE",
    worker_code: `W-${Date.now()}`,
    // HR master data — drives payroll posting class (COGS/OPEX) and disbursement.
    employment_type: data.employment_type,
    cost_class: data.cost_class,
    cost_center: data.cost_center ?? null,
    default_pay_method: data.default_pay_method,
    bank_name: data.bank_name ?? null,
    account_iban: data.account_iban ?? null,
    cnic_no: data.cnic_no ?? null,
  };

  const { data: rows, error } = await client
    .from("workers")
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error("[Supabase workers insert]", {
      status: error.code ?? "unknown",
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
      code: error.code ?? null,
    });
    throw new Error(error.message || "Failed to insert worker");
  }

  return rows as Worker;
}

export async function updateWorker(
  workerId: string,
  data: {
    full_name: string;
    role_designation: string;
    base_salary_pkr: number;
    overtime_rate_pkr: number;
    joining_date: string;
    employment_type: EmploymentType;
    cost_class: CostClass;
    default_pay_method: PayMethod;
    cost_center?: string | null;
    bank_name?: string | null;
    account_iban?: string | null;
    cnic_no?: string | null;
  }
): Promise<Worker | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${workerId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        full_name: data.full_name,
        role_designation: data.role_designation,
        base_salary_pkr: data.base_salary_pkr,
        overtime_rate_pkr: data.overtime_rate_pkr,
        designation: data.role_designation,
        daily_rate_pkr: data.base_salary_pkr / 30,
        joining_date: data.joining_date,
        employment_type: data.employment_type,
        cost_class: data.cost_class,
        cost_center: data.cost_center ?? null,
        default_pay_method: data.default_pay_method,
        bank_name: data.bank_name ?? null,
        account_iban: data.account_iban ?? null,
        cnic_no: data.cnic_no ?? null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("workers update", res.status, body);
      return null;
    }
    const rows = await res.json();
    return rows[0] ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase workers update]", { message: msg });
    return null;
  }
}

export async function deleteWorker(workerId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${workerId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ is_active: false, status: "INACTIVE" }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("workers delete", res.status, body);
    }
    return res.ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase workers delete]", { message: msg });
    return false;
  }
}

export async function fetchWorkerLoans(workerId: string): Promise<WorkerLoan[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_loans?worker_id=eq.${workerId}&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("worker_loans", res.status, body);
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as WorkerLoan[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase worker_loans]", { message: msg });
    return [];
  }
}

export interface IssueLoanPayload {
  worker_id: string;
  amount: number;
  monthly_deduction_rate: number;
  reason: string;
  /** Ledger account the money is paid FROM (Cash in Hand / Bank) — required by the RPC. */
  account_id: string;
  operator_name: string;
}

export interface IssueLoanResult {
  loan: WorkerLoan | null;
  error: string | null;
}

/**
 * Issues a loan/advance through the issue_worker_loan RPC, which writes the
 * loan row AND its balanced double entry (Dr Loan Recovery · Cr Cash/Bank) in
 * one transaction. The old "insert into worker_loans + manual audit row" path
 * is gone — the RPC owns posting and audit.
 */
export async function issueLoan(payload: IssueLoanPayload): Promise<IssueLoanResult> {
  const fail = (error: string): IssueLoanResult => ({ loan: null, error });
  if (!SUPABASE_URL) return fail("Database URL is not configured.");
  if (!payload.account_id) return fail("Select the account the loan is paid from.");
  if (!(payload.amount > 0)) return fail("Loan amount must be greater than zero.");
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/issue_worker_loan`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_worker_id: payload.worker_id,
        p_amount: payload.amount,
        p_monthly_rate: payload.monthly_deduction_rate,
        p_reason: payload.reason,
        p_account_id: payload.account_id,
        p_operator: payload.operator_name,
      }),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = extractSupabaseError(body ?? text);
      console.error("[Supabase issue_worker_loan]", { status: res.status, message: err.message });
      return fail(err.message || "Failed to issue loan.");
    }
    return { loan: normalizeIssuedLoan(body, payload), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase issue_worker_loan]", { message: msg });
    return fail(msg);
  }
}

/**
 * The RPC returns a jsonb snapshot whose shape depends on the migration version:
 * a full loan row, a row keyed by `loan_id`, or nothing at all. Accept any of
 * them so the caller always receives a WorkerLoan-shaped object.
 */
function normalizeIssuedLoan(body: unknown, payload: IssueLoanPayload): WorkerLoan {
  const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | null;
  if (row && typeof row === "object" && row.id) return row as unknown as WorkerLoan;
  return {
    id: row && typeof row === "object" && row.loan_id ? String(row.loan_id) : crypto.randomUUID(),
    worker_id: payload.worker_id,
    original_loan_amount: payload.amount,
    current_balance: payload.amount,
    monthly_deduction_rate: payload.monthly_deduction_rate,
    created_at: new Date().toISOString(),
  };
}

export function buildAttendanceMap(records: AttendanceRecord[]): AttendanceMap {
  const map: AttendanceMap = {};
  records.forEach((r) => {
    if (!map[r.worker_id]) map[r.worker_id] = {};
    map[r.worker_id][r.attendance_date] = r.status;
  });
  return map;
}

export function buildTimeLogMap(records: AttendanceRecord[]): TimeLogMap {
  const map: TimeLogMap = {};
  records.forEach((r) => {
    if (!r.check_in_time && !r.check_out_time) return;
    if (!map[r.worker_id]) map[r.worker_id] = {};
    map[r.worker_id][r.attendance_date] = {
      checkIn: r.check_in_time ? r.check_in_time.slice(0, 5) : null,
      checkOut: r.check_out_time ? r.check_out_time.slice(0, 5) : null,
    };
  });
  return map;
}
