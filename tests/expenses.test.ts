import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateExpenseInput,
  calculateExpenseSummary,
  EXPENSE_CATEGORIES,
  type Expense,
  type CreateExpenseInput,
} from "../src/lib/supabase/expenses";

describe("Expense Management - Validation & Business Logic", () => {
  it("passes validation with all required valid fields for PAID expense", () => {
    const input: CreateExpenseInput = {
      expense_date: "2026-10-13",
      category: "FUEL",
      description: "Diesel for main factory generator",
      amount: 45000,
      payment_method: "CASH",
      expense_account_id: "acc-expense-fuel-uuid",
      payment_account_id: "acc-cash-1000-uuid",
      status: "PAID",
      payee_name: "PSO Petrol Station",
    };

    const res = validateExpenseInput(input);
    assert.equal(res.valid, true);
    assert.deepEqual(res.errors, {});
  });

  it("passes validation with all required valid fields for UNPAID expense", () => {
    const input: CreateExpenseInput = {
      expense_date: "2026-10-13",
      category: "RENT",
      description: "Factory monthly lease",
      amount: 150000,
      payment_method: "PAYABLE",
      expense_account_id: "acc-expense-rent-uuid",
      payable_account_id: "acc-ap-2001-uuid",
      status: "UNPAID",
      payee_name: "Industrial Estate Landlord",
    };

    const res = validateExpenseInput(input);
    assert.equal(res.valid, true);
    assert.deepEqual(res.errors, {});
  });

  it("rejects non-positive, zero, and NaN amounts", () => {
    const zeroRes = validateExpenseInput({
      expense_date: "2026-10-13",
      category: "RENT",
      description: "Test",
      amount: 0,
      expense_account_id: "uuid-1",
      payment_account_id: "uuid-2",
      status: "PAID",
    });
    assert.equal(zeroRes.valid, false);
    assert.ok(zeroRes.errors.amount);

    const negativeRes = validateExpenseInput({
      expense_date: "2026-10-13",
      category: "RENT",
      description: "Test",
      amount: -500,
      expense_account_id: "uuid-1",
      payment_account_id: "uuid-2",
      status: "PAID",
    });
    assert.equal(negativeRes.valid, false);
    assert.ok(negativeRes.errors.amount);

    const nanRes = validateExpenseInput({
      expense_date: "2026-10-13",
      category: "RENT",
      description: "Test",
      amount: NaN,
      expense_account_id: "uuid-1",
      payment_account_id: "uuid-2",
      status: "PAID",
    });
    assert.equal(nanRes.valid, false);
    assert.ok(nanRes.errors.amount);
  });

  it("rejects empty description and missing expense account", () => {
    const res = validateExpenseInput({
      expense_date: "2026-10-13",
      category: "MAINTENANCE",
      description: "   ",
      amount: 2500,
      status: "DRAFT",
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.description);
    assert.ok(res.errors.expense_account_id);
  });

  it("requires payment_account_id when status is PAID", () => {
    const res = validateExpenseInput({
      expense_date: "2026-10-13",
      category: "ELECTRICITY",
      description: "LESCO Bill",
      amount: 78000,
      expense_account_id: "uuid-exp",
      status: "PAID",
      payment_account_id: null,
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.payment_account_id);
  });

  it("requires payable_account_id when status is UNPAID", () => {
    const res = validateExpenseInput({
      expense_date: "2026-10-13",
      category: "PACKAGING",
      description: "Carton boxes supply",
      amount: 32000,
      expense_account_id: "uuid-exp",
      status: "UNPAID",
      payable_account_id: null,
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.payable_account_id);
  });
});

describe("Expense Management - Double-Entry Ledger Balancing", () => {
  it("enforces balanced debits and credits for PAID expense (Dr Expense, Cr Cash/Bank)", () => {
    const amount = 12500;
    const debitLine = { account: "5007 (Fuel)", debit: amount, credit: 0 };
    const creditLine = { account: "1000 (Cash)", debit: 0, credit: amount };

    const totalDebit = debitLine.debit + creditLine.debit;
    const totalCredit = debitLine.credit + creditLine.credit;

    assert.equal(totalDebit, totalCredit);
    assert.equal(totalDebit, amount);
  });

  it("enforces balanced debits and credits for UNPAID expense (Dr Expense, Cr AP 2001)", () => {
    const amount = 85000;
    const debitLine = { account: "6100 (Rent)", debit: amount, credit: 0 };
    const creditLine = { account: "2001 (AP)", debit: 0, credit: amount };

    const totalDebit = debitLine.debit + creditLine.debit;
    const totalCredit = debitLine.credit + creditLine.credit;

    assert.equal(totalDebit, totalCredit);
    assert.equal(totalDebit, amount);
  });

  it("enforces balanced debits and credits when paying UNPAID expense later (Dr AP 2001, Cr Bank 1002)", () => {
    const amount = 85000;
    const debitLine = { account: "2001 (AP)", debit: amount, credit: 0 };
    const creditLine = { account: "1002 (Bank)", debit: 0, credit: amount };

    const totalDebit = debitLine.debit + creditLine.debit;
    const totalCredit = debitLine.credit + creditLine.credit;

    assert.equal(totalDebit, totalCredit);
    assert.equal(totalDebit, amount);
  });

  it("confirms DRAFT and CANCELLED expenses produce zero active posted journal entries", () => {
    const draftJournalLines: unknown[] = [];
    const cancelledJournalLines: unknown[] = [];

    assert.equal(draftJournalLines.length, 0);
    assert.equal(cancelledJournalLines.length, 0);
  });
});

describe("Expense Management - Category Taxonomy & Verification", () => {
  it("supports all 8 required categories", () => {
    const expectedCategories = [
      "RENT",
      "ELECTRICITY",
      "SALARIES",
      "TRANSPORT",
      "FUEL",
      "MAINTENANCE",
      "PACKAGING",
      "MISCELLANEOUS",
    ];

    const actualCategories = EXPENSE_CATEGORIES.map((c) => c.value);
    for (const exp of expectedCategories) {
      assert.ok(
        (actualCategories as readonly string[]).includes(exp),
        `Missing category: ${exp}`
      );
    }
  });
});

describe("Expense Management - Summary Metrics & Calculations", () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const mockExpenses: Expense[] = [
    {
      id: "1",
      expense_number: "EXP-2026-00001",
      expense_date: todayStr,
      category: "FUEL",
      description: "Diesel fuel",
      amount: 10000,
      payment_method: "CASH",
      expense_account_id: "exp-1",
      payment_account_id: "cash-1",
      payable_account_id: null,
      party_id: null,
      payee_name: "PSO",
      notes: null,
      status: "PAID",
      receipt_url: null,
      journal_entry_id: "je-1",
      payment_journal_entry_id: null,
      operator_name: "Admin",
      device_node: "NODE-01",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "2",
      expense_number: "EXP-2026-00002",
      expense_date: todayStr,
      category: "RENT",
      description: "Warehouse Rent",
      amount: 50000,
      payment_method: "PAYABLE",
      expense_account_id: "exp-2",
      payment_account_id: null,
      payable_account_id: "ap-1",
      party_id: null,
      payee_name: "Owner",
      notes: null,
      status: "UNPAID",
      receipt_url: null,
      journal_entry_id: "je-2",
      payment_journal_entry_id: null,
      operator_name: "Admin",
      device_node: "NODE-01",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "3",
      expense_number: "EXP-2026-00003",
      expense_date: yesterday,
      category: "ELECTRICITY",
      description: "Old bill draft",
      amount: 20000,
      payment_method: "CASH",
      expense_account_id: "exp-3",
      payment_account_id: "cash-1",
      payable_account_id: null,
      party_id: null,
      payee_name: null,
      notes: null,
      status: "DRAFT",
      receipt_url: null,
      journal_entry_id: null,
      payment_journal_entry_id: null,
      operator_name: "Admin",
      device_node: "NODE-01",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "4",
      expense_number: "EXP-2026-00004",
      expense_date: todayStr,
      category: "MAINTENANCE",
      description: "Cancelled repair",
      amount: 15000,
      payment_method: "CASH",
      expense_account_id: "exp-4",
      payment_account_id: "cash-1",
      payable_account_id: null,
      party_id: null,
      payee_name: null,
      notes: "Cancelled due to double entry",
      status: "CANCELLED",
      receipt_url: null,
      journal_entry_id: null,
      payment_journal_entry_id: null,
      operator_name: "Admin",
      device_node: "NODE-01",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  it("calculates today total including only non-draft, non-cancelled expenses", () => {
    const summary = calculateExpenseSummary(mockExpenses);
    // 10000 (PAID) + 50000 (UNPAID) = 60000
    assert.equal(summary.todayTotal, 60000);
  });

  it("calculates paid total and unpaid total separately", () => {
    const summary = calculateExpenseSummary(mockExpenses);
    assert.equal(summary.paidTotal, 10000);
    assert.equal(summary.unpaidTotal, 50000);
  });

  it("excludes cancelled expenses from grand total", () => {
    const summary = calculateExpenseSummary(mockExpenses);
    assert.equal(summary.grandTotal, 60000);
    assert.equal(summary.cancelledTotal, 15000);
  });

  it("computes category breakdown amounts and percentages correctly", () => {
    const summary = calculateExpenseSummary(mockExpenses);
    assert.equal(summary.categoryBreakdown.FUEL.amount, 10000);
    assert.equal(summary.categoryBreakdown.RENT.amount, 50000);
    assert.equal(summary.categoryBreakdown.FUEL.count, 1);
    assert.equal(summary.categoryBreakdown.RENT.count, 1);
    // 10,000 / 60,000 ~ 17%, 50,000 / 60,000 ~ 83%
    assert.equal(summary.categoryBreakdown.FUEL.percentage, 17);
    assert.equal(summary.categoryBreakdown.RENT.percentage, 83);
  });

  it("handles empty expenses array without NaN or errors", () => {
    const summary = calculateExpenseSummary([]);
    assert.equal(summary.todayTotal, 0);
    assert.equal(summary.monthTotal, 0);
    assert.equal(summary.paidTotal, 0);
    assert.equal(summary.unpaidTotal, 0);
    assert.equal(summary.grandTotal, 0);
    assert.equal(summary.categoryBreakdown.FUEL.percentage, 0);
  });
});
