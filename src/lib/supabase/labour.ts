import { createClient } from "@/lib/supabase/client";

export interface Worker {
  id: string;
  full_name: string;
  role_designation: string;
  base_salary_pkr: number;
  joining_date: string;
  is_active: boolean;
}

export interface AttendanceRecord {
  id: string;
  worker_id: string;
  attendance_date: string;
  status: "P" | "A" | "L";
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

export async function createWorker(data: {
  full_name: string;
  role_designation: string;
  base_salary_pkr: number;
  joining_date: string;
}): Promise<Worker> {
  const client = createClient();
  const payload = {
    full_name: data.full_name,
    role_designation: data.role_designation,
    base_salary_pkr: data.base_salary_pkr,
    joining_date: data.joining_date,
    is_active: true,
    designation: data.role_designation,
    daily_rate_pkr: data.base_salary_pkr / 30,
    status: "ACTIVE",
    worker_code: `W-${Date.now()}`,
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
    joining_date: string;
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
        designation: data.role_designation,
        daily_rate_pkr: data.base_salary_pkr / 30,
        joining_date: data.joining_date,
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
  device_node: string;
  operator_name: string;
}

export async function issueLoan(payload: IssueLoanPayload): Promise<WorkerLoan | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/worker_loans`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        worker_id: payload.worker_id,
        original_loan_amount: payload.amount,
        current_balance: payload.amount,
        monthly_deduction_rate: payload.monthly_deduction_rate,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logSupabaseError("worker_loans insert", res.status, body);
      return null;
    }
    const data = await res.json();
    const loan = data[0] ?? null;

    await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        node_id: payload.device_node,
        operator_name: payload.operator_name,
        action_type: "LOAN_ISSUED",
        details: {
          module: "LABOUR",
          worker_id: payload.worker_id,
          amount: payload.amount,
          monthly_deduction_rate: payload.monthly_deduction_rate,
          reason: payload.reason,
        },
      }),
    });

    return loan;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Supabase issueLoan]", { message: msg });
    return null;
  }
}

export function buildAttendanceMap(records: AttendanceRecord[]): AttendanceMap {
  const map: AttendanceMap = {};
  records.forEach((r) => {
    if (!map[r.worker_id]) map[r.worker_id] = {};
    map[r.worker_id][r.attendance_date] = r.status;
  });
  return map;
}
