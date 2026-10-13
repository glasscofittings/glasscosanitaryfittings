import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";
import type { ChartAccount } from "@/lib/ledger/voucher-rules";

export interface CustomerReceiptVoucher {
  id: string;
  voucher_no: string;
  customer_id: string;
  customer_name: string;
  receipt_date: string;
  amount: number;
  payment_mode: "CASH" | "BANK_TRANSFER" | "CHEQUE" | "ONLINE";
  reference_no?: string;
  bank_account_id?: string;
  remarks?: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  created_at: string;
  allocations?: ReceiptVoucherAllocation[];
}

export interface ReceiptVoucherAllocation {
  id?: string;
  voucher_id?: string;
  invoice_id: string;
  invoice_number: string;
  allocated_amount: number;
}

export interface CustomerAgingBucket {
  customerId: string;
  customerName: string;
  totalDue: number;
  current: number;       // 0-30 days
  days31_60: number;     // 31-60 days
  days61_90: number;     // 61-90 days
  over90: number;        // 90+ days
  invoiceCount: number;
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

export async function fetchReceiptVouchers(): Promise<CustomerReceiptVoucher[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/customer_receipt_vouchers?select=*,allocations:receipt_voucher_allocations(*)&order=receipt_date.desc,created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      // Fallback if allocations relation not configured
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/customer_receipt_vouchers?order=receipt_date.desc,created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Supabase Error [fetchReceiptVouchers]:", err);
    return [];
  }
}

/**
 * Chart rows for the Receipt form's Mode B dropdowns (Dr Cash/Bank, Cr party).
 * Kept in this module so the receipts screen does not depend on the payment
 * voucher data layer.
 */
export async function fetchReceiptAccounts(): Promise<ChartAccount[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts_chart?select=id,account_code,account_name,account_type,is_liquid_funds,is_default_cash&order=account_code.asc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [receipt accounts_chart]:", res.status);
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as ChartAccount[];
  } catch (err) {
    console.error("Supabase Error [receipt accounts_chart]:", err);
    return [];
  }
}

/**
 * The two accounts a receipt voucher's journal entry was posted with, read
 * back from its journal_lines. The voucher row stores no account ids, so edit
 * mode pre-fills its dropdowns from here.
 */
