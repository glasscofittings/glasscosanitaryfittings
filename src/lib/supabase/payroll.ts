import { fetchWorkers, fetchAttendance, fetchWorkerLoans } from "./labour";

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

export async function fetchPayrollRuns(): Promise<PayrollRun[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/payroll_runs?select=*,slips:payroll_slips(*)&order=year.desc,month.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/payroll_runs?order=created_at.desc`,
        { headers: headers() }
      );
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

export async function generateMonthlyPayroll(year: number, month: number): Promise<{
  success: boolean;
  payroll?: PayrollRun;
  error?: string;
}> {
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

    // Map attendance per worker
    const attMap = new Map<string, { present: number; absent: number; leave: number }>();
    attendanceRecords.forEach((r) => {
      if (!attMap.has(r.worker_id)) attMap.set(r.worker_id, { present: 0, absent: 0, leave: 0 });
      const stats = attMap.get(r.worker_id)!;
      if (r.status === "P") stats.present += 1;
      else if (r.status === "A") stats.absent += 1;
      else if (r.status === "L") stats.leave += 1;
    });

    // Compute slips
    const slips: PayrollSlip[] = [];
    let grossTotal = 0;
    let deductionTotal = 0;
    let loanRepaymentTotal = 0;
    let netTotal = 0;

    for (const w of workers) {
      const stats = attMap.get(w.id) || { present: 0, absent: 0, leave: 0 };
      const dailyRate = Math.round((w.base_salary_pkr / daysInMonth) * 100) / 100;
      
      // Absence penalty (unapproved absent days deducted)
      const absenceDeduction = Math.round(stats.absent * dailyRate * 100) / 100;
      const earnedSalary = Math.max(0, Math.round((w.base_salary_pkr - absenceDeduction) * 100) / 100);

      // Check active loans
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

    // Insert or update Payroll Run Header
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
      return { success: false, error: err.message || "Failed to create payroll run" };
    }

    const runRows = await runRes.json();
    const createdRun = Array.isArray(runRows) ? runRows[0] : runRows;

    // Insert Slips
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
