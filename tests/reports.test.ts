import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyReportPreset,
  normalizeReportPeriod,
  inReportPeriod,
  reportSectionVisible,
  resolveReportSections,
  buildExpenseReport,
  computeSalesReport,
  buildPurchaseSection,
  computeSupplierOutstanding,
  buildQuotationReport,
  summarizeLedgerRevenue,
  buildDashboardReports,
  type ReportSections,
} from "../src/lib/supabase/financial-reports";
import type { Expense } from "../src/lib/supabase/expenses";
import type { SalesInvoice, SalesInvoiceItem } from "../src/lib/supabase/invoicing";
import type { ProductPurchase } from "../src/lib/supabase/purchases";
import type { Quotation } from "../src/lib/supabase/quotations";
import type { Party } from "../src/lib/supabase/crm";
import type { PurchaseInvoice } from "../src/lib/supabase/purchase-invoices";
import type { PaymentVoucher } from "../src/lib/supabase/payment-vouchers";
import type { AccountLedgerLine } from "../src/lib/supabase/ledger";
import { DEFAULT_MODULE_VISIBILITY } from "../src/types/settings";

/* ─── Fixtures ────────────────────────────────────────────────────────────── */

const ALL_SECTIONS: ReportSections = {
  sales: true,
  expenses: true,
  purchases: true,
  suppliers: true,
  quotations: true,
  ledger: true,
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const TODAY = new Date().toISOString().slice(0, 10);

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: `exp-${Math.random().toString(36).slice(2)}`,
    expense_number: "EXP-2026-0001",
    expense_date: "2026-10-05",
    category: "FUEL",
    description: "Generator diesel",
    amount: 1000,
    payment_method: "CASH",
    expense_account_id: "acc-expense-uuid",
    payment_account_id: "acc-cash-uuid",
    payable_account_id: null,
    party_id: null,
    payee_name: null,
    notes: null,
    status: "PAID",
    receipt_url: null,
    journal_entry_id: null,
    payment_journal_entry_id: null,
    operator_name: null,
    device_node: null,
    created_at: "2026-10-05T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z",
    ...overrides,
  };
}

function line(overrides: Partial<SalesInvoiceItem> = {}): SalesInvoiceItem {
  return {
    id: "li-1",
    invoice_id: "inv-1",
    product_id: "prod-1",
    product_name: "Basin Mixer",
    quantity: 2,
    unit_price_pkr: 150,
    line_total_pkr: 300,
    unit_of_measure: "PCS",
    ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: `inv-${Math.random().toString(36).slice(2)}`,
    invoice_number: "INV-2026-0001",
    customer_id: "cust-1",
    taxable_value_pkr: 300,
    sales_tax_rate: 0,
    sales_tax_amount_pkr: 0,
    further_tax_rate: 0,
    further_tax_amount_pkr: 0,
    total_invoice_value_pkr: 300,
    is_posted: true,
    created_at: "2026-10-05T10:00:00.000Z",
    items: [line()],
    ...overrides,
  };
}

function purchase(overrides: Partial<ProductPurchase> = {}): ProductPurchase {
  return {
    id: `pur-${Math.random().toString(36).slice(2)}`,
    purchase_number: "PUR-2026-00001",
    purchase_date: "2026-10-01",
    supplier_id: "sup-a",
    supplier_name: "Supplier A",
    product_id: "prod-1",
    product_name: "Basin Mixer",
    sku: "BM-001",
    quantity: 10,
    unit_of_measure: "PCS",
    purchase_rate: 100,
    discount_percent: 0,
    discount_pkr: 0,
    tax_rate: 0,
    tax_amount_pkr: 0,
    additional_cost_pkr: 0,
    purchase_subtotal_pkr: 1000,
    purchase_total_pkr: 1000,
    effective_unit_cost_pkr: 100,
    status: "confirmed",
    inventory_lot_id: null,
    journal_entry_id: null,
    notes: null,
    operator_name: null,
    device_node: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function quotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: `qtn-${Math.random().toString(36).slice(2)}`,
    quotation_number: "QTN-2026-00001",
    quotation_date: "2026-10-05",
    customer_name: "Walk-in Customer",
    status: "ISSUED",
    subtotal_pkr: 1000,
    discount_pkr: 0,
    tax_amount_pkr: 0,
    additional_charges_pkr: 0,
    grand_total_pkr: 1000,
    estimated_cost_pkr: 0,
    estimated_profit_pkr: 0,
    margin_percent: 0,
    created_at: "2026-10-05T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z",
    ...overrides,
  };
}

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: "sup-1",
    name: "Supplier A",
    party_type: "SUPPLIER",
    is_registered: false,
    ...overrides,
  };
}

function purchaseInvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pi-1",
    invoice_number: "PI-2026-0001",
    grn_id: null,
    grn_number: "GRN-1",
    vendor_id: "sup-1",
    vendor_name: "Supplier A",
    taxable_amount: 1000,
    tax_amount: 0,
    total_payable: 1000,
    status: "posted",
    items: [],
    created_at: "2026-10-05T00:00:00Z",
    ...overrides,
  };
}

