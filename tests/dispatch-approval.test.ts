/**
 * Dispatch approval workflow — financial invariants for
 * "Add Edit, Delete, and Approval Workflow to Dispatch Management":
 *
 *  §1  Stock deduction and the customer's ledger debit happen ONLY when a
 *      dispatch transitions to 'approved' (one approve_dispatch RPC).
 *      Creating an invoice, printing, editing, or deleting a PENDING
 *      dispatch must never move stock or the ledger.
 *  §3  Deleting before approval makes no adjustments; deleting after
 *      approval reverses stock + ledger and returns the invoice to draft.
 *  §2  Source contract: the print drawer records 'pending_approval' and
 *      never posts; the migration ships the status machine, legacy
 *      backfills, and per-invoice effect guards.
 *
 * The SUT reads NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY at module scope, so the
 * env is set at file load and the module is imported inside `before()`.
 * node --test runs each test file in an isolated process, so the global
 * fetch stub cannot leak into other suites.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  SalesInvoice,
  SalesInvoiceItem,
  DispatchRecord,
  DispatchLineItem,
} from "../src/lib/supabase/invoicing";

/* ─── Fetch stub (same harness as audit-fixes.test.ts) ───────────────────── */

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
    calls.push({ url, method, body });
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

/* ─── SUT + fixtures ─────────────────────────────────────────────────────── */

let invoicing: typeof import("../src/lib/supabase/invoicing");

before(async () => {
  invoicing = await import("../src/lib/supabase/invoicing");
});

const line: DispatchLineItem = {
  product_id: "prod-1",
  product_name: "Basin Mixer",
  quantity: 4,
  unit_price_pkr: 250,
  line_total_pkr: 1000,
  unit_of_measure: "NOS",
};

const invoiceItem: SalesInvoiceItem = {
  id: "item-1",
  invoice_id: "inv-1",
  product_id: "prod-1",
  product_name: "Basin Mixer",
  quantity: 4,
  unit_price_pkr: 250,
  line_total_pkr: 1000,
  unit_of_measure: "NOS",
};

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1",
    invoice_number: "INV-2026-0001",
    customer_id: "cust-1",
    taxable_value_pkr: 1000,
    sales_tax_rate: 18,
    sales_tax_amount_pkr: 180,
    further_tax_rate: 0,
    further_tax_amount_pkr: 0,
    total_invoice_value_pkr: 1180,
    is_posted: false,
    stock_deducted: false,
    created_at: "2026-11-07T10:00:00Z",
    items: [invoiceItem],
    ...overrides,
  };
}

function dispatch(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    id: "disp-1",
    invoice_id: "inv-1",
    invoice_number: "INV-2026-0001",
    customer_id: "cust-1",
    customer_name: "Test Customer",
    taxable_value_pkr: 1000,
    sales_tax_rate: 18,
    sales_tax_amount_pkr: 180,
    further_tax_rate: 0,
    further_tax_amount_pkr: 0,
    total_invoice_value_pkr: 1180,
    line_items: [line],
    operator_name: "QA",
    device_node: "PC-01",
    posted_at: "2026-11-07T10:00:00Z",
    created_at: "2026-11-07T10:00:00Z",
    status: "pending_approval",
    ...overrides,
  };
}

/** True when any call tried to change inventory one way or another. */
function stockWrites(): number {
  return (
    find("deduct_product_stock").length +
    find("restore_product_stock").length +
    find("sanitary_products", "PATCH").length
  );
}

/* ─── Creation / printing ────────────────────────────────────────────────── */

