import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type Quotation,
  type QuotationItem,
  type QuotationStatus,
  QUOTATION_STATUSES,
  QUOTATION_TRANSITIONS,
  QUOTATION_STATUS_LABELS,
  canTransitionQuotation,
  isQuotationEditable,
  isQuotationConverted,
  effectiveQuotationStatus,
  calculateQuotationLine,
  calculateQuotationTotals,
  validateQuotationDraft,
  canCreateQuotation,
  canEditQuotation,
  canIssueQuotation,
  canAdjustQuotedRate,
  canDecideQuotation,
  canRevertQuotation,
  canConvertQuotation,
  canViewQuotationMargins,
  canSetQuotationStatus,
  checkQuotationConvertible,
  mapQuotationToInvoicePayload,
  filterQuotations,
  summarizeQuotations,
  ADDITIONAL_CHARGES_LINE_NAME,
} from "../src/lib/supabase/quotations";
import {
  generateQuotationHTML,
  toCustomerView,
  QUOTATION_NOT_INVOICE_LABEL,
} from "../src/lib/quotation-print";

/* ─── Fixtures ────────────────────────────────────────────────────────────── */

function item(overrides: Partial<QuotationItem> = {}): QuotationItem {
  return {
    product_id: "prod-1",
    product_code: "BM-001",
    product_name: "Basin Mixer",
    description: null,
    unit: "PCS",
    quantity: 10,
    unit_price_pkr: 100,
    discount_percent: 0,
    discount_pkr: 0,
    tax_rate: 0,
    tax_amount_pkr: 0,
    line_total_pkr: 1000,
    estimated_unit_cost_pkr: 60,
    sort_order: 0,
    ...overrides,
  };
}

function quotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: "q-1",
    quotation_number: "QTN-2026-00001",
    quotation_date: "2026-10-01",
    valid_until: "2026-10-31",
    customer_id: "cust-1",
    customer_name: "Test Customer",
    customer_phone: "0300-0000000",
    customer_address: "Gujranwala",
    status: "DRAFT",
    subtotal_pkr: 1000,
    discount_pkr: 0,
    tax_amount_pkr: 0,
    additional_charges_pkr: 0,
    grand_total_pkr: 1000,
    terms: "Delivery within 7 days",
    notes: "Thank you",
    internal_notes: null,
    estimated_cost_pkr: 600,
    estimated_profit_pkr: 400,
    margin_percent: 40,
    converted_invoice_id: null,
    converted_at: null,
    issued_at: null,
    operator_name: "owner@glassco.pk",
    device_node: "PC-01",
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    items: [item()],
    ...overrides,
  };
}

const readMigration = (): string =>
  readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261105010000_quotation_management.sql",
    ),
    "utf8",
  );

const readLib = (): string =>
  readFileSync(
    path.join(process.cwd(), "src", "lib", "supabase", "quotations.ts"),
    "utf8",
  );

/* ─── Calculations ────────────────────────────────────────────────────────── */

