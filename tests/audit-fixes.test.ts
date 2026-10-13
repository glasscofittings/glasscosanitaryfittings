/**
 * QA audit regression tests — fetch-stubbed behaviour for the defects
 * confirmed and fixed during the independent audit:
 *
 *  expenses:  fallback posting never leaves orphan/partial journal entries,
 *             payment settlement is CAS-guarded and compensates on failure,
 *             cancel aborts before the status flip when cleanup fails,
 *             draft edits PATCH (never re-post), draft delete is row-aware.
 *  invoicing: a unique violation is no longer masked as "run the migration",
 *             a line failure rolls the invoice back and never deducts stock,
 *             posting a sales invoice is idempotent and ledger-first.
 *  quotations: conversion refuses to adopt a line-less invoice artifact and
 *             never creates a second invoice when recovering.
 *
 * The SUT modules read NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY at module scope,
 * so the env is set at file load and the modules are imported inside a
 * `before()` hook. node --test runs each test file in an isolated process,
 * so the global fetch stub cannot leak into the other suites.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { CreateExpenseInput, Expense } from "../src/lib/supabase/expenses";
import type { SalesInvoice, DispatchLineItem } from "../src/lib/supabase/invoicing";
import type { Quotation } from "../src/lib/supabase/quotations";

/* ─── Fetch stub ─────────────────────────────────────────────────────────── */

type StubResult = { status?: number; body?: unknown };
type StubHandler = (
  url: string,
  method: string,
  body: string | null,
) => StubResult | null;

interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

const calls: RecordedCall[] = [];
const handlers: StubHandler[] = [];
const realFetch = globalThis.fetch;

function on(handler: StubHandler): void {
  handlers.push(handler);
}

/** Convenience: match url+method to a canned response. */
function route(frag: string, method: string, result: StubResult): void {
  on((url, m) => (m === method && url.includes(frag) ? result : null));
}

function find(frag: string, method?: string): RecordedCall[] {
  return calls.filter(
    (c) => c.url.includes(frag) && (!method || c.method === method),
  );
}

