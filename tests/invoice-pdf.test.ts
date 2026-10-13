/**
 * Sales-invoice PDF (generateInvoiceHTML) regression tests.
 *
 * Bug fixed: the A4 invoice table's "Disc%" column rendered a single
 * invoice-level percent (extraDiscount / grossTotal) on every row, so a
 * per-line discount stored on sales_invoice_items (discount_percent /
 * discount_pkr) printed "0.00" while the row's net Total Price was correct.
 *
 * The column must show each row's OWN line discount:
 *   - prefer the stored discount_percent,
 *   - else derive the percent from a flat discount_pkr against qty × price,
 *   - never emit NaN for missing/undefined discount fields.
 *
 * Second report: the summary "Discount / Extra Discount (XD)" row printed
 * PKR 0.00 when discounts were entered per line — it must show the SUM of the
 * per-line discounts plus any invoice-level XD amount, with the items-table
 * "Total" row showing the gross before discounts (gross − discount = taxable).
 *
 * The SUT module reads NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY at module scope,
 * so the env is set at file load and the module is imported in `before()`.
 * node --test runs each file in an isolated process.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type {
  SalesInvoice,
  SalesInvoiceItem,
} from "../src/lib/supabase/invoicing";

type Gen = (invoice: SalesInvoice) => string;

/** Returns the <tr> fragment that contains the given marker text. */
function rowContaining(html: string, marker: string): string {
  const rows = html.split("<tr>");
  const row = rows.find((r) => r.includes(marker));
  assert.ok(row, `expected a table row containing "${marker}"`);
  return row;
}