function voucher(overrides: Partial<PaymentVoucher> = {}): PaymentVoucher {
  return {
    id: "pv-1",
    voucher_no: "CPV-2026-00001",
    voucher_type: "PARTY_PAYMENT",
    voucher_date: "2026-10-06",
    payee_name: "Supplier A",
    payee_address: null,
    cnic_ntn: null,
    purpose: null,
    reference_no: null,
    debit_account_id: null,
    credit_account_id: null,
    amount: 400,
    amount_in_words: "",
    remarks: null,
    created_by: null,
    created_at: "2026-10-06T00:00:00Z",
    ...overrides,
  };
}

function ledgerLine(overrides: Partial<AccountLedgerLine> = {}): AccountLedgerLine {
  return {
    id: "jl-1",
    journal_entry_id: "je-1",
    account_id: "acc-4001-uuid",
    debit_pkr: 0,
    credit_pkr: 100,
    entry_date: "2026-10-05",
    entry_number: "JE-2026-0001",
    narration: "Sales",
    status: "POSTED",
    created_at: "2026-10-05T00:00:00Z",
    customer_name: null,
    ...overrides,
  };
}

/* ─── Period presets & date filters ───────────────────────────────────────── */

describe("Financial reports - period presets & date filters", () => {
  it("TODAY pins both bounds to the UTC calendar day", () => {
    assert.deepEqual(applyReportPreset("TODAY", "2026-10-13"), {
      startDate: "2026-10-13",
      endDate: "2026-10-13",
    });
  });

  it("THIS_MONTH spans the 1st → today", () => {
    assert.deepEqual(applyReportPreset("THIS_MONTH", "2026-10-13"), {
      startDate: "2026-10-01",
      endDate: "2026-10-13",
    });
  });

  it("LAST_30_DAYS spans exactly 30 UTC days and crosses month boundaries", () => {
    assert.deepEqual(applyReportPreset("LAST_30_DAYS", "2026-10-13"), {
      startDate: "2026-09-13",
      endDate: "2026-10-13",
    });
    // 2026 is not a leap year: 2026-03-05 − 30d = 2026-02-03
    assert.deepEqual(applyReportPreset("LAST_30_DAYS", "2026-03-05"), {
      startDate: "2026-02-03",
      endDate: "2026-03-05",
    });
  });

  it("ALL is unbounded (matches the expenses page 'All Time')", () => {
    assert.deepEqual(applyReportPreset("ALL"), {});
  });

  it("normalizeReportPeriod trims inputs and turns blanks into no bound", () => {
    assert.deepEqual(normalizeReportPeriod(" 2026-10-01 ", ""), {
      startDate: "2026-10-01",
    });
    assert.deepEqual(normalizeReportPeriod("", undefined), {});
    assert.deepEqual(normalizeReportPeriod(null, "2026-10-31"), {
      endDate: "2026-10-31",
    });
  });

  it("inReportPeriod is inclusive on both bounds", () => {
    const period = { startDate: "2026-10-01", endDate: "2026-10-31" };
    assert.equal(inReportPeriod("2026-10-01", period), true);
    assert.equal(inReportPeriod("2026-10-31", period), true);
    assert.equal(inReportPeriod("2026-09-30", period), false);
    assert.equal(inReportPeriod("2026-11-01", period), false);
    // ISO timestamps are cut to their calendar day
    assert.equal(inReportPeriod("2026-10-31T23:59:59.000Z", period), true);
  });

  it("missing dates follow the existing page filters", () => {
    assert.equal(inReportPeriod("", {}), true);
    // A start bound excludes undated rows (date >= startDate fails)
    assert.equal(inReportPeriod(null, { startDate: "2026-10-01" }), false);
    // An end bound alone still matches — identical to the expenses page's
    // `if (endDate) date <= endDate` filter
    assert.equal(inReportPeriod(undefined, { endDate: "2026-10-31" }), true);
  });
});

/* ─── Expenses ────────────────────────────────────────────────────────────── */

