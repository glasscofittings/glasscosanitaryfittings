/**
 * Line-item discount math for the New Tax Invoice form.
 *
 * Entry side (calcEntryLineDiscount) — BOTH discount kinds combine:
 *   Line Item Discount = (qty × price × Disc% / 100) + fixed Rs. amount
 *   Item Subtotal      = gross − Line Item Discount   (subtracted before tax)
 *
 * Stored side (calcLineDiscountAmount) — sales_invoice_items.discount_pkr
 * holds the COMBINED total written at entry time, so the stored value stays
 * authoritative for print; legacy percent-only rows fall back to
 * percent-of-gross. Capped at the gross line, floored at zero, never NaN.
 *
 * The SUT module reads NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY at module scope,
 * so env is set at file load and the module is imported in `before()`
 * (node --test runs each file in an isolated process).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { SalesInvoiceItem } from "../src/lib/supabase/invoicing";

describe("calcEntryLineDiscount — percent + fixed amount combine", () => {
  let calcEntryLineDiscount: (
    gross: number,
    discountPercent?: number,
    fixedAmount?: number,
  ) => number;
  let calcLineDiscountAmount: (item: SalesInvoiceItem) => number;

  before(async () => {
    ({ calcEntryLineDiscount, calcLineDiscountAmount } = await import(
      "../src/lib/supabase/invoicing"
    ));
  });

  it("applies a percentage-only discount", () => {
    // 10 × 100 = 1,000 gross, 10% → 100 off, net 900.
    assert.equal(calcEntryLineDiscount(1000, 10, 0), 100);
  });

  it("applies a fixed-amount-only discount", () => {
    assert.equal(calcEntryLineDiscount(1000, 0, 250), 250);
  });

  it("adds the percent part and the fixed amount (the required formula)", () => {
    // (1,000 × 10 / 100) + 250 = 350 → Item Subtotal = 650.
    const gross = 10 * 100;
    const lineDiscount = calcEntryLineDiscount(gross, 10, 250);
    assert.equal(lineDiscount, 350);
    assert.equal(gross - lineDiscount, 650);
  });

  it("never exceeds the gross line", () => {
    // 50% of 100 = 50 plus 500 fixed would be 550 — clamped to gross 100.
    assert.equal(calcEntryLineDiscount(100, 50, 500), 100);
  });

  it("reads missing or invalid inputs as 0 (never NaN / negative)", () => {
    assert.equal(calcEntryLineDiscount(1000, undefined, undefined), 0);
    assert.equal(calcEntryLineDiscount(1000, Number.NaN, Number.NaN), 0);
    assert.equal(calcEntryLineDiscount(1000, 10, -250), 100);
    assert.equal(calcEntryLineDiscount(-100, 10, 10), 0);
  });

  it("keeps the stored-row reader authoritative on the combined total", () => {
    // Combined at entry: 10% of 1,000 (100) + 500 fixed = 600 stored total.
    assert.equal(
      calcLineDiscountAmount({
        quantity: 10,
        unit_price_pkr: 100,
        discount_percent: 10,
        discount_pkr: 600,
      } as SalesInvoiceItem),
      600,
    );
    // Legacy percent-only row: discount_pkr holds the percent part (560 of 2,800).
    assert.equal(
      calcLineDiscountAmount({
        quantity: 14,
        unit_price_pkr: 200,
        discount_percent: 20,
        discount_pkr: 560,
      } as SalesInvoiceItem),
      560,
    );
    // Legacy row without discount_pkr derives percent-of-gross.
    assert.equal(
      calcLineDiscountAmount({
        quantity: 10,
        unit_price_pkr: 100,
        discount_percent: 15,
      } as SalesInvoiceItem),
      150,
    );
    // Missing discount fields read as 0 — never NaN.
    const legacy = calcLineDiscountAmount({
      quantity: 5,
      unit_price_pkr: 50,
    } as SalesInvoiceItem);
    assert.equal(legacy, 0);
  });
});