describe("dispatch approval - creation and printing never move stock", () => {
  it("createInvoice saves lines without deducting inventory", async () => {
    route("/rest/v1/sales_invoices", "POST", {
      status: 201,
      body: [{ ...invoice(), id: "inv-new", invoice_number: "INV-2026-0100" }],
    });
    route("/rest/v1/sales_invoice_items", "POST", { status: 201, body: [{}] });

    const res = await invoicing.createInvoice({
      customer_id: "cust-1",
      taxable_value_pkr: 1000,
      sales_tax_rate: 18,
      sales_tax_amount_pkr: 180,
      further_tax_rate: 0,
      further_tax_amount_pkr: 0,
      total_invoice_value_pkr: 1180,
      device_node: "PC-01",
      operator_name: "QA",
      items: [{ ...line }],
    });

    assert.ok(res.invoice, res.error ?? "invoice should save");
    assert.equal(
      stockWrites(),
      0,
      "§1: no stock movement may happen at invoice creation",
    );
  });

  it("createDispatchRecord stamps pending_approval and drops the workflow columns on a legacy schema", async () => {
    let posts = 0;
    on((url, m) => {
      if (m !== "POST" || !url.includes("/rest/v1/dispatch_records")) return null;
      posts += 1;
      return posts === 1
        ? {
            status: 400,
            body: { message: "column dispatch_records.status does not exist" },
          }
        : { status: 201, body: [{ ...dispatch(), id: "disp-new" }] };
    });

    const rec = await invoicing.createDispatchRecord({
      invoice_id: "inv-1",
      invoice_number: "INV-2026-0001",
      customer_id: "cust-1",
      customer_name: "Test Customer",
      taxable_value_pkr: 1000,
      sales_tax_rate: 18,
      sales_tax_amount_pkr: 180,
      further_tax_rate: 0,
      further_tax_amount_pkr: 0,
      total_invoice_value_pkr: 1180,
      line_items: [line],
      operator_name: "QA",
      device_node: "PC-01",
      status: "pending_approval",
      dispatch_date: "2026-11-07",
    });

    assert.ok(rec, "printing must never lose its dispatch record");
    const created = find("dispatch_records", "POST");
    assert.equal(created.length, 2, "legacy schema retries without new columns");
    assert.ok(
      created[0].body?.includes('"status":"pending_approval"'),
      "the record is created as pending approval",
    );
    assert.ok(
      !created[1].body?.includes('"status"'),
      "the legacy retry omits the workflow columns",
    );
    assert.equal(stockWrites(), 0, "recording a dispatch moves no stock");
  });

  it("the print drawer records a pending dispatch and never posts the invoice", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src",
        "components",
        "modules",
        "invoicing",
        "PostPrintDrawer.tsx",
      ),
      "utf8",
    );
    assert.ok(
      !src.includes("postGSTPaintsInvoice"),
      "printing must not post the invoice (stock/ledger run at approval)",
    );
    assert.ok(
      src.includes('status: "pending_approval"'),
      "the printed invoice becomes a pending dispatch",
    );
    assert.ok(
      src.includes("findDispatchRecordByInvoice"),
      "re-prints reuse the existing dispatch instead of duplicating it",
    );
  });
});

/* ─── Approval ───────────────────────────────────────────────────────────── */

describe("dispatch approval - approval is the only effect path", () => {
  it("approveDispatch calls the single RPC and writes nothing directly", async () => {
    route("rpc/approve_dispatch", "POST", {
      body: {
        status: "approved",
        already_approved: false,
        invoice_number: "INV-2026-0001",
        total_payable: 1180,
        stock_deducted: true,
      },
    });

    const res = await invoicing.approveDispatch("disp-1", "QA", "PC-01");
    assert.equal(res.success, true, res.error);
    assert.equal(res.status, "approved");
    assert.equal(res.invoiceNumber, "INV-2026-0001");

    const rpcCalls = find("rpc/approve_dispatch", "POST");
    assert.equal(rpcCalls.length, 1, "exactly one RPC call");
    const rpcBody = JSON.parse(rpcCalls[0].body ?? "{}");
    assert.equal(rpcBody.p_dispatch_id, "disp-1");

    // §1: stock + ledger live inside the RPC transaction, never client-side.
    assert.equal(find("journal_entries", "POST").length, 0, "no client-side journal write");
    assert.equal(stockWrites(), 0, "no client-side stock write");
    assert.equal(find("sales_invoices", "PATCH").length, 0, "no client-side invoice write");
  });

  it("explains the missing migration when the RPC is absent", async () => {
    route("rpc/approve_dispatch", "POST", {
      status: 404,
      body: {
        message:
          "Could not find the function public.approve_dispatch in the schema cache",
      },
    });

    const res = await invoicing.approveDispatch("disp-1", "QA", "PC-01");
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /20261107010000/);
  });
});

