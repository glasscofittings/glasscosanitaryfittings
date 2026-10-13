import { formatPKR } from "@/lib/utils/formatters";
import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";

export interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  /** True on canonical Cash in Hand (post-dedup) — prefer over hardcoding "1000". */
  is_default_cash?: boolean;
  /** True on Cash + Bank — used by fetchAvailableFunds. */
  is_liquid_funds?: boolean;
  /** Optional Urdu account name stored alongside the English one (accounts_chart.name_urdu). */
  name_urdu?: string | null;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  narration: string;
  customer_name: string | null;
  is_balanced: boolean;
  status: "DRAFT" | "POSTED";
  created_at: string;
}

export interface JournalLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  party_id: string | null;
  debit_pkr: number;
  credit_pkr: number;
  accounts_chart?: Account;
  parties?: {
    id: string;
    name: string;
    party_type?: string;
    phone?: string;
    email?: string;
    address?: string;
    ntn_strn?: string;
  } | null;
}

export interface JournalEntryWithLines extends JournalEntry {
  journal_lines?: JournalLine[];
}

export interface JournalEntryResult {
  data: JournalEntry | null;
  error: string | null;
  /** False when a draft was saved as header-only (lines omitted until balanced). */
  linesSaved?: boolean;
}

/** One journal_line joined to its parent entry — strictly one account's side of each JE. */
export interface AccountLedgerLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit_pkr: number;
  credit_pkr: number;
  entry_date: string;
  entry_number: string;
  narration: string;
  status: "DRAFT" | "POSTED";
  created_at: string;
  customer_name: string | null;
}

export interface AccountLedgerQuery {
  /** accounts_chart.id UUID — preferred, filters journal_lines.account_id directly */
  accountId?: string;
  /** accounts_chart.account_code — resolved to a UUID when accountId is omitted */
  accountCode?: string;
  startDate?: string;
  endDate?: string;
  includeDrafts?: boolean;
}

/** Normal-balance ledger row after opening + sequential running balance. */
export interface AccountLedgerRow {
  id: string;
  entryId: string;
  date: string;
  voucherNo: string;
  status: "DRAFT" | "POSTED";
  narration: string;
  debit: number;
  credit: number;
  /** opening + debit - credit (running). >= 0 → Dr, < 0 → Cr */
  balance: number;
  createdAt: string;
}

export interface AccountLedgerSummary {
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  rows: AccountLedgerRow[];
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
  /** Optional pre-translated name from accounts_chart.name_urdu. */
  name_urdu?: string | null;
}

export interface PLRow {
  account_code: string;
  account_name: string;
  amount: number;
  name_urdu?: string | null;
}

export interface BalanceSheetRow {
  account_code: string;
  account_name: string;
  amount: number;
  name_urdu?: string | null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

export async function fetchAccounts(): Promise<Account[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts_chart?order=account_code.asc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [accounts_chart]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as Account[];
  } catch (err) {
    console.error("Supabase Error [accounts_chart]:", err);
    return [];
  }
}