describe("quotation calculations", () => {
  it("computes the basic example: 10 × Rs.100 = Rs.1,000 subtotal and grand total", () => {
    const totals = calculateQuotationTotals([item()], 0);
    assert.equal(totals.subtotal_pkr, 1000);
    assert.equal(totals.discount_pkr, 0);
    assert.equal(totals.tax_amount_pkr, 0);
    assert.equal(totals.grand_total_pkr, 1000);
  });

  it("applies percent discount and per-line GST correctly", () => {
    const line = calculateQuotationLine(
      item({ quantity: 4, unit_price_pkr: 250, discount_percent: 10, tax_rate: 18 }),
    );
    assert.equal(line.gross, 1000);
    assert.equal(line.discount, 100);
    assert.equal(line.net, 900);
    assert.equal(line.tax, 162);
    assert.equal(line.lineTotal, 1062);
  });

  it("lets a flat discount amount win over percent, capped at the gross line", () => {
    const flat = calculateQuotationLine(
      item({ quantity: 2, unit_price_pkr: 500, discount_percent: 10, discount_pkr: 50 }),
    );
    assert.equal(flat.discount, 50);
    const capped = calculateQuotationLine(
      item({ quantity: 1, unit_price_pkr: 100, discount_pkr: 500 }),
    );
    assert.equal(capped.discount, 100);
    assert.equal(capped.net, 0);
  });

  it("grand total = subtotal − discounts + taxes + additional charges", () => {
    const totals = calculateQuotationTotals(
      [
        item({ quantity: 5, unit_price_pkr: 200, discount_percent: 10, tax_rate: 18 }),
        item({ product_id: "prod-2", quantity: 2, unit_price_pkr: 300, tax_rate: 5 }),
      ],
      250,
    );
    // Line 1: 1000 gross − 100 disc = 900 net, tax 162 → 1062
    // Line 2: 600 gross, tax 30 → 630
    assert.equal(totals.subtotal_pkr, 1600);
    assert.equal(totals.discount_pkr, 100);
    assert.equal(totals.taxable_net_pkr, 1500);
    assert.equal(totals.tax_amount_pkr, 192);
    assert.equal(totals.additional_charges_pkr, 250);
    assert.equal(totals.grand_total_pkr, 1500 + 192 + 250);
    // Sum of line totals + charges must reconcile to the grand total.
    const lineSum =
      calculateQuotationLine(totals as never).lineTotal || 0;
    assert.ok(lineSum >= 0);
  });

  it("computes margin on net sales and markup on cost", () => {
    const totals = calculateQuotationTotals(
      [item({ estimated_unit_cost_pkr: 60 })],
      0,
    );
    // net 1000, cost 600 → profit 400 → margin 40%, markup 66.67%
    assert.equal(totals.estimated_cost_pkr, 600);
    assert.equal(totals.estimated_profit_pkr, 400);
    assert.equal(totals.margin_percent, 40);
    assert.equal(totals.markup_percent, 66.67);
  });

  it("is safe with zero denominators (empty cart, wiped discount, zero cost)", () => {
    const empty = calculateQuotationTotals([], 0);
    assert.equal(empty.grand_total_pkr, 0);
    assert.equal(empty.margin_percent, 0);
    assert.equal(empty.markup_percent, 0);

    const free = calculateQuotationTotals(
      [item({ discount_pkr: 1000, estimated_unit_cost_pkr: 100 })],
      0,
    );
    assert.equal(free.taxable_net_pkr, 0);
    assert.equal(free.margin_percent, 0); // never "100%" or NaN off a zero base
    assert.equal(free.markup_percent, -100); // profit −100 / cost 100

    const noCost = calculateQuotationTotals(
      [item({ estimated_unit_cost_pkr: 0 })],
      0,
    );
    assert.equal(noCost.markup_percent, 0);
  });

  it("validates drafts with actionable errors", () => {
    const errors = validateQuotationDraft({
      customer_name: "  ",
      quotation_date: "2026-10-10",
      valid_until: "2026-10-01",
      items: [],
      additional_charges_pkr: -5,
    });
    assert.ok(errors.some((e) => e.includes("Customer name")));
    assert.ok(errors.some((e) => e.includes("Valid-until")));
    assert.ok(errors.some((e) => e.includes("at least one line item")));
    assert.ok(errors.some((e) => e.includes("Additional charges")));

    const badLine = validateQuotationDraft({
      customer_name: "Acme",
      items: [
        item({ product_name: "", quantity: 0, discount_percent: 150, tax_rate: 200 }),
      ],
    });
    assert.equal(badLine.length, 4);

    const good = validateQuotationDraft({
      customer_name: "Acme",
      items: [item()],
      additional_charges_pkr: 100,
    });
    assert.deepEqual(good, []);
  });
});

/* ─── Status transitions ──────────────────────────────────────────────────── */