export async function fetchReceiptJournalAccounts(voucherNo: string): Promise<{
  debitAccountId: string | null;
  creditAccountId: string | null;
}> {
  const empty = { debitAccountId: null, creditAccountId: null };
  if (!SUPABASE_URL || !voucherNo) return empty;
  try {
    const filter = encodeURIComponent(`%[${voucherNo}]%`);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?narration=like.${filter}&select=journal_lines(account_id,debit_pkr,credit_pkr)&limit=1`,
      { headers: headers() }
    );
    if (!res.ok) return empty;
    const rows = (await res.json()) as Array<{
      journal_lines: Array<{ account_id: string; debit_pkr: number; credit_pkr: number }>;
    }>;
    const lines = rows[0]?.journal_lines ?? [];
    return {
      debitAccountId: lines.find((l) => Number(l.debit_pkr) > 0)?.account_id ?? null,
      creditAccountId: lines.find((l) => Number(l.credit_pkr) > 0)?.account_id ?? null,
    };
  } catch (err) {
    console.error("Supabase Error [fetchReceiptJournalAccounts]:", err);
    return empty;
  }
}

export interface UpdateReceiptVoucherData {
  customer_id?: string;
  customer_name?: string;
  receipt_date?: string;
  amount?: number;
  payment_mode?: "CASH" | "BANK_TRANSFER" | "CHEQUE" | "ONLINE";
  reference_no?: string | null;
  remarks?: string | null;
  /** Mode B accounts — resolved by the form; omitted = keep the JE's current sides. */
  debit_account_id?: string;
  credit_account_id?: string;
}

async function findVoucherJournalEntry(voucherNo: string): Promise<{ id: string } | null> {
  const filter = encodeURIComponent(`%[${voucherNo}]%`);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/journal_entries?narration=like.${filter}&select=id&limit=1`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function resolveReceiptAccounts(
  paymentMode: "CASH" | "BANK_TRANSFER" | "CHEQUE" | "ONLINE"
): Promise<{ debitId?: string; creditId?: string }> {
  const debitCode = paymentMode === "CASH" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
  const [drRes, crRes, cashRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/accounts_chart?account_code=eq.${debitCode}&select=id`, {
      headers: headers(),
    }),
    fetch(`${SUPABASE_URL}/rest/v1/accounts_chart?account_code=eq.${ACCOUNT_CODES.AR}&select=id`, {
      headers: headers(),
    }),
    paymentMode === "CASH"
      ? fetch(
          `${SUPABASE_URL}/rest/v1/accounts_chart?or=(account_code.eq.${ACCOUNT_CODES.CASH},is_default_cash.eq.true)&select=id&limit=1`,
          { headers: headers() }
        )
      : Promise.resolve(null),
  ]);

  const drRows = drRes.ok ? await drRes.json() : [];
  const crRows = crRes.ok ? await crRes.json() : [];
  let debitId: string | undefined = drRows[0]?.id;
  if (paymentMode === "CASH" && !debitId && cashRes?.ok) {
    const cashRows = await cashRes.json();
    debitId = cashRows[0]?.id;
  }
  return { debitId, creditId: crRows[0]?.id };
}

export async function updateReceiptVoucher(
  voucherId: string,
  data: UpdateReceiptVoucherData,
  original: CustomerReceiptVoucher
): Promise<{ data: CustomerReceiptVoucher | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };

  const patch: Record<string, unknown> = {};
  if (data.customer_id !== undefined) patch.customer_id = data.customer_id;
  if (data.customer_name !== undefined) patch.customer_name = data.customer_name;
  if (data.receipt_date !== undefined) patch.receipt_date = data.receipt_date;
  if (data.amount !== undefined) patch.amount = data.amount;
  if (data.payment_mode !== undefined) patch.payment_mode = data.payment_mode;
  if (data.reference_no !== undefined) patch.reference_no = data.reference_no || null;
  if (data.remarks !== undefined) patch.remarks = data.remarks || null;

  if (Object.keys(patch).length === 0) {
    return { data: null, error: "No fields to update." };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/customer_receipt_vouchers?id=eq.${voucherId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const msg =
        (body.message as string) ||
        (body.details as string) ||
        text.slice(0, 300) ||
        "Update failed";
      return { data: null, error: msg };
    }
    const rows = Array.isArray(body) ? body : [body];
    const updated = rows[0] as CustomerReceiptVoucher;
    if (!updated) return { data: null, error: "No row returned" };

    const nextAmount = data.amount ?? original.amount;
    const nextMode = data.payment_mode ?? original.payment_mode;
    const nextDate = data.receipt_date ?? original.receipt_date;
    const nextCustomerName = data.customer_name ?? original.customer_name;
    const nextCustomerId = data.customer_id ?? original.customer_id;
    const financialChanged =
      nextAmount !== original.amount || nextMode !== original.payment_mode;
    const metaChanged =
      nextDate !== original.receipt_date || nextCustomerName !== original.customer_name;
    const accountsProvided =
      data.debit_account_id !== undefined || data.credit_account_id !== undefined;

    if (financialChanged || metaChanged || accountsProvided) {
      const je = await findVoucherJournalEntry(original.voucher_no);
      if (je) {
        // The voucher row stores no account ids — read the current Mode B
        // sides from its journal_lines before deciding whether to rebuild.
        let curDebitId: string | null = null;
        let curCreditId: string | null = null;
        const curRes = await fetch(
          `${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${je.id}&select=account_id,debit_pkr,credit_pkr`,
          { headers: headers() }
        );
        if (curRes.ok) {
          const curLines = (await curRes.json()) as Array<{
            account_id: string;
            debit_pkr: number;
            credit_pkr: number;
          }>;
          curDebitId = curLines.find((l) => Number(l.debit_pkr) > 0)?.account_id ?? null;
          curCreditId = curLines.find((l) => Number(l.credit_pkr) > 0)?.account_id ?? null;
        }

        const modeChanged = nextMode !== original.payment_mode;
        const accountChanged =
          (data.debit_account_id !== undefined && data.debit_account_id !== curDebitId) ||
          (data.credit_account_id !== undefined && data.credit_account_id !== curCreditId);

        if (financialChanged || accountChanged) {
          // Explicit picks win; otherwise keep the current sides (falling back
          // to the payment-mode default when the mode itself changed).
          const fallback = modeChanged ? await resolveReceiptAccounts(nextMode) : null;
          const nextDebitId = data.debit_account_id ?? curDebitId ?? fallback?.debitId ?? null;
          const nextCreditId = data.credit_account_id ?? curCreditId ?? fallback?.creditId ?? null;

          if (!nextDebitId || !nextCreditId) {
            return {
              data: null,
              error:
                "Could not resolve the receipt accounts (Cash/Bank debit, party credit). Re-select them and try again.",
            };
          }

          const delRes = await fetch(
            `${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${je.id}`,
            { method: "DELETE", headers: headers() }
          );
          if (!delRes.ok) {
            return {
              data: null,
              error: `Could not clear the previous journal lines (HTTP ${delRes.status}).`,
            };
          }

          const lineRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify([
              {
                journal_entry_id: je.id,
                account_id: nextDebitId,
                party_id: nextCustomerId,
                debit_pkr: nextAmount,
                credit_pkr: 0,
              },
              {
                journal_entry_id: je.id,
                account_id: nextCreditId,
                party_id: nextCustomerId,
                debit_pkr: 0,
                credit_pkr: nextAmount,
              },
            ]),
          });
          if (!lineRes.ok) {
            // Best effort: put the previous sides back rather than leaving the
            // entry single-sided/empty.
            if (curDebitId && curCreditId) {
              await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
                method: "POST",
                headers: headers(),
                body: JSON.stringify([
                  {
                    journal_entry_id: je.id,
                    account_id: curDebitId,
                    party_id: nextCustomerId,
                    debit_pkr: original.amount,
                    credit_pkr: 0,
                  },
                  {
                    journal_entry_id: je.id,
                    account_id: curCreditId,
                    party_id: nextCustomerId,
                    debit_pkr: 0,
                    credit_pkr: original.amount,
                  },
                ]),
              });
            }
            const errText = await lineRes.text().catch(() => "");
            return {
              data: null,
              error: `Journal lines update failed (HTTP ${lineRes.status}): ${errText.slice(0, 200)}`,
            };
          }
        }

        await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${je.id}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({
            entry_date: nextDate,
            narration: `Customer Payment Received: ${nextCustomerName} [${original.voucher_no}]`,
            customer_name: nextCustomerName,
          }),
        });
      }
    }

    fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        operator_name: "AR Accountant",
        action_type: "CUSTOMER_RECEIPT_VOUCHER_UPDATED",
        module: "SAP_AR",
        details: {
          voucher_no: original.voucher_no,
          customer_name: nextCustomerName,
          amount: nextAmount,
          payment_mode: nextMode,
        },
      }),
    }).catch(() => {});

    return { data: updated, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update receipt voucher";
    return { data: null, error: msg };
  }
}

export async function deleteReceiptVoucher(
  voucherId: string,
  voucherNo: string
): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    const je = await findVoucherJournalEntry(voucherNo);
    if (je) {
      await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${je.id}`, {
        method: "DELETE",
        headers: headers(),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${je.id}`, {
        method: "DELETE",
        headers: headers(),
      });
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/customer_receipt_vouchers?id=eq.${voucherId}`,
      {
        method: "DELETE",
        headers: headers(),
      }
    );
    if (!res.ok && res.status !== 204) {
      const bodyText = await res.text().catch(() => "");
      let msg = bodyText || `HTTP ${res.status}`;
      try {
        msg = JSON.parse(bodyText).message ?? msg;
      } catch {
        /* keep raw */
      }
      return { success: false, error: msg };
    }

    fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        operator_name: "AR Accountant",
        action_type: "CUSTOMER_RECEIPT_VOUCHER_DELETED",
        module: "SAP_AR",
        details: { voucher_no: voucherNo, voucher_id: voucherId },
      }),
    }).catch(() => {});

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete receipt voucher";
    return { success: false, error: msg };
  }
}