/* ─── Delete gating (§3) ─────────────────────────────────────────────────── */

describe("dispatch approval - delete gating", () => {
  it("pre-approval dispatch delete removes only the dispatch row", async () => {
    route("sales_invoices?id=eq.", "GET", {
      body: [{ is_posted: false, stock_deducted: false }],
    });
    route("dispatch_records?id=eq.", "DELETE", { status: 200, body: [] });

    const res = await invoicing.deleteDispatchRecord(dispatch());
    assert.equal(res.success, true, res.error);
    assert.equal(res.stockRestored, false, "nothing was deducted, nothing returns");
    assert.equal(res.ledgerReversed, false, "nothing was posted, nothing reverses");

    assert.equal(find("journal_entries").length, 0, "no ledger reads or writes");
    assert.equal(find("sanitary_products").length, 0, "no inventory reads or writes");
    assert.equal(
      find("sales_invoices", "PATCH").length,
      0,
      "the invoice is left exactly as it was",
    );
  });

  it("approved dispatch delete reverses stock + ledger and returns the invoice to draft", async () => {
    route("sales_invoices?id=eq.", "GET", {
      body: [{ is_posted: true, stock_deducted: true }],
    });
    route("sales_invoices?id=eq.", "PATCH", { status: 204 });
    route("dispatch_records?id=eq.", "DELETE", { status: 200, body: [] });
    route("journal_entries", "GET", { body: [{ id: "je-9" }] });
    route("journal_entries", "DELETE", { status: 200, body: [] });
    route("sanitary_products", "GET", { body: [{ available_stock: 10 }] });
    route("sanitary_products", "PATCH", { status: 204 });

    const res = await invoicing.deleteDispatchRecord(dispatch({ status: "approved" }));
    assert.equal(res.success, true, res.error);
    assert.equal(res.stockRestored, true, "deducted units must go back to inventory");
    assert.equal(res.ledgerReversed, true, "the posted entry must come out of the books");

    assert.ok(find("sanitary_products", "PATCH").length >= 1, "stock was returned");
    assert.ok(find("journal_entries", "DELETE").length >= 1, "journal was removed");

    const patches = find("sales_invoices", "PATCH");
    assert.equal(patches.length, 1, "invoice returns to draft");
    const patchBody = JSON.parse(patches[0].body ?? "{}");
    assert.equal(patchBody.stock_deducted, false);
    assert.equal(patchBody.is_posted, false);
  });

  it("invoice delete while pending makes no stock or ledger adjustments", async () => {
    route("sales_invoices?id=eq.", "GET", { body: [{ stock_deducted: false }] });
    route("sales_invoices?id=eq.", "DELETE", { body: [{ id: "inv-1" }] });

    const res = await invoicing.deleteInvoice({
      id: "inv-1",
      invoice_number: "INV-2026-0001",
      is_posted: false,
      items: [invoiceItem],
    });

    assert.equal(res.success, true, res.error);
    assert.equal(res.stockRestored, false, "§3: pending delete must not inflate stock");
    assert.equal(res.ledgerRemoved, false);
    assert.equal(find("journal_entries").length, 0, "no ledger cleanup needed");
    assert.equal(stockWrites(), 0, "no inventory writes at all");
  });

  it("invoice delete after approval reverses both effects", async () => {
    route("sales_invoices?id=eq.", "GET", { body: [{ stock_deducted: true }] });
    route("sales_invoices?id=eq.", "DELETE", { body: [{ id: "inv-1" }] });
    route("journal_entries", "GET", { body: [{ id: "je-9" }] });
    route("journal_entries", "DELETE", { status: 200, body: [] });
    route("sanitary_products", "GET", { body: [{ available_stock: 10 }] });
    route("sanitary_products", "PATCH", { status: 204 });

    const res = await invoicing.deleteInvoice({
      id: "inv-1",
      invoice_number: "INV-2026-0001",
      is_posted: true,
      items: [invoiceItem],
    });

    assert.equal(res.success, true, res.error);
    assert.equal(res.ledgerRemoved, true, "posted invoice → journal removed");
    assert.equal(res.stockRestored, true, "settled invoice → stock returned");
  });
});