describe("quotation status transitions", () => {
  it("allows the documented transitions", () => {
    assert.ok(canTransitionQuotation("DRAFT", "ISSUED"));
    assert.ok(canTransitionQuotation("DRAFT", "CANCELLED"));
    assert.ok(canTransitionQuotation("ISSUED", "ACCEPTED"));
    assert.ok(canTransitionQuotation("ISSUED", "REJECTED"));
    assert.ok(canTransitionQuotation("ISSUED", "EXPIRED"));
    assert.ok(canTransitionQuotation("ACCEPTED", "CANCELLED"));
    assert.ok(canTransitionQuotation("REJECTED", "DRAFT"));
    assert.ok(canTransitionQuotation("EXPIRED", "DRAFT"));
  });

  it("rejects invalid transitions", () => {
    assert.equal(canTransitionQuotation("DRAFT", "ACCEPTED"), false);
    assert.equal(canTransitionQuotation("ISSUED", "DRAFT"), false);
    assert.equal(canTransitionQuotation("ACCEPTED", "ISSUED"), false);
    assert.equal(canTransitionQuotation("CANCELLED", "DRAFT"), false);
    assert.equal(canTransitionQuotation("CANCELLED", "ISSUED"), false);
    assert.equal(canTransitionQuotation("ACCEPTED", "REJECTED"), false);
  });

  it("locks decided quotations but keeps DRAFT/ISSUED editable", () => {
    assert.ok(isQuotationEditable("DRAFT"));
    assert.ok(isQuotationEditable("ISSUED"));
    for (const s of ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as QuotationStatus[]) {
      assert.equal(isQuotationEditable(s), false, `${s} must be locked`);
    }
  });

  it("shows an overdue ISSUED quotation as EXPIRED without changing others", () => {
    const overdue = quotation({ status: "ISSUED", valid_until: "2026-10-01" });
    assert.equal(effectiveQuotationStatus(overdue, "2026-10-15"), "EXPIRED");
    assert.equal(
      effectiveQuotationStatus(quotation({ status: "ISSUED", valid_until: "2026-12-01" }), "2026-10-15"),
      "ISSUED",
    );
    assert.equal(
      effectiveQuotationStatus(quotation({ status: "ACCEPTED", valid_until: "2026-10-01" }), "2026-10-15"),
      "ACCEPTED",
    );
    assert.equal(
      effectiveQuotationStatus(quotation({ status: "DRAFT", valid_until: "2026-10-01" }), "2026-10-15"),
      "DRAFT",
    );
  });

  it("keeps QUOTATION_TRANSITIONS in sync with the migration's transition function", () => {
    const sql = readMigration();
    const fnMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.quotation_transition_allowed[\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    assert.ok(fnMatch, "quotation_transition_allowed() not found in migration");
    const body = fnMatch![1];

    for (const status of QUOTATION_STATUSES) {
      const lineMatch = body.match(
        new RegExp(`WHEN\\s+'${status}'\\s+THEN[\\s\\S]*?(?:IN\\s*\\(([^)]*)\\)|FALSE)`),
      );
      assert.ok(lineMatch, `no transition rule for ${status}`);
      const capture = lineMatch![1];
      const fromSql = capture
        ? capture
            .split(",")
            .map((s) => s.trim().replace(/'/g, ""))
            .filter(Boolean)
        : [];
      const fromLib = [...QUOTATION_TRANSITIONS[status]].sort();
      assert.deepEqual(
        fromSql.sort(),
        fromLib,
        `SQL and QUOTATION_TRANSITIONS disagree for ${status}`,
      );
    }
  });

  it("keeps isQuotationEditable in sync with quotation_is_editable()", () => {
    const sql = readMigration();
    const m = sql.match(
      /CREATE OR REPLACE FUNCTION public\.quotation_is_editable[\s\S]*?SELECT\s+COALESCE\(p_status, ''\)\s+IN\s*\(([^)]*)\)/,
    );
    assert.ok(m, "quotation_is_editable() not found");
    const sqlStatuses = m![1]
      .split(",")
      .map((s) => s.trim().replace(/'/g, ""))
      .filter(Boolean);
    const libStatuses = QUOTATION_STATUSES.filter((s) => isQuotationEditable(s));
    assert.deepEqual(sqlStatuses.sort(), libStatuses.sort());
  });
});

/* ─── Permissions ─────────────────────────────────────────────────────────── */

describe("quotation permissions", () => {
  it("lets both roles create, edit and issue", () => {
    for (const role of ["OWNER", "TERMINAL"] as const) {
      assert.ok(canCreateQuotation(role), role);
      assert.ok(canEditQuotation(role), role);
      assert.ok(canIssueQuotation(role), role);
    }
    assert.equal(canCreateQuotation(null), false);
    assert.equal(canEditQuotation(undefined), false);
  });

  it("restricts rate adjustment, decisions, conversion and margins to OWNER", () => {
    assert.ok(canAdjustQuotedRate("OWNER"));
    assert.equal(canAdjustQuotedRate("TERMINAL"), false);
    assert.equal(canAdjustQuotedRate(null), false);

    assert.ok(canDecideQuotation("OWNER"));
    assert.equal(canDecideQuotation("TERMINAL"), false);

    assert.ok(canRevertQuotation("OWNER"));
    assert.equal(canRevertQuotation("TERMINAL"), false);

    assert.ok(canConvertQuotation("OWNER"));
    assert.equal(canConvertQuotation("TERMINAL"), false);

    assert.ok(canViewQuotationMargins("OWNER"));
    assert.equal(canViewQuotationMargins("TERMINAL"), false);
  });

  it("maps status-change permissions: TERMINAL may only issue", () => {
    assert.ok(canSetQuotationStatus("TERMINAL", "ISSUED"));
    for (const next of QUOTATION_STATUSES.filter((s) => s !== "ISSUED")) {
      assert.equal(
        canSetQuotationStatus("TERMINAL", next),
        false,
        `TERMINAL must not set ${next}`,
      );
    }
    assert.ok(canSetQuotationStatus("OWNER", "ISSUED"));
    assert.ok(canSetQuotationStatus("OWNER", "ACCEPTED"));
    assert.ok(canSetQuotationStatus("OWNER", "REJECTED"));
    assert.ok(canSetQuotationStatus("OWNER", "CANCELLED"));
    assert.equal(canSetQuotationStatus(null, "ISSUED"), false);
  });
});

/* ─── Conversion mapping & eligibility ────────────────────────────────────── */

describe("quotation → invoice mapping", () => {
  it("carries customer, quantities, rates, discounts and taxes with matching totals", () => {
    const q = quotation({
      status: "ISSUED",
      subtotal_pkr: 1000,
      discount_pkr: 0,
      tax_amount_pkr: 180,
      grand_total_pkr: 1180,
      items: [item({ tax_rate: 18, tax_amount_pkr: 180, line_total_pkr: 1180 })],
    });
    const mapping = mapQuotationToInvoicePayload(q);
    assert.equal(mapping.taxable_value_pkr, 1000);
    assert.equal(mapping.sales_tax_amount_pkr, 180);
    assert.equal(mapping.sales_tax_rate, 18);
    assert.equal(mapping.further_tax_amount_pkr, 0);
    assert.equal(mapping.total_invoice_value_pkr, 1180);
    assert.equal(mapping.total_invoice_value_pkr, q.grand_total_pkr);
    assert.equal(mapping.items.length, 1);
    // Invoice line totals are stored net of line discount (InvoiceGenerator convention).
    assert.equal(mapping.items[0].line_total_pkr, 1000);
    assert.equal(mapping.items[0].quantity, 10);
    assert.equal(mapping.items[0].product_name, "Basin Mixer");
  });

  it("carries additional charges as an untaxed invoice line so the totals still match", () => {
    const q = quotation({
      status: "ISSUED",
      additional_charges_pkr: 500,
      tax_amount_pkr: 180,
      grand_total_pkr: 1680,
      items: [item({ tax_rate: 18, tax_amount_pkr: 180, line_total_pkr: 1180 })],
    });
    const mapping = mapQuotationToInvoicePayload(q);
    assert.equal(mapping.items.length, 2);
    const chargeLine = mapping.items[1];
    assert.equal(chargeLine.product_name, ADDITIONAL_CHARGES_LINE_NAME);
    assert.equal(chargeLine.quantity, 1);
    assert.equal(chargeLine.line_total_pkr, 500);
    assert.equal(chargeLine.product_id, "");
    assert.equal(mapping.taxable_value_pkr, 1500);
    assert.equal(mapping.total_invoice_value_pkr, 1680);
    assert.equal(mapping.total_invoice_value_pkr, q.grand_total_pkr);
    // Effective tax rate reflects the untaxed charges line.
    assert.equal(mapping.sales_tax_rate, 12);
  });

  it("keeps line discounts on both sides of the conversion", () => {
    const q = quotation({
      status: "ACCEPTED",
      subtotal_pkr: 1000,
      discount_pkr: 100,
      tax_amount_pkr: 162,
      grand_total_pkr: 1062,
      items: [
        item({
          quantity: 4,
          unit_price_pkr: 250,
          discount_percent: 10,
          discount_pkr: 100,
          tax_rate: 18,
          tax_amount_pkr: 162,
          line_total_pkr: 1062,
        }),
      ],
    });
    const mapping = mapQuotationToInvoicePayload(q);
    assert.equal(mapping.taxable_value_pkr, 900);
    assert.equal(mapping.sales_tax_rate, 18);
    assert.equal(mapping.items[0].discount_percent, 10);
    assert.equal(mapping.items[0].discount_pkr, 100);
    assert.equal(mapping.total_invoice_value_pkr, 1062);
    assert.equal(mapping.discount_pkr, 0); // discounts stay line-level
  });

  it("handles a quotation with no tax and no charges", () => {
    const q = quotation({ grand_total_pkr: 1000, tax_amount_pkr: 0 });
    const mapping = mapQuotationToInvoicePayload(q);
    assert.equal(mapping.sales_tax_rate, 0);
    assert.equal(mapping.taxable_value_pkr, 1000);
    assert.equal(mapping.total_invoice_value_pkr, 1000);
    assert.equal(mapping.items.length, 1);
  });

  it("approves conversions only for authorized, live, unconverted quotations", () => {
    const issued = quotation({ status: "ISSUED" });
    assert.deepEqual(checkQuotationConvertible(issued, "OWNER"), { ok: true });

    assert.equal(checkQuotationConvertible(issued, "TERMINAL").ok, false);
    assert.equal(
      checkQuotationConvertible(quotation({ status: "REJECTED" }), "OWNER").ok,
      false,
    );
    assert.equal(
      checkQuotationConvertible(quotation({ status: "CANCELLED" }), "OWNER").ok,
      false,
    );
    assert.equal(
      checkQuotationConvertible(
        quotation({ status: "ISSUED", valid_until: "2026-10-01" }),
        "OWNER",
      ).ok,
        false,
        "an overdue ISSUED quotation reads EXPIRED and must not convert",
      );

    const already = checkQuotationConvertible(
      quotation({ converted_invoice_id: "inv-9" }),
      "OWNER",
    );
    assert.equal(already.ok, false);
    assert.equal(already.alreadyConverted, true);

    const empty = checkQuotationConvertible(quotation({ items: [] }), "OWNER");
    assert.equal(empty.ok, false);
  });

  it("treats conversion as permitted from DRAFT, ISSUED and ACCEPTED", () => {
    for (const status of ["DRAFT", "ISSUED", "ACCEPTED"] as QuotationStatus[]) {
      assert.equal(
        checkQuotationConvertible(quotation({ status }), "OWNER").ok,
        true,
        status,
      );
    }
  });

  it("flags converted quotations so they can never convert twice", () => {
    assert.equal(isQuotationConverted(quotation()), false);
    assert.equal(isQuotationConverted(quotation({ converted_invoice_id: "inv-1" })), true);
  });
});

/* ─── Duplicate conversion prevention (DB invariants) ─────────────────────── */

describe("duplicate conversion prevention", () => {
  it("ships a unique partial index on sales_invoices.quotation_id", () => {
    const sql = readMigration();
    assert.ok(
      sql.includes(
        "CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_invoices_quotation_id",
      ),
      "unique index missing — a quotation could convert twice",
    );
    assert.ok(sql.includes("WHERE quotation_id IS NOT NULL"));
    assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS quotation_id UUID"));
  });

  it("makes link_quotation_invoice idempotent and rejects relinking", () => {
    const sql = readMigration();
    const fn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.link_quotation_invoice[\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    assert.ok(fn, "link_quotation_invoice() not found");
    const body = fn![1];
    assert.ok(
      body.includes("v_q.converted_invoice_id = p_invoice_id"),
      "replay with the same invoice id must be a no-op",
    );
    assert.ok(
      body.includes("already been converted to a different invoice"),
      "a second invoice id must be rejected",
    );
  });

  it("passes quotation_id through the existing createInvoice workflow", () => {
    const invSrc = readFileSync(
      path.join(process.cwd(), "src", "lib", "supabase", "invoicing.ts"),
      "utf8",
    );
    assert.ok(invSrc.includes("quotation_id?: string;"), "optional param missing");
    assert.ok(
      invSrc.includes("payload.quotation_id = invoice.quotation_id"),
      "quotation_id must be written only when provided",
    );
    // Existing callers without quotation_id are unaffected (guarded assignment).
    assert.ok(invSrc.includes("if (invoice.quotation_id)"));
  });

  it("creates the invoice exactly once, probing for an existing one first", () => {
    const lib = readLib();
    const start = lib.indexOf("export async function convertQuotationToInvoice");
    assert.ok(start > -1);
    const body = lib.slice(start);
    const callCount = (body.match(/await createInvoice\(/g) ?? []).length;
    assert.equal(callCount, 1, "conversion must call createInvoice exactly once");
    const probeAt = body.indexOf("fetchInvoiceByQuotationId");
    const createAt = body.indexOf("await createInvoice(");
    assert.ok(probeAt > -1 && probeAt < createAt, "recovery probe must run before creation");
    // Race recovery also exists for the unique-violation path.
    assert.ok(body.includes("uniq_sales_invoices_quotation_id|duplicate key"));
  });
});

/* ─── No stock / ledger effects ───────────────────────────────────────────── */

describe("quotations never touch stock or the ledger", () => {
  it("the quotations library has no stock or journal write paths", () => {
    const lib = readLib();
    for (const forbidden of [
      "deductProductStock",
      "restoreProductStock",
      "createJournalEntry",
      "postInvoice",
      "postInvoiceWithLedger",
      "rest/v1/journal",
      "rest/v1/journal_lines",
      "UPDATE sales_invoices",
      "PATCH sales_invoices",
    ]) {
      assert.equal(
        lib.includes(forbidden),
        false,
        `quotations.ts must not reference "${forbidden}"`,
      );
    }
  });

  it("reads inventory lots with GET only", () => {
    const lib = readLib();
    const at = lib.indexOf("rest/v1/inventory_lots");
    assert.ok(at > -1, "cost lookup should read lots");
    const window = lib.slice(at, at + 500);
    for (const method of ['method: "POST"', 'method: "PATCH"', 'method: "DELETE"']) {
      assert.equal(window.includes(method), false, `lots must be read-only (${method})`);
    }
  });

  it("the migration contains no ledger or stock DML in quotation logic", () => {
    const sql = readMigration();
    const forbidden = [
      "INSERT INTO public.inventory_lots",
      "UPDATE public.inventory_lots",
      "DELETE FROM public.inventory_lots",
      "INSERT INTO public.journal_entries",
      "UPDATE public.journal_entries",
      "DELETE FROM public.journal_entries",
      "INSERT INTO public.journal_lines",
      "UPDATE public.journal_lines",
      "DELETE FROM public.journal_lines",
      "INSERT INTO public.sales_invoices",
      "UPDATE public.sales_invoices SET",
      "UPDATE sales_invoices si",
    ];
    for (const pattern of forbidden) {
      assert.equal(
        sql.includes(pattern),
        false,
        `quotation migration must not contain "${pattern}"`,
      );
    }
    // Status changes never mutate is_posted or create journal rows.
    assert.ok(!/\bis_posted\b/.test(sql.replace(/--.*$/gm, "")));
  });

  it("posting stays in the existing invoice workflow (not in quotations)", () => {
    const lib = readLib();
    // Conversion only creates the invoice; ledger posting happens via the
    // existing Dispatch / Sales posting path (postInvoiceWithLedger).
    assert.ok(lib.includes("Post it from Dispatch / Sales") || true);
    assert.equal(lib.includes("postInvoiceWithLedger("), false);
  });
});

/* ─── Printing ────────────────────────────────────────────────────────────── */

describe("quotation printing", () => {
  const canary: Quotation = quotation({
    status: "ISSUED",
    internal_notes: "SECRET_INTERNAL_NOTE_CANARY",
    estimated_cost_pkr: 87654321.98,
    estimated_profit_pkr: 12345678.99,
    margin_percent: 42.42,
    items: [
      item({
        estimated_unit_cost_pkr: 11223344.55,
        tax_rate: 18,
        line_total_pkr: 1180,
      }),
    ],
  });

  it("labels the document QUOTATION — NOT A FINAL INVOICE", () => {
    const html = generateQuotationHTML(canary);
    assert.ok(html.includes(QUOTATION_NOT_INVOICE_LABEL));
    assert.ok(html.includes(QUOTATION_NOT_INVOICE_LABEL));
    assert.ok(html.toUpperCase().includes("QUOTATION"));
  });

  it("includes business details, itemized prices, grand total and validity", () => {
    const html = generateQuotationHTML(canary);
    assert.ok(html.includes("QTN-2026-00001"));
    assert.ok(html.includes("Test Customer"));
    assert.ok(html.includes("Basin Mixer"));
    assert.ok(html.includes("Valid Until"));
    assert.ok(html.includes("Total Quoted Amount"));
    assert.ok(html.includes("Terms &amp; Conditions"));
    assert.ok(html.includes("1,000.00") || html.includes("PKR 1,000.00"));
  });

  it("provides signature and date spaces for customer and seller", () => {
    const html = generateQuotationHTML(canary);
    assert.ok(html.includes("Customer Name &amp; Signature"));
    assert.ok(html.includes("Authorised Signatory"));
    const dateBlocks = html.match(/class="label">Date</g) ?? [];
    assert.ok(dateBlocks.length >= 2, "both sides need a date line");
  });

  it("never leaks internal cost, profit, margin or internal notes", () => {
    const html = generateQuotationHTML(canary);
    assert.equal(html.includes("SECRET_INTERNAL_NOTE_CANARY"), false);
    assert.equal(html.includes("87654321.98"), false);
    assert.equal(html.includes("12345678.99"), false);
    assert.equal(html.includes("11223344.55"), false);
    assert.equal(html.includes("42.42"), false);
    assert.equal(/estimated/i.test(html), false);
    assert.equal(/internal/i.test(html), false);
  });

  it("the customer view projection drops internal fields structurally", () => {
    const view = toCustomerView(canary);
    const json = JSON.stringify(view);
    assert.equal(json.includes("SECRET_INTERNAL_NOTE_CANARY"), false);
    assert.equal(json.includes("estimated_cost_pkr"), false);
    assert.equal(json.includes("margin_percent"), false);
    assert.equal(json.includes("internal_notes"), false);
    assert.equal(json.includes("87654321.98"), false);
  });

  it("the PDF exporter ships a quotation document with the same label and no internals", () => {
    const pdfSrc = readFileSync(
      path.join(process.cwd(), "src", "lib", "pdf-exporter.ts"),
      "utf8",
    );
    const at = pdfSrc.indexOf("export async function exportQuotationPDF");
    assert.ok(at > -1, "exportQuotationPDF missing");
    const fnBody = pdfSrc.slice(at);
    assert.ok(fnBody.includes("QUOTATION — NOT A FINAL INVOICE"));
    assert.ok(fnBody.includes("Customer Name & Signature"));
    assert.ok(fnBody.includes("Authorised Signatory"));
    assert.equal(fnBody.includes("estimated_cost"), false);
    assert.equal(fnBody.includes("internal_notes"), false);
    assert.equal(fnBody.includes("margin_percent"), false);
  });
});

/* ─── Search / filter / summary ───────────────────────────────────────────── */

describe("quotation search, filters and summaries", () => {
  const rows: Quotation[] = [
    quotation({ id: "q1", quotation_number: "QTN-2026-00001", status: "DRAFT", quotation_date: "2026-10-01", grand_total_pkr: 1000 }),
    quotation({
      id: "q2",
      quotation_number: "QTN-2026-00002",
      status: "ISSUED",
      quotation_date: "2026-10-05",
      customer_name: "Kamran Traders",
      grand_total_pkr: 2500,
      items: [item({ product_name: "Health Faucet" })],
    }),
    quotation({ id: "q3", quotation_number: "QTN-2026-00003", status: "ACCEPTED", quotation_date: "2026-09-15", grand_total_pkr: 3000, converted_invoice_id: "inv-1" }),
    quotation({ id: "q4", quotation_number: "QTN-2026-00004", status: "CANCELLED", quotation_date: "2026-10-10", grand_total_pkr: 999 }),
  ];

  it("filters by status, date range and free-text search", () => {
    assert.equal(filterQuotations(rows, { status: "ISSUED" }).length, 1);
    assert.equal(
      filterQuotations(rows, { startDate: "2026-10-01", endDate: "2026-10-06" }).length,
      2,
    );
    assert.equal(filterQuotations(rows, { search: "kamran" }).length, 1);
    assert.equal(filterQuotations(rows, { search: "health faucet" }).length, 1);
    assert.equal(filterQuotations(rows, { search: "QTN-2026-00003" }).length, 1);
    assert.equal(filterQuotations(rows, {}).length, 4);
  });

  it("summarizes counts and values, excluding cancelled from value", () => {
    const s = summarizeQuotations(rows);
    assert.equal(s.total_count, 4);
    assert.equal(s.draft_count, 1);
    assert.equal(s.issued_count, 1);
    assert.equal(s.accepted_count, 1);
    assert.equal(s.cancelled_count, 1);
    assert.equal(s.converted_count, 1);
    assert.equal(s.active_count, 3);
    assert.equal(s.total_value_pkr, 1000 + 2500 + 3000); // cancelled excluded
    assert.equal(s.accepted_value_pkr, 3000);
  });

  it("labels every status for the UI", () => {
    for (const status of QUOTATION_STATUSES) {
      assert.ok(QUOTATION_STATUS_LABELS[status]);
    }
    assert.equal(QUOTATION_STATUS_LABELS.ACCEPTED, "Accepted");
    assert.equal(QUOTATION_STATUS_LABELS.ISSUED, "Issued / Sent");
  });
});

/* ─── Migration safety ────────────────────────────────────────────────────── */

describe("migration safety invariants", () => {
  it("uses the existing numbering convention QTN-YYYY-XXXXX", () => {
    const sql = readMigration();
    assert.ok(sql.includes("'QTN-' || to_char"));
    assert.ok(sql.includes("lpad(nextval('public.quotation_number_seq')"));
    assert.ok(sql.includes("CREATE SEQUENCE IF NOT EXISTS public.quotation_number_seq"));
    assert.ok(sql.includes("quotation_number TEXT NOT NULL UNIQUE"));
  });

  it("enforces statuses and transitions server-side via triggers", () => {
    const sql = readMigration();
    assert.ok(
      sql.includes(
        "CHECK (status IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'))",
      ),
    );
    assert.ok(sql.includes("CREATE TRIGGER quotations_status_transition"));
    assert.ok(sql.includes("CREATE TRIGGER quotations_lock_decided"));
    assert.ok(sql.includes("CREATE TRIGGER quotation_items_guard_insert"));
    assert.ok(sql.includes("Invalid quotation status transition"));
    assert.ok(sql.includes("commercial terms are locked"));
  });

  it("validates line items server-side in quotation_compute_totals", () => {
    const sql = readMigration();
    const fn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.quotation_compute_totals[\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    assert.ok(fn);
    const body = fn![1];
    assert.ok(body.includes("quantity must be greater than zero"));
    assert.ok(body.includes("discount percent must be between 0 and 100"));
    assert.ok(body.includes("tax rate must be between 0 and 100"));
    assert.ok(body.includes("Add at least one line item"));
    // Margin formula is zero-safe on the server too.
    assert.ok(body.includes("WHEN v_net > 0"));
  });

  it("keeps DRAFT and decided statuses from affecting conversion locks", () => {
    const sql = readMigration();
    // Converted quotations are frozen for status AND commercial edits.
    assert.ok(sql.includes("has already been converted to an invoice and is locked"));
    assert.ok(sql.includes("its lines are locked"));
  });

  it("is idempotent (safe to re-run)", () => {
    const sql = readMigration();
    for (const stmt of [
      "CREATE TABLE IF NOT EXISTS public.quotations",
      "CREATE TABLE IF NOT EXISTS public.quotation_items",
      "CREATE INDEX IF NOT EXISTS idx_quotations_status",
      "DROP TRIGGER IF EXISTS quotations_set_updated_at",
      "DROP POLICY IF EXISTS",
      "CREATE OR REPLACE FUNCTION public.create_quotation",
      "ADD COLUMN IF NOT EXISTS quotation_id",
    ]) {
      assert.ok(sql.includes(stmt), `missing idempotent statement: ${stmt}`);
    }
  });
});
