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

/** Weekly off days (0 = Sunday). Unmarked off days are paid for permanent staff. */
export const WEEKLY_OFF_DAYS: number[] = [0];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Inclusive payroll period expressed as YYYY-MM-DD strings. */
export interface PeriodRange {
  start: string;
  end: string;
}

/** "November 2026" from a YYYY-MM-DD (or YYYY-MM) date string. */
export function monthLabelOf(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date || "");
  if (!m) return date || "—";
  const idx = Number(m[2]) - 1;
  return `${MONTH_NAMES[idx] ?? ""} ${m[1]}`.trim();
}

/** Splits 'YYYY-MM-DD' — never feeds a date string to new Date() (UTC drift). */
function parseISODate(date: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date || "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Days in the calendar month containing `date` (numeric Date parts only). */
function daysInMonthOf(date: string): number {
  const p = parseISODate(date);
  if (!p) return 30;
  return new Date(p.year, p.month, 0).getDate();
}

/** Every date (inclusive) inside the period, built arithmetically. */
function listDatesInRange(period: PeriodRange): string[] {
  const s = parseISODate(period.start);
  const e = parseISODate(period.end);
  if (!s || !e || period.end < period.start) return [];
  const cursor = new Date(s.year, s.month - 1, s.day);
  const last = new Date(e.year, e.month - 1, e.day);
  const dates: string[] = [];
  while (cursor <= last && dates.length < 400) {
    dates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** Weekday (0 = Sunday) of a 'YYYY-MM-DD' string, without string Date parsing. */
function weekdayOfDate(date: string): number {
  const p = parseISODate(date);
  if (!p) return -1;
  return new Date(p.year, p.month - 1, p.day).getDay();
}

function monthRangeOf(year: number, month: number): PeriodRange {
  const mm = Math.min(12, Math.max(1, Math.trunc(month) || 1));
  const start = `${year}-${pad2(mm)}-01`;
  const end = `${year}-${pad2(mm)}-${pad2(daysInMonthOf(start))}`;
  return { start, end };
}

/**
 * Default overtime hourly rate.
 * Permanent salary: monthly base / 30 days / 9 shift hours.
 * DAILY_PAY / PART_TIME_WAGE: base_salary_pkr already IS the daily rate → rate / 9.
 */
export function defaultOvertimeRate(baseSalary: number, employmentType?: string): number {
  if (employmentType === "DAILY_PAY" || employmentType === "PART_TIME_WAGE") {
    return round2((baseSalary || 0) / SHIFT_HOURS);
  }
  return round2((baseSalary || 0) / 30 / SHIFT_HOURS);
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
  /** Calendar days covered by the period (start..end, inclusive). */
  daysInPeriod: number;
  /** Days in the calendar month containing period.start (basis of the daily rate). */
  daysInMonth: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  /** In-period dates with no attendance row, excluding weekly off days (unpaid). */
  unmarkedDays: number;
  /** Unmarked weekly off days (paid for permanent staff, downgraded from absent). */
  paidWeeklyOffDays: number;
  /** Days actually paid: present + leave (+ weekly offs for permanent staff). */
  paidDays: number;
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
 *
 * Only dates inside `period` are counted. 'YYYY-MM-DD' strings are split
 * arithmetically (never passed to `new Date(string)`, which is UTC-based).
 */
export function calculateEarnedSalary(
  worker: Worker,
  attendance: AttendanceMap,
  period: PeriodRange,
  timeLogs?: TimeLogMap
): EarnedSalaryResult;
/** Legacy month overload — same as passing { start: first day, end: last day }. */
export function calculateEarnedSalary(
  worker: Worker,
  attendance: AttendanceMap,
  year: number,
  month: number,
  timeLogs?: TimeLogMap
): EarnedSalaryResult;
export function calculateEarnedSalary(
  worker: Worker,
  attendance: AttendanceMap,
  periodOrYear: PeriodRange | number,
  timeLogsOrMonth?: TimeLogMap | number,
  legacyTimeLogs?: TimeLogMap
): EarnedSalaryResult {
  let period: PeriodRange;
  let timeLogs: TimeLogMap;
  if (typeof periodOrYear === "number") {
    period = monthRangeOf(periodOrYear, typeof timeLogsOrMonth === "number" ? timeLogsOrMonth : 1);
    timeLogs = legacyTimeLogs ?? {};
  } else {
    period = periodOrYear || { start: "", end: "" };
    timeLogs = (timeLogsOrMonth as TimeLogMap) ?? {};
  }

  const employmentType = worker.employment_type || "PERMANENT_SALARY";
  const isPermanent = employmentType === "PERMANENT_SALARY";
  const daysInMonth = daysInMonthOf(period.start);
  // Permanent: base is a monthly salary → daily rate. Daily/part-time: base IS the daily rate.
  const dailyRate = isPermanent
    ? round2((worker.base_salary_pkr || 0) / (daysInMonth || 30))
    : round2(worker.base_salary_pkr || 0);
  const overtimeRate =
    worker.overtime_rate_pkr || defaultOvertimeRate(worker.base_salary_pkr || 0, employmentType);

  const workerAttendance = attendance[worker.id] ?? {};
  const workerTimes = timeLogs[worker.id] ?? {};
  const weeklyOff = new Set<number>(WEEKLY_OFF_DAYS);

  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let unmarkedDays = 0;
  let paidWeeklyOffDays = 0;
  let overtimeMinutes = 0;
  let undertimeMinutes = 0;

  const dates = listDatesInRange(period);
  for (const date of dates) {
    const status = workerAttendance[date];
    if (status === undefined) {
      // No attendance row: weekly offs are paid for permanent staff, the rest are not.
      if (weeklyOff.has(weekdayOfDate(date))) paidWeeklyOffDays++;
      else unmarkedDays++;
      continue;
    }
    if (status === "P") {
      presentDays++;
      const log = workerTimes[date];
      const time = calculateDayTime(log?.checkIn, log?.checkOut);
      overtimeMinutes += time?.overtimeMinutes ?? 0;
      undertimeMinutes += time?.undertimeMinutes ?? 0;
    } else if (status === "A") absentDays++;
    else if (status === "L") leaveDays++;
  }

  const paidDays = isPermanent ? presentDays + leaveDays + paidWeeklyOffDays : presentDays;
  const basicSalary = round2(dailyRate * paidDays);
  const overtimePay = round2((overtimeMinutes / 60) * overtimeRate);
  const hourlyRate = round2(dailyRate / SHIFT_HOURS);
  const undertimeDeduction = round2((undertimeMinutes / 60) * hourlyRate);

  return {
    daysInPeriod: dates.length,
    daysInMonth,
    presentDays,
    absentDays,
    leaveDays,
    unmarkedDays,
    paidWeeklyOffDays,
    paidDays,
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
    /** In-period days with no attendance row (unpaid) — warning signal for the UI. */
    unmarkedDays: number;
    /** Unmarked weekly off days that were paid anyway. */
    paidWeeklyOffDays: number;
    overtimeMinutes: number;
    undertimeMinutes: number;
  };
  /** Convenience mirror of attendance.unmarkedDays (per worker). */
  unmarkedDays: number;
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
 *       PERMANENT_SALARY: dailyRate = base / days in month of period.start.
 *                         Paid days = present + leave + unmarked weekly off days.
 *       DAILY_PAY / PART_TIME_WAGE: base_salary_pkr already IS the daily rate,
 *                         so paid = present days * rate (absence is not paid).
 *   - Only attendance dates inside `period` (YYYY-MM-DD strings) are counted.
 *   - Overtime and Undertime (timeLogs are honoured so they reach the slip)
 *   - Recurring components (infotype 0008/0014)
 *   - Manual one-time lines (e.g. Bonus, Advance recovery)
 *   - Deductions can never exceed gross: undertime + manual (+recurring) are scaled
 *     down to fit, then loan recovery is capped at
 *       1. Active loan outstanding balance
 *       2. The loan's monthly deduction rate
 *       3. maxLoanDeductionPercent (default 50%) of what remains
 *   - netPayable ALWAYS equals round2(grossEarnings - totalDeductions) — no clamping
 */
export function calculateGrossToNetPayslip(
  worker: Worker,
  attendanceMap: AttendanceMap,
  period: PeriodRange,
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
  const attRes = calculateEarnedSalary(worker, attendanceMap, period, options.timeLogs || {});

  const lines: FullPayslipCalculationResult["lines"] = [];
  /** Every deduction line, tagged by group so all of them can be capped together. */
  const deductionLines: Array<{ index: number; group: "undertime" | "recurring" | "manual" }> = [];
  const pushDeductionLine = (
    line: FullPayslipCalculationResult["lines"][number],
    group: "undertime" | "recurring" | "manual"
  ) => {
    lines.push(line);
    deductionLines.push({ index: lines.length - 1, group });
  };

  let baseEarnings = 0;
  // Absence simply means no pay — it is never turned into a cash deduction.
  const absenceDeductions = 0;

  if (empType === "PERMANENT_SALARY") {
    baseEarnings = attRes.basicSalary;
    lines.push({
      wageTypeCode: "BASIC",
      wageTypeName: "Basic Salary",
      category: "EARNING",
      qty: attRes.paidDays,
      rate: attRes.dailyRate,
      amount: baseEarnings,
    });
  } else {
    // DAILY_PAY / PART_TIME_WAGE — base_salary_pkr already is the daily rate
    baseEarnings = attRes.basicSalary;
    lines.push({
      wageTypeCode: "DAILY_WAGE",
      wageTypeName: empType === "DAILY_PAY" ? "Daily Wage" : "Part-time Wage",
      category: "EARNING",
      qty: attRes.presentDays,
      rate: attRes.dailyRate,
      amount: baseEarnings,
    });
  }

  // Overtime (from timeLogs)
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

  // Undertime (from timeLogs)
  if (attRes.undertimeDeduction > 0) {
    pushDeductionLine(
      {
        wageTypeCode: "UNDERTIME_DEDUCTION",
        wageTypeName: "Undertime Deduction",
        category: "DEDUCTION",
        qty: round2(attRes.undertimeMinutes / 60),
        rate: attRes.hourlyRate,
        amount: attRes.undertimeDeduction,
      },
      "undertime"
    );
  }

  // Recurring components
  let recurringEarnings = 0;
  (options.recurringComponents || []).forEach((rc) => {
    if (rc.amount > 0) {
      if (rc.category === "EARNING") {
        recurringEarnings = round2(recurringEarnings + rc.amount);
      }
      const line = {
        wageTypeCode: rc.wageTypeCode,
        wageTypeName: rc.wageTypeName,
        category: rc.category,
        qty: 1,
        rate: rc.amount,
        amount: rc.amount,
      };
      if (rc.category === "DEDUCTION") pushDeductionLine(line, "recurring");
      else lines.push(line);
    }
  });

  // Manual one-off adjustments
  let manualBonusOrEarnings = 0;
  (options.manualAdjustments || []).forEach((ma) => {
    if (ma.amount > 0) {
      if (ma.category === "EARNING") {
        manualBonusOrEarnings = round2(manualBonusOrEarnings + ma.amount);
      }
      const line = {
        wageTypeCode: ma.wageTypeCode,
        wageTypeName: ma.wageTypeName,
        category: ma.category,
        qty: 1,
        rate: ma.amount,
        amount: ma.amount,
      };
      if (ma.category === "DEDUCTION") pushDeductionLine(line, "manual");
      else lines.push(line);
    }
  });

  const grossEarnings = round2(baseEarnings + overtimePay + recurringEarnings + manualBonusOrEarnings);

  // ── Capping: undertime + manual (+recurring) can never exceed gross ────────
  if (deductionLines.length > 0) {
    if (grossEarnings <= 0) {
      for (const ref of deductionLines) lines[ref.index].amount = 0;
    } else {
      const rawTotal = round2(
        deductionLines.reduce((sum, ref) => sum + lines[ref.index].amount, 0)
      );
      if (rawTotal > grossEarnings) {
        // Scale every deduction proportionally so their sum fits inside gross.
        const ratio = grossEarnings / rawTotal;
        for (const ref of deductionLines) {
          lines[ref.index].amount = round2(lines[ref.index].amount * ratio);
        }
        // Rounding can leave the scaled sum a cent over — trim the largest lines.
        const scaledTotal = round2(
          deductionLines.reduce((sum, ref) => sum + lines[ref.index].amount, 0)
        );
        let excess = round2(scaledTotal - grossEarnings);
        if (excess > 0) {
          const bySize = [...deductionLines].sort(
            (a, b) => lines[b.index].amount - lines[a.index].amount
          );
          for (const ref of bySize) {
            if (excess <= 0) break;
            const amount = lines[ref.index].amount;
            const take = Math.min(amount, excess);
            lines[ref.index].amount = round2(amount - take);
            excess = round2(excess - take);
          }
        }
      }
    }
  }

  const sumGroup = (group: "undertime" | "recurring" | "manual"): number =>
    round2(
      deductionLines
        .filter((ref) => ref.group === group)
        .reduce((sum, ref) => sum + lines[ref.index].amount, 0)
    );

  const undertimeDeduction = sumGroup("undertime");
  const recurringDeductions = sumGroup("recurring");
  const manualDeductions = sumGroup("manual");
  const otherDeductions = round2(undertimeDeduction + recurringDeductions + manualDeductions);

  // ── Loan recovery: min(balance, monthly rate, maxLoan% of what remains) ────
  const remainingBeforeLoan = round2(grossEarnings - otherDeductions); // ≥ 0 by construction
  let loanRecoveryDeduction = 0;
  const activeLoans = options.activeLoans || [];
  const totalLoanBalance = activeLoans.reduce((sum, l) => sum + (l.current_balance || 0), 0);
  const totalMonthlyScheduled = activeLoans.reduce(
    (sum, l) => sum + Math.min(l.current_balance || 0, l.monthly_deduction_rate || 0),
    0
  );

  if (totalLoanBalance > 0 && remainingBeforeLoan > 0) {
    const maxPercent = options.maxLoanDeductionPercent ?? 50; // max 50% cap
    const maxAllowableRecovery = round2(remainingBeforeLoan * (maxPercent / 100));
    loanRecoveryDeduction = round2(
      Math.min(totalLoanBalance, totalMonthlyScheduled, maxAllowableRecovery)
    );

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

  const totalDeductions = round2(otherDeductions + loanRecoveryDeduction);
  // Identity (never clamped): deductions ≤ gross, so net = gross - deductions ≥ 0.
  const netPayable = round2(grossEarnings - totalDeductions);

  return {
    workerId: worker.id,
    workerName: worker.full_name,
    employmentType: empType,
    costClass,
    attendance: {
      daysInPeriod: attRes.daysInPeriod,
      presentDays: attRes.presentDays,
      absentDays: attRes.absentDays,
      leaveDays: attRes.leaveDays,
      unmarkedDays: attRes.unmarkedDays,
      paidWeeklyOffDays: attRes.paidWeeklyOffDays,
      overtimeMinutes: attRes.overtimeMinutes,
      undertimeMinutes: attRes.undertimeMinutes,
    },
    unmarkedDays: attRes.unmarkedDays,
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
    // normalise -0 so strict equality checks (0 === net) hold
    netPayable: netPayable === 0 ? 0 : netPayable,
    lines,
  };
}
