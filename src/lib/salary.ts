import type { Worker, AttendanceMap, TimeLogMap, WorkerLoan } from "@/lib/supabase/labour";
export type { Worker, AttendanceMap, TimeLogMap, WorkerLoan };

/**
 * Standard shift: 08:00 – 17:00. Time worked after SHIFT_END is overtime;
 * shift time missed (late arrival / early departure) is undertime.
 */
export const SHIFT_START = "08:00";
export const SHIFT_END = "17:00";
export const SHIFT_HOURS = 9;
/** Standard monthly salary for the 08:00 – 17:00 shift. */
export const DEFAULT_BASE_SALARY_PKR = 50000;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Default overtime hourly rate: base salary / 30 days / 9 shift hours. */
export function defaultOvertimeRate(baseSalary: number): number {
  return round2(baseSalary / 30 / SHIFT_HOURS);
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
 * Pure salary computation - attendance, overtime & undertime.
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
  const dailyRate = round2(worker.base_salary_pkr / daysInMonth);
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

  const basicSalary = round2(dailyRate * (presentDays + leaveDays));
  const overtimePay = round2((overtimeMinutes / 60) * overtimeRate);
  const hourlyRate = round2(dailyRate / SHIFT_HOURS);
  const undertimeDeduction = round2((undertimeMinutes / 60) * hourlyRate);

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
    earnedSalary: Math.max(0, round2(basicSalary + overtimePay - undertimeDeduction)),
  };
}

// ─── Gross-to-Net SAP Calculation Engine ────────────────────────────────────

export interface RecurringComponentInput {
  wageTypeCode: string;
  wageTypeName: string;
  category: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
  amount: number;
}

export interface ManualAdjustmentInput {
  wageTypeCode: string;
  wageTypeName: string;
  category: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
  amount: number;
}

export interface FullPayslipCalculationResult {
  workerId: string;
  workerName: string;
  employmentType: "PERMANENT_SALARY" | "DAILY_PAY" | "PART_TIME_WAGE";
  costClass: "PRODUCTION" | "ADMIN";
  attendance: {
    daysInPeriod: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    overtimeMinutes: number;
    undertimeMinutes: number;
  };
  baseEarnings: number;
  overtimePay: number;
  recurringEarnings: number;
  manualBonusOrEarnings: number;
  grossEarnings: number;

  absenceDeductions: number;
  undertimeDeductions: number;
  recurringDeductions: number;
  manualDeductions: number;
  loanRecoveryDeduction: number;
  totalDeductions: number;

  netPayable: number;
  lines: Array<{
    wageTypeCode: string;
    wageTypeName: string;
    category: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
    qty: number;
    rate: number;
    amount: number;
  }>;
}

/**
 * Computes Gross-to-Net payroll slip for a worker with integer/2-decimal accuracy:
 *   - Employment types:
 *       PERMANENT_SALARY: dailyRate = base / daysInMonth. Paid = (present + leave) * dailyRate
 *       DAILY_PAY: present days * dailyRate (absence is not paid; not deducted)
 *       PART_TIME_WAGE: present days or hours * rate
 *   - Overtime and Undertime
 *   - Recurring components (infotype 0008/0014)
 *   - Manual one-time lines (e.g. Bonus, Advance recovery)
 *   - Loan recovery capped at:
 *       1. Active loan outstanding balance
 *       2. Max configurable % of (gross - statutory deductions), e.g. 50%
 */
