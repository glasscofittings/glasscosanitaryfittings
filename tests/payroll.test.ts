import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateEarnedSalary,
  calculateGrossToNetPayslip,
  round2,
  type Worker,
} from "../src/lib/salary";
import { computePL, type TrialBalanceRow } from "../src/lib/supabase/ledger";
import {
  buildEmployeeLedger,
  type PayrollPaymentLog,
  type PayrollPeriod,
  type PayrollRun,
  type PayrollRunItem,
} from "../src/lib/supabase/payroll";

describe("SAP HCM Payroll Engine Tests", () => {
  const dummyWorkerPermanent: Worker = {
    id: "w-001",
    full_name: "Muhammad Ali",
    role_designation: "Lathe Operator",
    base_salary_pkr: 60000,
    overtime_rate_pkr: 300,
    joining_date: "2026-01-01",
    is_active: true,
    employment_type: "PERMANENT_SALARY",
    cost_class: "PRODUCTION",
  };

  const dummyWorkerDaily: Worker = {
    id: "w-002",
    full_name: "Tariq Mahmood",
    role_designation: "Polisher",
    base_salary_pkr: 2500, // daily rate
    overtime_rate_pkr: 250,
    joining_date: "2026-02-01",
    is_active: true,
    employment_type: "DAILY_PAY",
    cost_class: "PRODUCTION",
  };

  const dummyWorkerAdmin: Worker = {
    id: "w-003",
    full_name: "Sara Khan",
    role_designation: "Accountant",
    base_salary_pkr: 80000,
    overtime_rate_pkr: 400,
    joining_date: "2026-01-01",
    is_active: true,
    employment_type: "PERMANENT_SALARY",
    cost_class: "ADMIN",
  };

  it("1. Computes Permanent Salary with attendance, overtime & undertime", () => {
    const attendance = {
      "w-001": {
        "2026-10-01": "P" as const,
        "2026-10-02": "P" as const,
        "2026-10-03": "A" as const,
        "2026-10-04": "L" as const,
      },
    };

    const timeLogs = {
      "w-001": {
        "2026-10-01": { checkIn: "08:00", checkOut: "19:00" }, // 2h overtime (120 min)
      },
    };

    const slip = calculateGrossToNetPayslip(dummyWorkerPermanent, attendance, 2026, 10, {
      timeLogs,
    });

    assert.equal(slip.attendance.presentDays, 2);
    assert.equal(slip.attendance.absentDays, 1);
    assert.equal(slip.attendance.leaveDays, 1);
    assert.equal(slip.attendance.overtimeMinutes, 120);
    assert.equal(slip.overtimePay, 600); // 2 hrs * 300 PKR
    assert.ok(slip.grossEarnings > 0);
    assert.equal(slip.costClass, "PRODUCTION");
  });

  it("2. Computes Daily Pay correctly (days worked x daily rate)", () => {
    const attendance = {
      "w-002": {
        "2026-10-01": "P" as const,
        "2026-10-02": "P" as const,
        "2026-10-03": "P" as const,
        "2026-10-04": "A" as const,
      },
    };

    const slip = calculateGrossToNetPayslip(dummyWorkerDaily, attendance, 2026, 10);
    assert.equal(slip.attendance.presentDays, 3);
    assert.equal(slip.baseEarnings, 7500); // 3 days * 2500
    assert.equal(slip.netPayable, 7500);
  });

  it("3. Enforces Loan Recovery Capping at active balance & max 50% of net", () => {
    const attendance = {
      "w-001": {
        "2026-10-01": "P" as const,
        "2026-10-02": "P" as const,
      },
    };

    // Case A: Loan balance is small -> full repayment taken
    const slipA = calculateGrossToNetPayslip(dummyWorkerPermanent, attendance, 2026, 10, {
      activeLoans: [
        {
          id: "loan-1",
          worker_id: "w-001",
          original_loan_amount: 5000,
          current_balance: 500,
          monthly_deduction_rate: 1000,
          created_at: "2026-01-01",
        },
      ],
    });
    assert.equal(slipA.loanRecoveryDeduction, 500);

    // Case B: Loan scheduled rate exceeds 50% net -> capped at 50%
    const slipB = calculateGrossToNetPayslip(dummyWorkerPermanent, attendance, 2026, 10, {
      activeLoans: [
        {
          id: "loan-2",
          worker_id: "w-001",
          original_loan_amount: 50000,
          current_balance: 40000,
          monthly_deduction_rate: 20000, // larger than allowable 50% of 2-day earnings
          created_at: "2026-01-01",
        },
      ],
      maxLoanDeductionPercent: 50,
    });
    const maxAllowable = round2(slipB.grossEarnings * 0.5);
    assert.ok(slipB.loanRecoveryDeduction <= maxAllowable);
  });

  it("4. Financial P&L groups Production Direct Labour into COGS and Admin Payroll into OPEX", () => {
    const trialBalance: TrialBalanceRow[] = [
      {
        account_code: "4001",
        account_name: "Sales Revenue",
        account_type: "REVENUE",
        total_debit: 0,
        total_credit: 500000,
      },
      {
        account_code: "5006",
        account_name: "Cost of Goods Sold (Materials)",
        account_type: "EXPENSE",
        report_group: "COGS",
        total_debit: 200000,
        total_credit: 0,
      },
      {
        account_code: "5010",
        account_name: "Direct Labour - Wages (COGS)",
        account_type: "EXPENSE",
        report_group: "COGS",
        total_debit: 50000,
        total_credit: 0,
      },
      {
        account_code: "5002",
        account_name: "Admin Salaries & Wages Expense",
        account_type: "EXPENSE",
        report_group: "OPEX",
        total_debit: 80000,
        total_credit: 0,
      },
      {
        account_code: "5003",
        account_name: "Utilities Expense",
        account_type: "EXPENSE",
        report_group: "OPEX",
        total_debit: 20000,
        total_credit: 0,
      },
    ];

    const pl = computePL(trialBalance);

    // Revenue: 500,000
    assert.equal(pl.totalRevenue, 500000);
    // COGS: 200,000 (materials) + 50,000 (direct labour) = 250,000
    assert.equal(pl.totalCOGS, 250000);
    // Gross Profit: 500,000 - 250,000 = 250,000
    assert.equal(pl.grossProfit, 250000);
    // Operating Expenses: 80,000 (admin salary) + 20,000 (utilities) = 100,000
    assert.equal(pl.totalOperatingExpenses, 100000);
    // Net Profit: 250,000 - 100,000 = 150,000
    assert.equal(pl.netProfit, 150000);
  });
});

