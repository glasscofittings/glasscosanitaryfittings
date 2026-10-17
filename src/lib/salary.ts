import type { Worker, AttendanceMap, TimeLogMap } from "@/lib/supabase/labour";

/**
 * Standard shift: 08:00 – 17:00. Time worked after SHIFT_END is overtime;
 * shift time missed (late arrival / early departure) is undertime.
 */
export const SHIFT_START = "08:00";
export const SHIFT_END = "17:00";
export const SHIFT_HOURS = 9;
/** Standard monthly salary for the 08:00 – 17:00 shift. */
export const DEFAULT_BASE_SALARY_PKR = 50000;

/** Default overtime hourly rate: base salary / 30 days / 9 shift hours. */
export function defaultOvertimeRate(baseSalary: number): number {
  return Math.round(baseSalary / 30 / SHIFT_HOURS);
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight; null if malformed. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export interface DayTimeResult {
  /** Total minutes between check-in and check-out. */
  workedMinutes: number;
  /** Minutes worked after SHIFT_END. */
  overtimeMinutes: number;
  /** Minutes arrived after SHIFT_START. */
  lateMinutes: number;
  /** Shift minutes not worked: late arrival + early departure. */
  undertimeMinutes: number;
}

/**
 * Worked / overtime minutes for one day. Returns null until both times are
 * logged and check-out is after check-in.
 */
export function calculateDayTime(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined
): DayTimeResult | null {
  const inMin = timeToMinutes(checkIn);
  const outMin = timeToMinutes(checkOut);
  if (inMin === null || outMin === null || outMin <= inMin) return null;
  const shiftStart = timeToMinutes(SHIFT_START)!;
  const shiftEnd = timeToMinutes(SHIFT_END)!;
  const workedInShift = Math.max(0, Math.min(outMin, shiftEnd) - Math.max(inMin, shiftStart));
  return {
    workedMinutes: outMin - inMin,
    overtimeMinutes: Math.max(0, outMin - Math.max(inMin, shiftEnd)),
    lateMinutes: Math.max(0, inMin - shiftStart),
    undertimeMinutes: SHIFT_HOURS * 60 - workedInShift,
  };
}

export interface EarnedSalaryResult {
  daysInMonth: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  dailyRate: number;
  /** Salary for paid days, before overtime. */
  basicSalary: number;
  overtimeMinutes: number;
  overtimeRate: number;
  overtimePay: number;
  undertimeMinutes: number;
  /** Normal hourly rate: dailyRate / SHIFT_HOURS. Used for undertime. */
  hourlyRate: number;
  undertimeDeduction: number;
  /** basicSalary + overtimePay - undertimeDeduction (never below 0) */
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
 * - basicSalary = round(dailyRate * (presentDays + leaveDays)).
 * - Overtime: minutes worked after SHIFT_END on Present days, paid at
 *   worker.overtime_rate_pkr per hour, pro-rated by the minute.
 * - Undertime: shift minutes missed on Present days (late arrival + early
 *   departure), deducted at the normal hourly rate (dailyRate / SHIFT_HOURS),
 *   pro-rated by the minute. Days without both times logged are not deducted.
 * - earnedSalary = basicSalary + overtimePay - undertimeDeduction.
 * - Loans are informational only and never affect this figure.
 */
export function calculateEarnedSalary(
  worker: Worker,
  attendance: AttendanceMap,
  year: number,
  month: number,
  timeLogs: TimeLogMap = {}
): EarnedSalaryResult {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
  const dailyRate = worker.base_salary_pkr / daysInMonth;
  const overtimeRate = worker.overtime_rate_pkr ?? defaultOvertimeRate(worker.base_salary_pkr);

  const workerAttendance = attendance[worker.id] ?? {};
  const workerTimes = timeLogs[worker.id] ?? {};
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let overtimeMinutes = 0;
  let undertimeMinutes = 0;
  for (const [date, status] of Object.entries(workerAttendance)) {
    if (!date.startsWith(monthPrefix)) continue;
    const day = Number(date.slice(monthPrefix.length));
    if (!Number.isFinite(day) || day < 1 || day > daysInMonth) continue;
    if (status === "P") {
      presentDays++;
      const log = workerTimes[date];
      const time = calculateDayTime(log?.checkIn, log?.checkOut);
      overtimeMinutes += time?.overtimeMinutes ?? 0;
      undertimeMinutes += time?.undertimeMinutes ?? 0;
    } else if (status === "A") absentDays++;
    else if (status === "L") leaveDays++;
  }

  const basicSalary = Math.round(dailyRate * (presentDays + leaveDays));
  const overtimePay = Math.round((overtimeMinutes / 60) * overtimeRate);
  const hourlyRate = dailyRate / SHIFT_HOURS;
  const undertimeDeduction = Math.round((undertimeMinutes / 60) * hourlyRate);

  return {
    daysInMonth,
    presentDays,
    absentDays,
    leaveDays,
    dailyRate,
    basicSalary,
    overtimeMinutes,
    overtimeRate,
    overtimePay,
    undertimeMinutes,
    hourlyRate,
    undertimeDeduction,
    earnedSalary: Math.max(0, basicSalary + overtimePay - undertimeDeduction),
  };
}
