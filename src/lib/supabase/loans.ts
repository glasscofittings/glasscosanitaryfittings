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

export async function recordRepayment(
  loanId: string,
  amountPaid: number,
  source: "CASH" | "BANK_TRANSFER" | "SALARY_DEDUCTION"
): Promise<{ loan: WorkerLoan | null; log: LoanRepaymentLog | null }> {
  if (!SUPABASE_URL) return { loan: null, log: null };
  try {
    const loanRes = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_loans?id=eq.${loanId}&select=*`,
      { headers: headers() }
    );
    if (!loanRes.ok) {
      console.error("Supabase Error [worker_loans fetch]:", { status: loanRes.status, body: await loanRes.json() });
      return { loan: null, log: null };
    }
    const loans: WorkerLoan[] = await loanRes.json();
    if (loans.length === 0) return { loan: null, log: null };

    const loan = loans[0];
    const newBalance = Math.max(0, loan.current_balance - amountPaid);

    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/worker_loans?id=eq.${loanId}`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({ current_balance: newBalance }),
      }
    );
    if (!updateRes.ok) {
      console.error("Supabase Error [worker_loans update]:", { status: updateRes.status, body: await updateRes.json() });
      return { loan: null, log: null };
    }
    const updatedLoans: WorkerLoan[] = await updateRes.json();

    const logRes = await fetch(
      `${SUPABASE_URL}/rest/v1/loan_repayment_logs`,
      {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({
          loan_id: loanId,
          amount_paid: amountPaid,
          repayment_source: source,
        }),
      }
    );
    if (!logRes.ok) {
      console.error("Supabase Error [loan_repayment_logs insert]:", { status: logRes.status, body: await logRes.json() });
      return { loan: updatedLoans[0] ?? null, log: null };
    }
    const logs: LoanRepaymentLog[] = await logRes.json();

    await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        node_id: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
        operator_name: "Accounts Dept",
        action_type: "LOAN_REPAYMENT_RECEIVED",
        details: {
          module: "LOANS",
          loan_id: loanId,
          amount_paid: amountPaid,
          source,
          new_balance: newBalance,
        },
      }),
    });

    return { loan: updatedLoans[0] ?? null, log: logs[0] ?? null };
  } catch (err) {
    console.error("Supabase Error [recordRepayment]:", err);
    return { loan: null, log: null };
  }
}
