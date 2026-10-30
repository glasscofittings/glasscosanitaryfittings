import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";

export interface Worker {
  id: string;
  full_name: string;
  role_designation: string;
  base_salary_pkr: number;
}

export interface WorkerLoan {
  id: string;
  worker_id: string;
  original_loan_amount: number;
  current_balance: number;
  monthly_deduction_rate: number;
  created_at: string;
  workers?: Worker;
}

export interface LoanRepaymentLog {
  id: string;
  loan_id: string;
  amount_paid: number;
  repayment_source: "CASH" | "BANK_TRANSFER" | "SALARY_DEDUCTION";
  payment_date: string;
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

export async function fetchLoans(): Promise<WorkerLoan[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_loans?select=*,workers(full_name,role_designation,base_salary_pkr)&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [worker_loans]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as WorkerLoan[];
  } catch (err) {
    console.error("Supabase Error [worker_loans]:", err);
    return [];
  }
}

export async function fetchRepaymentLogs(loanId?: string): Promise<LoanRepaymentLog[]> {
  if (!SUPABASE_URL) return [];
  try {
    const filter = loanId ? `?loan_id=eq.${loanId}&` : "?";
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/loan_repayment_logs${filter}order=payment_date.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [loan_repayment_logs]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as LoanRepaymentLog[];
  } catch (err) {
    console.error("Supabase Error [loan_repayment_logs]:", err);
    return [];
  }
}

/** Repayments are cash/bank only — salary deductions belong to Payroll. */
export type LoanRepaymentSource = "CASH" | "BANK_TRANSFER";
/** Legacy value still present in older UI callers; rejected at runtime. */
export type LegacyLoanRepaymentSource = "SALARY_DEDUCTION";

export interface RecordRepaymentResult {
  loan: WorkerLoan | null;
  log: LoanRepaymentLog | null;
  error: string | null;
}

/**
 * Records a repayment through the record_loan_repayment RPC (one transaction:
 * repayment log + loan balance + balanced double entry Dr Cash/Bank · Cr Loan
 * Recovery). The old "PATCH worker_loans + INSERT repayment log" path is gone.
 *
 * @param accountId Money-in account (Cash in Hand / Bank). When omitted, the
 *                  default cash/bank account is used so legacy callers still work.
 */
export async function recordRepayment(
  loanId: string,
  amountPaid: number,
  source: LoanRepaymentSource | LegacyLoanRepaymentSource,
  accountId?: string
): Promise<RecordRepaymentResult> {
  const fail = (error: string): RecordRepaymentResult => ({ loan: null, log: null, error });
  if (!SUPABASE_URL) return fail("Database URL is not configured.");
  if (!(amountPaid > 0)) return fail("Repayment amount must be greater than zero.");
  if (source === "SALARY_DEDUCTION") {
    return fail("Salary deductions are booked by Payroll only — record this repayment as Cash or Bank.");
  }
  try {
    const resolvedAccountId = accountId ?? (await defaultMoneyAccountId(source));
    if (!resolvedAccountId) return fail("No Cash in Hand / Bank account found in the chart of accounts.");

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_loan_repayment`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_loan_id: loanId,
        p_amount: amountPaid,
        p_source: source,
        p_account_id: resolvedAccountId,
        p_operator: "Accounts Dept",
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
      const message = extractMessage(body) || text.slice(0, 200) || "Failed to record repayment.";
      console.error("Supabase Error [record_loan_repayment]:", { status: res.status, message });
      return fail(message);
    }

    // The RPC owns the writes; re-read the loan so callers get the fresh balance.
    const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | null;
    let loan: WorkerLoan | null =
      row && typeof row === "object" && row.id ? (row as unknown as WorkerLoan) : null;
    if (!loan) {
      const loanRes = await fetch(`${SUPABASE_URL}/rest/v1/worker_loans?id=eq.${loanId}&select=*`, {
        headers: headers(),
      });
      if (!loanRes.ok) return fail("Repayment recorded, but the loan could not be re-read.");
      const rows = (await loanRes.json()) as WorkerLoan[];
      loan = rows[0] ?? null;
    }
    const log =
      row && typeof row === "object" && row.amount_paid ? (row as unknown as LoanRepaymentLog) : null;
    return { loan, log, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [recordRepayment]:", msg);
    return fail(msg);
  }
}

/**
 * Default money-in account for legacy callers that never picked one:
 * Cash in Hand (1000) for CASH, Bank (1002) for BANK_TRANSFER.
 */
async function defaultMoneyAccountId(source: LoanRepaymentSource): Promise<string | null> {
  if (!SUPABASE_URL) return null;
  try {
    const code = source === "CASH" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts_chart?select=id,is_default_cash&account_code=eq.${encodeURIComponent(
        code
      )}&order=is_default_cash.desc&limit=1`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { id: string }[];
    return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [defaultMoneyAccountId]:", msg);
    return null;
  }
}

function extractMessage(body: unknown): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (typeof b.message === "string" && b.message) return b.message;
    if (typeof b.error === "string" && b.error) return b.error;
    if (typeof b.hint === "string" && b.hint) return b.hint;
    return null;
  }
  if (typeof body === "string" && body) return body;
  return null;
}