export async function fetchJournalEntries(): Promise<JournalEntryWithLines[]> {
  if (!SUPABASE_URL) return [];
  try {
    let res = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?select=*,journal_lines(*,accounts_chart(*),parties(*))&order=entry_date.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      // Fallback without parties(*) if PostgREST relation is not exposed
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/journal_entries?select=*,journal_lines(*,accounts_chart(*))&order=entry_date.desc`,
        { headers: headers() }
      );
    }
    if (!res.ok) {
      console.error("Supabase Error [journal_entries]:", { status: res.status, body: await res.json().catch(() => null) });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as JournalEntryWithLines[];
  } catch (err) {
    console.error("Supabase Error [journal_entries]:", err);
    return [];
  }
}

/**
 * Fetch journal_lines for ONE account only (`WHERE journal_lines.account_id = :id`).
 * Counter-account lines in the same JE are never returned — each JE appears at most
 * once (only the selected account's debit or credit side).
 */
export async function getAccountLedger(query: AccountLedgerQuery): Promise<AccountLedgerLine[]> {
  if (!SUPABASE_URL) return [];

  let accountId = query.accountId;

  if (!accountId && query.accountCode) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/accounts_chart?account_code=eq.${encodeURIComponent(query.accountCode)}&select=id&limit=1`,
        { headers: headers() }
      );
      if (!res.ok) {
        console.error("Supabase Error [accounts_chart resolve]:", { status: res.status });
        return [];
      }
      const rows = (await res.json()) as { id: string }[];
      accountId = rows[0]?.id;
    } catch (err) {
      console.error("Supabase Error [accounts_chart resolve]:", err);
      return [];
    }
  }

  if (!accountId) return [];

  try {
    const params = new URLSearchParams({
      account_id: `eq.${accountId}`,
      select:
        "id,journal_entry_id,account_id,debit_pkr,credit_pkr," +
        "journal_entries(entry_date,entry_number,narration,status,created_at,customer_name)",
      order: "id.asc",
    });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?${params.toString()}`, {
      headers: headers(),
    });
    if (!res.ok) {
      console.error("Supabase Error [getAccountLedger]:", { status: res.status, body: await res.json().catch(() => null) });
      return [];
    }
    const json = (await res.json()) as Array<
      Omit<AccountLedgerLine, "entry_date" | "entry_number" | "narration" | "status" | "created_at" | "customer_name"> & {
        journal_entries: Pick<AccountLedgerLine, "entry_date" | "entry_number" | "narration" | "status" | "created_at" | "customer_name"> | null;
      }
    >;

    return json
      .filter((row) => row.journal_entries)
      .map((row) => ({
        id: row.id,
        journal_entry_id: row.journal_entry_id,
        account_id: row.account_id,
        debit_pkr: Number(row.debit_pkr) || 0,
        credit_pkr: Number(row.credit_pkr) || 0,
        entry_date: row.journal_entries!.entry_date,
        entry_number: row.journal_entries!.entry_number,
        narration: row.journal_entries!.narration,
        status: row.journal_entries!.status,
        created_at: row.journal_entries!.created_at,
        customer_name: row.journal_entries!.customer_name,
      }));
  } catch (err) {
    console.error("Supabase Error [getAccountLedger]:", err);
    return [];
  }
}

/**
 * Pure helper: sort lines chronologically, split on startDate, and compute
 * opening / running / period totals for a debit-normal (ASSET / CUSTOMER) account.
 * Running balance = optional base opening + pre-startDate txns + debit - credit, line by line.
 * `opts.baseOpeningBalance` is signed (Dr positive / Cr negative).
 */
export function buildAccountLedgerSummary(
  lines: AccountLedgerLine[],
  opts: { startDate?: string; endDate?: string; baseOpeningBalance?: number } = {}
): AccountLedgerSummary {
  const { startDate, endDate } = opts;

  const sorted = [...lines].sort((a, b) => {
    const cmpDate = a.entry_date.localeCompare(b.entry_date);
    if (cmpDate !== 0) return cmpDate;
    return a.created_at.localeCompare(b.created_at);
  });

  let openingBalance = Number(opts.baseOpeningBalance) || 0;
  for (const line of sorted) {
    if (startDate && line.entry_date < startDate) {
      openingBalance += line.debit_pkr - line.credit_pkr;
    }
  }

  let running = openingBalance;
  const rows: AccountLedgerRow[] = [];

  for (const line of sorted) {
    const inRange = (!startDate || line.entry_date >= startDate) && (!endDate || line.entry_date <= endDate);
    if (!inRange) continue;
    running += line.debit_pkr - line.credit_pkr;
    rows.push({
      id: line.id,
      entryId: line.journal_entry_id,
      date: line.entry_date,
      voucherNo: line.entry_number,
      status: line.status,
      narration: line.narration || (line.customer_name ? `Party: ${line.customer_name}` : "Journal Transaction"),
      debit: line.debit_pkr,
      credit: line.credit_pkr,
      balance: running,
      createdAt: line.created_at,
    });
  }

  const periodDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const periodCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  const closingBalance = openingBalance + periodDebit - periodCredit;

  return { openingBalance, periodDebit, periodCredit, closingBalance, rows };
}

/** `Rs/PKR X.XX Dr` when balance >= 0, `… Cr` when negative (debit-normal). */
export function formatLedgerBalance(balance: number): string {
  return `${formatPKR(Math.abs(balance))} ${balance >= 0 ? "Dr" : "Cr"}`;
}

// ─── Available Funds (live SUM — never a stored balance) ───────────────────

export interface AvailableFunds {
  cashBalance: number;
  bankBalance: number;
  total: number;
}

/**
 * Live sum of debit - credit from journal_lines for the liquid accounts
 * (is_liquid_funds flag; falls back to codes 1000/1002 if the column is missing).
 * Includes DRAFT + POSTED so it always matches computeTrialBalance.
 */
export async function fetchAvailableFunds(): Promise<AvailableFunds> {
  const empty: AvailableFunds = { cashBalance: 0, bankBalance: 0, total: 0 };
  if (!SUPABASE_URL) return empty;
  try {
    // 1) Resolve liquid account ids (flag first, fallback to known codes).
    let accRes = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts_chart?select=id,account_code&is_liquid_funds=eq.true`,
      { headers: headers() }
    );
    let accounts: { id: string; account_code: string }[] = [];
    if (accRes.ok) {
      const json = await accRes.json();
      accounts = Array.isArray(json) ? json : [];
    }
    if (accounts.length === 0) {
      accRes = await fetch(
        `${SUPABASE_URL}/rest/v1/accounts_chart?select=id,account_code&account_code=in.(${ACCOUNT_CODES.CASH},${ACCOUNT_CODES.BANK})`,
        { headers: headers() }
      );
      if (accRes.ok) {
        const json = await accRes.json();
        accounts = Array.isArray(json) ? json : [];
      }
    }
    if (accounts.length === 0) return empty;

    const ids = accounts.map((a) => a.id).join(",");
    const lineRes = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_lines?select=account_id,debit_pkr,credit_pkr&account_id=in.(${ids})`,
      { headers: headers() }
    );
    if (!lineRes.ok) return empty;
    const lines = (await lineRes.json()) as {
      account_id: string;
      debit_pkr: number;
      credit_pkr: number;
    }[];

    const byId = new Map<string, number>();
    for (const a of accounts) byId.set(a.id, 0);
    for (const line of lines) {
      const prev = byId.get(line.account_id) ?? 0;
      byId.set(
        line.account_id,
        prev + (Number(line.debit_pkr) || 0) - (Number(line.credit_pkr) || 0)
      );
    }

    let cashBalance = 0;
    let bankBalance = 0;
    for (const a of accounts) {
      const bal = byId.get(a.id) ?? 0;
      if (a.account_code === ACCOUNT_CODES.BANK) bankBalance += bal;
      else cashBalance += bal; // CASH (and any other liquid non-bank)
    }

    return {
      cashBalance,
      bankBalance,
      total: cashBalance + bankBalance,
    };
  } catch (err) {
    console.error("Supabase Error [fetchAvailableFunds]:", err);
    return empty;
  }
}

// ─── Capital injection (owner Add Funds) ───────────────────────────────────

export async function recordCapitalInjection(input: {
  amount: number;
  target: "CASH" | "BANK";
  narration: string;
  operatorName: string;
  deviceNode: string;
}): Promise<{ data: { entry_number: string; amount: number } | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured." };
  if (!(input.amount > 0)) return { data: null, error: "Amount must be greater than zero." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_capital_injection`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_amount: input.amount,
        p_target_account: input.target,
        p_narration: input.narration,
        p_operator_name: input.operatorName,
        p_device_node: input.deviceNode,
      }),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok) {
      const message =
        (body.message as string | undefined) ??
        (body.error as string | undefined) ??
        text.slice(0, 300) ??
        "Failed to record capital injection.";
      console.error("Supabase Error [record_capital_injection]:", {
        status: res.status,
        message,
        details: body.details,
        hint: body.hint,
      });
      return { data: null, error: message };
    }
    return {
      data: {
        entry_number: String(body.entry_number ?? ""),
        amount: Number(body.amount ?? input.amount),
      },
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [record_capital_injection]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

// ─── Capital injection edit (Available Funds → Edit) ───────────────────────

/** One owner capital-injection entry (Dr 1000/1002 · Cr 3000) — as returned by the RPC. */
export interface CapitalInjection {
  id: string;
  entry_number: string;
  entry_date: string;
  narration: string | null;
  amount: number;
  target: "CASH" | "BANK";
}

/** Recent capital-injection entries, newest first — the pick list of the Edit modal. */
export async function fetchCapitalInjections(limit = 50): Promise<CapitalInjection[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_capital_injections`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_limit: limit }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Supabase Error [list_capital_injections]:", {
        status: res.status,
        body: text.slice(0, 300),
      });
      return [];
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return [];
    return (body as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      entry_number: String(row.entry_number ?? ""),
      entry_date: String(row.entry_date ?? ""),
      narration: row.narration == null ? null : String(row.narration),
      amount: Number(row.amount ?? 0),
      target: row.target === "BANK" ? ("BANK" as const) : ("CASH" as const),
    }));
  } catch (err) {
    console.error("Supabase Error [list_capital_injections]:", err);
    return [];
  }
}

/**
 * Correct a wrongly recorded capital injection in place: rewrites the entry's
 * journal_lines with the new amount/target, keeps entry_number + entry_date,
 * and writes an UPDATED_CAPITAL_INJECTION audit row.
 */
export async function updateCapitalInjection(input: {
  entryId: string;
  amount: number;
  target: "CASH" | "BANK";
  narration: string;
  operatorName: string;
  deviceNode: string;
}): Promise<{
  data: { entry_number: string; amount: number; previous_amount: number | null } | null;
  error: string | null;
}> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured." };
  if (!(input.amount > 0)) return { data: null, error: "Amount must be greater than zero." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_capital_injection`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_entry_id: input.entryId,
        p_amount: input.amount,
        p_target_account: input.target,
        p_narration: input.narration,
        p_operator_name: input.operatorName,
        p_device_node: input.deviceNode,
      }),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok) {
      const message =
        (body.message as string | undefined) ??
        (body.error as string | undefined) ??
        text.slice(0, 300) ??
        "Failed to update capital injection.";
      console.error("Supabase Error [update_capital_injection]:", {
        status: res.status,
        message,
        details: body.details,
        hint: body.hint,
      });
      return { data: null, error: message };
    }
    return {
      data: {
        entry_number: String(body.entry_number ?? ""),
        amount: Number(body.amount ?? input.amount),
        previous_amount:
          body.previous_amount == null ? null : Number(body.previous_amount),
      },
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [update_capital_injection]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

export async function createJournalEntry(entry: {
  entry_date: string;
  narration: string;
  customer_name?: string;
  lines: { account_id: string; debit_pkr: number; credit_pkr: number }[];
  device_node: string;
  operator_name: string;
  status?: "DRAFT" | "POSTED";
}): Promise<JournalEntryResult> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };

  // Bug #5 fix: Work in paisa (integers) to avoid IEEE 754 floating-point errors
  const totalDebitPaisa = entry.lines.reduce((a, l) => a + Math.round(l.debit_pkr * 100), 0);
  const totalCreditPaisa = entry.lines.reduce((a, l) => a + Math.round(l.credit_pkr * 100), 0);
  const isBalanced = totalDebitPaisa === totalCreditPaisa;
  const status = entry.status ?? "DRAFT";
  // Single-sided entries are allowed (debit-only or credit-only).
  const persistLines = entry.lines.length > 0;

  if (status === "POSTED" && !persistLines) {
    return { data: null, error: "Posted entries require journal lines." };
  }

  // Bug #10 fix: Use 8 digits (2.7 hour collision window) + random suffix for safety
  const entryNumber = `JE-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}-${crypto.randomUUID().slice(0, 4)}`;

  // --- Insert journal entry ---
  let entryRes: Response;
  try {
    entryRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        entry_number: entryNumber,
        entry_date: entry.entry_date,
        narration: entry.narration,
        customer_name: entry.customer_name || null,
        is_balanced: isBalanced && persistLines,
        status,
      }),
    });
  } catch (err) {
    console.error("Supabase Error [journal_entries insert]: network failure", err);
    return { data: null, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!entryRes.ok) {
    const bodyText = await entryRes.text().catch(() => "");
    let detail = bodyText;
    try { detail = JSON.parse(bodyText).message ?? bodyText; } catch {}
    const msg = `Journal entry insert failed (${entryRes.status} ${entryRes.statusText}): ${detail}`;
    console.error("Supabase Error [journal_entries insert]:", msg);
    return { data: null, error: msg };
  }

  let entryRows: unknown[];
  try {
    entryRows = await entryRes.json();
  } catch {
    const msg = `Journal entry created but response was not JSON (${entryRes.status})`;
    console.error("Supabase Error [journal_entries insert]:", msg);
    return { data: null, error: msg };
  }

  const newEntry = (entryRows as JournalEntry[])[0];
  if (!newEntry) {
    return { data: null, error: "Journal entry created but no rows returned" };
  }

  // --- Insert journal lines ---
  if (persistLines) {
    const lines = entry.lines.map((l) => ({
      journal_entry_id: newEntry.id,
      account_id: l.account_id,
      debit_pkr: l.debit_pkr,
      credit_pkr: l.credit_pkr,
    }));

    let linesRes: Response;
    try {
      linesRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(lines),
      });
    } catch (err) {
      console.error("Supabase Error [journal_lines insert]: network failure", err);
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${newEntry.id}`, {
        method: "DELETE",
        headers: headers(),
      }).catch(() => {});
      return { data: null, error: `Lines failed (network) — entry rolled back: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!linesRes.ok) {
      const bodyText = await linesRes.text().catch(() => "");
      let detail = bodyText;
      try { detail = JSON.parse(bodyText).message ?? bodyText; } catch {}
      console.error("Supabase Error [journal_lines insert]:", detail);
      // Roll back the orphaned header so the entry never shows up with zero lines.
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${newEntry.id}`, {
        method: "DELETE",
        headers: headers(),
      }).catch(() => {});
      return { data: null, error: `Journal lines rejected (${linesRes.status}): ${detail}` };
    }
  }

  // --- Audit log (best-effort) ---
  fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      node_id: entry.device_node,
      operator_name: entry.operator_name,
      action_type: "CREATED_JOURNAL_ENTRY",
      details: {
        module: "LEDGER",
        entry_number: entryNumber,
        total_debit: totalDebitPaisa / 100,
        total_credit: totalCreditPaisa / 100,
        line_count: persistLines ? entry.lines.length : 0,
        header_only: !persistLines,
        balanced: isBalanced,
      },
    }),
  }).catch(() => {});

  return { data: newEntry, error: null, linesSaved: persistLines };
}

export async function createAccount(data: {
  account_code: string;
  account_name: string;
  account_type: Account["account_type"];
}): Promise<Account | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/accounts_chart`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      console.error("Supabase Error [accounts_chart insert]:", { status: res.status, body: await res.json() });
      return null;
    }
    const rows = await res.json();
    return rows[0] ?? null;
  } catch (err) {
    console.error("Supabase Error [accounts_chart insert]:", err);
    return null;
  }
}