beforeEach(() => {
  calls.length = 0;
  handlers.length = 0;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body == null
          ? null
          : String(init.body);
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(
        init.headers as Record<string, string>,
      )) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    calls.push({ url, method, body, headers });
    for (const h of handlers) {
      const r = h(url, method, body);
      if (r) {
        const status = r.status ?? 200;
        // 204/205/304 must not carry a body (Response ctor throws otherwise).
        if (status === 204 || status === 205 || status === 304) {
          return new Response(null, { status });
        }
        return new Response(JSON.stringify(r.body ?? []), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(
      JSON.stringify({ message: `unstubbed: ${method} ${url}` }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ─── Fixtures ───────────────────────────────────────────────────────────── */

const paidInput: CreateExpenseInput = {
  expense_date: "2026-10-13",
  category: "FUEL",
  description: "Diesel for factory generator",
  amount: 45000,
  payment_method: "CASH",
  expense_account_id: "acc-expense-uuid",
  payment_account_id: "acc-cash-uuid",
  status: "PAID",
  payee_name: "PSO Station",
};

const unpaidExpense: Expense = {
  id: "exp-1",
  expense_number: "EXP-2026-000001",
  expense_date: "2026-10-13",
  category: "RENT",
  description: "Factory monthly lease",
  amount: 150000,
  payment_method: "PAYABLE",
  expense_account_id: "acc-expense-rent",
  payment_account_id: null,
  payable_account_id: "acc-ap-2001",
  party_id: null,
  payee_name: "Landlord",
  notes: null,
  status: "UNPAID",
  receipt_url: null,
  journal_entry_id: "je-accrual",
  payment_journal_entry_id: null,
  operator_name: null,
  device_node: null,
  created_at: "2026-10-13T08:00:00Z",
  updated_at: "2026-10-13T08:00:00Z",
};

const salesInvoice: SalesInvoice = {
  id: "inv-1",
  invoice_number: "INV-2026-0777",
  customer_id: "cust-1",
  taxable_value_pkr: 1000,
  sales_tax_rate: 0,
  sales_tax_amount_pkr: 0,
  further_tax_rate: 0,
  further_tax_amount_pkr: 0,
  total_invoice_value_pkr: 1000,
  is_posted: false,
  created_at: "2026-10-13T10:00:00Z",
  parties: {
    id: "cust-1",
    name: "Acme Traders",
    party_type: "CUSTOMER",
    is_registered: false,
  },
};

const quotationFixture = {
  id: "qtn-1",
  quotation_number: "QTN-2026-00001",
  status: "ACCEPTED",
  converted_invoice_id: null,
  converted_at: null,
  customer_id: "party-1",
  customer_name: "Acme Traders",
  valid_until: "2026-12-31",
  items: [
    { id: "qi-1", quotation_id: "qtn-1", product_name: "Basin Mixer", quantity: 1 },
  ],
} as unknown as Quotation;

function rpcMissing(frag: string): void {
  route(`/rest/v1/rpc/${frag}`, "POST", {
    status: 404,
    body: { message: "function not found" },
  });
}

/* ─── SUT modules (imported after env is set) ────────────────────────────── */

let expenses: typeof import("../src/lib/supabase/expenses");
let invoicing: typeof import("../src/lib/supabase/invoicing");
let quotations: typeof import("../src/lib/supabase/quotations");

before(async () => {
  expenses = await import("../src/lib/supabase/expenses");
  invoicing = await import("../src/lib/supabase/invoicing");
  quotations = await import("../src/lib/supabase/quotations");
});

/* ─── Expenses: create fallback ──────────────────────────────────────────── */

describe("QA audit - expense create fallback (RPC missing)", () => {
  it("never saves a PAID expense when its journal header fails", async () => {
    rpcMissing("create_or_post_expense");
    route("/rest/v1/journal_entries", "POST", {
      status: 500,
      body: { message: "db unavailable" },
    });

    const res = await expenses.createExpense(paidInput);

    assert.ok(res.error, "must fail loudly instead of saving PAID without money");
    assert.equal(res.data, null);
    assert.equal(find("/rest/v1/expenses", "POST").length, 0);
    assert.equal(find("/rest/v1/journal_lines", "POST").length, 0);
  });

  it("removes the posted journal when the expense row insert fails (no orphan on retry)", async () => {
    rpcMissing("create_or_post_expense");
    route("/rest/v1/journal_entries", "POST", { status: 201, body: [{ id: "je-1" }] });
    route("/rest/v1/journal_lines", "POST", { status: 201, body: [{}, {}] });
    route("/rest/v1/expenses", "POST", { status: 500, body: { message: "chk failed" } });

    const res = await expenses.createExpense(paidInput);

    assert.ok(res.error?.includes("Failed to insert expense record"));
    assert.equal(
      find("/rest/v1/journal_lines?journal_entry_id=eq.je-1", "DELETE").length,
      1,
      "lines must be rolled back",
    );
    assert.equal(
      find("/rest/v1/journal_entries?id=eq.je-1", "DELETE").length,
      1,
      "header must be rolled back",
    );
  });

  it("keeps debits = credits in the fallback lines it posts", async () => {
    rpcMissing("create_or_post_expense");
    route("/rest/v1/journal_entries", "POST", { status: 201, body: [{ id: "je-2" }] });
    route("/rest/v1/journal_lines", "POST", { status: 201, body: [{}, {}] });
    route("/rest/v1/expenses", "POST", {
      status: 201,
      body: [{ ...unpaidExpense, status: "PAID" }],
    });

    const res = await expenses.createExpense(paidInput);
    assert.ok(res.data);

    const lines = JSON.parse(find("/rest/v1/journal_lines", "POST")[0].body!);
    const debit = lines.reduce((a: number, l: { debit_pkr: number }) => a + l.debit_pkr, 0);
    const credit = lines.reduce((a: number, l: { credit_pkr: number }) => a + l.credit_pkr, 0);
    assert.equal(debit, credit);
    assert.equal(debit, paidInput.amount);
  });
});

/* ─── Expenses: payment settlement fallback ──────────────────────────────── */

describe("QA audit - expense payment settlement (RPC missing)", () => {
  function stubUpToLines(failLines: boolean): void {
    rpcMissing("pay_unpaid_expense");
    route("/rest/v1/expenses?id=eq.exp-1", "GET", { status: 200, body: [unpaidExpense] });
    route("/rest/v1/journal_entries", "POST", { status: 201, body: [{ id: "je-9" }] });
    route(
      "/rest/v1/journal_lines",
      "POST",
      failLines ? { status: 500, body: { message: "line failed" } } : { status: 201, body: [{}, {}] },
    );
  }

  it("removes the empty header when the payment lines fail, without touching the expense", async () => {
    stubUpToLines(true);

    const res = await expenses.payUnpaidExpense("exp-1", "acc-bank", "BANK", "2026-10-13", "QA");

    assert.ok(res.error?.includes("payment journal lines"));
    assert.equal(res.data, null);
    assert.equal(find("/rest/v1/journal_entries?id=eq.je-9", "DELETE").length, 1);
    assert.equal(find("/rest/v1/expenses", "PATCH").length, 0, "status must stay UNPAID");
  });

  it("rolls back its own journal when the compare-and-set status flip is lost (no double credit)", async () => {
    stubUpToLines(false);
    // CAS misses: the row is no longer UNPAID (concurrent/earlier payment).
    route("/rest/v1/expenses", "PATCH", { status: 200, body: [] });

    const res = await expenses.payUnpaidExpense("exp-1", "acc-bank", "BANK", "2026-10-13", "QA");

    assert.ok(res.error?.includes("no ledger change was kept"));
    const patch = find("/rest/v1/expenses", "PATCH")[0];
    assert.ok(patch.url.includes("status=eq.UNPAID"), "PATCH must be status-guarded");
    assert.equal(find("/rest/v1/journal_lines?journal_entry_id=eq.je-9", "DELETE").length, 1);
    assert.equal(find("/rest/v1/journal_entries?id=eq.je-9", "DELETE").length, 1);
  });

  it("posts exactly one balanced entry and flips the status on success", async () => {
    stubUpToLines(false);
    route("/rest/v1/expenses", "PATCH", {
      status: 200,
      body: [{ ...unpaidExpense, status: "PAID", payment_journal_entry_id: "je-9" }],
    });

    const res = await expenses.payUnpaidExpense("exp-1", "acc-bank", "BANK", "2026-10-13", "QA");

    assert.ok(res.data);
    assert.equal(res.data.status, "PAID");
    assert.equal(find("/rest/v1/journal_lines", "POST").length, 1);
    assert.equal(find("/rest/v1/journal_entries?id=eq.je-9", "DELETE").length, 0);

    const lines = JSON.parse(find("/rest/v1/journal_lines", "POST")[0].body!);
    const debit = lines.reduce((a: number, l: { debit_pkr: number }) => a + l.debit_pkr, 0);
    const credit = lines.reduce((a: number, l: { credit_pkr: number }) => a + l.credit_pkr, 0);
    assert.equal(debit, credit);
    assert.equal(debit, unpaidExpense.amount); // Dr AP / Cr Cash for the full amount
  });

  it("validates the payable account before any ledger write", async () => {
    rpcMissing("pay_unpaid_expense");
    route("/rest/v1/expenses?id=eq.exp-1", "GET", {
      status: 200,
      body: [{ ...unpaidExpense, payable_account_id: null }],
    });

    const res = await expenses.payUnpaidExpense("exp-1", "acc-bank", "BANK", "2026-10-13", "QA");

    assert.ok(res.error?.includes("payable account"));
    assert.equal(find("/rest/v1/journal_entries", "POST").length, 0, "no orphan header");
  });
});

/* ─── Expenses: edit / delete / cancel ───────────────────────────────────── */

describe("QA audit - expense edit, delete and cancel guards", () => {
  it("updateExpenseDraft validates before touching the network", async () => {
    const res = await expenses.updateExpenseDraft("exp-1", { ...paidInput, amount: 0 });
    assert.ok(res.error);
    assert.equal(res.data, null);
    assert.equal(calls.length, 0);
  });

  it("updateExpenseDraft PATCHes with a DRAFT guard and refuses posted rows", async () => {
    route("/rest/v1/expenses?id=eq.exp-1&status=eq.DRAFT", "PATCH", {
      status: 200,
      body: [],
    });

    const res = await expenses.updateExpenseDraft("exp-1", paidInput);

    assert.equal(find("/rest/v1/expenses", "PATCH").length, 1);
    assert.ok(res.error?.includes("Only DRAFT expenses can be edited"));
    assert.equal(res.data, null);
  });

  it("updateExpenseDraft returns the updated row on success", async () => {
    route("/rest/v1/expenses?id=eq.exp-1&status=eq.DRAFT", "PATCH", {
      status: 200,
      body: [{ ...unpaidExpense, status: "DRAFT", amount: 50000 }],
    });

    const res = await expenses.updateExpenseDraft("exp-1", paidInput);

    assert.ok(res.data);
    assert.equal(res.data.amount, 50000);
    assert.equal(res.data.status, "DRAFT");
    // Editing must never touch the journal columns.
    const sent = JSON.parse(find("/rest/v1/expenses", "PATCH")[0].body!);
    assert.equal("journal_entry_id" in sent, false);
    assert.equal("status" in sent, false);
  });

  it("deleteExpenseDraft treats a zero-row DELETE as failure", async () => {
    route("/rest/v1/expenses?id=eq.exp-1&status=eq.DRAFT", "DELETE", {
      status: 200,
      body: [],
    });
    const miss = await expenses.deleteExpenseDraft("exp-1");
    assert.equal(miss.success, false);
    assert.ok(miss.error);

    const hit = await (async () => {
      handlers.length = 0;
      route("/rest/v1/expenses?id=eq.exp-1&status=eq.DRAFT", "DELETE", {
        status: 200,
        body: [{ id: "exp-1" }],
      });
      return expenses.deleteExpenseDraft("exp-1");
    })();
    assert.equal(hit.success, true);
  });

  it("cancelExpense aborts before the status flip when journal cleanup fails", async () => {
    rpcMissing("cancel_expense");
    route("/rest/v1/expenses?id=eq.exp-1", "GET", {
      status: 200,
      body: [{ ...unpaidExpense, status: "PAID", journal_entry_id: "je-1" }],
    });
    route("/rest/v1/journal_lines?journal_entry_id=eq.je-1", "DELETE", {
      status: 500,
      body: { message: "locked" },
    });

    const res = await expenses.cancelExpense("exp-1", "QA", "audit test");

    assert.ok(res.error?.includes("Cancel failed"));
    assert.equal(res.data, null);
    assert.equal(find("/rest/v1/expenses", "PATCH").length, 0, "must stay retryable");
  });
});

/* ─── Invoicing: createInvoice error classification & atomicity ──────────── */

describe("QA audit - invoice creation", () => {
  const base = {
    customer_id: "cust-1",
    taxable_value_pkr: 1000,
    sales_tax_rate: 18,
    sales_tax_amount_pkr: 180,
    further_tax_rate: 0,
    further_tax_amount_pkr: 0,
    total_invoice_value_pkr: 1180,
    quotation_id: "qtn-1",
    device_node: "PC-01",
    operator_name: "QA",
  };

  it("keeps a unique violation recognisable so conversion recovery can match it", async () => {
    route("/rest/v1/sales_invoices", "POST", {
      status: 409,
      body: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "uniq_sales_invoices_quotation_id", key (quotation_id)=(qtn-1)',
      },
    });

    const res = await invoicing.createInvoice(base);

    assert.equal(res.invoice, null);
    assert.ok(res.error);
    assert.match(res.error!, /uniq_sales_invoices_quotation_id|duplicate key/i);
    assert.doesNotMatch(res.error!, /Run migration/, "must not masquerade as a missing migration");
  });

  it("still reports the migration hint when the quotation_id column truly is missing", async () => {
    route("/rest/v1/sales_invoices", "POST", {
      status: 400,
      body: { message: 'column sales_invoices.quotation_id does not exist' },
    });

    const res = await invoicing.createInvoice(base);

    assert.equal(res.invoice, null);
    assert.ok(res.error?.includes("Run migration"));
    assert.doesNotMatch(res.error!, /duplicate key/i);
  });

  it("rolls the header back and never deducts stock when lines fail to save", async () => {
    route("/rest/v1/sales_invoices", "POST", {
      status: 201,
      body: { id: "inv-9", invoice_number: "INV-2026-9999" },
    });
    route("/rest/v1/sales_invoice_items", "POST", {
      status: 500,
      body: { message: "items unavailable" },
    });
    route("/rest/v1/sales_invoice_items?invoice_id=eq.inv-9", "DELETE", { status: 204 });
    route("/rest/v1/sales_invoices?id=eq.inv-9", "DELETE", { status: 204 });

    const items = [
      {
        product_id: "prod-1",
        product_name: "Basin Mixer",
        quantity: 2,
        unit_price_pkr: 500,
        line_total_pkr: 1000,
        unit_of_measure: "PCS",
      },
    ] as unknown as DispatchLineItem[];

    const res = await invoicing.createInvoice({ ...base, items });

    assert.equal(res.invoice, null);
    assert.ok(res.error?.includes("nothing was recorded"));
    assert.equal(find("/rest/v1/sales_invoices?id=eq.inv-9", "DELETE").length, 1);
    assert.equal(find("sanitary_products").length, 0, "stock must not move");
    assert.equal(find("deduct_product_stock").length, 0, "stock must not move");
  });
});

/* ─── Invoicing: postInvoiceWithLedger idempotency & ordering ────────────── */

describe("QA audit - sales invoice posting", () => {
  it("is a complete no-op when the invoice is already posted with its journal", async () => {
    route("/rest/v1/journal_entries?narration=ilike.", "GET", {
      status: 200,
      body: [{ id: "je-0" }],
    });

    const ok = await invoicing.postInvoiceWithLedger({ ...salesInvoice, is_posted: true });

    assert.equal(ok, true);
    assert.equal(find("/rest/v1/journal_entries", "POST").length, 0);
    assert.equal(find("/rest/v1/sales_invoices", "PATCH").length, 0);
  });

  it("creates the balanced ledger entry first, flags posted second, exactly once", async () => {
    let journalExists = false;
    on((url, method) => {
      if (method === "GET" && url.includes("journal_entries?narration=ilike")) {
        return { status: 200, body: journalExists ? [{ id: "je-1" }] : [] };
      }
      if (method === "POST" && url.includes("/rest/v1/journal_entries")) {
        journalExists = true;
        return { status: 201, body: { id: "je-1" } };
      }
      if (method === "GET" && url.includes("/rest/v1/accounts_chart")) {
        return { status: 200, body: [{ id: "acc-chart-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/journal_lines")) {
        return { status: 201, body: [{}, {}] };
      }
      if (method === "POST" && url.includes("/rest/v1/system_audit_logs")) {
        return { status: 200, body: {} };
      }
      if (method === "PATCH" && url.includes("/rest/v1/sales_invoices")) {
        return { status: 204 };
      }
      return null;
    });

    const ok = await invoicing.postInvoiceWithLedger(salesInvoice);
    assert.equal(ok, true);

    const journalIdx = calls.findIndex(
      (c) => c.method === "POST" && c.url.includes("/rest/v1/journal_entries"),
    );
    const flagIdx = calls.findIndex(
      (c) => c.method === "PATCH" && c.url.includes("/rest/v1/sales_invoices"),
    );
    assert.ok(journalIdx >= 0 && flagIdx >= 0, "both writes must happen");
    assert.ok(journalIdx < flagIdx, "ledger entry must be created BEFORE the posted flag");

    // createJournalEntry may post lines individually or as a batch — flatten both.
    const lines = find("/rest/v1/journal_lines", "POST").flatMap((c) => {
      const parsed = JSON.parse(c.body!);
      return Array.isArray(parsed) ? parsed : [parsed];
    });
    const debit = lines.reduce((a: number, l: { debit_pkr: number }) => a + l.debit_pkr, 0);
    const credit = lines.reduce((a: number, l: { credit_pkr: number }) => a + l.credit_pkr, 0);
    assert.equal(debit, credit);
    assert.equal(debit, salesInvoice.taxable_value_pkr);

    // A second call (stale UI / double click) must not create a second entry.
    const again = await invoicing.postInvoiceWithLedger({ ...salesInvoice, is_posted: true });
    assert.equal(again, true);
    assert.equal(find("/rest/v1/journal_entries", "POST").length, 1, "exactly one JE per invoice");
  });

  it("leaves the invoice unflagged when the journal fails, so posting stays retryable", async () => {
    route("/rest/v1/journal_entries?narration=ilike.", "GET", { status: 200, body: [] });
    route("/rest/v1/journal_entries", "POST", { status: 500, body: { message: "down" } });

    const ok = await invoicing.postInvoiceWithLedger(salesInvoice);

    assert.equal(ok, false);
    assert.equal(
      find("/rest/v1/sales_invoices", "PATCH").length,
      0,
      "is_posted must not be set when the ledger entry is missing",
    );
  });
});

/* ─── Quotations: conversion recovery ────────────────────────────────────── */

describe("QA audit - quotation conversion recovery", () => {
  it("refuses to adopt a line-less invoice artifact and links nothing", async () => {
    route("/rest/v1/sales_invoices?quotation_id=eq.qtn-1", "GET", {
      status: 200,
      body: [{ id: "inv-42", invoice_number: "INV-2026-1234" }],
    });
    route("/rest/v1/sales_invoice_items?invoice_id=eq.inv-42", "GET", {
      status: 200,
      body: [],
    });

    const res = await quotations.convertQuotationToInvoice(quotationFixture, {
      role: "OWNER",
    });

    assert.equal(res.invoice, null);
    assert.ok(res.error?.includes("no line items"));
    assert.equal(find("/rest/v1/sales_invoices", "POST").length, 0);
    assert.equal(find("link_quotation_invoice").length, 0, "must not lock the quotation");
  });

  it("recovers a healthy prior invoice without ever creating a second one", async () => {
    route("/rest/v1/sales_invoices?quotation_id=eq.qtn-1", "GET", {
      status: 200,
      body: [{ id: "inv-42", invoice_number: "INV-2026-1234" }],
    });
    route("/rest/v1/sales_invoice_items?invoice_id=eq.inv-42", "GET", {
      status: 200,
      body: [{ id: "li-1" }],
    });
    route("/rpc/link_quotation_invoice", "POST", { status: 200, body: { id: "qtn-1" } });

    const res = await quotations.convertQuotationToInvoice(quotationFixture, {
      role: "OWNER",
    });

    assert.ok(res.alreadyConverted);
    assert.equal(res.invoice?.id, "inv-42");
    assert.equal(find("/rest/v1/sales_invoices", "POST").length, 0, "no second invoice");
    assert.equal(find("link_quotation_invoice", "POST").length, 1, "linked exactly once");
  });
});
