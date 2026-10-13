import { createClient } from "@supabase/supabase-js";
import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";
import {
  isLiquidFundsAccount,
  isReceiptCreditAllowed,
  receiptVoucherPrefix,
} from "@/lib/ledger/voucher-rules";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface ReceiptVoucherResult {
  success: boolean;
  voucher_no?: string;
  error?: string;
}

/**
 * Mode B — Receipt Voucher (CRV / BRV), money incoming:
 *   DEBIT  Cash in Hand (1000) or Bank (1002)
 *   CREDIT party control account (1100 AR default / 1201 Trade Debts / advance)
 *
 * Both journal_lines carry party_id = customer_id, so the CREDIT to the party
 * account reduces the customer ledger balance immediately.
 *
 * Accounts are resolved and validated BEFORE any row is written — a bad pick
 * fails fast instead of leaving a voucher without a balanced posting.
 */
export async function createReceiptVoucherAction(payload: {
  customer_id: string;
  customer_name: string;
  receipt_date: string;
  amount: number;
  payment_mode: "CASH" | "BANK_TRANSFER" | "CHEQUE" | "ONLINE";
  reference_no?: string;
  remarks?: string;
  allocations: Array<{ invoice_id: string; invoice_number: string; allocated_amount: number }>;
  /** Mode B dropdown picks — fall back to mode default (debit) / AR 1100 (credit). */
  debit_account_id?: string;
  credit_account_id?: string;
}): Promise<ReceiptVoucherResult> {
  const supabase = getServiceClient();

  // Party association is mandatory: the credit line must hit the customer's
  // ledger account with party_id or the receipt would not reduce their balance.
  if (!payload.customer_id?.trim()) {
    return {
      success: false,
      error:
        "Customer (party_id) is required — a receipt credits the customer's account (1100/1201) and must reduce their balance.",
    };
  }
  if (!(payload.amount > 0)) {
    return { success: false, error: "Amount must be greater than zero." };
  }

  const year = new Date().getFullYear();
  const timestamp = Date.now().toString().slice(-6);

  // ── Resolve + validate the two Mode B sides ────────────────────────────────
  const debitDefaultCode = payload.payment_mode === "CASH" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;

  let debitId: string;
  let debitCode: string;
  if (payload.debit_account_id) {
    const { data, error } = await supabase
      .from("accounts_chart")
      .select("id,account_code,account_name,account_type,is_liquid_funds,is_default_cash")
      .eq("id", payload.debit_account_id)
      .single();
    if (error || !data) {
      return { success: false, error: `Debit account not found (${error?.message ?? "invalid id"}).` };
    }
    if (!isLiquidFundsAccount(data)) {
      return {
        success: false,
        error: `Receipt debit must be Cash in Hand (${ACCOUNT_CODES.CASH}) or Bank (${ACCOUNT_CODES.BANK}) — got ${data.account_code} ${data.account_name}.`,
      };
    }
    debitId = data.id;
    debitCode = data.account_code;
  } else {
    const { data, error } = await supabase
      .from("accounts_chart")
      .select("id")
      .eq("account_code", debitDefaultCode)
      .single();
    if (error || !data) {
      return {
        success: false,
        error: `Ledger account not found: ${debitDefaultCode}. Run the chart-of-accounts migration first.`,
      };
    }
    debitId = data.id;
    debitCode = debitDefaultCode;
  }

  let creditId: string;
  if (payload.credit_account_id) {
    const { data, error } = await supabase
      .from("accounts_chart")
      .select("id,account_code,account_name,account_type,is_liquid_funds,is_default_cash")
      .eq("id", payload.credit_account_id)
      .single();
    if (error || !data) {
      return { success: false, error: `Credit account not found (${error?.message ?? "invalid id"}).` };
    }
    if (!isReceiptCreditAllowed(data)) {
      return {
        success: false,
        error: `Receipt credit must be a party account (${ACCOUNT_CODES.AR} Receivable, 1201 Trade Debts, or a customer advance) — got ${data.account_code} ${data.account_name}.`,
      };
    }
    creditId = data.id;
  } else {
    const { data, error } = await supabase
      .from("accounts_chart")
      .select("id")
      .eq("account_code", ACCOUNT_CODES.AR)
      .single();
    if (error || !data) {
      return {
        success: false,
        error: `Ledger account not found: ${ACCOUNT_CODES.AR} (Accounts Receivable). Run the chart-of-accounts migration first.`,
      };
    }
    creditId = data.id;
  }

  // CRV for cash receipts, BRV for bank receipts — keyed off the money-in account.
  const voucherNo = `${receiptVoucherPrefix(debitCode)}-${year}-${timestamp}`;

  // 1. Insert voucher
  const { data: voucher, error: vErr } = await supabase
    .from("customer_receipt_vouchers")
    .insert({
      voucher_no: voucherNo,
      customer_id: payload.customer_id,
      customer_name: payload.customer_name,
      receipt_date: payload.receipt_date,
      amount: payload.amount,
      payment_mode: payload.payment_mode,
      reference_no: payload.reference_no || null,
      remarks: payload.remarks || null,
      status: "POSTED",
    })
    .select("id")
    .single();

  if (vErr) {
    return { success: false, error: `Voucher insert failed: ${vErr.message}` };
  }

  // Compensation: this flow runs without a DB transaction, so every later
  // failure unwinds the rows already written — the result is all-or-nothing.
  const rollback = async () => {
    if (!voucher?.id) return;
    if (payload.allocations.length > 0) {
      await supabase.from("receipt_voucher_allocations").delete().eq("voucher_id", voucher.id);
    }
    await supabase.from("customer_receipt_vouchers").delete().eq("id", voucher.id);
  };

  // 2. Insert allocations
  if (payload.allocations.length > 0 && voucher?.id) {
    const allocRows = payload.allocations.map((a) => ({
      voucher_id: voucher.id,
      invoice_id: a.invoice_id,
      invoice_number: a.invoice_number,
      allocated_amount: a.allocated_amount,
    }));

    const { error: allocErr } = await supabase.from("receipt_voucher_allocations").insert(allocRows);
    if (allocErr) {
      await rollback();
      return { success: false, error: `Allocation insert failed: ${allocErr.message}` };
    }
  }

  // 3. Post the balanced double entry:
  //    Debit: Cash (1000) / Bank (1002)      — money IN
  //    Credit: party control account + party_id — customer balance DOWN
  const jeNumber = `JE-${year}-${timestamp}`;
  const { data: je, error: jeErr } = await supabase
    .from("journal_entries")
    .insert({
      entry_number: jeNumber,
      entry_date: payload.receipt_date,
      narration: `Customer Payment Received: ${payload.customer_name} [${voucherNo}]`,
      customer_name: payload.customer_name,
      is_balanced: true,
      status: "POSTED",
    })
    .select("id")
    .single();

  if (jeErr || !je) {
    await rollback();
    return { success: false, error: `Journal entry creation failed: ${jeErr?.message ?? "no id returned"}` };
  }

  const { error: linesErr } = await supabase.from("journal_lines").insert([
    {
      journal_entry_id: je.id,
      account_id: debitId,
      party_id: null, // Cash/Bank line must NOT be tagged with party_id
      debit_pkr: payload.amount,
      credit_pkr: 0.0,
    },
    {
      journal_entry_id: je.id,
      account_id: creditId,
      party_id: payload.customer_id, // AR line tagged with party_id
      debit_pkr: 0.0,
      credit_pkr: payload.amount,
    },
  ]);

  if (linesErr) {
    // Unwind in reverse order: journal entry (lines cascade), then voucher rows
    await supabase.from("journal_entries").delete().eq("id", je.id);
    await rollback();
    return { success: false, error: `Journal lines insert failed: ${linesErr.message}` };
  }

  // 4. Audit log
  await supabase.from("system_audit_logs").insert({
    operator_name: "AR Accountant",
    action_type: "CUSTOMER_RECEIPT_VOUCHER_POSTED",
    module: "SAP_AR",
    details: {
      voucher_no: voucherNo,
      customer_name: payload.customer_name,
      amount: payload.amount,
      payment_mode: payload.payment_mode,
      debit_account_id: debitId,
      credit_account_id: creditId,
    },
  });

  return { success: true, voucher_no: voucherNo };
}