export async function updateAccount(
  id: string,
  data: { account_name?: string; account_type?: Account["account_type"] }
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/accounts_chart?id=eq.${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      console.error("Supabase Error [accounts_chart update]:", { status: res.status, body: await res.json() });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [accounts_chart update]:", err);
    return false;
  }
}

export async function deleteAccount(id: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/accounts_chart?id=eq.${id}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) {
      console.error("Supabase Error [accounts_chart delete]:", { status: res.status, body: await res.json() });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [accounts_chart delete]:", err);
    return false;
  }
}

export async function updateJournalEntry(
  entryId: string,
  data: { entry_date: string; narration: string; customer_name?: string | null; is_balanced?: boolean }
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${entryId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      console.error("Supabase Error [journal_entries update]:", { status: res.status, body: await res.json() });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [journal_entries update]:", err);
    return false;
  }
}

export async function deleteJournalLines(entryId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${entryId}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) {
      console.error("Supabase Error [journal_lines delete]:", { status: res.status, body: await res.json() });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [journal_lines delete]:", err);
    return false;
  }
}

export async function addJournalLines(
  entryId: string,
  lines: { account_id: string; debit_pkr: number; credit_pkr: number }[]
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const payload = lines.map((l) => ({
      journal_entry_id: entryId,
      account_id: l.account_id,
      debit_pkr: l.debit_pkr,
      credit_pkr: l.credit_pkr,
    }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("Supabase Error [journal_lines insert]:", { status: res.status, body: await res.json() });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [journal_lines insert]:", err);
    return false;
  }
}

export async function postJournalEntry(entryId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${entryId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status: "POSTED" }),
    });
    if (!res.ok) {
      console.error("Supabase Error [journal_entries post]:", { status: res.status, body: await res.json() });
      return false;
    }

    await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        node_id: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
        operator_name: "Accounts Dept",
        action_type: "POSTED_JOURNAL_ENTRY",
        details: { module: "LEDGER", entry_id: entryId },
      }),
    });
    return true;
  } catch (err) {
    console.error("Supabase Error [postJournalEntry]:", err);
    return false;
  }
}

