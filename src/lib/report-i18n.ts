import type { FinancialStatements, JournalEntryWithLines } from "./supabase/ledger";

export type UrduNameMap = Record<string, string>;

export function staticUrdu(_label: string): string | undefined {
  return undefined;
}

export function collectStatementNames(_statements: FinancialStatements): string[] {
  return [];
}

export function collectJournalAccountNames(_entries: JournalEntryWithLines[]): string[] {
  return [];
}

export async function buildTranslatedAccountMap(_names: Iterable<string>): Promise<UrduNameMap> {
  return {};
}

export function accountUrdu(
  _englishName: string | undefined | null,
  _map?: UrduNameMap,
  _preTranslated?: string | null,
): string | undefined {
  return undefined;
}
