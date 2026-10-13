/**
 * Financial reporting service behind the Dashboard "Financial Reports" panel.
 *
 * Every figure is assembled from the EXISTING module services — there is no
 * second accounting engine here:
 *   - expenses      → calculateExpenseSummary (expenses module)
 *   - purchases     → summarizePurchases / buildPurchaseReportBySupplier /
 *                     buildPurchaseReportByProduct (purchase cost module)
 *   - quotations    → filterQuotations / summarizeQuotations (quotations module)
 *   - supplier bal. → party-statement (the SAME ledger presentation the CRM
 *                     drawer computes, so dashboard = CRM balances)
 *   - COGS          → fetchEstimatedCosts (the existing FIFO costing service:
 *                     oldest open inventory lot, else latest purchase rate)
 *   - ledger check  → getAccountLedger + buildAccountLedgerSummary (account 4001)
 *
 * Business rules enforced here (asserted in tests/reports.test.ts):
 *   1. Quotations are NEVER sales/revenue — only posted sales invoices count.
 *      A quotation's value appears only in the quotation section.
 *   2. Purchases ≠ COGS. Purchases are inventory buying activity for the
 *      period; COGS is the cost of quantities actually sold, priced with the
 *      existing FIFO costing service.
 *   3. Gross profit = posted-sales revenue (excl. tax) − COGS, with the same
 *      rounding as calculateProfitMargins (money 2 dp, percentages 2 dp).
 *   4. No duplicate accounting: supplier balances reuse party-statement,
 *      revenue cross-check reuses the journal ledger.
 *   5. Sections are gated by module visibility; COGS/profit/margin figures are
 *      OWNER-only (canViewQuotationMargins) and are not even fetched otherwise.
 *   6. Reconciliation: category rows sum to the expense period total, supplier
 *      report rows sum to the purchase totals, revenue + tax = invoice value,
 *      and ledger account 4001 is shown as an independent cross-check.
 *
 * Dates are UTC calendar dates (YYYY-MM-DD) — the same convention every
 * existing filter in the app uses (`new Date().toISOString().slice(0, 10)`).
 * Comparisons are lexicographic and INCLUSIVE on both bounds. Money is PKR
 * rounded to 2 decimals: Math.round(n * 100) / 100.
 */

import type { ModuleKey, ModuleVisibility } from "@/types/settings";
import {
  calculateExpenseSummary,
  fetchExpenses,
  EXPENSE_CATEGORY_LABELS,
  type Expense,
  type ExpenseCategory,
} from "@/lib/supabase/expenses";
import {
  buildPurchaseReportByProduct,
  buildPurchaseReportBySupplier,
  fetchProductPurchases,
  summarizePurchases,
  type ProductPurchase,
  type PurchaseReportRow,
  type PurchaseReportTotals,
} from "@/lib/supabase/purchases";
import {
  fetchEstimatedCosts,
  fetchQuotations,
  filterQuotations,
  summarizeQuotations,
  type Quotation,
  type QuotationSummary,
} from "@/lib/supabase/quotations";
import { fetchInvoices, type SalesInvoice } from "@/lib/supabase/invoicing";
import { fetchParties, type Party } from "@/lib/supabase/crm";
import {
  fetchAllPurchaseInvoices,
  type PurchaseInvoice,
} from "@/lib/supabase/purchase-invoices";
import { fetchPaymentVouchers, type PaymentVoucher } from "@/lib/supabase/payment-vouchers";
import {
  buildAccountLedgerSummary,
  getAccountLedger,
  type AccountLedgerLine,
} from "@/lib/supabase/ledger";
import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";
import {
  buildPartyLedgerEntries,
  computeSideTotals,
  partySignedOpeningBalance,
  type PartyStatementDoc,
} from "@/lib/party-statement";

/* ─── Period helpers (UTC calendar dates, inclusive bounds) ───────────────── */

export type ReportPeriodPreset = "ALL" | "TODAY" | "THIS_MONTH" | "LAST_30_DAYS";

export interface ReportPeriod {
  /** YYYY-MM-DD, inclusive. Absent = no lower bound. */
  startDate?: string;
  /** YYYY-MM-DD, inclusive. Absent = no upper bound. */
  endDate?: string;
}