describe("generateInvoiceHTML — per-line discount column", () => {
  let generateInvoiceHTML: Gen;

  before(async () => {
    ({ generateInvoiceHTML } = await import(
      "../src/lib/supabase/invoicing"
    ));
  });

  const invoiceWith = (
    items: SalesInvoiceItem[],
    extra: Partial<SalesInvoice> = {},
  ): SalesInvoice =>
    ({
      id: "inv-1",
      invoice_number: "INV-2026-00001",
      customer_id: "cust-1",
      taxable_value_pkr: 0,
      sales_tax_rate: 0,
      sales_tax_amount_pkr: 0,
      further_tax_rate: 0,
      further_tax_amount_pkr: 0,
      total_invoice_value_pkr: 0,
      is_posted: false,
      created_at: "2026-10-13T10:00:00Z",
      items,
      ...extra,
    }) as SalesInvoice;

  it("shows the stored per-line discount percent (reported bug: always 0.00)", () => {
    // T-nuts: 14 × 200 = 2,800 gross, 20% line discount → net 2,240 stored.
    // Invoice-level discount is 0 — the old code printed 0.00 here.
    const html = generateInvoiceHTML(
      invoiceWith(
        [
          {
            id: "li-1",
            invoice_id: "inv-1",
            product_id: "p-1",
            product_name: "T-nuts",
            quantity: 14,
            unit_price_pkr: 200,
            line_total_pkr: 2240,
            unit_of_measure: "PCS",
            discount_percent: 20,
            discount_pkr: 560,
          },
        ],
        { taxable_value_pkr: 2240, total_invoice_value_pkr: 2240 },
      ),
    );
    const row = rowContaining(html, "T-nuts");
    assert.match(row, /<td class="num">20\.00<\/td>/, "Disc% cell must show the line's own 20%");
    assert.match(row, /<td class="num">2,240\.00<\/td>/, "net line total must remain correct");
  });

  it("derives the percent from a flat PKR discount when no percent is stored", () => {
    const html = generateInvoiceHTML(
      invoiceWith([
        {
          id: "li-1",
          invoice_id: "inv-1",
          product_id: "p-1",
          product_name: "Handles",
          quantity: 10,
          unit_price_pkr: 100,
          line_total_pkr: 750,
          unit_of_measure: "PCS",
          discount_percent: 0,
          discount_pkr: 250, // 250 / 1,000 = 25%
        },
      ]),
    );
    const row = rowContaining(html, "Handles");
    assert.match(row, /<td class="num">25\.00<\/td>/);
    assert.match(row, /<td class="num">750\.00<\/td>/);
  });

  it("renders 0.00 (not NaN) when discount fields are missing on legacy rows", () => {
    const html = generateInvoiceHTML(
      invoiceWith([
        {
          id: "li-1",
          invoice_id: "inv-1",
          product_id: "p-1",
          product_name: "Legacy Pipe",
          quantity: 5,
          unit_price_pkr: 50,
          line_total_pkr: 250,
          unit_of_measure: "PCS",
          // discount_percent / discount_pkr intentionally absent (undefined)
        },
      ]),
    );
    const row = rowContaining(html, "Legacy Pipe");
    assert.match(row, /<td class="num">0\.00<\/td>/);
    assert.doesNotMatch(row, /NaN/, "missing discounts must never print NaN");
  });

  it("maps each row its OWN discount, not one shared invoice-level percent", () => {
    const html = generateInvoiceHTML(
      invoiceWith([
        {
          id: "li-1",
          invoice_id: "inv-1",
          product_id: "p-1",
          product_name: "Discounted Item",
          quantity: 2,
          unit_price_pkr: 100,
          line_total_pkr: 180, // 10%
          unit_of_measure: "PCS",
          discount_percent: 10,
          discount_pkr: 20,
        },
        {
          id: "li-2",
          invoice_id: "inv-1",
          product_id: "p-2",
          product_name: "Full Price Item",
          quantity: 3,
          unit_price_pkr: 100,
          line_total_pkr: 300, // no discount
          unit_of_measure: "PCS",
          discount_percent: 0,
          discount_pkr: 0,
        },
      ]),
    );
    const discounted = rowContaining(html, "Discounted Item");
    const fullPrice = rowContaining(html, "Full Price Item");
    assert.match(discounted, /<td class="num">10\.00<\/td>/);
    assert.match(fullPrice, /<td class="num">0\.00<\/td>/);
  });

  it("summary Discount row sums the per-line discounts (reported bug: PKR 0.00)", () => {
    // Mirror of the reported invoice: four T-nuts lines with line discounts only.
    const line = (
      id: string,
      qty: number,
      pct: number,
      net: number,
    ): SalesInvoiceItem => ({
      id,
      invoice_id: "inv-1",
      product_id: "p-1",
      product_name: "T-nuts",
      quantity: qty,
      unit_price_pkr: 200,
      line_total_pkr: net,
      unit_of_measure: "PCS",
      discount_percent: pct,
      discount_pkr: Math.round(qty * 200 * pct) / 100,
    });
    const html = generateInvoiceHTML(
      invoiceWith(
        [
          line("li-1", 14, 20, 2240), // 560 off
          line("li-2", 6, 10, 1080), // 120 off
          line("li-3", 7, 3, 1358), // 42 off
          line("li-4", 14, 6, 2632), // 168 off
        ],
        {
          taxable_value_pkr: 7310,
          sales_tax_amount_pkr: 1315.8,
          total_invoice_value_pkr: 8625.8,
        },
      ),
    );
    // 560 + 120 + 42 + 168 = 890 of line discounts, invoice-level XD = 0.
    assert.match(html, /PKR 890\.00/, "summary must show the total discount");
    // Total row shows the gross before discounts: 7,310 net + 890 = 8,200.
    assert.match(
      html,
      /<td class="num">8,200\.00<\/td>/,
      "Total row must show the gross line value",
    );
  });

  it("combines line discounts with an invoice-level XD discount in the summary", () => {
    const html = generateInvoiceHTML(
      invoiceWith(
        [
          {
            id: "li-1",
            invoice_id: "inv-1",
            product_id: "p-1",
            product_name: "Combo Item",
            quantity: 10,
            unit_price_pkr: 100,
            line_total_pkr: 900, // 100 line discount
            unit_of_measure: "PCS",
            discount_percent: 10,
            discount_pkr: 100,
          },
        ],
        {
          discount_pkr: 50, // invoice-level XD on top
          taxable_value_pkr: 850,
          total_invoice_value_pkr: 850,
        },
      ),
    );
    assert.match(html, /PKR 150\.00/, "100 line + 50 XD = 150 total discount");
  });

  it("still prints the invoice-level extra discount in the summary block", () => {
    const html = generateInvoiceHTML(
      invoiceWith(
        [
          {
            id: "li-1",
            invoice_id: "inv-1",
            product_id: "p-1",
            product_name: "Item A",
            quantity: 1,
            unit_price_pkr: 1000,
            line_total_pkr: 1000,
            unit_of_measure: "PCS",
            discount_percent: 0,
            discount_pkr: 0,
          },
        ],
        {
          discount_pkr: 50, // invoice-level XD discount
          taxable_value_pkr: 950,
          total_invoice_value_pkr: 950,
        },
      ),
    );
    assert.match(html, /Discount \/ Extra Discount \(XD\)/);
    assert.match(html, /PKR 50\.00/);
  });

  it("caps the derived percent at 100 when a flat discount exceeds the gross line", () => {
    const html = generateInvoiceHTML(
      invoiceWith([
        {
          id: "li-1",
          invoice_id: "inv-1",
          product_id: "p-1",
          product_name: "Odd Data",
          quantity: 1,
          unit_price_pkr: 100,
          line_total_pkr: 0,
          unit_of_measure: "PCS",
          discount_percent: 0,
          discount_pkr: 500, // > gross 100 — must clamp to 100.00
        },
      ]),
    );
    const row = rowContaining(html, "Odd Data");
    assert.match(row, /<td class="num">100\.00<\/td>/);
  });
});
