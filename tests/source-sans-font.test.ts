import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import jsPDF from "jspdf";
import { SANS_FONT, ensureSourceSansFont, hasSourceSansFont } from "@/lib/pdf-font";
import { generateQuotationHTML } from "@/lib/quotation-print";
import { generateStatementHTML } from "@/lib/statement-print";
import { generateInvoiceHTML } from "@/lib/supabase/invoicing";
import { generatePartyLedgerHTML } from "@/lib/supabase/crm";
import {
  exportExpensesReportPDF,
  exportPartyLedgerPDF,
  exportQuotationPDF,
} from "@/lib/pdf-exporter";

/**
 * Source Sans 3 is the typeface of the printable documents:
 * Invoice, Quotation, Customer Ledger / Account Statement and Expense Report.
 * These tests cover both rendering engines:
 *   - the A4 HTML print templates (@font-face + body font stack),
 *   - the jsPDF exports (faces embedded into the document VFS).
 */

const PUBLIC_DIR = path.join(process.cwd(), "public");

// Serve /public over fetch so the font files resolve outside the browser.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/fonts/")) {
    const rel = url.replace(/^\/+/, "").split("?")[0];
    const buf = readFileSync(path.join(PUBLIC_DIR, rel));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as Response;
  }
  return realFetch(input, init);
}) as typeof fetch;

/** Faces that must never appear in the four target documents again. */
const LEGACY_FACES = ["PT Serif", "Courier New", "Arial, Helvetica", "font-family:monospace"];

