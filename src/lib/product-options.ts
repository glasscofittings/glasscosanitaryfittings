/**
 * Matching helpers for the product option comboboxes (Category, Subcategory,
 * Finish). Kept free of React so the search behaviour is unit-testable.
 *
 * The filter deliberately runs on the option LABEL, normalised on both sides
 * (case + surrounding whitespace), so a partial query typed into the search box
 * always surfaces the options that contain it.
 */

/** Case-insensitive, whitespace-trimmed comparison key. */
export function normalizeProductOption(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Display text for a typed option: collapse runs of whitespace and trim the
 * ends, preserving the user's casing. Used before a custom Category /
 * Subcategory / Finish value is stored on the product row.
 */
export function cleanProductOption(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Decide what a typed query commits to when the field is confirmed — blur
 * (e.g. the user clicks "Add Product"), Enter, or "+ Add Custom".
 *
 * - Exact normalised match → the predefined spelling, flagged `isCustom: false`
 *   so the stored value matches the canonical option.
 * - Anything else → the cleaned typed text as a custom value.
 * - Empty / whitespace-only input → `null` (nothing to commit, keep the
 *   previous selection).
 *
 * This is the guard that stops a typed custom entry from being silently
 * discarded when the user leaves the field.
 */
export function resolveOptionCommit(
  typed: string,
  options: readonly string[]
): { value: string; isCustom: boolean } | null {
  const cleaned = cleanProductOption(typed);
  if (cleaned === "") return null;
  const normalized = normalizeProductOption(cleaned);
  const exact = options.find((option) => normalizeProductOption(option) === normalized);
  if (exact) return { value: exact, isCustom: false };
  return { value: cleaned, isCustom: true };
}

/**
 * Merge the predefined option list with values already seen on products, so a
 * custom Category / Subcategory / Finish added via "+ Add Custom" reappears in
 * the dropdowns without a page refresh.
 *
 * The predefined options keep their order and come first; product values are
 * appended in encounter order, de-duplicated case-insensitively, and
 * null/undefined/blank values are skipped.
 */
export function mergeProductOptions(
  base: readonly string[],
  values: readonly (string | null | undefined)[]
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const cleaned = cleanProductOption(raw ?? "");
    if (cleaned === "") return;
    const key = normalizeProductOption(cleaned);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(cleaned);
  };
  base.forEach(push);
  values.forEach(push);
  return merged;
}

/** True when `value` exactly matches one of the predefined options (normalised). */
export function isKnownProductOption(value: string, options: readonly string[]): boolean {
  const normalized = normalizeProductOption(value);
  if (normalized === "") return false;
  return options.some((option) => normalizeProductOption(option) === normalized);
}

/**
 * Filter `options` down to the ones matching `rawQuery`.
 *
 * Ranking (stable, so each tier keeps the predefined order):
 *   0 — option starts with the query        ("Lever" → "Lever Set Complete")
 *   1 — a word inside the option starts with it ("Neck" → "… Cast Neck")
 *   2 — option contains the query anywhere     ("605"  → "Bib Cock 605-606 C")
 *
 * An empty/whitespace query returns every option; no match returns [].
 */
export function filterProductOptions(options: readonly string[], rawQuery: string): string[] {
  const query = normalizeProductOption(rawQuery);
  if (query === "") return [...options];

  const hits: Array<{ option: string; rank: number }> = [];
  for (const option of options) {
    const normalized = normalizeProductOption(option);
    let rank = -1;
    if (normalized.startsWith(query)) rank = 0;
    else if (normalized.split(/\s+/).some((word) => word.startsWith(query))) rank = 1;
    else if (normalized.includes(query)) rank = 2;
    if (rank >= 0) hits.push({ option, rank });
  }

  hits.sort((a, b) => a.rank - b.rank); // Array#sort is stable in V8
  return hits.map((hit) => hit.option);
}