describe("Financial reports - expenses", () => {
  it("empty dataset produces all zeros and no category rows", () => {
    const r = buildExpenseReport([]);
    assert.equal(r.todayTotal, 0);
    assert.equal(r.monthTotal, 0);
    assert.equal(r.periodTotal, 0);
    assert.equal(r.periodCount, 0);
    assert.equal(r.periodPaidTotal, 0);
    assert.equal(r.periodUnpaidTotal, 0);
    assert.equal(r.periodDraftTotal, 0);
    assert.equal(r.periodCancelledTotal, 0);
    assert.deepEqual(r.categoryRows, []);
  });

  it("today / this-month totals come from the whole dataset, independent of the period", () => {
    const expenses = [
      expense({ expense_date: TODAY, amount: 500, status: "PAID" }),
      expense({ expense_date: TODAY, amount: 300, status: "UNPAID" }),
      expense({ expense_date: "2000-01-15", amount: 1000 }),
    ];
    const r = buildExpenseReport(expenses, {
      startDate: "2000-01-01",
      endDate: "2000-01-31",
    });
    assert.equal(r.todayTotal, 800);
    assert.equal(r.monthTotal, 800); // TODAY is always in the current month
    assert.equal(r.periodTotal, 1000); // the selected period is Jan 2000
  });

  it("today / month totals skip DRAFT and CANCELLED expenses", () => {
    const expenses = [
      expense({ expense_date: TODAY, amount: 100, status: "DRAFT" }),
      expense({ expense_date: TODAY, amount: 200, status: "CANCELLED" }),
      expense({ expense_date: TODAY, amount: 400, status: "PAID" }),
    ];
    const r = buildExpenseReport(expenses);
    assert.equal(r.todayTotal, 400);
    assert.equal(r.monthTotal, 400);
  });

  it("period totals exclude DRAFT and CANCELLED, but report them separately", () => {
    const expenses = [
      expense({ amount: 100, status: "PAID" }),
      expense({ amount: 200, status: "UNPAID" }),
      expense({ amount: 50, status: "DRAFT" }),
      expense({ amount: 70, status: "CANCELLED" }),
      expense({ amount: 999, expense_date: "2026-11-30" }), // outside period
    ];
    const r = buildExpenseReport(expenses, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    assert.equal(r.periodTotal, 300);
    assert.equal(r.periodPaidTotal, 100);
    assert.equal(r.periodUnpaidTotal, 200);
    assert.equal(r.periodDraftTotal, 50);
    assert.equal(r.periodCancelledTotal, 70);
    assert.equal(r.periodCount, 3); // paid + unpaid + draft (cancelled dropped)
    assert.equal(r2(r.periodPaidTotal + r.periodUnpaidTotal), r.periodTotal);
  });

  it("category rows sum exactly to the period total (dashboard ↔ detail reconciliation)", () => {
    const expenses = [
      expense({ category: "FUEL", amount: 123.45 }),
      expense({ category: "RENT", amount: 76.55 }),
      expense({ category: "TRANSPORT", amount: 50 }),
      expense({ category: "FUEL", amount: 50, status: "DRAFT" }), // not in breakdown
      expense({ category: "RENT", amount: 999, status: "CANCELLED" }), // not in breakdown
    ];
    const r = buildExpenseReport(expenses, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    assert.equal(r.periodTotal, 250);
    const sum = r.categoryRows.reduce((s, row) => s + row.amount, 0);
    assert.equal(r2(sum), r.periodTotal);
    const counts = r.categoryRows.reduce((s, row) => s + row.count, 0);
    assert.equal(counts, 3);
    // zero categories are omitted
    assert.ok(r.categoryRows.every((row) => row.amount > 0));
    assert.deepEqual(
      r.categoryRows.map((row) => row.category),
      ["FUEL", "RENT", "TRANSPORT"], // amount desc: 123.45, 76.55, 50
    );
  });

  it("category percentages are rounded shares of the period total", () => {
    const expenses = [
      expense({ category: "FUEL", amount: 500 }),
      expense({ category: "RENT", amount: 250 }),
      expense({ category: "TRANSPORT", amount: 250 }),
    ];
    const r = buildExpenseReport(expenses, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    assert.equal(r.periodTotal, 1000);
    const pct = Object.fromEntries(
      r.categoryRows.map((row) => [row.category, row.percentage]),
    );
    assert.equal(pct.FUEL, 50);
    assert.equal(pct.RENT, 25);
    assert.equal(pct.TRANSPORT, 25);
  });
});

/* ─── Sales, COGS and margin ──────────────────────────────────────────────── */

describe("Financial reports - sales, COGS & margin", () => {
  it("empty dataset → zeros; without cost data every cost field stays null", () => {
    const noCosts = computeSalesReport([], {});
    assert.equal(noCosts.posted_invoice_count, 0);
    assert.equal(noCosts.revenue_excl_tax, 0);
    assert.equal(noCosts.sales_tax, 0);
    assert.equal(noCosts.total_invoice_value, 0);
    assert.equal(noCosts.cogs, null);
    assert.equal(noCosts.gross_profit, null);
    assert.equal(noCosts.gross_margin_percent, null);
    assert.equal(noCosts.markup_percent, null);

    const withCosts = computeSalesReport([], {}, new Map());
    assert.equal(withCosts.cogs, 0);
    assert.equal(withCosts.gross_profit, 0);
    assert.equal(withCosts.gross_margin_percent, 0);
    assert.equal(withCosts.markup_percent, 0);
  });

  it("revenue excludes sales tax and further tax, and reconciles to the document total", () => {
    const r = computeSalesReport(
      [
        invoice({
          taxable_value_pkr: 300,
          sales_tax_amount_pkr: 45,
          further_tax_amount_pkr: 30,
          total_invoice_value_pkr: 375,
        }),
      ],
      {},
    );
    assert.equal(r.revenue_excl_tax, 300);
    assert.equal(r.sales_tax, 45);
    assert.equal(r.further_tax, 30);
    assert.equal(r.tax_total, 75);
    assert.equal(r.total_invoice_value, 375);
    assert.equal(r2(r.revenue_excl_tax + r.tax_total), r.total_invoice_value);
  });

  it("only posted invoices become revenue (drafts never count)", () => {
    const r = computeSalesReport(
      [invoice({ is_posted: false, taxable_value_pkr: 5000, total_invoice_value_pkr: 5000 })],
      {},
    );
    assert.equal(r.posted_invoice_count, 0);
    assert.equal(r.revenue_excl_tax, 0);
    assert.equal(r.total_invoice_value, 0);
  });

  it("the period filter uses the invoice date inclusively", () => {
    const invoices = [
      invoice({ created_at: "2026-09-30T23:59:00.000Z", taxable_value_pkr: 100, total_invoice_value_pkr: 100 }),
      invoice({ created_at: "2026-10-01T00:00:00.000Z", taxable_value_pkr: 200, total_invoice_value_pkr: 200 }),
      invoice({ created_at: "2026-10-31T12:00:00.000Z", taxable_value_pkr: 400, total_invoice_value_pkr: 400 }),
      invoice({ created_at: "2026-11-01T00:00:00.000Z", taxable_value_pkr: 800, total_invoice_value_pkr: 800 }),
    ];
    const r = computeSalesReport(invoices, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    assert.equal(r.posted_invoice_count, 2);
    assert.equal(r.revenue_excl_tax, 600);
  });

  it("canonical example: 10 units @ Rs.100 bought, 2 sold @ Rs.150 → revenue 300, COGS 200, profit 100, margin 33.33%, markup 50%", () => {
    const purchases = [
      purchase({
        quantity: 10,
        purchase_rate: 100,
        purchase_subtotal_pkr: 1000,
        purchase_total_pkr: 1000,
      }),
    ];
    const costs = new Map([["prod-1", 100]]);
    const sales = computeSalesReport(
      [
        invoice({
          taxable_value_pkr: 300,
          total_invoice_value_pkr: 300,
          items: [line({ quantity: 2, unit_price_pkr: 150, line_total_pkr: 300 })],
        }),
      ],
      {},
      costs,
    );
    const purchaseSection = buildPurchaseSection(purchases, {});

    assert.equal(sales.revenue_excl_tax, 300);
    assert.equal(sales.cogs, 200);
    assert.equal(sales.gross_profit, 100);
    assert.equal(sales.gross_margin_percent, 33.33);
    assert.equal(sales.markup_percent, 50);

    // Rule 2: total purchases (1000) are NOT cost of goods sold (200)
    assert.equal(purchaseSection.totals.total_purchase_pkr, 1000);
    assert.notEqual(purchaseSection.totals.total_purchase_pkr, sales.cogs);
    // and purchases ≠ revenue either
    assert.notEqual(purchaseSection.totals.total_purchase_pkr, sales.revenue_excl_tax);
  });

  it("lines without cost data are counted instead of silently priced at zero", () => {
    const r = computeSalesReport(
      [
        invoice({
          items: [
            line({ product_id: "prod-1", quantity: 2 }),
            line({ product_id: "prod-unknown", quantity: 5, product_name: "Mystery Part" }),
          ],
        }),
      ],
      {},
      new Map([["prod-1", 100]]),
    );
    assert.equal(r.cogs, 200);
    assert.equal(r.unpriced_line_count, 1);
    assert.equal(r.unpriced_qty, 5);
  });

  it("money and percentages round to 2 decimals", () => {
    const r = computeSalesReport(
      [
        invoice({
          taxable_value_pkr: 100,
          total_invoice_value_pkr: 100,
          items: [line({ quantity: 1, unit_price_pkr: 100, line_total_pkr: 100 })],
        }),
      ],
      {},
      new Map([["prod-1", 33.34]]),
    );
    assert.equal(r.cogs, 33.34);
    assert.equal(r.gross_profit, 66.66);
    assert.equal(r.gross_margin_percent, 66.66);
    assert.equal(r.markup_percent, 199.94);
  });

  it("zero revenue never divides by zero", () => {
    const r = computeSalesReport([invoice({ taxable_value_pkr: 0, total_invoice_value_pkr: 0 })], {}, new Map([["prod-1", 100]]));
    assert.equal(r.revenue_excl_tax, 0);
    assert.equal(r.gross_margin_percent, 0);
    const zeroCogs = computeSalesReport([], {}, new Map());
    assert.equal(zeroCogs.markup_percent, 0);
  });
});

/* ─── Purchases section ───────────────────────────────────────────────────── */

describe("Financial reports - purchases section", () => {
  it("period filter applies and cancelled purchases never hit the totals", () => {
    const purchases = [
      purchase({ purchase_date: "2026-10-02", purchase_total_pkr: 1000 }),
      purchase({ purchase_date: "2026-10-03", purchase_total_pkr: 500, status: "cancelled" }),
      purchase({ purchase_date: "2026-10-04", purchase_total_pkr: 200, status: "draft" }),
      purchase({ purchase_date: "2026-09-15", purchase_total_pkr: 9999 }),
    ];
    const r = buildPurchaseSection(purchases, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    assert.equal(r.totals.total_purchase_pkr, 1200); // 1000 confirmed + 200 draft
    assert.equal(r.totals.purchase_count, 2);
  });

  it("supplier and product rows reconcile with the grand totals", () => {
    const purchases = [
      purchase({ supplier_id: "sup-a", supplier_name: "Supplier A", product_id: "prod-1", quantity: 10, purchase_total_pkr: 1000, purchase_subtotal_pkr: 1000 }),
      purchase({ supplier_id: "sup-b", supplier_name: "Supplier B", product_id: "prod-1", quantity: 5, purchase_total_pkr: 600, purchase_subtotal_pkr: 600 }),
      purchase({ supplier_id: "sup-a", supplier_name: "Supplier A", product_id: "prod-2", quantity: 2, purchase_total_pkr: 250, purchase_subtotal_pkr: 250 }),
    ];
    const r = buildPurchaseSection(purchases, {});
    const bySupplierSum = r.bySupplier.reduce((s, row) => s + row.total_purchase_pkr, 0);
    const byProductSum = r.byProduct.reduce((s, row) => s + row.total_purchase_pkr, 0);
    assert.equal(r2(bySupplierSum), r.totals.total_purchase_pkr);
    assert.equal(r2(byProductSum), r.totals.total_purchase_pkr);
    assert.equal(r.totals.total_purchase_pkr, 1850);
    assert.equal(r.bySupplier.length, 2);
    assert.equal(r.byProduct.length, 2);
  });
});

/* ─── Supplier outstanding ────────────────────────────────────────────────── */

describe("Financial reports - supplier outstanding balances", () => {
  it("empty inputs → zero total and no rows", () => {
    const r = computeSupplierOutstanding([], [], []);
    assert.deepEqual(r.rows, []);
    assert.equal(r.total_outstanding_pkr, 0);
    assert.equal(r.supplier_count, 0);
  });

  it("outstanding = purchase invoices − payments, with CRM's status and name-matching rules", () => {
    const parties = [
      party({ id: "sup-1", name: "Supplier A" }),
      party({ id: "cust-1", name: "Regular Customer", party_type: "CUSTOMER" }),
      party({ id: "sup-2", name: "Supplier B" }), // no documents → skipped
      party({ id: "both-1", name: "Dual Party", party_type: "BOTH" }),
    ];
    const invoices = [
      purchaseInvoice({ id: "pi-1", vendor_id: "sup-1", total_payable: 1000, status: "posted" }),
      purchaseInvoice({ id: "pi-2", vendor_id: "sup-1", total_payable: 500, status: "pending_approval" }),
      purchaseInvoice({ id: "pi-3", vendor_id: "sup-1", total_payable: 9999, status: "cancelled" }),
      purchaseInvoice({ id: "pi-4", vendor_id: "cust-1", total_payable: 700, status: "posted" }), // customer vendor? excluded below only if not supplier party — cust-1 is CUSTOMER → not in rows
      purchaseInvoice({ id: "pi-5", vendor_id: "both-1", total_payable: 300, status: "posted" }),
    ];
    const vouchers = [
      // case-insensitive match against "Supplier A" (vouchers carry no party FK)
      voucher({ id: "pv-1", payee_name: "supplier a", amount: 400 }),
      voucher({ id: "pv-2", payee_name: "Regular Customer", amount: 100 }), // customer voucher ignored
      voucher({ id: "pv-3", payee_name: "Dual Party", amount: 100 }),
    ];

    const r = computeSupplierOutstanding(parties, invoices, vouchers);
    const rowsById = Object.fromEntries(r.rows.map((row) => [row.party_id, row]));

    assert.equal(rowsById["sup-1"].invoice_count, 2);
    assert.equal(rowsById["sup-1"].total_invoice_value_pkr, 1500);
    assert.equal(rowsById["sup-1"].total_paid_pkr, 400);
    assert.equal(rowsById["sup-1"].outstanding_balance_pkr, 1100);

    // BOTH parties are suppliers too
    assert.equal(rowsById["both-1"].outstanding_balance_pkr, 200);

    // pure customers never appear in the supplier report
    assert.equal(rowsById["cust-1"], undefined);
    assert.equal(rowsById["sup-2"], undefined);

    assert.equal(r.supplier_count, 2);
    assert.equal(r.total_outstanding_pkr, 1300);
    assert.equal(
      r2(r.rows.reduce((s, row) => s + row.outstanding_balance_pkr, 0)),
      r.total_outstanding_pkr,
    );
  });

  it("an overpaid supplier shows a negative (Cr) balance", () => {
    const r = computeSupplierOutstanding(
      [party({ id: "sup-1", name: "Supplier A" })],
      [purchaseInvoice({ vendor_id: "sup-1", total_payable: 1000 })],
      [voucher({ payee_name: "Supplier A", amount: 1500 })],
    );
    assert.equal(r.rows[0].outstanding_balance_pkr, -500);
    assert.equal(r.total_outstanding_pkr, -500);
  });

  it("opening balances do not distort the outstanding figure (same as the CRM drawer)", () => {
    const withoutOpening = computeSupplierOutstanding(
      [party({ id: "sup-1", name: "Supplier A" })],
      [purchaseInvoice({ vendor_id: "sup-1", total_payable: 1000 })],
      [],
    );
    const withOpening = computeSupplierOutstanding(
      [party({ id: "sup-1", name: "Supplier A", opening_balance: 250, opening_balance_type: "Cr" })],
      [purchaseInvoice({ vendor_id: "sup-1", total_payable: 1000 })],
      [],
    );
    assert.equal(withOpening.rows[0].outstanding_balance_pkr, withoutOpening.rows[0].outstanding_balance_pkr);
    assert.equal(withOpening.total_outstanding_pkr, 1000);
  });

  it("rows sort by outstanding, descending", () => {
    const r = computeSupplierOutstanding(
      [
        party({ id: "sup-1", name: "Small" }),
        party({ id: "sup-2", name: "Large" }),
      ],
      [
        purchaseInvoice({ id: "pi-1", vendor_id: "sup-1", total_payable: 100 }),
        purchaseInvoice({ id: "pi-2", vendor_id: "sup-2", total_payable: 900 }),
      ],
      [],
    );
    assert.deepEqual(
      r.rows.map((row) => row.party_name),
      ["Large", "Small"],
    );
  });
});

/* ─── Quotations ──────────────────────────────────────────────────────────── */

describe("Financial reports - quotations", () => {
  it("empty dataset → all zeros including a 0% conversion rate", () => {
    const r = buildQuotationReport([]);
    assert.equal(r.total_count, 0);
    assert.equal(r.total_value_pkr, 0);
    assert.equal(r.accepted_value_pkr, 0);
    assert.equal(r.converted_count, 0);
    assert.equal(r.sent_count, 0);
    assert.equal(r.conversion_rate_percent, 0);
  });

  it("status counts, quoted value (cancelled excluded) and accepted value", () => {
    const quotations = [
      quotation({ status: "DRAFT", grand_total_pkr: 1000 }),
      quotation({ status: "ISSUED", grand_total_pkr: 2000 }),
      quotation({ status: "ACCEPTED", grand_total_pkr: 3000 }),
      quotation({ status: "REJECTED", grand_total_pkr: 500 }),
      quotation({ status: "EXPIRED", grand_total_pkr: 400 }),
      quotation({ status: "CANCELLED", grand_total_pkr: 99999 }),
    ];
    const r = buildQuotationReport(quotations);
    assert.equal(r.total_count, 6);
    assert.equal(r.draft_count, 1);
    assert.equal(r.issued_count, 1);
    assert.equal(r.accepted_count, 1);
    assert.equal(r.rejected_count, 1);
    assert.equal(r.expired_count, 1);
    assert.equal(r.cancelled_count, 1);
    assert.equal(r.total_value_pkr, 6900); // 1000+2000+3000+500+400
    assert.equal(r.accepted_value_pkr, 3000);
  });

  it("conversion rate = converted ÷ issued (drafts are not part of the denominator)", () => {
    const quotations = [
      quotation({ status: "ACCEPTED", grand_total_pkr: 1500, converted_invoice_id: "inv-1" }),
      quotation({ status: "ISSUED", grand_total_pkr: 2500, converted_invoice_id: "inv-2" }),
      quotation({ status: "ISSUED", grand_total_pkr: 3000 }),
      quotation({ status: "REJECTED", grand_total_pkr: 1000 }),
      quotation({ status: "DRAFT", grand_total_pkr: 500 }), // never sent
    ];
    const r = buildQuotationReport(quotations);
    assert.equal(r.sent_count, 4);
    assert.equal(r.converted_count, 2);
    assert.equal(r.conversion_rate_percent, 50);
    assert.equal(r.converted_value_pkr, 4000);
  });

  it("all-draft datasets cannot divide by zero", () => {
    const r = buildQuotationReport([quotation({ status: "DRAFT" })]);
    assert.equal(r.sent_count, 0); // drafts were never sent
    assert.equal(r.converted_count, 0);
    assert.equal(r.conversion_rate_percent, 0);
    const rTwoDrafts = buildQuotationReport([
      quotation({ status: "DRAFT" }),
      quotation({ status: "DRAFT" }),
    ]);
    assert.equal(rTwoDrafts.sent_count, 0);
    assert.equal(rTwoDrafts.conversion_rate_percent, 0);
  });

  it("the period filters on quotation_date", () => {
    const quotations = [
      quotation({ quotation_date: "2026-09-30", grand_total_pkr: 100 }),
      quotation({ quotation_date: "2026-10-01", grand_total_pkr: 200 }),
      quotation({ quotation_date: "2026-10-31", grand_total_pkr: 400 }),
      quotation({ quotation_date: "2026-11-01", grand_total_pkr: 800 }),
    ];
    const r = buildQuotationReport(quotations, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    assert.equal(r.total_count, 2);
    assert.equal(r.total_value_pkr, 600);
  });

  it("rule 1: quoted value never leaks into revenue, even for accepted quotations", () => {
    const reports = buildDashboardReports(
      {
        invoices: [],
        quotations: [
          quotation({ status: "ACCEPTED", grand_total_pkr: 50000 }),
        ],
      },
      { sections: ALL_SECTIONS, costsById: new Map() },
    );
    assert.equal(reports.sales!.revenue_excl_tax, 0);
    assert.equal(reports.sales!.posted_invoice_count, 0);
    assert.equal(reports.quotations!.total_value_pkr, 50000);
    assert.equal(reports.quotations!.accepted_value_pkr, 50000);
    assert.equal(reports.quotations!.converted_count, 0);
    assert.equal(reports.quotations!.conversion_rate_percent, 0);
  });
});

/* ─── Ledger cross-check ──────────────────────────────────────────────────── */

describe("Financial reports - ledger revenue cross-check", () => {
  it("posted credit − debit inside the period; drafts and other periods ignored", () => {
    const lines = [
      ledgerLine({ id: "l1", credit_pkr: 1000, debit_pkr: 0, entry_date: "2026-10-05" }),
      ledgerLine({ id: "l2", credit_pkr: 0, debit_pkr: 200, entry_date: "2026-10-10" }),
      ledgerLine({ id: "l3", credit_pkr: 500, debit_pkr: 0, entry_date: "2026-09-30" }),
      ledgerLine({ id: "l4", credit_pkr: 9999, debit_pkr: 0, entry_date: "2026-10-20", status: "DRAFT" }),
    ];
    const r = summarizeLedgerRevenue(lines, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    assert.equal(r.revenue_pkr, 800);
    assert.equal(r.line_count, 2);
  });

  it("unbounded period sums every posted line; empty input is zero", () => {
    const lines = [
      ledgerLine({ id: "l1", credit_pkr: 300, entry_date: "2026-01-01" }),
      ledgerLine({ id: "l2", credit_pkr: 700, entry_date: "2026-12-31" }),
      ledgerLine({ id: "l3", credit_pkr: 400, debit_pkr: 400, entry_date: "2026-06-01" }),
    ];
    assert.equal(summarizeLedgerRevenue(lines).revenue_pkr, 1000);
    assert.equal(summarizeLedgerRevenue([]).revenue_pkr, 0);
    assert.equal(summarizeLedgerRevenue([]).line_count, 0);
  });
});

/* ─── Permissions & section gating ────────────────────────────────────────── */

describe("Financial reports - permissions & section gating", () => {
  it("every section maps to the module that owns it", () => {
    const hidden = {
      ...DEFAULT_MODULE_VISIBILITY,
      invoicing: false,
      expenses: false,
      catalog: false,
      crm: false,
      quotations: false,
      ledger: false,
    };
    assert.equal(reportSectionVisible("sales", hidden), false);
    assert.equal(reportSectionVisible("expenses", hidden), false);
    assert.equal(reportSectionVisible("purchases", hidden), false);
    assert.equal(reportSectionVisible("suppliers", hidden), false);
    assert.equal(reportSectionVisible("quotations", hidden), false);
    assert.equal(reportSectionVisible("ledger", hidden), false);

    const shown = { ...DEFAULT_MODULE_VISIBILITY };
    assert.equal(reportSectionVisible("sales", shown), true);
    assert.equal(reportSectionVisible("expenses", shown), true);
    assert.equal(reportSectionVisible("purchases", shown), true);
    assert.equal(reportSectionVisible("suppliers", shown), true);
    assert.equal(reportSectionVisible("quotations", shown), true);
    assert.equal(reportSectionVisible("ledger", shown), true);
  });

  it("missing visibility info fails open (matches the settings sanitizer default)", () => {
    assert.equal(reportSectionVisible("sales", undefined), true);
    assert.equal(reportSectionVisible("sales", null), true);
    assert.equal(reportSectionVisible("expenses", {}), true);
  });

  it("resolveReportSections mirrors the visibility map", () => {
    const sections = resolveReportSections({
      ...DEFAULT_MODULE_VISIBILITY,
      expenses: false,
      quotations: false,
    });
    assert.deepEqual(sections, {
      sales: true,
      expenses: false,
      purchases: true,
      suppliers: true,
      quotations: false,
      ledger: true,
    });
    assert.deepEqual(resolveReportSections(DEFAULT_MODULE_VISIBILITY), ALL_SECTIONS);
  });

  it("hidden sections are never computed (null), and costs stay null unless requested", () => {
    const reports = buildDashboardReports(
      {
        invoices: [invoice({ taxable_value_pkr: 999, total_invoice_value_pkr: 999 })],
        expenses: [expense({ amount: 500 })],
        purchases: [purchase()],
        suppliers: {
          parties: [party()],
          purchaseInvoices: [purchaseInvoice()],
          paymentVouchers: [],
        },
        quotations: [quotation()],
        ledgerLines: [ledgerLine()],
      },
      {
        sections: { ...ALL_SECTIONS, expenses: false, suppliers: false },
      },
    );
    assert.equal(reports.expenses, null);
    assert.equal(reports.suppliers, null);
    assert.ok(reports.sales);
    assert.ok(reports.purchases);
    assert.ok(reports.quotations);
    assert.ok(reports.ledgerRevenue);
    // costs were not requested → owner-only fields are structurally null
    assert.equal(reports.sales!.cogs, null);
    assert.equal(reports.sales!.gross_profit, null);
    assert.equal(reports.sales!.gross_margin_percent, null);
    assert.equal(reports.sales!.markup_percent, null);
  });

  it("a failed supplier fetch (null bundle) does not break the rest of the report", () => {
    const reports = buildDashboardReports(
      {
        invoices: [invoice()],
        suppliers: null,
      },
      { sections: ALL_SECTIONS, costsById: new Map([["prod-1", 100]]) },
    );
    assert.equal(reports.suppliers, null);
    assert.equal(reports.sales!.revenue_excl_tax, 300);
    assert.equal(reports.sales!.cogs, 200);
  });
});

/* ─── Cross-report reconciliation (rule 6) ────────────────────────────────── */

describe("Financial reports - end-to-end reconciliation", () => {
  it("dashboard totals reconcile across expenses, purchases, sales, suppliers and quotations", () => {
    const period = { startDate: "2026-10-01", endDate: "2026-10-31" };

    const invoices = [
      invoice({
        id: "inv-1",
        taxable_value_pkr: 300,
        sales_tax_amount_pkr: 45,
        total_invoice_value_pkr: 345,
        items: [line({ quantity: 2, unit_price_pkr: 150, line_total_pkr: 300 })],
      }),
      invoice({
        id: "inv-2",
        created_at: "2026-10-20T09:00:00.000Z",
        taxable_value_pkr: 500,
        sales_tax_amount_pkr: 75,
        total_invoice_value_pkr: 575,
        items: [line({ id: "li-2", quantity: 3, unit_price_pkr: 166.67, line_total_pkr: 500 })],
      }),
      invoice({
        id: "inv-3",
        created_at: "2026-12-01T09:00:00.000Z", // outside period
        taxable_value_pkr: 10000,
        total_invoice_value_pkr: 10000,
      }),
    ];
    const expenses = [
      expense({ category: "FUEL", amount: 500, status: "PAID" }),
      expense({ category: "RENT", amount: 300, status: "UNPAID" }),
      expense({ category: "MISCELLANEOUS", amount: 50, status: "DRAFT" }),
    ];
    const purchases = [
      purchase({ purchase_date: "2026-10-05", quantity: 10, purchase_total_pkr: 1000, purchase_subtotal_pkr: 1000 }),
      purchase({ purchase_date: "2026-10-06", quantity: 4, purchase_total_pkr: 500, purchase_subtotal_pkr: 500, status: "cancelled" }),
    ];
    const quotations = [
      quotation({ status: "ACCEPTED", grand_total_pkr: 4000, converted_invoice_id: "inv-1" }),
      quotation({ status: "ISSUED", grand_total_pkr: 2000 }),
    ];
    const suppliers = {
      parties: [party({ id: "sup-1", name: "Supplier A" })],
      purchaseInvoices: [purchaseInvoice({ vendor_id: "sup-1", total_payable: 1000 })],
      paymentVouchers: [voucher({ payee_name: "Supplier A", amount: 300 })],
    };
    const ledgerLines = [
      ledgerLine({ id: "l1", credit_pkr: 700, entry_date: "2026-10-05" }),
      ledgerLine({ id: "l2", credit_pkr: 100, debit_pkr: 0, entry_date: "2026-10-25" }),
    ];

    const r = buildDashboardReports(
      { invoices, expenses, purchases, quotations, suppliers, ledgerLines },
      {
        period,
        sections: ALL_SECTIONS,
        costsById: new Map([["prod-1", 100]]),
      },
    );

    // Sales: revenue − COGS = gross profit; revenue + tax = document totals
    const sales = r.sales!;
    assert.equal(sales.posted_invoice_count, 2);
    assert.equal(sales.revenue_excl_tax, 800);
    assert.equal(sales.sales_tax, 120);
    assert.equal(r2(sales.revenue_excl_tax + sales.tax_total), sales.total_invoice_value);
    assert.equal(sales.cogs, 500); // (2 + 3) units × Rs.100 FIFO cost
    assert.equal(sales.gross_profit, 300);
    assert.equal(sales.gross_margin_percent, 37.5);
    assert.equal(sales.markup_percent, 60);

    // Expenses: category rows sum to the period total (draft excluded)
    const exp = r.expenses!;
    assert.equal(exp.periodTotal, 800);
    assert.equal(
      r2(exp.categoryRows.reduce((s, row) => s + row.amount, 0)),
      exp.periodTotal,
    );

    // Purchases: supplier/product rows sum to the totals, and ≠ COGS
    const pur = r.purchases!;
    assert.equal(pur.totals.total_purchase_pkr, 1000);
    assert.equal(
      r2(pur.bySupplier.reduce((s, row) => s + row.total_purchase_pkr, 0)),
      pur.totals.total_purchase_pkr,
    );
    assert.equal(
      r2(pur.byProduct.reduce((s, row) => s + row.total_purchase_pkr, 0)),
      pur.totals.total_purchase_pkr,
    );
    assert.notEqual(pur.totals.total_purchase_pkr, sales.cogs);

    // Suppliers: total = Σ rows
    assert.equal(r.suppliers!.total_outstanding_pkr, 700);
    assert.equal(
      r2(r.suppliers!.rows.reduce((s, row) => s + row.outstanding_balance_pkr, 0)),
      r.suppliers!.total_outstanding_pkr,
    );

    // Quotations: conversion reported separately from sales
    assert.equal(r.quotations!.converted_count, 1);
    assert.equal(r.quotations!.conversion_rate_percent, 50);
    assert.equal(r.quotations!.accepted_value_pkr, 4000);

    // Ledger: posted revenue for the period
    assert.equal(r.ledgerRevenue!.revenue_pkr, 800);
    // In this synthetic set the invoice revenue matches the ledger exactly
    assert.equal(r2(sales.revenue_excl_tax - r.ledgerRevenue!.revenue_pkr), 0);
  });

  it("all-empty datasets load without NaN, Infinity or division errors", () => {
    const r = buildDashboardReports(
      {},
      { sections: ALL_SECTIONS, costsById: new Map() },
    );
    const numbers: number[] = [];
    if (r.sales) numbers.push(r.sales.revenue_excl_tax, r.sales.cogs ?? 0, r.sales.gross_profit ?? 0, r.sales.gross_margin_percent ?? 0, r.sales.markup_percent ?? 0);
    if (r.expenses) numbers.push(r.expenses.todayTotal, r.expenses.monthTotal, r.expenses.periodTotal);
    if (r.purchases) numbers.push(r.purchases.totals.total_purchase_pkr);
    if (r.suppliers) numbers.push(r.suppliers.total_outstanding_pkr);
    if (r.quotations) numbers.push(r.quotations.total_value_pkr, r.quotations.conversion_rate_percent);
    if (r.ledgerRevenue) numbers.push(r.ledgerRevenue.revenue_pkr);

    assert.ok(numbers.length > 0);
    for (const n of numbers) {
      assert.ok(Number.isFinite(n), `expected finite number, got ${n}`);
    }
  });
});
