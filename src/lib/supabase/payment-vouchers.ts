export interface PaymentVoucher {
  id: string;
  voucher_no: string;
  voucher_type: "CASH_PAYMENT" | "PARTY_PAYMENT" | "BANK_PAYMENT" | "SALARY_PAYMENT";
  voucher_date: string;
  payee_name: string;
  payee_name_ur?: string | null;
  payee_address: string | null;
  cnic_ntn: string | null;
  purpose: string | null;
  purpose_ur?: string | null;
  reference_no: string | null;
  debit_account_id: string | null;
  credit_account_id: string | null;
  debit_account_name?: string | null;
  credit_account_name?: string | null;
  amount: number;
  amount_in_words: string;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  debit_account?: Account;
  credit_account?: Account;
  category?: string;
}

export interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  /** True on the canonical Cash in Hand row (post-dedup). Prefer over hardcoding "1000". */
  is_default_cash?: boolean;
  /** True on Cash (1000) + Bank (1002) — used by Available Funds live SUM. */
  is_liquid_funds?: boolean;
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

/**
 * Narration filter for a voucher's journal entry:
 * `CPV CPV-2026-00001 — Payee`. Anchored on "PREFIX VOUCHER_NO " so BOTH
 * separators written by historical RPC versions match — " — " (em dash) and
 * " -- " (ASCII). Anchoring on a single separator is exactly how the old
 * lookup missed the RPC's row and posted a duplicate journal entry. The
 * trailing space prevents CPV-2026-0001 from matching CPV-2026-00010.
 */
function voucherNarrationFilter(voucherNo: string): string {
  const prefix = voucherNo.split("-")[0];
  return encodeURIComponent(`${prefix} ${voucherNo} %`);
}

/**
 * Every journal entry posted for a voucher, earliest first.
 *
 * Queries BOTH keys and merges the results:
 *   1. the dedicated `journal_entries.voucher_no` column (partial unique index
 *      ⇒ at most one row, migration 20261020010000), and
 *   2. the narration prefix — matches both historical separators (" — " em
 *      dash and " -- " ASCII) and covers rows the backfill may have missed.
 *
 * If duplicates are found anyway, the earliest entry is kept and the rest are
 * deleted (journal_lines cascade) so the ledger counts the voucher once.
 */
async function findVoucherJournalEntryIds(voucherNo: string): Promise<string[]> {
  if (!SUPABASE_URL || !voucherNo) return [];

  const filter = voucherNarrationFilter(voucherNo);
  const safeFetch = (url: string) =>
    fetch(url, { headers: headers() }).catch((err) => {
      console.warn(
        "Supabase Warning [findVoucherJournalEntryIds]:",
        err instanceof Error ? err.message : err
      );
      return null;
    });
  const [byVoucher, byNarration] = await Promise.all([
    safeFetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?voucher_no=eq.${encodeURIComponent(voucherNo)}&select=id,entry_date,entry_number&order=entry_date.asc,entry_number.asc`
    ),
    safeFetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?narration=like.${filter}&select=id,entry_date,entry_number&order=entry_date.asc,entry_number.asc&limit=10`
    ),
  ]);

  const seen = new Map<string, { id: string; entry_date: string; entry_number: string }>();
  for (const [label, res] of [
    ["voucher_no", byVoucher],
    ["narration", byNarration],
  ] as const) {
    if (!res) continue;
    if (res.ok) {
      try {
        const rows = (await res.json()) as Array<{
          id: string;
          entry_date: string;
          entry_number: string;
        }>;
        for (const row of rows ?? []) {
          if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
        }
      } catch {
        /* non-JSON body — treated as no rows */
      }
    } else {
      const body = await res.text();
      // PGRST204 = column does not exist yet (migration pending) — expected,
      // the narration lookup still resolves the entry.
      if (!body.includes("PGRST204")) {
        console.warn(
          `Supabase Warning [findVoucherJournalEntryIds ${label}]:`,
          res.status,
          body.slice(0, 300)
        );
      }
    }
  }

  const entries = [...seen.values()].sort(
    (a, b) =>
      a.entry_date.localeCompare(b.entry_date) ||
      a.entry_number.localeCompare(b.entry_number)
  );
  if (entries.length <= 1) return entries.map((e) => e.id);

  const keep = entries[0].id;
  const dupeFilter = entries
    .slice(1)
    .map((e) => e.id)
    .join(",");
  let deduped = false;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=in.(${dupeFilter})`, {
      method: "DELETE",
      headers: headers(),
    });
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=in.(${dupeFilter})`, {
      method: "DELETE",
      headers: headers(),
    });
    deduped = delRes.ok;
    if (!delRes.ok) {
      console.warn(
        "Supabase Warning [findVoucherJournalEntryIds dedupe]:",
        delRes.status,
        (await delRes.text()).slice(0, 300)
      );
    }
  } catch (err) {
    console.warn(
      "Supabase Warning [findVoucherJournalEntryIds dedupe]:",
      err instanceof Error ? err.message : err
    );
  }
  if (deduped) {
    const dupeCount = entries.length - 1;
    console.info(
      `[payment-vouchers] removed ${dupeCount} duplicate journal entr${
        dupeCount === 1 ? "y" : "ies"
      } for ${voucherNo}`
    );
    return [keep];
  }
  return entries.map((e) => e.id);
}