export function computeARAging(invoices: Array<{
  id: string;
  invoice_number: string;
  customer_id: string;
  parties?: { name: string };
  total_invoice_value_pkr: number;
  created_at: string;
  is_posted: boolean;
}>): CustomerAgingBucket[] {
  const map = new Map<string, CustomerAgingBucket>();
  const now = new Date();

  invoices
    .filter((inv) => inv.is_posted)
    .forEach((inv) => {
      const custId = inv.customer_id;
      const custName = inv.parties?.name || "Customer";

      if (!map.has(custId)) {
        map.set(custId, {
          customerId: custId,
          customerName: custName,
          totalDue: 0,
          current: 0,
          days31_60: 0,
          days61_90: 0,
          over90: 0,
          invoiceCount: 0,
        });
      }

      const bucket = map.get(custId)!;
      const invDate = new Date(inv.created_at);
      const diffDays = Math.max(0, Math.floor((now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24)));
      const amount = Number(inv.total_invoice_value_pkr) || 0;

      bucket.totalDue += amount;
      bucket.invoiceCount += 1;

      if (diffDays <= 30) bucket.current += amount;
      else if (diffDays <= 60) bucket.days31_60 += amount;
      else if (diffDays <= 90) bucket.days61_90 += amount;
      else bucket.over90 += amount;
    });

  return Array.from(map.values()).sort((a, b) => b.totalDue - a.totalDue);
}
