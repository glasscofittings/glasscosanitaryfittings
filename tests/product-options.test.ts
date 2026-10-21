import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterProductOptions,
  isKnownProductOption,
  normalizeProductOption,
} from "../src/lib/product-options";
import {
  SANITARY_CATEGORY_OPTIONS,
  SANITARY_SUBCATEGORY_OPTIONS,
  PRODUCT_FINISH_OPTIONS,
} from "../src/types";

/* ─── Reported bug: typing a partial query must surface matching options ──── */

describe("filterProductOptions — search must return matches while typing", () => {
  it("returns 'Lever Set Complete' etc. for the partial query 'Lever'", () => {
    const results = filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "Lever");
    assert.ok(results.length > 0, "expected matches for 'Lever'");
    assert.ok(results.includes("Lever Set Complete"));
    assert.ok(results.includes("Lever Vanity Nova"));
    assert.ok(results.includes("Single Lever Basin Mixer")); // substring hit
  });

  it("is case-insensitive on both sides", () => {
    assert.deepEqual(
      filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "lever"),
      filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "LEVER")
    );
    assert.ok(filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "lEvEr").includes("Lever Set Complete"));
  });

  it("trims surrounding whitespace in the query", () => {
    assert.deepEqual(
      filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "  Lever  "),
      filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "Lever")
    );
  });

  it("matches a word in the middle of an option (word boundary)", () => {
    const results = filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "Neck");
    assert.ok(results.includes("Basin Mixer Cast Neck"));
    assert.ok(results.includes("Sink Mixer Medium Neck"));
  });

  it("matches a substring anywhere (digits / hyphenated codes)", () => {
    assert.deepEqual(filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "605"), ["Bib Cock 605-606 C"]);
  });

  it("matches every category for 'bath' and every finish for a full name", () => {
    assert.equal(filterProductOptions(SANITARY_CATEGORY_OPTIONS, "bath").length, SANITARY_CATEGORY_OPTIONS.length);
    assert.deepEqual(filterProductOptions(PRODUCT_FINISH_OPTIONS, "black"), ["Black & Gold", "Black"]);
  });

  it("returns every option for an empty or whitespace-only query", () => {
    assert.deepEqual(filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, ""), [...SANITARY_SUBCATEGORY_OPTIONS]);
    assert.deepEqual(filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "   "), [...SANITARY_SUBCATEGORY_OPTIONS]);
  });

  it("returns an empty list when nothing matches", () => {
    assert.deepEqual(filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "zzz-no-such-item"), []);
  });

  it("ranks prefix hits before substring hits and keeps predefined order inside a tier", () => {
    const results = filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "Bib Cock");
    assert.deepEqual(results.slice(0, 3), [
      "Bib Cock",
      "Bib Cock Brass Head",
      "Bib Cock 605-606 C",
    ]);
    assert.ok(results.includes("Long Bib Cock"));
    assert.ok(results.indexOf("Long Bib Cock") > results.indexOf("Bib Cock 605-606 C"));
  });

  it("does not mutate the source option list", () => {
    const before = [...SANITARY_SUBCATEGORY_OPTIONS];
    filterProductOptions(SANITARY_SUBCATEGORY_OPTIONS, "cock");
    assert.deepEqual([...SANITARY_SUBCATEGORY_OPTIONS], before);
  });
});

/* ─── Value vs. label: only a full option counts as a known value ─────────── */

describe("isKnownProductOption", () => {
  it("accepts an exact option regardless of case or padding", () => {
    assert.equal(isKnownProductOption("Chrome", PRODUCT_FINISH_OPTIONS), true);
    assert.equal(isKnownProductOption("  chrome ", PRODUCT_FINISH_OPTIONS), true);
  });

  // This is the distinction that caused the bug: a typed *query* such as
  // "Lever" is not a committed value, so it must only filter — never flip the
  // field into custom mode and hide the list.
  it("rejects a partial query, an empty value and unknown custom text", () => {
    assert.equal(isKnownProductOption("Lever", SANITARY_SUBCATEGORY_OPTIONS), false);
    assert.equal(isKnownProductOption("", SANITARY_SUBCATEGORY_OPTIONS), false);
    assert.equal(isKnownProductOption("   ", SANITARY_SUBCATEGORY_OPTIONS), false);
    assert.equal(isKnownProductOption("Brass Fitting Deluxe", SANITARY_SUBCATEGORY_OPTIONS), false);
  });
});

describe("normalizeProductOption", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeProductOption("  Black & Gold  "), "black & gold");
    assert.equal(normalizeProductOption("T-ARM"), "t-arm");
  });
});
