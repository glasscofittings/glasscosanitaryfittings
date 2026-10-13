import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";

/**
 * Party statement presentation logic (UI / statement layer only).
 *
 * The books are maintained from OUR company's perspective:
 *
 *   CUSTOMER = Accounts Receivable (ASSET) - normal balance DEBIT
 *     sales invoice : DR Accounts Receivable, CR Revenue / Tax Payable
 *     receipt       : DR Cash/Bank,          CR Accounts Receivable
 *
 *   SUPPLIER = Accounts Payable (LIABILITY) - normal balance CREDIT
 *     purchase invoice: DR Inventory/Expense, CR Accounts Payable
 *     payment         : DR Accounts Payable,  CR Cash/Bank
 *
 * This module decides only HOW a party statement is PRESENTED: which column a
 * document lands in (Debit / Credit) and how the resulting balance is labelled.
 * It never posts journal entries - the general ledger always keeps the standard
 * double-entry above, unchanged by any statement presentation.
 *
 * Presentation rules (by party side):
 *   AR side ("buy"):  sales invoice / receipt  -> invoice DR, receipt/payment CR
 *   AP side ("sell"): purchase invoice / payment -> purchase CR, payment DR
 *
 * Running balance = opening + debit - credit, signed: positive = Dr, negative = Cr.
 * So a customer account normally ends positive (Dr) and a supplier account
 * normally ends negative (Cr).
 */

export type PartyLedgerDocType =
  | "SALES_INVOICE"
  | "PURCHASE_INVOICE"
  | "RECEIPT_VOUCHER"
  | "PAYMENT_VOUCHER";

/** "buy" = customer side (AR), "sell" = supplier side (AP). */
export type PartySide = "buy" | "sell";

/** Any party_type value used across the app (incl. legacy VENDOR). */
export type PartyTypeLike = "SUPPLIER" | "CUSTOMER" | "BOTH" | "VENDOR" | string | undefined | null;

/** One financial document in a party's combined statement. */
export interface PartyLedgerEntry {
  id: string;
  date: string; // created_at | voucher_date | receipt_date
  doc_type: PartyLedgerDocType;
  doc_no: string; // INV-2026-004 / PINV-2026-00012 / CPV-2026-00001 / CRV-...
  side: PartySide;
  remarks: string;
  debit: number;
  credit: number;
  balance: number; // running balance, computed after sort
}