export function calculateGrossToNetPayslip(
  worker: Worker,
  attendanceMap: AttendanceMap,
  year: number,
  month: number,
  options: {
    timeLogs?: TimeLogMap;
    recurringComponents?: RecurringComponentInput[];
    manualAdjustments?: ManualAdjustmentInput[];
    activeLoans?: WorkerLoan[];
    maxLoanDeductionPercent?: number; // e.g., 50 for max 50% of net
  } = {}
): FullPayslipCalculationResult {
  const empType = worker.employment_type || "PERMANENT_SALARY";
  const costClass = worker.cost_class || "PRODUCTION";
  const attRes = calculateEarnedSalary(worker, attendanceMap, year, month, options.timeLogs || {});

  const lines: FullPayslipCalculationResult["lines"] = [];

  let baseEarnings = 0;
  let absenceDeductions = 0;

  if (empType === "PERMANENT_SALARY") {
    baseEarnings = attRes.basicSalary;
    lines.push({
      wageTypeCode: "BASIC",
      wageTypeName: "Basic Salary",
      category: "EARNING",
      qty: attRes.presentDays + attRes.leaveDays,
      rate: attRes.dailyRate,
      amount: baseEarnings,
    });
  } else if (empType === "DAILY_PAY") {
    baseEarnings = round2(attRes.presentDays * (worker.base_salary_pkr || attRes.dailyRate));
    lines.push({
      wageTypeCode: "DAILY_WAGE",
      wageTypeName: "Daily Wage",
      category: "EARNING",
      qty: attRes.presentDays,
      rate: worker.base_salary_pkr || attRes.dailyRate,
      amount: baseEarnings,
    });
  } else {
    // PART_TIME_WAGE
    baseEarnings = round2(attRes.presentDays * (worker.base_salary_pkr || attRes.dailyRate));
    lines.push({
      wageTypeCode: "DAILY_WAGE",
      wageTypeName: "Part-time Wage",
      category: "EARNING",
      qty: attRes.presentDays,
      rate: worker.base_salary_pkr || attRes.dailyRate,
      amount: baseEarnings,
    });
  }

  // Overtime
  const overtimePay = attRes.overtimePay;
  if (overtimePay > 0) {
    lines.push({
      wageTypeCode: "OVERTIME",
      wageTypeName: "Overtime Pay",
      category: "EARNING",
      qty: round2(attRes.overtimeMinutes / 60),
      rate: attRes.overtimeRate,
      amount: overtimePay,
    });
  }

  // Undertime
  const undertimeDeduction = attRes.undertimeDeduction;
  if (undertimeDeduction > 0) {
    lines.push({
      wageTypeCode: "UNDERTIME_DEDUCTION",
      wageTypeName: "Undertime Deduction",
      category: "DEDUCTION",
      qty: round2(attRes.undertimeMinutes / 60),
      rate: attRes.hourlyRate,
      amount: undertimeDeduction,
    });
  }

  // Recurring components
  let recurringEarnings = 0;
  let recurringDeductions = 0;
  (options.recurringComponents || []).forEach((rc) => {
    if (rc.amount > 0) {
      if (rc.category === "EARNING") {
        recurringEarnings = round2(recurringEarnings + rc.amount);
      } else if (rc.category === "DEDUCTION") {
        recurringDeductions = round2(recurringDeductions + rc.amount);
      }
      lines.push({
        wageTypeCode: rc.wageTypeCode,
        wageTypeName: rc.wageTypeName,
        category: rc.category,
        qty: 1,
        rate: rc.amount,
        amount: rc.amount,
      });
    }
  });

  // Manual one-off adjustments
  let manualBonusOrEarnings = 0;
  let manualDeductions = 0;
  (options.manualAdjustments || []).forEach((ma) => {
    if (ma.amount > 0) {
      if (ma.category === "EARNING") {
        manualBonusOrEarnings = round2(manualBonusOrEarnings + ma.amount);
      } else if (ma.category === "DEDUCTION") {
        manualDeductions = round2(manualDeductions + ma.amount);
      }
      lines.push({
        wageTypeCode: ma.wageTypeCode,
        wageTypeName: ma.wageTypeName,
        category: ma.category,
        qty: 1,
        rate: ma.amount,
        amount: ma.amount,
      });
    }
  });

  const grossEarnings = round2(baseEarnings + overtimePay + recurringEarnings + manualBonusOrEarnings);

  // Preliminary Net before Loan Recovery
  const preLoanNet = Math.max(0, round2(grossEarnings - undertimeDeduction - recurringDeductions - manualDeductions));

  // Loan Recovery calculation with capping
  let loanRecoveryDeduction = 0;
  const activeLoans = options.activeLoans || [];
  const totalLoanBalance = activeLoans.reduce((sum, l) => sum + (l.current_balance || 0), 0);
  const totalMonthlyScheduled = activeLoans.reduce(
    (sum, l) => sum + Math.min(l.current_balance || 0, l.monthly_deduction_rate || 0),
    0
  );

  if (totalLoanBalance > 0 && preLoanNet > 0) {
    const maxPercent = options.maxLoanDeductionPercent ?? 50; // max 50% cap
    const maxAllowableRecovery = round2(preLoanNet * (maxPercent / 100));
    loanRecoveryDeduction = Math.min(totalLoanBalance, totalMonthlyScheduled, maxAllowableRecovery);
    loanRecoveryDeduction = round2(loanRecoveryDeduction);

    if (loanRecoveryDeduction > 0) {
      lines.push({
        wageTypeCode: "LOAN_RECOVERY",
        wageTypeName: "Staff Loan Recovery",
        category: "DEDUCTION",
        qty: 1,
        rate: loanRecoveryDeduction,
        amount: loanRecoveryDeduction,
      });
    }
  }

  const totalDeductions = round2(undertimeDeduction + recurringDeductions + manualDeductions + loanRecoveryDeduction);
  const netPayable = Math.max(0, round2(grossEarnings - totalDeductions));

  return {
    workerId: worker.id,
    workerName: worker.full_name,
    employmentType: empType,
    costClass,
    attendance: {
      daysInPeriod: attRes.daysInMonth,
      presentDays: attRes.presentDays,
      absentDays: attRes.absentDays,
      leaveDays: attRes.leaveDays,
      overtimeMinutes: attRes.overtimeMinutes,
      undertimeMinutes: attRes.undertimeMinutes,
    },
    baseEarnings,
    overtimePay,
    recurringEarnings,
    manualBonusOrEarnings,
    grossEarnings,
    absenceDeductions,
    undertimeDeductions: undertimeDeduction,
    recurringDeductions,
    manualDeductions,
    loanRecoveryDeduction,
    totalDeductions,
    netPayable,
    lines,
  };
}