describe("Source Sans 3 in the HTML print templates", () => {
  const quotationHtml = generateQuotationHTML({
    id: "q1",
    quotation_number: "QTN-2026-00001",
    quotation_date: "2026-10-01",
    valid_until: "2026-10-31",
    customer_name: "Kamran Traders",
    customer_phone: "0300-0000000",
    customer_address: "GT Road, Gujranwala",
    status: "DRAFT",
    subtotal_pkr: 1000,
    discount_pkr: 0,
    tax_amount_pkr: 0,
    additional_charges_pkr: 0,
    grand_total_pkr: 1000,
    terms: "Payment within 7 days",
    notes: null,
    items: [
      {
        product_code: "SS-101",
        product_name: "Health Faucet",
        description: "Chrome finish",
        unit: "PCS",
        quantity: 2,
        unit_price_pkr: 500,
        discount_percent: 0,
        tax_rate: 0,
        line_total_pkr: 1000,
      },
    ],
  } as never);

  const invoiceHtml = generateInvoiceHTML({
    id: "i1",
    invoice_number: "INV-2026-00001",
    created_at: "2026-10-01T10:00:00.000Z",
    parties: { name: "Kamran Traders", phone: "0300-0000000", email: "k@example.com", address: "GT Road" },
    items: [],
  } as never);

  const statementHtml = generateStatementHTML({
    target: { type: "PARTY", name: "Kamran Traders", party_type: "CUSTOMER" },
    startDate: "2026-09-01",
    periodLabel: "01 Sep 2026 - 30 Sep 2026",
    rows: [
      { date: "2026-09-05", voucherNo: "RV-1", narration: "Sales invoice [INV-2026-7327]", debit: 5000, credit: 0, balance: 5000 },
    ],
    openingBalance: 0,
    periodDebit: 5000,
    periodCredit: 0,
    closingBalance: 5000,
    closingLabel: "Amount Receivable",
    closingUrLabel: "واجب الوصول رقم",
    conventionNote: "Sales invoices are debits - receipts are credits.",
  });

  const ledgerHtml = generatePartyLedgerHTML(
    { id: "p1", name: "Kamran Traders", party_type: "CUSTOMER", phone: "0300-0000000", address: "GT Road" } as never,
    [
      {
        id: "v1",
        date: "2026-09-10",
        doc_type: "SALES_INVOICE",
        doc_no: "INV-2026-7327",
        side: "buy",
        remarks: "SALES INVOICE - TO Kamran Traders",
        debit: 5000,
        credit: 0,
        balance: 5000,
      },
    ] as never,
    { openingBalance: 0 }
  );

  const documents: Record<string, string> = {
    Invoice: invoiceHtml,
    Quotation: quotationHtml,
    "Account Statement": statementHtml,
    "Customer Ledger": ledgerHtml,
  };

  for (const [name, html] of Object.entries(documents)) {
    describe(name, () => {
      it("declares all five Source Sans 3 faces", () => {
        assert.equal((html.match(/@font-face\{font-family:'Source Sans 3'/g) ?? []).length, 5);
      });

      it("sets the Source Sans 3 stack with a regular 400 body weight", () => {
        assert.ok(/body\{[^}]*'Source Sans 3'/.test(html) || /body \{ font-family: 'Source Sans 3'/.test(html));
        assert.ok(/body\{[^}]*font-weight:400/.test(html) || /body \{ font-family:[^}]*font-weight: 400/.test(html));
      });

      it("uses SemiBold for headers and tabular figures for numbers", () => {
        assert.ok(/font-weight:600/.test(html));
        assert.ok(/font-variant-numeric:\s*tabular-nums/.test(html));
      });

      it("carries no legacy font definitions", () => {
        const found = LEGACY_FACES.filter((face) => html.includes(face));
        assert.deepEqual(found, []);
      });
    });
  }
});

describe("Source Sans 3 in the jsPDF exports", () => {
  it("embeds all five faces into the document", async () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    assert.equal(await ensureSourceSansFont(doc), true);
    assert.equal(hasSourceSansFont(doc), true);

    const styles = (doc.getFontList() as Record<string, string[]>)[SANS_FONT] ?? [];
    for (const style of ["light", "normal", "italic", "semibold", "bold"]) {
      assert.ok(styles.includes(style), `missing ${style} style: ${styles.join(",")}`);
    }

    doc.setFont(SANS_FONT, "semibold");
    const width = doc.getTextWidth("INV-2026-00001  PKR 1,234.56");
    assert.ok(width > 0 && width < 80, `unexpected semibold width ${width}`);

    const pdfText = Buffer.from(doc.output("arraybuffer") as ArrayBuffer).toString("latin1");
    assert.ok(pdfText.includes("SourceSans3"), "PDF output does not embed SourceSans3");
  });

  it("renders the Quotation, Expense Report and Customer Ledger exports with it", async () => {
    // Node has no print dialog; outputReport falls back to doc.save() there, so stub
    // the write on jsPDF.API (jsPDF copies API members onto each instance) to keep
    // the test run from dropping PDF files into the working directory.
    const api = (jsPDF as unknown as { API: { save: () => void; autoPrint: () => unknown } }).API;
    api.save = () => {};
    api.autoPrint = () => undefined;

    const quotation = await exportQuotationPDF({
      id: "q1",
      quotation_number: "QTN-2026-00001",
      quotation_date: "2026-10-01",
      valid_until: null,
      customer_name: "Kamran Traders",
      customer_phone: null,
      customer_address: null,
      status: "DRAFT",
      subtotal_pkr: 1000,
      discount_pkr: 100,
      tax_amount_pkr: 0,
      grand_total_pkr: 900,
      terms: "Payment within 7 days",
      notes: null,
      items: [
        { product_code: "SS-101", product_name: "Health Faucet", unit: "PCS", quantity: 2, unit_price_pkr: 500, discount_percent: 0, line_total_pkr: 1000 },
      ],
    } as never);
    assert.equal(hasSourceSansFont(quotation), true);

    const expenses = await exportExpensesReportPDF([
      {
        id: "e1",
        expense_number: "EXP-2026-0001",
        expense_date: "2026-10-02",
        category: "Transport",
        description: "Truck hire",
        payee_name: "Kamran Transport",
        status: "PAID",
        amount: 12000,
      },
    ] as never);
    assert.equal(hasSourceSansFont(expenses), true);

    const ledger = await exportPartyLedgerPDF({
      targetName: "Kamran Traders",
      accountCode: "1100",
      partyType: "CUSTOMER",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      openingBalance: 0,
      periodDebit: 5000,
      periodCredit: 2000,
      closingBalance: 3000,
      transactions: [
        { date: "2026-09-05", voucherNo: "INV-1", narration: "Sales invoice", debit: 5000, credit: 0, balance: 5000 },
        { date: "2026-09-10", voucherNo: "RV-1", narration: "Receipt", debit: 0, credit: 2000, balance: 3000 },
      ],
    });
    assert.equal(hasSourceSansFont(ledger), true);

    for (const [name, doc] of [["quotation", quotation], ["expense report", expenses], ["customer ledger", ledger]] as const) {
      const pdfText = Buffer.from(doc.output("arraybuffer") as ArrayBuffer).toString("latin1");
      assert.ok(pdfText.includes("SourceSans3"), `${name} PDF does not embed SourceSans3`);
    }
  });
});