export function computeTrialBalance(entries: JournalEntryWithLines[]): TrialBalanceRow[] {
  const map = new Map<string, { account_code: string; account_name: string; account_type: string; total_debit: number; total_credit: number; name_urdu?: string | null }>();

  entries.forEach((e) => {
    e.journal_lines?.forEach((line) => {
      const acc = line.accounts_chart;
      if (!acc) return;
      const key = acc.account_code;
      if (!map.has(key)) {
        map.set(key, { account_code: acc.account_code, account_name: acc.account_name, account_type: acc.account_type, total_debit: 0, total_credit: 0, name_urdu: acc.name_urdu ?? null });
      }
      const row = map.get(key)!;
      row.total_debit += line.debit_pkr;
      row.total_credit += line.credit_pkr;
    });
  });

  return Array.from(map.values()).sort((a, b) => a.account_code.localeCompare(b.account_code));
}

export function computePL(rows: TrialBalanceRow[]): { revenue: PLRow[]; expenses: PLRow[]; netProfit: number } {
  const revenue = rows
    .filter((r) => r.account_type === "REVENUE")
    .map((r) => ({ account_code: r.account_code, account_name: r.account_name, amount: r.total_credit - r.total_debit, name_urdu: r.name_urdu ?? null }));
  const expenses = rows
    .filter((r) => r.account_type === "EXPENSE")
    .map((r) => ({ account_code: r.account_code, account_name: r.account_name, amount: r.total_debit - r.total_credit, name_urdu: r.name_urdu ?? null }));
  const totalRevenue = revenue.reduce((a, r) => a + r.amount, 0);
  const totalExpenses = expenses.reduce((a, r) => a + r.amount, 0);
  return { revenue, expenses, netProfit: totalRevenue - totalExpenses };
}