/* ─── Edit gating ────────────────────────────────────────────────────────── */

describe("dispatch approval - edit gating", () => {
  function routeItemEdit(stockDeducted: boolean): void {
    route("sales_invoice_items?invoice_id=eq.", "GET", {
      body: [{ product_id: "prod-1", product_name: "Basin Mixer", quantity: 5 }],
    });
    route("sales_invoices?id=eq.", "GET", {
      body: [{ stock_deducted: stockDeducted }],
    });
    route("sales_invoice_items?invoice_id=eq.", "DELETE", { status: 204 });
    route("/rest/v1/sales_invoice_items", "POST", { status: 201, body: [{}] });
    route("rpc/deduct_product_stock", "POST", { body: {} });
    route("rpc/restore_product_stock", "POST", { body: {} });
    route("sanitary_products", "PATCH", { status: 204 });
  }

  const edited: DispatchLineItem[] = [{ ...line, quantity: 7 }];

  it("editing a pending invoice leaves stock untouched", async () => {
    routeItemEdit(false);
    const ok = await invoicing.updateInvoiceItems("inv-1", edited);
    assert.equal(ok, true);
    assert.equal(stockWrites(), 0, "§1: pre-approval edits must not move stock");
  });

  it("editing a settled invoice applies only the quantity delta", async () => {
    routeItemEdit(true);
    const ok = await invoicing.updateInvoiceItems("inv-1", edited);
    assert.equal(ok, true);
    assert.ok(
      find("rpc/deduct_product_stock").length + find("sanitary_products", "PATCH").length >= 1,
      "settled invoices keep their stock delta behaviour",
    );
    // previous 5 → new 7 = delta 2 deducted, never a full re-deduct of 7.
    const deduct = find("rpc/deduct_product_stock");
    if (deduct.length > 0) {
      const body = JSON.parse(deduct[0].body ?? "{}");
      const qty = Number(body.p_quantity ?? body.quantity ?? 0);
      assert.equal(qty, 2, "only the difference moves");
    }
  });
});

/* ─── Migration / source contract (§2) ───────────────────────────────────── */

describe("dispatch approval - migration ships the workflow", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261107010000_dispatch_approval_workflow.sql",
    ),
    "utf8",
  );

  it("defines approve_dispatch as the combined effect path", () => {
    assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.approve_dispatch"));
    assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.approve_dispatch"));
  });

  it("ships the three-state status machine", () => {
    assert.ok(
      sql.includes(
        "CHECK (status IN ('pending_approval', 'approved', 'dispatched'))",
      ),
      "status column with the specified states",
    );
    assert.ok(
      sql.includes("ALTER TABLE dispatch_records ALTER COLUMN status SET DEFAULT 'pending_approval'"),
      "new dispatches start pending approval",
    );
  });

  it("backfills legacy rows so history stays truthful", () => {
    assert.ok(
      sql.includes("UPDATE dispatch_records SET status = 'dispatched' WHERE status IS NULL"),
      "pre-workflow dispatches were already completed",
    );
    assert.ok(
      sql.includes("UPDATE sales_invoices SET stock_deducted = true WHERE stock_deducted IS NULL"),
      "pre-workflow invoices already moved stock at creation",
    );
  });

  it("guards each effect so nothing runs twice or out of order", () => {
    assert.ok(sql.includes("IF NOT v_stock_deducted THEN"), "stock guard");
    assert.ok(sql.includes("IF NOT v_posted THEN"), "ledger guard");
    assert.ok(
      sql.includes("SET status = 'approved'"),
      "the status flip lives in the same transaction",
    );
  });
});
