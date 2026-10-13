import { lookupInvoiceUrdu, translateBatchToUrdu } from "./geminiTranslator";
import type { FinancialStatements, JournalEntryWithLines } from "./supabase/ledger";

/**
 * Pre-translation step for financial reports (Balance Sheet, Trial Balance, P&L,
 * Ledger/Statement exports).
 *
 * Rendering is English-first: every dynamic account name coming out of the
 * database goes through `buildTranslatedAccountMap` once, and the resulting
 * `Record<englishName, urduName>` is handed to the PDF/HTML/React renderers as
 * `translatedAccountNamesMap`.
 *
 * Resolution order per name:
 *   1. static accounting dictionary (`INVOICE_URDU_DICTIONARY`) — no API call,
 *   2. already non-Latin text — nothing to translate,
 *   3. `translateBatchToUrdu` (one Gemini call for all remaining names, with its
 *      own session cache and a fail-open fallback to the original text).
 */

export type UrduNameMap = Record<string, string>;

/** Summary labels rendered beside the dynamic rows, so they travel with the map. */
const STATEMENT_LABELS = [
  "Assets",
  "Liabilities",
  "Equity",
  "Revenue",
  "Expenses",
  "Total Assets",
  "Total Liabilities",
  "Total Equity",
  "Total Revenue",
  "Total Expenses",
  "Net Profit",
  "Net Loss",
  "Net Profit (P&L)",
  "Difference",
  "Liabilities + Equity",
  "Balance Check",
  "Grand Totals",
  "Trial Balance",
  "Balance Sheet",
  "Profit & Loss",
  "No asset entries",
  "No liability entries",
  "No equity entries",
  "No revenue entries",
  "No expense entries",
] as const;

/** Dictionary-only lookup for static labels (sections, totals, empty states). */
export function staticUrdu(label: string): string | undefined {
  const ur = lookupInvoiceUrdu(label);
  return ur !== label ? ur : undefined;
}

/** Every account name + summary label a statement render puts on the page. */
export function collectStatementNames(statements: FinancialStatements): string[] {
  const names = new Set<string>();
  const add = (name?: string | null) => {
    const trimmed = (name ?? "").trim();
    if (trimmed) names.add(trimmed);
  };

  statements.trialBalance.forEach((r) => add(r.account_name));
  statements.pl.revenue.forEach((r) => add(r.account_name));
  statements.pl.expenses.forEach((r) => add(r.account_name));
  statements.balanceSheet.assets.forEach((r) => add(r.account_name));
  statements.balanceSheet.liabilities.forEach((r) => add(r.account_name));
  statements.balanceSheet.equity.forEach((r) => add(r.account_name));
  STATEMENT_LABELS.forEach(add);

  return [...names];
}

/** Account names referenced by journal entries (group headers excluded). */
export function collectJournalAccountNames(entries: JournalEntryWithLines[]): string[] {
  const names = new Set<string>();
  entries.forEach((entry) => {
    (entry.journal_lines ?? []).forEach((line) => {
      const name = line.accounts_chart?.account_name?.trim();
      if (name) names.add(name);
    });
  });
  STATEMENT_LABELS.forEach((label) => names.add(label));
  return [...names];
}

/**
 * Builds `Record<string, string>` (English → Urdu) for account names/labels.
 * Dictionary hits never reach the API; everything else goes out in a single batch.
 */
export async function buildTranslatedAccountMap(names: Iterable<string>): Promise<UrduNameMap> {
  const map: UrduNameMap = {};
  const pending: string[] = [];

  for (const raw of names) {
    const name = raw.trim();
    if (!name || name in map) continue;

    const fromDictionary = staticUrdu(name);
    if (fromDictionary) {
      map[name] = fromDictionary;
      continue;
    }
    // Already Urdu/Arabic script (or digits only): nothing for Gemini to do.
    if (!/[A-Za-z]/.test(name)) continue;
    pending.push(name);
  }

  if (pending.length > 0) {
    let translated: string[] = [];
    try {
      translated = await translateBatchToUrdu(pending);
    } catch (err) {
      console.warn("[report-i18n] Batch account translation failed:", err instanceof Error ? err.message : err);
    }
    pending.forEach((name, index) => {
      const candidate = translated[index]?.trim();
      if (candidate && candidate !== name) map[name] = candidate;
    });
  }

  return map;
}

/**
 * Urdu for one row: translated map first, then the row's own `name_urdu`
 * (when a future accounts_chart column provides one), else "".
 */
export function accountUrdu(
  name: string,
  map: UrduNameMap,
  nameUrdu?: string | null
): string {
  const fromMap = map[name.trim()];
  if (fromMap) return fromMap;
  const own = nameUrdu?.trim();
  return own && own !== name.trim() ? own : "";
}
