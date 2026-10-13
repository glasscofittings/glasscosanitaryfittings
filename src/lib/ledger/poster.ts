import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LedgerPostingPayload {
  transactionRef: string;
  debitAccountCode: string;
  creditAccountCode: string;
  amountPKR: number;
  operatorName: string;
}

export interface LedgerPostingSuccess {
  success: true;
}

export interface LedgerPostingFailure {
  success: false;
  error: string;
}

export type LedgerPostingResult = LedgerPostingSuccess | LedgerPostingFailure;

interface AccountRow {
  id: string;
  account_code: string;
  is_active: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const GL_ACCOUNTS_TABLE = "gl_accounts" as const;
const GL_LEDGER_ENTRIES_TABLE = "gl_ledger_entries" as const;

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Executes a deterministic double-entry ledger posting.
 *
 * 1. Validates amountPKR > 0.
 * 2. Resolves both account codes from `gl_accounts`, confirming each exists
 *    and is active (`is_active = true`).
 * 3. Inserts a balanced debit/credit pair atomically into `gl_ledger_entries`.
 *
 * Both rows share the same `transaction_ref` and `posted_by` metadata.
 * The database enforces immutability via:
 *   - `chk_debit_credit_positive` CHECK constraint
 *   - RLS UPDATE/DELETE policies set to `USING (false)`
 *
 * @param supabaseClient - A Supabase client (server or browser)
 * @param payload        - Posting details: ref, account codes, amount, operator
 * @returns `{ success: true }` on success, or `{ success: false, error: string }`
 */
export async function executeLedgerPosting(
  supabaseClient: SupabaseClient,
  payload: LedgerPostingPayload
): Promise<LedgerPostingResult> {
  const { transactionRef, debitAccountCode, creditAccountCode, amountPKR, operatorName } = payload;

  // ── 1. Validate amount ──────────────────────────────────────────────────
  if (typeof amountPKR !== "number" || !Number.isFinite(amountPKR)) {
    return { success: false, error: "amountPKR must be a finite number." };
  }

  if (amountPKR <= 0) {
    return { success: false, error: "amountPKR must be greater than 0." };
  }

  // ── 2. Validate required string fields ──────────────────────────────────
  if (!transactionRef?.trim()) {
    return { success: false, error: "transactionRef is required." };
  }

  if (!debitAccountCode?.trim()) {
    return { success: false, error: "debitAccountCode is required." };
  }

  if (!creditAccountCode?.trim()) {
    return { success: false, error: "creditAccountCode is required." };
  }

  if (!operatorName?.trim()) {
    return { success: false, error: "operatorName is required." };
  }

  if (debitAccountCode === creditAccountCode) {
    return { success: false, error: "Debit and credit accounts must be different." };
  }

  // ── 3. Resolve accounts from gl_accounts ────────────────────────────────
  const { data: accounts, error: accError } = await supabaseClient
    .from(GL_ACCOUNTS_TABLE)
    .select("id, account_code, is_active")
    .in("account_code", [debitAccountCode, creditAccountCode]);

  if (accError) {
    return {
      success: false,
      error: `Failed to query gl_accounts: ${accError.message}`,
    };
  }

  const accountRows = (accounts ?? []) as AccountRow[];

  // Confirm both codes resolved
  if (accountRows.length !== 2) {
    const found = accountRows.map((a) => a.account_code);
    const missing = [debitAccountCode, creditAccountCode].filter(
      (code) => !found.includes(code)
    );
    return {
      success: false,
      error: `Account(s) not found in gl_accounts: ${missing.join(", ")}`,
    };
  }

  const debitAcc = accountRows.find((a) => a.account_code === debitAccountCode)!;
  const creditAcc = accountRows.find((a) => a.account_code === creditAccountCode)!;

  // Confirm both accounts are active
  if (!debitAcc.is_active) {
    return {
      success: false,
      error: `Debit account '${debitAccountCode}' is inactive and cannot be posted to.`,
    };
  }

  if (!creditAcc.is_active) {
    return {
      success: false,
      error: `Credit account '${creditAccountCode}' is inactive and cannot be posted to.`,
    };
  }

  // ── 4. Atomic dual-row insert into gl_ledger_entries ────────────────────
  const ledgerRows = [
    {
      transaction_ref: transactionRef,
      account_id: debitAcc.id,
      debit_pkr: amountPKR,
      credit_pkr: 0.0,
      posted_by: operatorName,
    },
    {
      transaction_ref: transactionRef,
      account_id: creditAcc.id,
      debit_pkr: 0.0,
      credit_pkr: amountPKR,
      posted_by: operatorName,
    },
  ];

  const { error: insertError } = await supabaseClient
    .from(GL_LEDGER_ENTRIES_TABLE)
    .insert(ledgerRows as never[]);

  if (insertError) {
    return {
      success: false,
      error: `Ledger insert failed: ${insertError.message}`,
    };
  }

  return { success: true };
}
