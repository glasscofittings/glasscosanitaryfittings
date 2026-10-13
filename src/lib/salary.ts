import type { Worker, AttendanceMap } from "@/lib/supabase/labour";

export interface EarnedSalaryResult {
  daysInMonth: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  dailyRate: number;
  earnedSalary: number;
}

/**
 * Pure salary computation - no DB writes, no loan deductions.
 *
 * - daysInMonth is the actual calendar days in the month (28-31).
 * - dailyRate = base_salary / daysInMonth (always full month, no proration).
 * - All attendance entries in the month are counted (no joining-date filter),
 *   so users can freely enter historical / backdated attendance.
 * - Leave (L) is paid like Present; only Absent (A) is unpaid.
 * - earnedSalary = round(dailyRate * (presentDays + leaveDays)).
 * - Loans are informational only and never affect this figure.
 */
export function calculateEarnedSalary(
  worker: Worker,
  attendance: AttendanceMap,
  year: number,
  month: number
): EarnedSalaryResult {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
  const dailyRate = worker.base_salary_pkr / daysInMonth;

  const workerAttendance = attendance[worker.id] ?? {};
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  for (const [date, status] of Object.entries(workerAttendance)) {
    if (!date.startsWith(monthPrefix)) continue;
    const day = Number(date.slice(monthPrefix.length));
    if (!Number.isFinite(day) || day < 1 || day > daysInMonth) continue;
    if (status === "P") presentDays++;
    else if (status === "A") absentDays++;
    else if (status === "L") leaveDays++;
  }

  const earnedSalary = Math.round(dailyRate * (presentDays + leaveDays));

  return { daysInMonth, presentDays, absentDays, leaveDays, dailyRate, earnedSalary };
}