// ─── Number to Words (PKR) ──────────────────────────────────────────────────

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function convertGroup(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + convertGroup(n % 100) : "");
}

export function numberToWords(num: number): string {
  if (num === 0) return "Zero";
  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);

  let result = "";
  const crore = Math.floor(intPart / 10000000);
  const lakh = Math.floor((intPart % 10000000) / 100000);
  const thousand = Math.floor((intPart % 100000) / 1000);
  const remaining = intPart % 1000;

  if (crore > 0) result += convertGroup(crore) + " Crore ";
  if (lakh > 0) result += convertGroup(lakh) + " Lakh ";
  if (thousand > 0) result += convertGroup(thousand) + " Thousand ";
  if (remaining > 0) result += convertGroup(remaining);

  result = result.trim() + " Rupees";
  if (decPart > 0) {
    result += " and " + convertGroup(decPart) + " Paisa";
  }
  result += " Only";
  return result;
}

// ─── Fetch Accounts ─────────────────────────────────────────────────────────

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

// ─── Fetch Payment Vouchers ─────────────────────────────────────────────────

export async function fetchPaymentVouchers(
  type?: "CASH_PAYMENT" | "PARTY_PAYMENT" | "BANK_PAYMENT" | "SALARY_PAYMENT"
): Promise<PaymentVoucher[]> {
  if (!SUPABASE_URL) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/payment_vouchers?select=*,debit_account:accounts_chart!payment_vouchers_debit_account_id_fkey(account_code,account_name),credit_account:accounts_chart!payment_vouchers_credit_account_id_fkey(account_code,account_name)&order=voucher_date.desc,voucher_no.desc`;
    if (type) {
      url += `&voucher_type=eq.${type}`;
    }
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      console.error("Supabase Error [payment_vouchers]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as PaymentVoucher[];
  } catch (err) {
    console.error("Supabase Error [payment_vouchers]:", err);
    return [];
  }
}

// ─── Fetch Payment Vouchers for one party ───────────────────────────────────

/**
 * Vouchers carry the payee as free text (no party FK), so a party's history is every voucher
 * whose payee name matches the party name, case-insensitively. Returned oldest first, ledger style.
 */
export async function fetchPartyPaymentVouchers(partyName: string): Promise<PaymentVoucher[]> {
  const name = partyName.trim();
  if (!SUPABASE_URL || !name) return [];
  try {
    // `ilike` without wildcards is a case-insensitive equality. PostgREST does not unquote
    // `ilike` values, so the name goes in bare; only its own wildcards need escaping.
    const pattern = name.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const filter = encodeURIComponent(pattern);
    const url = `${SUPABASE_URL}/rest/v1/payment_vouchers?select=*,debit_account:accounts_chart!payment_vouchers_debit_account_id_fkey(account_code,account_name),credit_account:accounts_chart!payment_vouchers_credit_account_id_fkey(account_code,account_name)&payee_name=ilike.${filter}&order=voucher_date.asc,voucher_no.asc`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      console.error("Supabase Error [payment_vouchers by party]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as PaymentVoucher[];
  } catch (err) {
    console.error("Supabase Error [payment_vouchers by party]:", err);
    return [];
  }
}

// ─── Create Payment Voucher ─────────────────────────────────────────────────

/**
 * Double-pay guard for salary: true when a SALARY_PAYMENT already exists for
 * this worker + pay period (reference_no = "SALARY-YYYY-MM").
 * No dedicated tracking table — payee + period on the voucher is enough.
 */
export async function salaryAlreadyPaid(
  payeeName: string,
  referenceNo: string
): Promise<boolean> {
  if (!SUPABASE_URL || !payeeName.trim() || !referenceNo.trim()) return false;
  try {
    const filter = encodeURIComponent(payeeName.trim());
    const ref = encodeURIComponent(referenceNo.trim());
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/payment_vouchers?select=id&voucher_type=eq.SALARY_PAYMENT&reference_no=eq.${ref}&payee_name=eq.${filter}&limit=1`,
      { headers: headers() }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function createPaymentVoucher(data: {
  voucher_type: "CASH_PAYMENT" | "PARTY_PAYMENT" | "BANK_PAYMENT" | "SALARY_PAYMENT";
  voucher_date: string;
  payee_name: string;
  payee_name_ur?: string;
  payee_address?: string;
  cnic_ntn?: string;
  purpose?: string;
  purpose_ur?: string;
  reference_no?: string;
  debit_account_id?: string;
  credit_account_id?: string;
  amount: number;
  amount_in_words?: string;
  remarks?: string;
}): Promise<{ data: PaymentVoucher | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_payment_voucher`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_voucher_type: data.voucher_type,
        p_voucher_date: data.voucher_date,
        p_payee_name: data.payee_name,
        p_amount: data.amount,
        p_payee_address: data.payee_address || null,
        p_cnic_ntn: data.cnic_ntn || null,
        p_purpose: data.purpose || null,
        p_reference_no: data.reference_no || null,
        p_debit_account_id: data.debit_account_id || null,
        p_credit_account_id: data.credit_account_id || null,
        p_remarks: data.remarks || null,
        p_amount_in_words: data.amount_in_words || "",
      }),
    });

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON
    }

    if (!res.ok) {
      const message = (body.message as string | undefined) ?? (body.error as string | undefined) ?? text.slice(0, 300) ?? "Unknown error";
      const hint = body.hint as string | undefined;
      const details = body.details as string | undefined;
      const fullError = [message, hint, details].filter(Boolean).join(" — ");
      console.error("Supabase Error [create_payment_voucher]:", {
        status: res.status,
        message,
        details,
        hint,
        code: body.code ?? null,
      });
      return { data: null, error: fullError || "Failed to create payment voucher." };
    }

    const voucher = body as unknown as PaymentVoucher;

    // Safety net: the deployed create_payment_voucher RPC may predate the
    // double-entry fix — verify both balanced lines exist, repair if not.
    if (voucher?.id) {
      await ensureVoucherJournalPosted(voucher);
    }

    // Store supplementary fields that the RPC may not handle directly.
    const patch: Record<string, unknown> = {};
    if (data.payee_name_ur?.trim()) patch.payee_name_ur = data.payee_name_ur.trim();
    if (data.purpose_ur?.trim()) patch.purpose_ur = data.purpose_ur.trim();
    if (data.amount_in_words?.trim() && !voucher.amount_in_words) patch.amount_in_words = data.amount_in_words.trim();

    if (voucher?.id && Object.keys(patch).length > 0) {
      const saved = await patchVoucher(voucher.id, patch);
      // Even if PATCH fails (e.g. columns pending migration), the voucher is already created!
      return { data: { ...voucher, ...(saved ?? patch) }, error: null };
    }
    return { data: voucher, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [create_payment_voucher]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

async function patchVoucher(
  voucherId: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payment_vouchers?id=eq.${voucherId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* non-JSON response */ }
    if (!res.ok) {
      const err = (body ?? {}) as { message?: string; hint?: string; details?: string };
      console.warn("Supabase Warning [payment_vouchers patch]:", {
        status: res.status,
        message: err.message ?? text.slice(0, 300),
        hint: err.hint,
        details: err.details,
      });
      return null;
    }
    const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
    return row ?? patch;
  } catch (err) {
    console.warn("Supabase Warning [payment_vouchers patch]:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Verify that the voucher's journal entry exists with both balanced lines.
 * The deployed create_payment_voucher RPC may predate the double-entry fix and
 * under-post; repair client-side so the voucher always reaches Cash/Bank and
 * party ledgers. Best-effort: failures are logged, never block voucher creation.
 */
async function ensureVoucherJournalPosted(voucher: PaymentVoucher): Promise<void> {
  if (!SUPABASE_URL || !voucher?.voucher_no) return;
  try {
    // One entry per voucher: the finder deduplicates and tolerates both
    // narration separators, so the RPC's row is always seen (never re-posted).
    const entryIds = await findVoucherJournalEntryIds(voucher.voucher_no);
    const entryId: string | null = entryIds[0] ?? null;

    const hasDebit = Boolean(voucher.debit_account_id);
    const hasCredit = Boolean(voucher.credit_account_id);
    if (!hasDebit && !hasCredit) return;

    let id = entryId;
    if (!id) {
      // RPC created no journal entry at all — post the header now, keyed by
      // voucher_no so the unique index blocks a second entry for this voucher.
      const prefix = voucher.voucher_no.split("-")[0];
      const header: Record<string, unknown> = {
        entry_number: `JE-${voucher.voucher_date.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`,
        entry_date: voucher.voucher_date,
        narration: `${prefix} ${voucher.voucher_no} — ${voucher.payee_name}`,
        is_balanced: false,
        status: "POSTED",
        voucher_no: voucher.voucher_no,
      };
      let createRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(header),
      });
      if (!createRes.ok && createRes.status === 400) {
        // voucher_no column unknown — migration 20261020010000 not applied yet.
        const legacyHeader = { ...header };
        delete legacyHeader.voucher_no;
        createRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
          method: "POST",
          headers: { ...headers(), Prefer: "return=representation" },
          body: JSON.stringify(legacyHeader),
        });
      }
      if (!createRes.ok) {
        console.warn("Supabase Warning [voucher journal repair]:", createRes.status, (await createRes.text()).slice(0, 300));
        return;
      }
      let created: Array<{ id: string }> = [];
      try {
        created = (await createRes.json()) as Array<{ id: string }>;
      } catch {
        /* non-JSON body — treat as no new entry id */
      }
      id = created?.[0]?.id ?? id;
      if (!id) return;
    }

    // Resolve party_id from the payee name (best-effort, same rule as the RPC).
    let partyId: string | null = null;
    try {
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/parties?select=id,name`, { headers: headers() });
      if (pRes.ok) {
        const rows = (await pRes.json()) as Array<{ id: string; name: string }>;
        const norm = (s: string) => s.trim().toLowerCase();
        partyId = rows.find((p) => norm(p.name) === norm(voucher.payee_name))?.id ?? null;
      }
    } catch {
      /* linkage is best-effort */
    }

    const linesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${id}&select=id,account_id,debit_pkr,credit_pkr`,
      { headers: headers() }
    );
    if (!linesRes.ok) return;
    const lines = (await linesRes.json()) as Array<{ id: string; account_id: string }>;
    if (lines.length >= 2) return;

    const present = new Set(lines.map((l) => l.account_id));
    const missing: {
      journal_entry_id: string;
      account_id: string;
      party_id: string | null;
      debit_pkr: number;
      credit_pkr: number;
    }[] = [];
    if (voucher.debit_account_id && !present.has(voucher.debit_account_id)) {
      missing.push({
        journal_entry_id: id,
        account_id: voucher.debit_account_id,
        party_id: partyId,
        debit_pkr: voucher.amount,
        credit_pkr: 0,
      });
    }
    if (voucher.credit_account_id && !present.has(voucher.credit_account_id)) {
      missing.push({
        journal_entry_id: id,
        account_id: voucher.credit_account_id,
        party_id: partyId,
        debit_pkr: 0,
        credit_pkr: voucher.amount,
      });
    }
    if (missing.length > 0) {
      const lineRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(missing),
      });
      if (!lineRes.ok) {
        console.warn("Supabase Warning [ensureVoucherJournalPosted repair lines]:", lineRes.status, (await lineRes.text()).slice(0, 300));
        return;
      }
    }

    // Stamp customer_name when a control account (1100/2001) sits on either side.
    let customerName: string | null = null;
    const sideIds = [voucher.debit_account_id, voucher.credit_account_id].filter(
      (sid): sid is string => Boolean(sid)
    );
    if (sideIds.length > 0) {
      const aRes = await fetch(
        `${SUPABASE_URL}/rest/v1/accounts_chart?id=in.(${sideIds.join(",")})&select=account_code`,
        { headers: headers() }
      );
      if (aRes.ok) {
        const rows = (await aRes.json()) as Array<{ account_code: string }>;
        if (rows.some((r) => r.account_code === "1100" || r.account_code === "2001")) {
          customerName = voucher.payee_name;
        }
      }
    }

    await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ is_balanced: true, customer_name: customerName }),
    });
    console.info(`[payment-vouchers] repaired journal entry for ${voucher.voucher_no}`);
  } catch (err) {
    console.warn("Supabase Warning [ensureVoucherJournalPosted]:", err instanceof Error ? err.message : err);
  }
}

// ─── Delete Payment Voucher ─────────────────────────────────────────────────

export async function deletePaymentVoucher(voucherId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    // Capture the voucher number first so the linked journal entry can be
    // removed too — otherwise it lingers as an orphan distorting ledgers.
    let voucherNo: string | null = null;
    try {
      const getRes = await fetch(
        `${SUPABASE_URL}/rest/v1/payment_vouchers?id=eq.${voucherId}&select=voucher_no&limit=1`,
        { headers: headers() }
      );
      if (getRes.ok) {
        const rows = (await getRes.json()) as Array<{ voucher_no: string }>;
        voucherNo = rows?.[0]?.voucher_no ?? null;
      }
    } catch {
      // best effort — still attempt the voucher delete below
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/payment_vouchers?id=eq.${voucherId}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) {
      console.error("Supabase Error [payment_vouchers delete]:", { status: res.status, body: await res.json() });
      return false;
    }

    if (voucherNo) {
      // Finder covers both narration separators + the voucher_no column, so
      // the entry is found regardless of which writer created it.
      const ids = await findVoucherJournalEntryIds(voucherNo);
      if (ids.length > 0) {
        // journal_lines cascade with the entry
        const delRes = await fetch(
          `${SUPABASE_URL}/rest/v1/journal_entries?id=in.(${ids.join(",")})`,
          { method: "DELETE", headers: headers() }
        );
        if (!delRes.ok) {
          console.warn("Supabase Warning [voucher journal cleanup]:", delRes.status, (await delRes.text()).slice(0, 300));
        }
      }
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [payment_vouchers delete]:", err);
    return false;
  }
}

// ─── Update Payment Voucher ─────────────────────────────────────────────────

export interface UpdatePaymentVoucherData {
  voucher_date?: string;
  payee_name?: string;
  payee_name_ur?: string;
  payee_address?: string;
  cnic_ntn?: string;
  purpose?: string;
  purpose_ur?: string;
  reference_no?: string;
  /** undefined = leave unchanged; null | "" = clear the side (form validation now requires both sides — defensive only). */
  debit_account_id?: string | null;
  /** undefined = leave unchanged; null | "" = clear the side (form validation now requires both sides — defensive only). */
  credit_account_id?: string | null;
  amount?: number;
  amount_in_words?: string;
  remarks?: string;
}

/**
 * Updates a payment voucher and synchronizes the associated journal entry lines
 * when financial fields (amount, accounts) change.
 */
export async function updatePaymentVoucher(
  voucherId: string,
  data: UpdatePaymentVoucherData,
  original?: PaymentVoucher
): Promise<{ data: PaymentVoucher | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured." };

  const patch: Record<string, unknown> = {};
  if (data.voucher_date !== undefined) patch.voucher_date = data.voucher_date;
  if (data.payee_name !== undefined) patch.payee_name = data.payee_name;
  if (data.payee_address !== undefined) patch.payee_address = data.payee_address || null;
  if (data.cnic_ntn !== undefined) patch.cnic_ntn = data.cnic_ntn || null;
  if (data.purpose !== undefined) patch.purpose = data.purpose || null;
  if (data.reference_no !== undefined) patch.reference_no = data.reference_no || null;
    // Normalize empty string → null so clearing a side works the same as null.
    const nextDebit = data.debit_account_id === undefined ? undefined : (data.debit_account_id || null);
    const nextCredit = data.credit_account_id === undefined ? undefined : (data.credit_account_id || null);
    if (nextDebit !== undefined) patch.debit_account_id = nextDebit;
    if (nextCredit !== undefined) patch.credit_account_id = nextCredit;
  if (data.amount !== undefined) patch.amount = data.amount;
  if (data.amount_in_words !== undefined) patch.amount_in_words = data.amount_in_words;
  if (data.remarks !== undefined) patch.remarks = data.remarks || null;

  if (Object.keys(patch).length === 0) {
    return { data: null, error: "No fields to update." };
  }

  try {
    // 1. Update the voucher row
    const res = await fetch(`${SUPABASE_URL}/rest/v1/payment_vouchers?id=eq.${voucherId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok) {
      const msg = (body.message as string) ?? text.slice(0, 300) ?? "Update failed";
      console.error("Supabase Error [payment_vouchers update]:", { status: res.status, message: msg });
      return { data: null, error: msg };
    }

    const updated = (Array.isArray(body) ? body[0] : body) as PaymentVoucher;

    // 2. Synchronize journal entry lines if ledger-facing fields changed
    const originalDebit = original?.debit_account_id ?? null;
    const originalCredit = original?.credit_account_id ?? null;
    const payeeChanged =
      data.payee_name !== undefined && data.payee_name !== original?.payee_name;
    const financialChanged =
      original &&
      (data.amount !== undefined && data.amount !== original.amount ||
        nextDebit !== undefined && nextDebit !== originalDebit ||
        nextCredit !== undefined && nextCredit !== originalCredit ||
        payeeChanged);

    if (financialChanged && original) {
      await syncJournalLines(original, {
        amount: data.amount ?? original.amount,
        debit_account_id: nextDebit === undefined ? originalDebit : nextDebit,
        credit_account_id: nextCredit === undefined ? originalCredit : nextCredit,
        payee_name: data.payee_name ?? original.payee_name,
      });
    }

    // 3. Re-fetch with joined account data
    const fetched = await fetchPaymentVoucherById(voucherId);
    return { data: fetched ?? updated, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [payment_vouchers update]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

/** Fetch a single voucher with joined account objects. */
async function fetchPaymentVoucherById(id: string): Promise<PaymentVoucher | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/payment_vouchers?id=eq.${id}&select=*,debit_account:accounts_chart!payment_vouchers_debit_account_id_fkey(account_code,account_name),credit_account:accounts_chart!payment_vouchers_credit_account_id_fkey(account_code,account_name)`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    return (row as PaymentVoucher) ?? null;
  } catch {
    return null;
  }
}

/**
 * When amount, accounts, or the payee change, find the journal entry created by
 * the voucher's RPC and rebuild its journal_lines to match. Party linkage is
 * preserved: each line gets party_id (resolved from the payee name) and the
 * entry gets customer_name whenever a control account (1100/2001) sits on
 * either side — party statements match on those.
 *
 * Journal entries are created with narration pattern: "CPV CPV-2026-00001 — Payee Name"
 */
async function syncJournalLines(
  original: PaymentVoucher,
  update: {
    amount: number;
    debit_account_id: string | null;
    credit_account_id: string | null;
    payee_name?: string;
  }
): Promise<void> {
  if (!SUPABASE_URL) return;
  try {
    const payee = (update.payee_name ?? original.payee_name).trim();

    // Find the journal entry the voucher's RPC posted (voucher_no column first,
    // narration fallback) — one entry per voucher, never a second header.
    const entryIds = await findVoucherJournalEntryIds(original.voucher_no);
    let entryId: string | null = entryIds[0] ?? null;

    // Legacy voucher without a journal entry — create the header here.
    if (!entryId) {
      const prefix = original.voucher_no.split("-")[0];
      const header: Record<string, unknown> = {
        entry_number: `JE-${original.voucher_date.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`,
        entry_date: original.voucher_date,
        narration: `${prefix} ${original.voucher_no} — ${payee}`,
        is_balanced: false,
        status: "POSTED",
        voucher_no: original.voucher_no,
      };
      let createRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(header),
      });
      if (!createRes.ok && createRes.status === 400) {
        // voucher_no column unknown — migration 20261020010000 not applied yet.
        const legacyHeader = { ...header };
        delete legacyHeader.voucher_no;
        createRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
          method: "POST",
          headers: { ...headers(), Prefer: "return=representation" },
          body: JSON.stringify(legacyHeader),
        });
      }
      if (!createRes.ok) return;
      const created = (await createRes.json()) as Array<{ id: string }>;
      entryId = created?.[0]?.id ?? null;
      if (!entryId) return;
    }

    // Resolve party_id from the payee name (case-insensitive, trimmed — same
    // rule the create RPC uses). Best-effort: the narration fallback still
    // matches party statements when no CRM contact exists.
    let partyId: string | null = null;
    try {
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/parties?select=id,name`, {
        headers: headers(),
      });
      if (pRes.ok) {
        const rows = (await pRes.json()) as Array<{ id: string; name: string }>;
        const norm = (s: string) => s.trim().toLowerCase();
        partyId = rows.find((p) => norm(p.name) === norm(payee))?.id ?? null;
      }
    } catch {
      /* linkage is best-effort */
    }

    // Delete old journal lines
    await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${entryId}`, {
      method: "DELETE",
      headers: headers(),
    });

    // Insert new journal lines with updated accounts/amount + party linkage
    const lines: {
      journal_entry_id: string;
      account_id: string;
      party_id: string | null;
      debit_pkr: number;
      credit_pkr: number;
    }[] = [];
    if (update.debit_account_id) {
      lines.push({
        journal_entry_id: entryId,
        account_id: update.debit_account_id,
        party_id: partyId,
        debit_pkr: update.amount,
        credit_pkr: 0,
      });
    }
    if (update.credit_account_id) {
      lines.push({
        journal_entry_id: entryId,
        account_id: update.credit_account_id,
        party_id: partyId,
        debit_pkr: 0,
        credit_pkr: update.amount,
      });
    }
    if (lines.length > 0) {
      const lineRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(lines),
      });
      if (!lineRes.ok) return;

      // Stamp customer_name only when a control account (1100/2001) sits on
      // either side — keeps the party-statement fallback consistent.
      let customerName: string | null = null;
      const sideIds = [update.debit_account_id, update.credit_account_id].filter(
        (id): id is string => Boolean(id)
      );
      if (sideIds.length > 0) {
        const aRes = await fetch(
          `${SUPABASE_URL}/rest/v1/accounts_chart?id=in.(${sideIds.join(",")})&select=account_code`,
          { headers: headers() }
        );
        if (aRes.ok) {
          const rows = (await aRes.json()) as Array<{ account_code: string }>;
          if (rows.some((r) => r.account_code === "1100" || r.account_code === "2001")) {
            customerName = payee;
          }
        }
      }

      const prefix = original.voucher_no.split("-")[0];
      // Rebuilt entries are a balanced pair (form requires both sides)
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${entryId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          narration: `${prefix} ${original.voucher_no} — ${payee}`,
          customer_name: customerName,
          is_balanced: lines.length === 2,
          status: "POSTED",
        }),
      });
    }
  } catch (err) {
    console.error("Supabase Error [syncJournalLines]:", err);
  }
}