export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Preset → date range, using the app's UTC "today" convention. */
export function applyReportPreset(
  preset: ReportPeriodPreset,
  today: string = todayISO(),
): ReportPeriod {
  if (preset === "TODAY") return { startDate: today, endDate: today };
  if (preset === "THIS_MONTH") {
    return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
  }
  if (preset === "LAST_30_DAYS") {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return { startDate: d.toISOString().slice(0, 10), endDate: today };
  }
  return {}; // ALL — unbounded
}

/** Trims the raw date inputs; empty strings become "no bound". */
export function normalizeReportPeriod(
  startDate?: string | null,
  endDate?: string | null,
): ReportPeriod {
  const period: ReportPeriod = {};
  const s = (startDate ?? "").trim();
  const e = (endDate ?? "").trim();
  if (s) period.startDate = s;
  if (e) period.endDate = e;
  return period;
}

/**
 * Inclusive period test for a date or ISO timestamp string, identical to the
 * existing page filters (`date >= startDate` / `date <= endDate`): a missing
 * date fails a start bound but passes an end bound and an unbounded period.
 */
export function inReportPeriod(dateLike: string | null | undefined, period: ReportPeriod = {}): boolean {
  const date = (dateLike ?? "").slice(0, 10);
  if (period.startDate && date < period.startDate) return false;
  if (period.endDate && date > period.endDate) return false;
  return true;
}

/* ─── Sections & permissions (module visibility = the app's page permission) ─ */

export type ReportSectionKey =
  | "sales"
  | "expenses"
  | "purchases"
  | "suppliers"
  | "quotations"
  | "ledger";

export type ReportSections = Record<ReportSectionKey, boolean>;

/** Which module's visibility gates each report section. */
export const REPORT_SECTION_MODULES: Record<ReportSectionKey, ModuleKey> = {
  sales: "invoicing",
  expenses: "expenses",
  purchases: "catalog",
  suppliers: "crm",
  quotations: "quotations",
  ledger: "ledger",
};

/**
 * A section is shown when its module is visible. Missing keys are treated as
 * visible (the settings sanitizer defaults everything to true).
 */
export function reportSectionVisible(
  section: ReportSectionKey,
  visibility: Partial<ModuleVisibility> | null | undefined,
): boolean {
  const key = REPORT_SECTION_MODULES[section];
  const value = visibility?.[key];
  return value !== false;
}

export function resolveReportSections(
  visibility: Partial<ModuleVisibility> | null | undefined,
): ReportSections {
  return {
    sales: reportSectionVisible("sales", visibility),
    expenses: reportSectionVisible("expenses", visibility),
    purchases: reportSectionVisible("purchases", visibility),
    suppliers: reportSectionVisible("suppliers", visibility),
    quotations: reportSectionVisible("quotations", visibility),
    ledger: reportSectionVisible("ledger", visibility),
  };
}

/* ─── Expenses: today / this month / selected period + category breakdown ─── */

