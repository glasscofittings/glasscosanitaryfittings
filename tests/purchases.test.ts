import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  calculatePurchaseLine,
  calculateProfitMargins,
  computeSupplierPriceComparisons,
  computeProductCostAndMargin,
  filterPurchases,
  buildPurchaseReportByProduct,
  buildPurchaseReportBySupplier,
  summarizePurchases,
  type ProductPurchase,
} from "../src/lib/supabase/purchases";
import type { SanitaryProduct } from "../src/types";
import type { InventoryLot } from "../src/lib/supabase/inventory";

/* ─── Fixtures ────────────────────────────────────────────────────────────── */

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

function product(overrides: Partial<SanitaryProduct> = {}): SanitaryProduct {
  return {
    id: "prod-1",
    sku: "BM-001",
    name: "Basin Mixer",
    category: "Faucets & Mixers",
    unit_price: 150,
    total_stock: 10,
    available_stock: 10,
    reorder_level: 2,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function lot(overrides: Partial<InventoryLot> = {}): InventoryLot {
  return {
    id: "lot-1",
    lot_number: "LOT-1",
    product_id: "prod-1",
    warehouse_id: "wh-2",
    vendor_lot_code: "V-1",
    manufacture_date: "2026-09-01",
    expiration_date: "2028-09-01",
    initial_qty: 10,
    remaining_qty: 10,
    unit_cost_pkr: 100,
    qc_status: "PASSED",
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

/* ─── Acceptance example from the requirements ────────────────────────────── */

describe("Purchases - Worked example (acceptance test)", () => {
  it("10 units @ Rs.100 => subtotal Rs.1,000", () => {
    const line = calculatePurchaseLine({ quantity: 10, purchase_rate: 100 });
    assert.equal(line.subtotal, 1000);
    assert.equal(line.discountAmount, 0);
    assert.equal(line.netSubtotal, 1000);
    assert.equal(line.taxAmount, 0);
    assert.equal(line.total, 1000);
    assert.equal(line.effectiveUnitCost, 100);
  });

  it("2 sold @ Rs.150 with unit cost Rs.100 => sales 300, COGS 200, GP 100, margin 33.33%, markup 50%", () => {
    const m = calculateProfitMargins({ sellingPrice: 150, unitCost: 100, quantity: 2 });
    assert.equal(m.netSales, 300);
    assert.equal(m.cogs, 200);
    assert.equal(m.grossProfit, 100);
    assert.equal(m.grossMarginPercent, 33.33);
    assert.equal(m.markupPercent, 50);
  });
});

/* ─── Purchase line math ──────────────────────────────────────────────────── */

describe("Purchases - calculatePurchaseLine", () => {
  it("applies percentage discounts on the subtotal", () => {
    const line = calculatePurchaseLine({ quantity: 10, purchase_rate: 100, discount_percent: 10 });
    assert.equal(line.subtotal, 1000);
    assert.equal(line.discountAmount, 100);
    assert.equal(line.netSubtotal, 900);
  });

  it("prefers a flat discount over a percentage when both are provided", () => {
    const line = calculatePurchaseLine({
      quantity: 10,
      purchase_rate: 100,
      discount_percent: 10,
      discount_pkr: 50,
    });
    assert.equal(line.discountAmount, 50);
    assert.equal(line.netSubtotal, 950);
  });

  it("caps the discount at the subtotal (never negative totals)", () => {
    const line = calculatePurchaseLine({ quantity: 2, purchase_rate: 100, discount_pkr: 500 });
    assert.equal(line.discountAmount, 200);
    assert.equal(line.netSubtotal, 0);
    assert.equal(line.total, 0);
  });

  it("taxes the discounted subtotal and adds landed costs to the total", () => {
    const line = calculatePurchaseLine({
      quantity: 10,
      purchase_rate: 100,
      discount_percent: 10,
      tax_rate: 17,
      additional_cost_pkr: 500,
    });
    // net 900, tax 17% of 900 = 153, landed 500
    assert.equal(line.taxAmount, 153);
    assert.equal(line.total, 1553);
  });

  it("allocates landed cost across units in the effective unit cost", () => {
    const line = calculatePurchaseLine({
      quantity: 10,
      purchase_rate: 100,
      discount_percent: 10,
      additional_cost_pkr: 500,
    });
    // (900 + 500) / 10 = 140 — tax is excluded from unit cost
    assert.equal(line.effectiveUnitCost, 140);
  });

  it("handles zero quantity and garbage inputs without NaN", () => {
    const zero = calculatePurchaseLine({ quantity: 0, purchase_rate: 100 });
    assert.equal(zero.subtotal, 0);
    assert.equal(zero.total, 0);

    const nan = calculatePurchaseLine({
      quantity: Number.NaN,
      purchase_rate: Number.NaN,
      discount_percent: Number.NaN,
      tax_rate: Number.NaN,
    });
    assert.ok(Number.isFinite(nan.subtotal));
    assert.ok(Number.isFinite(nan.total));
    assert.equal(nan.total, 0);
  });

  it("handles negative quantities and rates safely", () => {
    const line = calculatePurchaseLine({ quantity: -5, purchase_rate: -100 });
    assert.ok(Number.isFinite(line.subtotal));
    assert.ok(line.discountAmount >= 0);
    assert.ok(line.netSubtotal <= line.subtotal);
  });
});

/* ─── Profit margin math ──────────────────────────────────────────────────── */

describe("Purchases - calculateProfitMargins", () => {
  it("computes margin on net sales and markup on cost", () => {
    const m = calculateProfitMargins({ sellingPrice: 200, unitCost: 120, quantity: 5 });
    assert.equal(m.netSales, 1000);
    assert.equal(m.cogs, 600);
    assert.equal(m.grossProfit, 400);
    assert.equal(m.grossMarginPercent, 40); // 400 / 1000
    assert.equal(m.markupPercent, 66.67); // 400 / 600
  });

  it("defaults quantity to 1 when omitted or non-positive", () => {
    const omitted = calculateProfitMargins({ sellingPrice: 150, unitCost: 100 });
    assert.equal(omitted.netSales, 150);
    assert.equal(omitted.cogs, 100);

    const zeroQty = calculateProfitMargins({ sellingPrice: 150, unitCost: 100, quantity: 0 });
    assert.equal(zeroQty.netSales, 150);
  });

  it("returns zero percentages instead of Infinity for zero denominators", () => {
    const noSales = calculateProfitMargins({ sellingPrice: 0, unitCost: 100, quantity: 3 });
    assert.equal(noSales.grossMarginPercent, 0);
    assert.equal(noSales.grossProfit, -300);

    const noCost = calculateProfitMargins({ sellingPrice: 150, unitCost: 0, quantity: 2 });
    assert.equal(noCost.markupPercent, 0);
    assert.equal(noCost.grossMarginPercent, 100);

    const empty = calculateProfitMargins({ sellingPrice: 0, unitCost: 0 });
    assert.equal(empty.grossMarginPercent, 0);
    assert.equal(empty.markupPercent, 0);
    assert.ok(Number.isFinite(empty.grossMarginPercent));
    assert.ok(Number.isFinite(empty.markupPercent));
  });

  it("produces negative margins when selling below cost (no NaN)", () => {
    const m = calculateProfitMargins({ sellingPrice: 80, unitCost: 100, quantity: 10 });
    assert.equal(m.grossProfit, -200);
    assert.equal(m.grossMarginPercent, -25);
    assert.equal(m.markupPercent, -20);
  });
});

/* ─── Supplier price comparisons ──────────────────────────────────────────── */

describe("Purchases - computeSupplierPriceComparisons", () => {
  const rows = [
    purchase({
      supplier_id: "sup-a",
      supplier_name: "Supplier A",
      purchase_rate: 95,
      quantity: 10,
      purchase_date: "2026-10-01",
    }),
    purchase({
      supplier_id: "sup-a",
      supplier_name: "Supplier A",
      purchase_rate: 90,
      quantity: 30,
      purchase_date: "2026-10-05",
    }),
    purchase({
      supplier_id: "sup-b",
      supplier_name: "Supplier B",
      purchase_rate: 100,
      quantity: 20,
      purchase_date: "2026-10-03",
    }),
    purchase({
      supplier_id: "sup-c",
      supplier_name: "Supplier C",
      purchase_rate: 10,
      quantity: 5,
      purchase_date: "2026-10-04",
    }),
    purchase({
      supplier_id: "sup-c",
      supplier_name: "Supplier C",
      purchase_rate: 1,
      quantity: 1000,
      purchase_date: "2026-10-06",
      status: "cancelled",
    }),
  ];

  it("excludes cancelled purchases from every figure", () => {
    const result = computeSupplierPriceComparisons(rows);
    const c = result.find((r) => r.supplier_name === "Supplier C");
    assert.ok(c);
    assert.equal(c.purchase_count, 1);
    assert.equal(c.latest_rate, 10); // cancelled Rs.1 rate ignored
    assert.equal(c.min_rate, 10);
    assert.equal(c.total_qty, 5);
  });

  it("uses the most recent purchase for the latest rate and date", () => {
    const result = computeSupplierPriceComparisons(rows);
    const a = result.find((r) => r.supplier_name === "Supplier A");
    assert.ok(a);
    assert.equal(a.latest_rate, 90);
    assert.equal(a.last_purchased_date, "2026-10-05");
  });

  it("computes quantity-weighted average rates", () => {
    const result = computeSupplierPriceComparisons(rows);
    const a = result.find((r) => r.supplier_name === "Supplier A");
    assert.ok(a);
    // (95*10 + 90*30) / 40 = 91.25
    assert.equal(a.avg_rate, 91.25);
  });

  it("flags the best price and sorts by latest rate ascending", () => {
    const result = computeSupplierPriceComparisons(rows);
    assert.deepEqual(
      result.map((r) => r.supplier_name),
      ["Supplier C", "Supplier A", "Supplier B"]
    );
    const flagged = result.filter((r) => r.is_best_price);
    // Only the all-time lowest rate ever paid (C's Rs.10) holds "best price".
    assert.deepEqual(
      flagged.map((r) => r.supplier_name),
      ["Supplier C"]
    );
  });

  it("returns an empty list for no purchases", () => {
    assert.deepEqual(computeSupplierPriceComparisons([]), []);
  });
});

/* ─── Cost & margin summaries (FIFO / WAC reuse) ──────────────────────────── */

describe("Purchases - computeProductCostAndMargin", () => {
  it("uses the oldest active lot for FIFO cost and derives margins from it", () => {
    const lots = [
      lot({ id: "old", created_at: "2026-09-01T00:00:00Z", unit_cost_pkr: 100, remaining_qty: 5 }),
      lot({ id: "new", created_at: "2026-10-01T00:00:00Z", unit_cost_pkr: 120, remaining_qty: 15 }),
    ];
    const s = computeProductCostAndMargin(product(), [], lots);
    assert.equal(s.fifo_unit_cost, 100);
    // (5*100 + 15*120) / 20 = 115
    assert.equal(s.weighted_avg_unit_cost, 115);
    assert.equal(s.effective_cost, 100);
    assert.equal(s.selling_price, 150);
    assert.equal(s.gross_profit, 50);
    assert.equal(s.gross_margin_percent, 33.33);
    assert.equal(s.markup_percent, 50);
  });

  it("ignores fully-consumed lots (remaining_qty <= 0)", () => {
    const lots = [
      lot({ id: "used", created_at: "2026-08-01T00:00:00Z", unit_cost_pkr: 60, remaining_qty: 0 }),
      lot({ id: "kept", created_at: "2026-09-01T00:00:00Z", unit_cost_pkr: 110, remaining_qty: 4 }),
    ];
    const s = computeProductCostAndMargin(product(), [], lots);
    assert.equal(s.fifo_unit_cost, 110);
    assert.equal(s.weighted_avg_unit_cost, 110);
  });

  it("falls back to the latest landed purchase cost when no lots exist", () => {
    const purchases = [
      purchase({
        purchase_date: "2026-09-01",
        effective_unit_cost_pkr: 90,
        purchase_rate: 88,
      }),
      purchase({
        purchase_date: "2026-10-01",
        effective_unit_cost_pkr: 110,
        purchase_rate: 105,
      }),
    ];
    const s = computeProductCostAndMargin(product(), purchases, []);
    assert.equal(s.fifo_unit_cost, 110); // latest landed cost
    assert.equal(s.effective_cost, 110);
    assert.equal(s.latest_purchase_rate, 105);
  });

  it("excludes cancelled purchases and only counts this product's rows", () => {
    const purchases = [
      purchase({ purchase_date: "2026-10-01", quantity: 10, purchase_total_pkr: 1000 }),
      purchase({ purchase_date: "2026-10-02", quantity: 5, purchase_total_pkr: 500, status: "cancelled" }),
      purchase({ product_id: "prod-2", product_name: "Other", purchase_total_pkr: 999 }),
    ];
    const s = computeProductCostAndMargin(product(), purchases, []);
    assert.equal(s.purchase_count, 1);
    assert.equal(s.total_purchased_qty, 10);
    assert.equal(s.total_spent_pkr, 1000);
  });

  it("returns all-zero costs when there are no purchases or lots", () => {
    const s = computeProductCostAndMargin(product({ unit_price: 0 }), [], []);
    assert.equal(s.effective_cost, 0);
    assert.equal(s.gross_profit, 0);
    assert.equal(s.gross_margin_percent, 0);
    assert.equal(s.markup_percent, 0);
  });
});

/* ─── Purchase reports: product / supplier / date range ───────────────────── */

describe("Purchases - filterPurchases (product, supplier, date range, status)", () => {
  const rows = [
    purchase({ product_id: "p1", supplier_id: "s1", purchase_date: "2026-10-01" }),
    purchase({ product_id: "p1", supplier_id: "s2", purchase_date: "2026-10-15" }),
    purchase({ product_id: "p2", supplier_id: "s1", purchase_date: "2026-11-01", status: "draft" }),
    purchase({ product_id: "p2", supplier_id: "s2", purchase_date: "2026-09-01", status: "cancelled" }),
  ];

  it("filters by inclusive date range", () => {
    const out = filterPurchases(rows, { startDate: "2026-10-01", endDate: "2026-10-15" });
    assert.equal(out.length, 2);
  });

  it("filters by product and supplier together", () => {
    const out = filterPurchases(rows, { productId: "p1", supplierId: "s2" });
    assert.equal(out.length, 1);
    assert.equal(out[0].purchase_date, "2026-10-15");
  });

  it("filters by status", () => {
    assert.equal(filterPurchases(rows, { status: "draft" }).length, 1);
    assert.equal(filterPurchases(rows, { status: "cancelled" }).length, 1);
    assert.equal(filterPurchases(rows).length, 4);
  });
});

describe("Purchases - buildPurchaseReportByProduct", () => {
  const rows = [
    purchase({
      product_id: "p1",
      product_name: "Basin Mixer",
      sku: "BM-001",
      quantity: 10,
      purchase_rate: 100,
      purchase_subtotal_pkr: 1000,
      purchase_date: "2026-10-01",
    }),
    purchase({
      product_id: "p1",
      product_name: "Basin Mixer",
      sku: "BM-001",
      quantity: 30,
      purchase_rate: 110,
      purchase_subtotal_pkr: 3300,
      purchase_date: "2026-10-10",
      status: "draft",
    }),
    purchase({
      product_id: "p1",
      product_name: "Basin Mixer",
      sku: "BM-001",
      quantity: 5,
      purchase_rate: 50,
      purchase_subtotal_pkr: 250,
      purchase_date: "2026-10-05",
      status: "cancelled",
    }),
    purchase({
      product_id: "p2",
      product_name: "Health Faucet",
      sku: "HF-001",
      supplier_id: "sup-b",
      supplier_name: "Supplier B",
      quantity: 4,
      purchase_rate: 200,
      purchase_date: "2026-10-02",
      purchase_subtotal_pkr: 800,
      purchase_total_pkr: 800,
    }),
  ];

  it("groups by product and separates confirmed / draft / cancelled counts", () => {
    const report = buildPurchaseReportByProduct(rows);
    assert.equal(report.length, 2);

    const bm = report.find((r) => r.group_label === "Basin Mixer");
    assert.ok(bm);
    assert.equal(bm.group_key, "p1");
    assert.equal(bm.sku, "BM-001");
    assert.equal(bm.purchase_count, 3);
    assert.equal(bm.confirmed_count, 1);
    assert.equal(bm.draft_count, 1);
    assert.equal(bm.cancelled_count, 1);
  });

  it("excludes cancelled purchases from financial totals but keeps drafts visible", () => {
    const report = buildPurchaseReportByProduct(rows);
    const bm = report.find((r) => r.group_label === "Basin Mixer");
    assert.ok(bm);
    // confirmed 10 @100 + draft 30 @110; cancelled 5 @50 excluded
    assert.equal(bm.total_quantity, 40);
    assert.equal(bm.total_subtotal_pkr, 4300);
    assert.equal(bm.min_rate, 100);
    assert.equal(bm.max_rate, 110);
    assert.equal(bm.avg_rate, 107.5); // (100*10 + 110*30) / 40
    assert.equal(bm.latest_date, "2026-10-10");
    assert.equal(bm.latest_rate, 110);
  });

  it("sorts rows by total spend descending", () => {
    const report = buildPurchaseReportByProduct(rows);
    assert.deepEqual(
      report.map((r) => r.group_label),
      ["Basin Mixer", "Health Faucet"]
    );
  });

  it("applies the optional filter before grouping", () => {
    const report = buildPurchaseReportByProduct(rows, {
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      status: "confirmed",
    });
    assert.equal(report.length, 2);
    const bm = report.find((r) => r.group_label === "Basin Mixer");
    assert.ok(bm);
    assert.equal(bm.total_quantity, 10);
  });
});

describe("Purchases - buildPurchaseReportBySupplier", () => {
  it("groups by supplier and falls back to the name when no id exists", () => {
    const rows = [
      purchase({ supplier_id: "s1", supplier_name: "Alpha Traders", quantity: 2, purchase_rate: 100, purchase_date: "2026-10-01" }),
      purchase({ supplier_id: "s1", supplier_name: "Alpha Traders", quantity: 2, purchase_rate: 120, purchase_date: "2026-10-03" }),
      purchase({ supplier_id: null, supplier_name: "Beta Imports", quantity: 1, purchase_rate: 300, purchase_date: "2026-10-02" }),
      purchase({ supplier_id: null, supplier_name: "Beta Imports", quantity: 1, purchase_rate: 50, purchase_date: "2026-10-04", status: "cancelled" }),
    ];

    const report = buildPurchaseReportBySupplier(rows);
    assert.equal(report.length, 2);

    const alpha = report.find((r) => r.group_label === "Alpha Traders");
    assert.ok(alpha);
    assert.equal(alpha.group_key, "s1");
    assert.equal(alpha.latest_rate, 120);
    assert.equal(alpha.total_quantity, 4);

    const beta = report.find((r) => r.group_label === "Beta Imports");
    assert.ok(beta);
    assert.equal(beta.group_key, "Beta Imports");
    assert.equal(beta.cancelled_count, 1);
    assert.equal(beta.latest_rate, 300); // cancelled row ignored
    assert.equal(beta.total_quantity, 1);
  });
});

describe("Purchases - summarizePurchases", () => {
  it("totals only non-cancelled purchases", () => {
    const rows = [
      purchase({ quantity: 10, purchase_subtotal_pkr: 1000, purchase_total_pkr: 1170, tax_amount_pkr: 170 }),
      purchase({ quantity: 5, purchase_subtotal_pkr: 500, purchase_total_pkr: 500, status: "draft" }),
      purchase({ quantity: 99, purchase_subtotal_pkr: 9999, purchase_total_pkr: 9999, status: "cancelled" }),
    ];
    const t = summarizePurchases(rows);
    assert.equal(t.purchase_count, 2);
    assert.equal(t.total_quantity, 15);
    assert.equal(t.total_subtotal_pkr, 1500);
    assert.equal(t.total_tax_pkr, 170);
    assert.equal(t.total_purchase_pkr, 1670);
    // Drafts stay visible in the totals, but are disclosed separately so the
    // figure is never mistaken for posted-ledger purchases.
    assert.equal(t.draft_count, 1);
    assert.equal(t.draft_total_pkr, 500);
  });

  it("honours filters and returns zero-safe totals for empty input", () => {
    const rows = [
      purchase({ purchase_date: "2026-10-01", quantity: 1, purchase_total_pkr: 100 }),
      purchase({ purchase_date: "2026-11-01", quantity: 2, purchase_total_pkr: 200 }),
    ];
    const oct = summarizePurchases(rows, { startDate: "2026-10-01", endDate: "2026-10-31" });
    assert.equal(oct.purchase_count, 1);
    assert.equal(oct.total_purchase_pkr, 100);

    const empty = summarizePurchases([]);
    assert.deepEqual(empty, {
      purchase_count: 0,
      total_quantity: 0,
      total_subtotal_pkr: 0,
      total_discount_pkr: 0,
      total_tax_pkr: 0,
      total_additional_cost_pkr: 0,
      total_purchase_pkr: 0,
      draft_count: 0,
      draft_total_pkr: 0,
    });
    assert.deepEqual(buildPurchaseReportByProduct([]), []);
    assert.deepEqual(buildPurchaseReportBySupplier([]), []);
  });

  it("matches report rows: product totals sum to the grand total", () => {
    const rows = [
      purchase({ product_id: "p1", quantity: 1, purchase_total_pkr: 100 }),
      purchase({ product_id: "p1", quantity: 2, purchase_total_pkr: 200 }),
      purchase({ product_id: "p2", quantity: 3, purchase_total_pkr: 300 }),
    ];
    const reportSum = buildPurchaseReportByProduct(rows).reduce(
      (acc, r) => acc + r.total_purchase_pkr,
      0
    );
    assert.equal(reportSum, summarizePurchases(rows).total_purchase_pkr);
  });
});

/* ─── Migration invariants (server-side stock & ledger guarantees) ─────────── */

describe("Purchases - migration invariants", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "20261104010000_purchase_rpc_lot_fix.sql"),
    "utf8"
  );

  it("creates lots as 'unrestricted' so purchased stock can be consumed", () => {
    assert.ok(sql.includes("'PASSED', 'unrestricted'"));
  });

  it("resolves the products_master foreign key before inserting a lot", () => {
    assert.ok(sql.includes("INSERT INTO public.products_master"));
    assert.ok(sql.includes("inventory_lots"));
  });

  it("uses the canonical journal_entry_seq instead of RANDOM()", () => {
    assert.ok(sql.includes("nextval('public.journal_entry_seq')"));
    // No live (non-comment) code may call RANDOM() for entry numbers.
    const codeLines = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--") && l.includes("RANDOM()"));
    assert.deepEqual(codeLines, []);
  });

  it("replays idempotency keys instead of re-posting", () => {
    assert.ok(sql.includes("WHERE idempotency_key = v_idem_key"));
    assert.ok(sql.includes("product_purchases_idempotency_key_key"));
  });

  it("updates stock only inside the confirmed branch and posts a balanced entry", () => {
    const confirmedIdx = sql.indexOf("IF v_status = 'confirmed' THEN");
    const stockIdx = sql.indexOf("total_stock = total_stock + v_quantity");
    const debitIdx = sql.indexOf("v_inv_account_id, v_supplier_id, v_total, 0.00");
    const creditIdx = sql.indexOf("v_ap_account_id, v_supplier_id, 0.00, v_total");
    const insertIdx = sql.indexOf("INSERT INTO public.product_purchases (");
    assert.ok(confirmedIdx > 0 && stockIdx > confirmedIdx);
    assert.ok(debitIdx > confirmedIdx && creditIdx > confirmedIdx);
    assert.ok(insertIdx > confirmedIdx); // purchase row written after the branch
  });

  it("grants execute to the app roles", () => {
    assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.record_and_confirm_purchase"));
  });
});

/* ─── QA audit: drafts must never price rates or costs ──────────────────────── */

describe("Purchases - confirmed-only rate & cost evaluation", () => {
  it("ignores draft purchases in supplier price comparisons", () => {
    const rows = [
      purchase({
        supplier_id: "sup-d",
        supplier_name: "Drafty Traders",
        purchase_rate: 50,
        quantity: 100,
        purchase_date: "2026-10-10",
        status: "draft",
      }),
      purchase({
        supplier_id: "sup-d",
        supplier_name: "Drafty Traders",
        purchase_rate: 90,
        quantity: 10,
        purchase_date: "2026-09-01",
      }),
    ];
    const r = computeSupplierPriceComparisons(rows).find(
      (x) => x.supplier_name === "Drafty Traders"
    );
    assert.ok(r);
    assert.equal(r.purchase_count, 1, "the draft never happened");
    assert.equal(r.latest_rate, 90, "the draft's cheaper rate must not win");
    assert.equal(r.min_rate, 90);
    assert.equal(r.total_qty, 10);
  });

  it("excludes drafts from cost/margin volumes and the latest rate", () => {
    const purchases = [
      purchase({
        purchase_date: "2026-10-01",
        quantity: 10,
        purchase_total_pkr: 1000,
        purchase_rate: 100,
        effective_unit_cost_pkr: 100,
      }),
      purchase({
        purchase_date: "2026-11-01",
        quantity: 50,
        purchase_total_pkr: 5000,
        purchase_rate: 50,
        effective_unit_cost_pkr: 50,
        status: "draft",
      }),
    ];
    const s = computeProductCostAndMargin(product(), purchases, []);
    assert.equal(s.purchase_count, 1);
    assert.equal(s.total_purchased_qty, 10);
    assert.equal(s.total_spent_pkr, 1000);
    assert.equal(s.latest_purchase_rate, 100, "draft rate must not leak into costing");
    assert.equal(s.fifo_unit_cost, 100, "FIFO fallback uses confirmed purchases only");
  });

  it("treats null quantities/rates as zero instead of NaN", () => {
    const rows = [
      purchase({
        supplier_id: "sup-n",
        supplier_name: "Nulls Inc",
        quantity: null as unknown as number,
        purchase_rate: null as unknown as number,
      }),
    ];
    const c = computeSupplierPriceComparisons(rows)[0];
    assert.ok(c);
    assert.equal(c.total_qty, 0);
    assert.ok(!Number.isNaN(c.avg_rate) && !Number.isNaN(c.min_rate) && !Number.isNaN(c.max_rate));

    const s = computeProductCostAndMargin(product(), rows, []);
    assert.ok(!Number.isNaN(s.total_purchased_qty));
    assert.ok(!Number.isNaN(s.total_spent_pkr));
    assert.ok(!Number.isNaN(s.fifo_unit_cost));
  });
});

/* ─── QA audit: migration 20261106 (tax precision + posting hardening) ─────── */

describe("Purchases - QA audit migration 20261106010000", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "20261106010000_qa_audit_fixes.sql"),
    "utf8"
  );

  it("widens v_tax_amt to NUMERIC(15, 2) so PKR 1,000+ tax cannot overflow", () => {
    assert.ok(/v_tax_amt\s+NUMERIC\(15,\s*2\)/.test(sql), "tax amount must be NUMERIC(15,2)");
    assert.ok(!/v_tax_amt\s+NUMERIC\(5,\s*2\)/.test(sql), "no NUMERIC(5,2) tax amount remains");
  });

  it("rolls a confirmed purchase back when ledger accounts are missing", () => {
    const confirmedIdx = sql.indexOf("IF v_status = 'confirmed' THEN");
    const raiseIdx = sql.indexOf("Cannot post purchase %");
    const postIdx = sql.indexOf("INSERT INTO public.journal_entries");
    assert.ok(confirmedIdx > 0, "confirmed branch exists");
    assert.ok(raiseIdx > confirmedIdx, "RAISE sits inside the confirmed branch");
    assert.ok(raiseIdx < postIdx, "RAISE fires before any posting");
  });

  it("still keeps stock and ledger writes inside the confirmed branch", () => {
    const confirmedIdx = sql.indexOf("IF v_status = 'confirmed' THEN");
    const stockIdx = sql.indexOf("total_stock = total_stock + v_quantity");
    const insertIdx = sql.indexOf("INSERT INTO public.product_purchases (");
    assert.ok(stockIdx > confirmedIdx, "stock only moves when confirmed");
    assert.ok(insertIdx > confirmedIdx, "draft purchases never reach the branch");
  });

  it("replaces the same function it fixes (idempotent CREATE OR REPLACE)", () => {
    assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.record_and_confirm_purchase"));
    assert.ok(sql.includes("WHERE idempotency_key = v_idem_key"));
    assert.ok(sql.includes("'PASSED', 'unrestricted'"));
  });

  it("forces every inserted quotation to DRAFT before the lifecycle starts", () => {
    assert.ok(sql.includes("quotation_force_draft_on_insert"));
    assert.ok(sql.includes("BEFORE INSERT ON public.quotations"));
    assert.ok(sql.includes("NEW.converted_invoice_id := NULL"));
  });
});