/** Per-side money totals. A BOTH party keeps buy and sell separate - never merged. */
export interface PartySideTotals {
  invoice_count: number;
  total_invoice_value: number;
  total_paid: number;
  /** Positive = outstanding on that side (buy: receivable, sell: payable). */
  outstanding_balance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Invoices add to the party's balance; receipts / payments reduce it. */
export function isInvoiceDoc(docType: PartyLedgerDocType): boolean {
  return docType === "SALES_INVOICE" || docType === "PURCHASE_INVOICE";
}

export function isSupplierType(partyType: PartyTypeLike): boolean {
  const t = (partyType || "").toUpperCase();
  return t === "SUPPLIER" || t === "VENDOR";
}

/**
 * Debit / credit presentation of ONE document on the party's own account.
 *
 *   AR side  ("buy",  customer): sales invoice = DR, receipt / refund = CR
 *   AP side  ("sell", supplier): purchase invoice = CR, payment = DR
 */
export function partyEntryAmounts(
  side: PartySide,
  docType: PartyLedgerDocType,
  amount: number
): { debit: number; credit: number } {
  const value = round2(Math.abs(amount));
  const invoice = isInvoiceDoc(docType);
  const debitFirst = side === "buy" ? invoice : !invoice;
  return debitFirst ? { debit: value, credit: 0 } : { debit: 0, credit: value };
}

/** Sort by date (day precision, handles mixed DATE/timestamp), then doc no, then id. */
export function sortLedgerEntries<T extends Pick<PartyLedgerEntry, "date" | "doc_no" | "id">>(
  entries: T[]
): T[] {
  return [...entries].sort((a, b) => {
    const da = a.date.slice(0, 10);
    const db = b.date.slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    if (a.doc_no !== b.doc_no) return a.doc_no < b.doc_no ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * Sorted copy with running balance = opening + debit - credit.
 * Positive = Dr (debit balance), negative = Cr (credit balance).
 */
export function computeLedgerBalances(
  entries: PartyLedgerEntry[],
  openingBalance = 0
): PartyLedgerEntry[] {
  let balance = round2(openingBalance);
  return sortLedgerEntries(entries).map((e) => {
    balance = round2(balance + e.debit - e.credit);
    return { ...e, balance };
  });
}

/** A party's source document before debit/credit presentation is applied. */
export interface PartyStatementDoc {
  id: string;
  date: string;
  doc_type: PartyLedgerDocType;
  doc_no: string;
  side: PartySide;
  remarks: string;
  /** Absolute document amount. */
  amount: number;
}

/**
 * The whole party statement in one pass: applies the party-type presentation
 * rules (invoice/payment -> debit or credit) and the running balance.
 * Pure - it reads and writes no journal entries.
 */
export function buildPartyLedgerEntries(
  docs: PartyStatementDoc[],
  openingBalance = 0
): PartyLedgerEntry[] {
  const entries: PartyLedgerEntry[] = docs.map((doc) => {
    const { debit, credit } = partyEntryAmounts(doc.side, doc.doc_type, doc.amount);
    return {
      id: doc.id,
      date: doc.date,
      doc_type: doc.doc_type,
      doc_no: doc.doc_no,
      side: doc.side,
      remarks: doc.remarks,
      debit,
      credit,
      balance: 0,
    };
  });
  return computeLedgerBalances(entries, openingBalance);
}

/**
 * Signed opening balance: Dr is positive (debit-normal), Cr is negative
 * (credit-normal). Always returns a finite number.
 */
export function partySignedOpeningBalance(
  party?: { opening_balance?: number; opening_balance_type?: "Dr" | "Cr" } | null
): number {
  const amount = Math.abs(Number(party?.opening_balance ?? 0)) || 0;
  if (!party || party.opening_balance_type === "Dr") return amount;
  return -amount;
}

/** "Dr" when the signed balance is positive / zero, "Cr" when negative. */
export function balanceSide(balance: number): "Dr" | "Cr" {
  return balance < 0 ? "Cr" : "Dr";
}

/**
 * Per-side totals from the statement itself (invoices vs payments), independent
 * of which column a document was presented in. A positive `outstanding_balance`
 * means invoices exceed payments on that side.
 */
export function computeSideTotals(
  entries: PartyLedgerEntry[],
  side: PartySide
): PartySideTotals {
  const rows = entries.filter((e) => e.side === side);
  let invoiceValue = 0;
  let paid = 0;
  let invoiceCount = 0;
  for (const e of rows) {
    const amount = Math.abs(e.debit) + Math.abs(e.credit);
    if (isInvoiceDoc(e.doc_type)) {
      invoiceValue += amount;
      invoiceCount += 1;
    } else {
      paid += amount;
    }
  }
  return {
    invoice_count: invoiceCount,
    total_invoice_value: round2(invoiceValue),
    total_paid: round2(paid),
    outstanding_balance: round2(invoiceValue - paid),
  };
}

/**
 * Manager-facing label for a party's closing balance.
 *
 * The party type gives the expected side (supplier -> payable, customer ->
 * receivable); if the actual signed balance sits on the opposite side the label
 * follows the money so the screen never claims we are owed what we owe.
 *
 *   balance > 0 -> Dr (debit / receivable side)
 *   balance < 0 -> Cr (credit / payable side)
 */
export function balanceAmountLabel(partyType: PartyTypeLike, balance: number): string {
  const t = (partyType || "").toUpperCase();
  if (isSupplierType(t)) return balance > 0 ? "Amount Receivable" : "Amount Payable";
  if (t === "CUSTOMER") return balance < 0 ? "Amount Payable" : "Amount Receivable";
  return balance < 0 ? "Amount Payable" : "Amount Receivable";
}

/** "Amount Payable" / "Amount Receivable" / "Net Balance" without needing a balance. */
export function partyBalanceLabel(partyType: PartyTypeLike): string {
  const t = (partyType || "").toUpperCase();
  if (isSupplierType(t)) return "Amount Payable";
  if (t === "CUSTOMER") return "Amount Receivable";
  return "Net Balance";
}

// ----------------------------------------------------------------------------
// Party control account (which GL account a party statement is read from)
// ----------------------------------------------------------------------------

/** Minimal account reference used to recognise a party's control account. */
export interface StatementAccountRef {
  code: string;
  name?: string;
  type?: string;
}

/** Accounts Payable / vendor payable: the supplier's control account. */
export function isPayableControlAccount(account: StatementAccountRef): boolean {
  const code = (account.code || "").trim();
  const name = (account.name || "").toLowerCase();
  const type = (account.type || "").toUpperCase();
  return type === "LIABILITY" || code === ACCOUNT_CODES.AP || name.includes("payable");
}

/** Accounts Receivable / trade debts: the customer's control account. */
export function isReceivableControlAccount(account: StatementAccountRef): boolean {
  const code = (account.code || "").trim();
  const name = (account.name || "").toLowerCase();
  return (
    code === ACCOUNT_CODES.AR ||
    code === "1201" ||
    name.includes("receivable") ||
    name.includes("trade deb")
  );
}

/**
 * 0 = proper control account for this party type, 10 = anything else.
 * Unknown party types get 0 for everything (no opinion -> caller's choice wins).
 */
export function controlAccountRank(partyType: PartyTypeLike, account: StatementAccountRef): number {
  const t = (partyType || "").toUpperCase();
  if (!t) return 0;
  if (isSupplierType(t)) return isPayableControlAccount(account) ? 0 : 10;
  if (t === "CUSTOMER") return isReceivableControlAccount(account) ? 0 : 10;
  if (t === "BOTH") return isPayableControlAccount(account) || isReceivableControlAccount(account) ? 0 : 10;
  return 0;
}

/**
 * The GL account a party statement must be read from, by party type.
 *
 * Keeps `preferred` whenever it is already a valid control account for the party
 * (so opening the statement from the AP row keeps AP); otherwise switches to the
 * best control account found among the accounts that actually reference this
 * party - e.g. a supplier preferred onto 1101 Inventory flips to 2001 AP so
 * purchases are presented as CREDIT instead of debit.
 */
export function pickPartyControlAccount(
  partyType: PartyTypeLike,
  candidates: StatementAccountRef[],
  preferred?: StatementAccountRef | string
): string | undefined {
  const prefRef: StatementAccountRef | undefined =
    typeof preferred === "string"
      ? preferred.trim()
        ? { code: preferred.trim() }
        : undefined
      : preferred && preferred.code
      ? preferred
      : undefined;

  const prefRank = prefRef ? controlAccountRank(partyType, prefRef) : Number.POSITIVE_INFINITY;

  let best: StatementAccountRef | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate?.code) continue;
    const rank = controlAccountRank(partyType, candidate);
    if (rank < bestRank) {
      bestRank = rank;
      best = candidate;
    }
  }

  if (prefRef && prefRank <= bestRank) return prefRef.code;
  if (best && bestRank < prefRank) return best.code;
  return prefRef?.code ?? best?.code ?? candidates[0]?.code;
}