export function computeBalanceSheet(rows: TrialBalanceRow[]): { assets: BalanceSheetRow[]; liabilities: BalanceSheetRow[]; equity: BalanceSheetRow[] } {
  const assets = rows
    .filter((r) => r.account_type === "ASSET")
    .map((r) => ({ account_code: r.account_code, account_name: r.account_name, amount: r.total_debit - r.total_credit, name_urdu: r.name_urdu ?? null }));
  const liabilities = rows
    .filter((r) => r.account_type === "LIABILITY")
    .map((r) => ({ account_code: r.account_code, account_name: r.account_name, amount: r.total_credit - r.total_debit, name_urdu: r.name_urdu ?? null }));
  const equity = rows
    .filter((r) => r.account_type === "EQUITY")
    .map((r) => ({ account_code: r.account_code, account_name: r.account_name, amount: r.total_credit - r.total_debit, name_urdu: r.name_urdu ?? null }));
  return { assets, liabilities, equity };
}

export interface FinancialStatements {
  trialBalance: TrialBalanceRow[];
  pl: { revenue: PLRow[]; expenses: PLRow[]; netProfit: number };
  balanceSheet: { assets: BalanceSheetRow[]; liabilities: BalanceSheetRow[]; equity: BalanceSheetRow[] };
  totalDebit: number;
  totalCredit: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export async function fetchFinancialStatements(): Promise<FinancialStatements> {
  const entries = await fetchJournalEntries();
  // Include DRAFT + POSTED so newly saved (even single-sided) entries appear in Trial Balance.
  const trialBalance = computeTrialBalance(entries);
  const pl = computePL(trialBalance);
  const balanceSheet = computeBalanceSheet(trialBalance);

  const totalDebit = trialBalance.reduce((a, r) => a + r.total_debit, 0);
  const totalCredit = trialBalance.reduce((a, r) => a + r.total_credit, 0);
  const totalAssets = balanceSheet.assets.reduce((a, r) => a + r.amount, 0);
  const totalLiabilities = balanceSheet.liabilities.reduce((a, r) => a + r.amount, 0);
  const totalEquity = balanceSheet.equity.reduce((a, r) => a + r.amount, 0) + pl.netProfit;

  return { trialBalance, pl, balanceSheet, totalDebit, totalCredit, totalAssets, totalLiabilities, totalEquity };
}

// =============================================================================
// SAP-STYLE DOUBLE-ENTRY POSTING (FI Engine)
// =============================================================================

export interface LedgerEntryPayload {
  transactionRef: string;
  debitAccountId: string;
  creditAccountId: string;
  amountPKR: number;
  operatorName: string;
}

/**
 * Executes a balanced double-entry transaction into `gl_ledger_entries`.
 *
 * This is the SAP-style posting driver: it inserts two rows atomically —
 * one debit, one credit — each referencing `gl_accounts.id`. The database
 * enforces immutability via:
 *   - `chk_debit_credit_positive` CHECK constraint
 *   - RLS UPDATE/DELETE policies set to `USING (false)`
 *
 * @returns `{ success: true }` on success, or `{ success: false, error: string }`
 */
export async function postDoubleEntryTransaction({
  transactionRef,
  debitAccountId,
  creditAccountId,
  amountPKR,
  operatorName,
}: LedgerEntryPayload): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) {
    return { success: false, error: "Server URL is not configured." };
  }

  if (amountPKR <= 0) {
    return { success: false, error: "Transaction amount must be greater than zero." };
  }

  if (debitAccountId === creditAccountId) {
    return { success: false, error: "Debit and credit accounts must be different." };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gl_ledger_entries`, {
      method: "POST",
      headers: {
        ...headers(),
        Prefer: "return=representation",
      },
      body: JSON.stringify([
        {
          transaction_ref: transactionRef,
          account_id: debitAccountId,
          debit_pkr: amountPKR,
          credit_pkr: 0.0,
          posted_by: operatorName,
        },
        {
          transaction_ref: transactionRef,
          account_id: creditAccountId,
          debit_pkr: 0.0,
          credit_pkr: amountPKR,
          posted_by: operatorName,
        },
      ]),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      let detail = bodyText;
      try {
        detail = JSON.parse(bodyText).message ?? bodyText;
      } catch {
        /* not JSON */
      }
      return { success: false, error: `Ledger posting failed (${res.status}): ${detail}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Resolves account codes to UUIDs from `gl_accounts`.
 * Useful when the caller has account codes (e.g., "1100") instead of UUIDs.
 */
export async function resolveAccountCodes(
  codes: string[]
): Promise<{ id: string; account_code: string }[]> {
  if (!SUPABASE_URL || codes.length === 0) return [];
  try {
    const params = codes.map((c) => `account_code.eq.${c}`).join("&");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/gl_accounts?select=id,account_code&${params}`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
