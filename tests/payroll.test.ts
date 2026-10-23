import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateEarnedSalary,
  calculateGrossToNetPayslip,
  round2,
  type Worker,
} from "../src/lib/salary";
import { computePL, type TrialBalanceRow } from "../src/lib/supabase/ledger";

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