export interface ExpenseCategoryRow {
  category: ExpenseCategory;
  label: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface ExpenseReportData {
  /** From calculateExpenseSummary over the whole dataset (independent of period). */
  todayTotal: number;
  monthTotal: number;
  /** Selected period: paid + unpaid, excluding DRAFT and CANCELLED. */
  periodTotal: number;
  periodCount: number;
  periodPaidTotal: number;
  periodUnpaidTotal: number;
  periodDraftTotal: number;
  periodCancelledTotal: number;
  /** Non-zero categories for the period, amount desc. Amounts sum to periodTotal. */
  categoryRows: ExpenseCategoryRow[];
}

export function buildExpenseReport(
  expenses: Expense[],
  period: ReportPeriod = {},
): ExpenseReportData {
  const list = Array.isArray(expenses) ? expenses : [];
  const all = calculateExpenseSummary(list); // today / month — existing service
  const inPeriod = list.filter((e) => inReportPeriod(e.expense_date, period));
  const p = calculateExpenseSummary(inPeriod); // period totals + category %

  const categoryRows: ExpenseCategoryRow[] = (
    Object.keys(p.categoryBreakdown) as ExpenseCategory[]
  )
    .map((category) => ({
      category,
      label: EXPENSE_CATEGORY_LABELS[category] ?? category,
      ...p.categoryBreakdown[category],
    }))
    .filter((row) => row.amount > 0 || row.count > 0)
    .sort(
      (a, b) => b.amount - a.amount || a.label.localeCompare(b.label),
    );

  return {
    todayTotal: all.todayTotal,
    monthTotal: all.monthTotal,
    periodTotal: p.grandTotal,
    periodCount: p.count,
    periodPaidTotal: p.paidTotal,
    periodUnpaidTotal: p.unpaidTotal,
    periodDraftTotal: p.draftTotal,
    periodCancelledTotal: p.cancelledTotal,
    categoryRows,
  };
}

/* ─── Sales: posted revenue excl. tax + FIFO COGS + gross profit ──────────── */

export interface SalesReportData {
  /** Posted sales invoices inside the period. Unconverted quotations never appear here. */
  posted_invoice_count: number;
  /** Σ taxable_value_pkr — excludes sales tax and further tax. */
  revenue_excl_tax: number;
  sales_tax: number;
  further_tax: number;
  tax_total: number;
  /** Σ total_invoice_value_pkr = revenue + tax (the document totals). */
  total_invoice_value: number;
  /**
   * Σ (quantity × FIFO unit cost) over posted invoice lines, priced with the
   * existing costing service (`fetchEstimatedCosts`). `null` when cost data
   * was not requested — cost/margin is OWNER-only and must not be computed
   * for other roles.
   */
  cogs: number | null;
  gross_profit: number | null;
  /** gross_profit / revenue × 100 (0 when revenue is 0). */
  gross_margin_percent: number | null;
  /** gross_profit / cogs × 100 (0 when cogs is 0). */
  markup_percent: number | null;
  /** Lines whose product had no cost anywhere (lots/purchases) — surfaced so COGS is never silently wrong. */
  unpriced_line_count: number;
  unpriced_qty: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeSalesReport(
  invoices: SalesInvoice[],
  period: ReportPeriod = {},
  costById: Map<string, number> | null = null,
): SalesReportData {
  const posted = (Array.isArray(invoices) ? invoices : []).filter(
    (inv) => inv.is_posted && inReportPeriod(inv.created_at, period),
  );

  let revenue = 0;
  let salesTax = 0;
  let furtherTax = 0;
  let totalValue = 0;
  let cogsRaw = 0;
  let unpricedLines = 0;
  let unpricedQty = 0;

  for (const inv of posted) {
    revenue += Number(inv.taxable_value_pkr) || 0;
    salesTax += Number(inv.sales_tax_amount_pkr) || 0;
    furtherTax += Number(inv.further_tax_amount_pkr) || 0;
    totalValue += Number(inv.total_invoice_value_pkr) || 0;

    if (costById) {
      for (const item of inv.items ?? []) {
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) continue;
        const cost = item.product_id ? costById.get(item.product_id) : undefined;
        if (cost === undefined) {
          unpricedLines += 1;
          unpricedQty += qty;
          continue;
        }
        cogsRaw += qty * cost;
      }
    }
  }

  const revenueR = round2(revenue);
  const salesTaxR = round2(salesTax);
  const furtherTaxR = round2(furtherTax);

  let cogs: number | null = null;
  let grossProfit: number | null = null;
  let grossMarginPercent: number | null = null;
  let markupPercent: number | null = null;

  if (costById) {
    cogs = round2(cogsRaw);
    grossProfit = round2(revenueR - cogs);
    grossMarginPercent =
      revenueR > 0 ? round2((grossProfit / revenueR) * 100) : 0;
    markupPercent = cogs > 0 ? round2((grossProfit / cogs) * 100) : 0;
  }