describe("Employee Account Ledger (head-wise view) Tests", () => {
  const makeItem = (
    id: string,
    workerId: string,
    workerName: string,
    net: number,
    paid: number,
    costClass: "PRODUCTION" | "ADMIN" = "PRODUCTION"
  ): PayrollRunItem => ({
    id,
    run_id: "run-x",
    worker_id: workerId,
    worker_name: workerName,
    cost_class: costClass,
    employment_type: "PERMANENT_SALARY",
    days_in_period: 30,
    present_days: 30,
    absent_days: 0,
    leave_days: 0,
    overtime_minutes: 0,
    undertime_minutes: 0,
    basic_rate: net,
    gross_earnings: net,
    total_deductions: 0,
    net_pay: net,
    amount_paid: paid,
    status: net > 0 && paid >= net ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "POSTED",
    created_at: "2026-09-01T00:00:00.000Z",
  });

  const makePeriod = (
    id: string,
    period_code: string,
    start_date: string,
    end_date: string
  ): PayrollPeriod => ({
    id,
    period_code,
    period_type: "MONTHLY",
    start_date,
    end_date,
    status: "OPEN",
    created_at: "2026-01-01T00:00:00.000Z",
  });

  const runSep: PayrollRun = {
    id: "run-sep",
    run_no: "PR-2026-091",
    period_id: "p-sep",
    run_type: "REGULAR",
    status: "PARTIALLY_PAID",
    total_workers: 2,
    gross_earnings: 90000,
    total_deductions: 0,
    employer_cost: 0,
    net_payable: 90000,
    amount_paid: 70000,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-30T00:00:00.000Z",
    period: makePeriod("p-sep", "2026-M09", "2026-09-01", "2026-09-30"),
    items: [
      makeItem("item-osama-sep", "w-osama", "Osama", 60000, 60000),
      makeItem("item-tariq-sep", "w-tariq", "Tariq Mahmood", 30000, 10000),
    ],
  };

  const runOct: PayrollRun = {
    id: "run-oct",
    run_no: "PR-2026-101",
    period_id: "p-oct",
    run_type: "REGULAR",
    status: "POSTED",
    total_workers: 3,
    gross_earnings: 173000,
    total_deductions: 0,
    employer_cost: 0,
    net_payable: 173000,
    amount_paid: 111000,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    period: makePeriod("p-oct", "2026-M10", "2026-10-01", "2026-10-31"),
    items: [
      makeItem("item-osama-oct", "w-osama", "Osama", 62000, 0),
      makeItem("item-tariq-oct", "w-tariq", "Tariq Mahmood", 31000, 31000),
      makeItem("item-sara-oct", "w-sara", "Sara Khan", 80000, 80000, "ADMIN"),
    ],
  };

  // Storno-reversed run — must NOT affect ledger balances
  const reversedRun: PayrollRun = {
    ...runOct,
    id: "run-rev",
    run_no: "PR-2026-102",
    status: "REVERSED",
    items: [makeItem("item-osama-rev", "w-osama", "Osama", 99999, 0)],
  };

  const paymentLogs: PayrollPaymentLog[] = [
    {
      id: "log-1",
      run_id: "run-sep",
      item_id: "item-osama-sep",
      amount: 60000,
      payment_method: "CASH",
      payment_account_id: "acc-1",
      payment_date: "2026-09-30",
      created_at: "2026-09-30T10:00:00.000Z",
    },
    {
      id: "log-2",
      run_id: "run-sep",
      item_id: "item-tariq-sep",
      amount: 10000,
      payment_method: "BANK",
      payment_account_id: "acc-1",
      payment_date: "2026-09-28",
      created_at: "2026-09-28T10:05:00.000Z",
    },
  ];

  const ledgerWorkers: Worker[] = [
    {
      id: "w-osama",
      full_name: "Osama",
      role_designation: "Director",
      base_salary_pkr: 60000,
      overtime_rate_pkr: 0,
      joining_date: "2026-01-01",
      is_active: true,
      employment_type: "PERMANENT_SALARY",
      cost_class: "ADMIN",
      default_pay_method: "CASH",
    },
    {
      id: "w-tariq",
      full_name: "Tariq Mahmood",
      role_designation: "Polisher",
      base_salary_pkr: 2500,
      overtime_rate_pkr: 250,
      joining_date: "2026-02-01",
      is_active: true,
      employment_type: "DAILY_PAY",
      cost_class: "PRODUCTION",
      default_pay_method: "BANK",
      bank_name: "HBL",
      account_iban: "PK36SCBL00000011234567",
    },
  ];

  const ledger = buildEmployeeLedger(
    [runSep, runOct, reversedRun],
    paymentLogs,
    ledgerWorkers
  );

  it("5. Groups run items into one account per employee with month-by-month breakdown", () => {
    assert.equal(ledger.length, 3);

    const osama = ledger.find((a) => a.workerId === "w-osama")!;
    assert.equal(osama.months.length, 2);

    // Months are chronological regardless of run insertion order
    assert.equal(osama.months[0].periodCode, "2026-M09");
    assert.equal(osama.months[1].periodCode, "2026-M10");
  });

  it("6. Tracks paid vs pending (left unpaid) per specific month with correct statuses", () => {
    const osama = ledger.find((a) => a.workerId === "w-osama")!;

    // Sep: fully paid, Oct: nothing paid yet
    assert.equal(osama.months[0].status, "PAID");
    assert.equal(osama.months[0].pendingAmount, 0);
    assert.equal(osama.months[1].status, "PENDING");
    assert.equal(osama.months[1].pendingAmount, 62000);

    // Account-level roll-up
    assert.equal(osama.totalNetPay, 122000);
    assert.equal(osama.totalPaid, 60000);
    assert.equal(osama.totalPending, 62000);
    assert.equal(osama.status, "PARTIALLY_PAID");

    // Tariq: partial in Sep, full in Oct -> partially paid overall
    const tariq = ledger.find((a) => a.workerId === "w-tariq")!;
    assert.equal(tariq.months[0].status, "PARTIALLY_PAID");
    assert.equal(tariq.months[0].pendingAmount, 20000);
    assert.equal(tariq.months[1].status, "PAID");
    assert.equal(tariq.totalPending, 20000);

    // Sara: only Oct, fully settled
    const sara = ledger.find((a) => a.workerId === "w-sara")!;
    assert.equal(sara.status, "PAID");
    assert.equal(sara.totalPending, 0);
    assert.equal(sara.costClass, "ADMIN");
  });

  it("7. Excludes reversed (storno) runs from ledger balances", () => {
    const osama = ledger.find((a) => a.workerId === "w-osama")!;
    // If the reversed 99,999 run leaked in, totals would be far larger
    assert.equal(osama.totalNetPay, 122000);
    assert.ok(!osama.months.some((m) => m.runId === "run-rev"));
  });

  it("8. Enriches accounts with worker payment profiles and last payment dates", () => {
    const tariq = ledger.find((a) => a.workerId === "w-tariq")!;
    assert.equal(tariq.paymentProfile.bankName, "HBL");
    assert.equal(tariq.paymentProfile.accountIban, "PK36SCBL00000011234567");
    assert.equal(tariq.paymentProfile.defaultMethod, "BANK");
    assert.equal(tariq.roleDesignation, "Polisher");

    // Latest payment date from payment logs is surfaced per month & account
    const osama = ledger.find((a) => a.workerId === "w-osama")!;
    assert.equal(osama.months[0].lastPaymentDate, "2026-09-30");
    assert.equal(osama.lastPaymentDate, "2026-09-30");
  });

  it("9. Sorts accounts with outstanding balances first", () => {
    // Osama pending 62,000 > Tariq pending 20,000 > Sara pending 0
    assert.equal(ledger[0].workerId, "w-osama");
    assert.equal(ledger[1].workerId, "w-tariq");
    assert.equal(ledger[2].workerId, "w-sara");
  });
});
