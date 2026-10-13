/**
 * Canonical Chart of Accounts codes for Glassco Sanitary / Komax Brass ERP.
 *
 * Source of truth for double-entry ledger postings and account validations.
 */

export const ACCOUNT_CODES = {
  CASH: "1000",
  BANK: "1002",
  AR: "1100",
  RAW_MATERIAL: "1101",
  FINISHED_GOODS: "1102",
  TRADE_DEBTS: "1201",
  AP: "2001",
  SALES_TAX: "2200",
  FURTHER_TAX: "2210",
  REVENUE: "4001",
  COGS: "5006",
} as const;

export type AccountCodeKey = keyof typeof ACCOUNT_CODES;
export type AccountCode = (typeof ACCOUNT_CODES)[AccountCodeKey];

export const CORE_ACCOUNT_CODES = Object.values(ACCOUNT_CODES);

export interface AccountCheckResult {
  valid: boolean;
  missingAccounts: string[];
}

/**
 * Queries accounts_chart for all canonical core accounts.
 * Returns the list of missing codes so callers can block actions and inform the user.
 */
export async function verifyCoreAccounts(): Promise<AccountCheckResult> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL) {
    return { valid: false, missingAccounts: [...CORE_ACCOUNT_CODES] };
  }

  try {
    const filter = CORE_ACCOUNT_CODES.join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts_chart?select=account_code&account_code=in.(${filter})`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY ?? "",
          Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      console.error("Failed to query accounts_chart in verifyCoreAccounts:", res.status);
      return { valid: false, missingAccounts: [...CORE_ACCOUNT_CODES] };
    }

    const rows = (await res.json()) as Array<{ account_code: string }>;
    const foundCodes = new Set((rows || []).map((r) => r.account_code));
    const missing = CORE_ACCOUNT_CODES.filter((code) => !foundCodes.has(code));

    return {
      valid: missing.length === 0,
      missingAccounts: missing,
    };
  } catch (err) {
    console.error("Error verifying core accounts:", err);
    return { valid: false, missingAccounts: [...CORE_ACCOUNT_CODES] };
  }
}