  return {
    posted_invoice_count: posted.length,
    revenue_excl_tax: revenueR,
    sales_tax: salesTaxR,
    further_tax: furtherTaxR,
    tax_total: round2(salesTaxR + furtherTaxR),
    total_invoice_value: round2(totalValue),
    cogs,
    gross_profit: grossProfit,
    gross_margin_percent: grossMarginPercent,
    markup_percent: markupPercent,
    unpriced_line_count: unpricedLines,
    unpriced_qty: round2(unpricedQty),
  };
}

/* ─── Purchases (reporting only — never COGS) ─────────────────────────────── */

export interface PurchaseSectionData {
  totals: PurchaseReportTotals;
  bySupplier: PurchaseReportRow[];
  byProduct: PurchaseReportRow[];
}

export function buildPurchaseSection(
  purchases: ProductPurchase[],
  period: ReportPeriod = {},
): PurchaseSectionData {
  const filter = { startDate: period.startDate, endDate: period.endDate };
  return {
    totals: summarizePurchases(purchases, filter),
    bySupplier: buildPurchaseReportBySupplier(purchases, filter),
    byProduct: buildPurchaseReportByProduct(purchases, filter),
  };
}

/* ─── Supplier outstanding balances (same rules as the CRM party drawer) ──── */

export interface SupplierOutstandingRow {
  party_id: string;
  party_name: string;
  invoice_count: number;
  total_invoice_value_pkr: number;
  total_paid_pkr: number;
  /** Positive = we still owe the supplier (Cr payable), negative = overpaid. */
  outstanding_balance_pkr: number;
}

export interface SupplierOutstandingData {
  rows: SupplierOutstandingRow[];
  total_outstanding_pkr: number;
  supplier_count: number;
}

/** Same statuses fetchPartyDetails counts toward a supplier's statement. */
const COUNTABLE_PURCHASE_INVOICE_STATUSES: ReadonlyArray<PurchaseInvoice["status"]> = [
  "pending_approval",
  "posted",
];

const normPayee = (name: string | null | undefined): string => (name ?? "").toLowerCase();

/**
 * Supplier side of the party list — mirrors fetchPartyDetails' `isSupplier`
 * test (SUPPLIER or BOTH) and also accepts the VENDOR alias used by
 * party-statement's isSupplierType.
 */
const isSupplierParty = (partyType: string | null | undefined): boolean => {
  const t = (partyType ?? "").toUpperCase();
  return t === "SUPPLIER" || t === "BOTH" || t === "VENDOR";
};

/**
 * Batch mirror of the per-party statement fetchPartyDetails builds for the CRM
 * drawer: purchase invoices credit the AP side, payment vouchers (matched by
 * payee name, case-insensitively — vouchers carry no party FK) debit it.
 * Opening balances are applied to the running ledger exactly as the CRM does;
 * `outstanding_balance` remains invoice value − paid (computeSideTotals).
 */
export function computeSupplierOutstanding(
  parties: Party[],
  purchaseInvoices: PurchaseInvoice[],
  paymentVouchers: PaymentVoucher[],
): SupplierOutstandingData {
  const vouchersByPayee = new Map<string, PaymentVoucher[]>();
  for (const v of Array.isArray(paymentVouchers) ? paymentVouchers : []) {
    const key = normPayee(v.payee_name);
    if (!key) continue;
    const list = vouchersByPayee.get(key);
    if (list) list.push(v);
    else vouchersByPayee.set(key, [v]);
  }

  const invoicesByVendor = new Map<string, PurchaseInvoice[]>();
  for (const p of Array.isArray(purchaseInvoices) ? purchaseInvoices : []) {
    if (!p.vendor_id) continue;
    if (!COUNTABLE_PURCHASE_INVOICE_STATUSES.includes(p.status)) continue;
    const list = invoicesByVendor.get(p.vendor_id);
    if (list) list.push(p);
    else invoicesByVendor.set(p.vendor_id, [p]);
  }

  const rows: SupplierOutstandingRow[] = [];

  for (const party of Array.isArray(parties) ? parties : []) {
    if (!isSupplierParty(party.party_type)) continue;

    const docs: PartyStatementDoc[] = [];

    for (const p of invoicesByVendor.get(party.id) ?? []) {
      docs.push({
        id: p.id,
        date: p.created_at,
        doc_type: "PURCHASE_INVOICE",
        doc_no: p.invoice_number,
        side: "sell",
        remarks: `Purchase Invoice - ${p.status === "posted" ? "POSTED" : "PENDING APPROVAL"}`,
        amount: Math.abs(Number(p.total_payable) || 0),
      });
    }

    // fetchPartyDetails matches vouchers with `payee_name ilike party.name`
    // (case-insensitive equality; the party name is trimmed, the payee is not).
    for (const v of vouchersByPayee.get(normPayee(party.name.trim())) ?? []) {
      docs.push({
        id: v.id,
        date: v.voucher_date,
        doc_type: "PAYMENT_VOUCHER",
        doc_no: v.voucher_no,
        side: "sell",
        remarks: v.purpose || "Payment Voucher",
        amount: Math.abs(Number(v.amount) || 0),
      });
    }

    const ledger = buildPartyLedgerEntries(docs, partySignedOpeningBalance(party));
    const totals = computeSideTotals(ledger, "sell");

    if (totals.invoice_count === 0 && totals.outstanding_balance === 0) continue;

    rows.push({
      party_id: party.id,
      party_name: party.name,
      invoice_count: totals.invoice_count,
      total_invoice_value_pkr: totals.total_invoice_value,
      total_paid_pkr: totals.total_paid,
      outstanding_balance_pkr: totals.outstanding_balance,
    });
  }

  rows.sort(
    (a, b) =>
      b.outstanding_balance_pkr - a.outstanding_balance_pkr ||
      a.party_name.localeCompare(b.party_name),
  );

  return {
    rows,
    total_outstanding_pkr: round2(
      rows.reduce((sum, r) => sum + r.outstanding_balance_pkr, 0),
    ),
    supplier_count: rows.length,
  };
}

/* ─── Quotations: status mix, value, conversion rate ──────────────────────── */

export interface QuotationReportData extends QuotationSummary {
  /** Quotations that were sent (everything except DRAFT) — the conversion denominator. */
  sent_count: number;
  converted_value_pkr: number;
  /** converted_count / sent_count × 100 (0 when nothing was sent). */
  conversion_rate_percent: number;
}

export function buildQuotationReport(
  quotations: Quotation[],
  period: ReportPeriod = {},
): QuotationReportData {
  const inPeriod = filterQuotations(quotations ?? [], {
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const summary = summarizeQuotations(inPeriod);

  let sentCount = 0;
  let convertedValue = 0;
  for (const q of inPeriod) {
    if (q.status !== "DRAFT") sentCount += 1;
    if (q.converted_invoice_id) {
      convertedValue += Number(q.grand_total_pkr) || 0;
    }
  }

  return {
    ...summary,
    sent_count: sentCount,
    converted_value_pkr: round2(convertedValue),
    conversion_rate_percent:
      sentCount > 0 ? round2((summary.converted_count / sentCount) * 100) : 0,
  };
}

/* ─── Ledger cross-check: posted revenue on account 4001 ──────────────────── */

export interface LedgerRevenueData {
  /** periodCredit − periodDebit on REVENUE (4001), POSTED lines only. */
  revenue_pkr: number;
  line_count: number;
}

export function summarizeLedgerRevenue(
  lines: AccountLedgerLine[],
  period: ReportPeriod = {},
): LedgerRevenueData {
  const posted = (Array.isArray(lines) ? lines : []).filter(
    (l) => l.status === "POSTED",
  );
  const summary = buildAccountLedgerSummary(posted, {
    startDate: period.startDate,
    endDate: period.endDate,
  });
  return {
    revenue_pkr: round2(summary.periodCredit - summary.periodDebit),
    line_count: summary.rows.length,
  };
}

/* ─── Combined (pure) assembly — used by the fetcher and by the tests ─────── */

export interface DashboardReportInputs {
  invoices?: SalesInvoice[] | null;
  expenses?: Expense[] | null;
  purchases?: ProductPurchase[] | null;
  suppliers?: {
    parties: Party[];
    purchaseInvoices: PurchaseInvoice[];
    paymentVouchers: PaymentVoucher[];
  } | null;
  quotations?: Quotation[] | null;
  ledgerLines?: AccountLedgerLine[] | null;
}

export interface DashboardReportOptions {
  period?: ReportPeriod;
  sections: ReportSections;
  /**
   * FIFO cost map from `fetchEstimatedCosts` for the posted invoice products.
   * `null` (or omitted) = costs were not requested → cogs/profit stay `null`
   * and the UI shows them as owner-only.
   */
  costsById?: Map<string, number> | null;
}

export interface DashboardReports {
  sales: SalesReportData | null;
  expenses: ExpenseReportData | null;
  purchases: PurchaseSectionData | null;
  suppliers: SupplierOutstandingData | null;
  quotations: QuotationReportData | null;
  ledgerRevenue: LedgerRevenueData | null;
}

export function emptyDashboardReports(): DashboardReports {
  return {
    sales: null,
    expenses: null,
    purchases: null,
    suppliers: null,
    quotations: null,
    ledgerRevenue: null,
  };
}

/**
 * Pure assembly: hidden sections → `null` (never computed at all), visible
 * sections → built from the existing module services.
 */
export function buildDashboardReports(
  inputs: DashboardReportInputs,
  opts: DashboardReportOptions,
): DashboardReports {
  const period = opts.period ?? {};
  const sections = opts.sections;
  const out = emptyDashboardReports();

  if (sections.sales) {
    out.sales = computeSalesReport(
      inputs.invoices ?? [],
      period,
      opts.costsById ?? null,
    );
  }
  if (sections.expenses) {
    out.expenses = buildExpenseReport(inputs.expenses ?? [], period);
  }
  if (sections.purchases) {
    out.purchases = buildPurchaseSection(inputs.purchases ?? [], period);
  }
  if (sections.suppliers && inputs.suppliers) {
    out.suppliers = computeSupplierOutstanding(
      inputs.suppliers.parties,
      inputs.suppliers.purchaseInvoices,
      inputs.suppliers.paymentVouchers,
    );
  }
  if (sections.quotations) {
    out.quotations = buildQuotationReport(inputs.quotations ?? [], period);
  }
  if (sections.ledger) {
    out.ledgerRevenue = summarizeLedgerRevenue(inputs.ledgerLines ?? [], period);
  }

  return out;
}

/* ─── Fetch orchestration (reads only — never posts or mutates anything) ──── */

export interface FetchDashboardReportsOptions {
  period?: ReportPeriod;
  sections: ReportSections;
  /** OWNER-only cost/margin figures; when false no cost query runs at all. */
  includeCosts?: boolean;
}

/**
 * Loads every visible report section in parallel. Read-only: no inventory,
 * journal or balances are touched — a quotation or an unconverted document
 * can never shift these totals.
 */
export async function fetchDashboardReports(
  opts: FetchDashboardReportsOptions,
): Promise<DashboardReports> {
  const period = opts.period ?? {};
  const sections = opts.sections;
  const includeCosts = opts.includeCosts !== false;

  const [
    invoices,
    expenses,
    purchases,
    quotations,
    parties,
    purchaseInvoices,
    paymentVouchers,
    ledgerLines,
  ] = await Promise.all([
    sections.sales ? fetchInvoices() : Promise.resolve(null),
    sections.expenses ? fetchExpenses() : Promise.resolve(null),
    sections.purchases ? fetchProductPurchases() : Promise.resolve(null),
    sections.quotations ? fetchQuotations() : Promise.resolve(null),
    sections.suppliers ? fetchParties("ALL") : Promise.resolve(null),
    sections.suppliers ? fetchAllPurchaseInvoices() : Promise.resolve(null),
    sections.suppliers ? fetchPaymentVouchers() : Promise.resolve(null),
    sections.ledger
      ? getAccountLedger({ accountCode: ACCOUNT_CODES.REVENUE })
      : Promise.resolve(null),
  ]);

  // COGS needs the invoice lines first; second wave fetches the FIFO cost map.
  let costsById: Map<string, number> | null = null;
  if (sections.sales && includeCosts && invoices) {
    const ids = [
      ...new Set(
        invoices
          .filter((inv) => inv.is_posted)
          .flatMap((inv) => (inv.items ?? []).map((it) => it.product_id))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    costsById = await fetchEstimatedCosts(ids);
  }

  return buildDashboardReports(
    {
      invoices,
      expenses,
      purchases,
      quotations,
      suppliers:
        parties && purchaseInvoices && paymentVouchers
          ? {
              parties,
              purchaseInvoices,
              paymentVouchers,
            }
          : null,
      ledgerLines,
    },
    { period, sections, costsById },
  );
}
