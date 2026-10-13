/**
 * Voucher posting rules shared by the Payment Voucher form (Mode A) and the
 * Customer Receipt form (Mode B), the receipt server action, and the receipt
 * update hook — one source of truth so the dropdowns, validation, and DB
 * postings can never drift apart.
 *
 * Mode A — Payment Voucher (CPV / BPV / PPV / SPV): money OUTGOING
 *   DEBIT  expense / payable / non-receivable asset (5xxx, 2001, 2300, …)
 *   CREDIT Cash in Hand (1000) or Bank (1002)
 *   A receivable control account (1100 AR / 1201 Trade Debts) may NEVER sit on
 *   the debit side — that books a customer receipt backwards and drives the
 *   customer balance UP instead of DOWN. Customer receipts belong to Mode B.
 *
 * Mode B — Receipt Voucher (CRV / BRV): money INCOMING
 *   DEBIT  Cash in Hand (1000) or Bank (1002)
 *   CREDIT party control account — AR (1100), Trade Debts (1201), customer
 *          advance liabilities — always posted with party_id so the customer
 *          ledger balance reduces immediately.
 */
import { ACCOUNT_CODES } from "./account-codes";
import { isReceivableControlAccount } from "@/lib/party-statement";

/** Minimal chart row shape the rules operate on (works for any accounts_chart select). */
export interface ChartAccountRef {
  account_code: string;
  account_name: string;
  account_type: string;
  is_liquid_funds?: boolean;
  is_default_cash?: boolean;
}

/** A chart row with its id, as returned by the accounts fetchers. */
export interface ChartAccount extends ChartAccountRef {
  id: string;
}

/** Cash in Hand (1000) / Bank (1002) — the only money-in / money-out accounts. */
export function isLiquidFundsAccount(a: ChartAccountRef): boolean {
  return Boolean(
    a.is_liquid_funds ||
    a.is_default_cash ||
    a.account_code === ACCOUNT_CODES.CASH ||
    a.account_code === ACCOUNT_CODES.BANK
  );
}

/** Receivable control accounts: AR (1100), Trade Debts (1201). */
export function isReceivableAccount(a: ChartAccountRef): boolean {
  return isReceivableControlAccount({
    code: a.account_code,
    name: a.account_name,
    type: a.account_type,
  });
}

/** Mode A DEBIT: expense / payable / non-receivable asset.
 * Cash/Bank, 1100 AR, and 1201 Trade Debts are all excluded —
 * customer receipts must be recorded via Mode B (Receipt Voucher). */
export function isPaymentDebitAllowed(a: ChartAccountRef): boolean {
  const t = (a.account_type || "").toUpperCase();
  return (
    (t === "EXPENSE" || t === "LIABILITY" || t === "ASSET") &&
    !isLiquidFundsAccount(a) &&
    !isReceivableAccount(a)
  );
}

/** Mode A CREDIT / Mode B DEBIT: Cash in Hand or Bank only (money out / money in). */
export function isMoneyAccount(a: ChartAccountRef): boolean {
  return isLiquidFundsAccount(a);
}

/** Mode B CREDIT: party control accounts — receivables + customer advance liabilities. */
export function isReceiptCreditAllowed(a: ChartAccountRef): boolean {
  if (isReceivableAccount(a)) return true;
  return (
    (a.account_type || "").toUpperCase() === "LIABILITY" &&
    (a.account_name || "").toLowerCase().includes("advance")
  );
}

/** CRV for cash receipts, BRV for bank receipts — keyed off the DEBIT (money-in) account. */
export function receiptVoucherPrefix(debitAccountCode: string): "CRV" | "BRV" {
  return debitAccountCode === ACCOUNT_CODES.CASH ? "CRV" : "BRV";
}
