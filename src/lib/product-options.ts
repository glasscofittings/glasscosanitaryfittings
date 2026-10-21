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
