import { printPdfDocument } from "@/lib/tauri-bridge";
import { fetchPartyPaymentVouchers, type PaymentVoucher } from "@/lib/supabase/payment-vouchers";
import { UR, URDU_HTML_STYLES, urUnder } from "@/lib/pdf-urdu";
import { getCompanyLogoHtml, getExportCompanyName } from "@/lib/company-settings";
import { COMPANY_HEADER, COMPANY_HEADER_FONT_SIZE_PX, COMPANY_LEGAL_NAME } from "@/lib/branding";
import { SANS_FONT_FACES_CSS, SANS_FONT_FAMILY_CSS } from "@/lib/pdf-font";
import {
  balanceAmountLabel,
  balanceSide,
  buildPartyLedgerEntries,
  computeLedgerBalances,
  computeSideTotals,
  partySignedOpeningBalance,
  sortLedgerEntries,
  type PartyLedgerDocType,
  type PartyLedgerEntry,
  type PartySideTotals,
  type PartyStatementDoc,
} from "@/lib/party-statement";

export {
  computeLedgerBalances,
  partySignedOpeningBalance,
  sortLedgerEntries,
};
export type { PartyLedgerDocType, PartyLedgerEntry, PartySideTotals };

export interface Party {
  id: string;
  name: string;
  party_type: "SUPPLIER" | "CUSTOMER" | "BOTH";
  is_registered: boolean;
  ntn_strn?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Absolute opening balance amount (>= 0). Side is `opening_balance_type`. */
  opening_balance?: number;
  /** 'Dr' = debit-normal (customer/asset style), 'Cr' = credit-normal (supplier/liability style). */
  opening_balance_type?: "Dr" | "Cr";
}

// PartyLedgerEntry / PartyLedgerDocType / PartySideTotals are defined in
// "@/lib/party-statement" (party-type-aware presentation) and re-exported above.

export interface PartyDetail extends Party {
  /** Legacy top-level totals = the party's primary side (CUSTOMER->buy, SUPPLIER->sell, BOTH->buy). */
  total_invoices: number;
  total_invoice_value: number;
  total_paid: number;
  outstanding_balance: number;
  invoice_count: number;
  recent_invoices: PartyInvoice[];
  /** Combined, date-sorted ledger with running balances - the single source for drawer + print. */
  ledger: PartyLedgerEntry[];
  sides: { buy?: PartySideTotals; sell?: PartySideTotals };
  /** Signed closing balance: positive = Dr (receivable), negative = Cr (payable). */
  closing_balance: number;
}

export interface PartyInvoice {
  id: string;
  invoice_number: string;
  taxable_value_pkr: number;
  sales_tax_amount_pkr: number;
  further_tax_amount_pkr: number;
  total_invoice_value_pkr: number;
  is_posted: boolean;
  created_at: string;
}

export interface CRMStats {
  total_buyers: number;
  total_suppliers: number;
  total_receivables: number;
  total_payables: number;
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

export async function fetchParties(type?: "SUPPLIER" | "BUYER" | "ALL"): Promise<Party[]> {
  if (!SUPABASE_URL) return [];
  try {
    let filter = "";
    if (type === "BUYER") {
      filter = "&party_type=in.(CUSTOMER,BOTH)";
    } else if (type === "SUPPLIER") {
      filter = "&party_type=in.(SUPPLIER,BOTH)";
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/parties?select=id,name,party_type,phone,email,address,opening_balance,opening_balance_type&order=name.asc${filter}`,
      { headers: headers() }
    );
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok) {
      const { message, code, details, hint } = body as { message?: string; code?: string; details?: string; hint?: string };
      console.error("Supabase Error [crm fetchParties]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return [];
    }
    const rows = (Array.isArray(body) ? body : []) as Party[];
    return rows.map((r) => ({
      ...r,
      ntn_strn: undefined,
      is_registered: false,
      opening_balance: Number(r.opening_balance ?? 0),
      opening_balance_type: r.opening_balance_type === "Cr" ? "Cr" : "Dr",
    })) as Party[];
  } catch (err) {
    console.error("Supabase Error [crm fetchParties]:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function fetchCRMStats(): Promise<CRMStats> {
  const parties = await fetchParties("ALL");
  const buyers = parties.filter((p) => p.party_type === "CUSTOMER" || p.party_type === "BOTH");
  const suppliers = parties.filter((p) => p.party_type === "SUPPLIER" || p.party_type === "BOTH");

  let totalReceivables = 0;
  const totalPayables = 0;

  if (SUPABASE_URL) {
    try {
      const [invRes, purchaseRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/sales_invoices?select=total_invoice_value_pkr,is_posted&is_posted=eq.true`,
          { headers: headers() }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/inward_gate_passes?select=status`,
          { headers: headers() }
        ),
      ]);

      if (invRes.ok) {
        const invoices = await invRes.json();
        totalReceivables = Array.isArray(invoices)
          ? invoices.reduce((sum: number, i: { total_invoice_value_pkr: number }) => sum + (Number(i.total_invoice_value_pkr) || 0), 0)
          : 0;
      }
    } catch {
      // Stats are best-effort
    }
  }

  return {
    total_buyers: buyers.length,
    total_suppliers: suppliers.length,
    total_receivables: totalReceivables,
    total_payables: totalPayables,
  };
}

async function fetchRest(url: string, context: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: headers() });
    const text = await res.text();
    let body: unknown = [];
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok) {
      console.error(`Supabase Error [${context}]:`, { status: res.status, message: text.slice(0, 300) });
      return [];
    }
    return body;
  } catch (err) {
    console.error(`Supabase Error [${context}]:`, err instanceof Error ? err.message : err);
    return [];
  }
}

const num = (v: unknown) => Number(v) || 0;

interface PurchaseInvoiceRow {
  id: string;
  invoice_number: string;
  grn_number: string;
  taxable_amount: number;
  tax_amount: number;
  total_payable: number;
  status: "pending_approval" | "posted" | "cancelled";
  created_at: string;
}

interface ReceiptRow {
  id: string;
  voucher_no: string;
  receipt_date: string;
  amount: number;
  payment_mode: string;
  reference_no: string | null;
}

const PURCHASE_STATUS_LABEL: Record<PurchaseInvoiceRow["status"], string> = {
  pending_approval: "PENDING APPROVAL",
  posted: "POSTED",
  cancelled: "CANCELLED",
};

/**
 * Single source for party details: totals AND the combined ledger both come from here.
 * Presentation is party-type aware (see "@/lib/party-statement"):
 *   CUSTOMER (AR side): sales invoice = debit,  receipt/refund = credit -> normal Dr balance
 *   SUPPLIER (AP side): purchase invoice = credit, payment = debit      -> normal Cr balance
 * balance = opening + debit - credit (positive = Dr, negative = Cr).
 * For BOTH parties, buy (AR) and sell (AP) totals are kept in `sides` and are
 * never merged into one number. No journal entries are created or altered here -
 * this only presents the party statement.
 */
export async function fetchPartyDetails(partyId: string): Promise<PartyDetail | null> {
  if (!SUPABASE_URL) return null;
  try {
    const partyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/parties?id=eq.${partyId}&select=*`,
      { headers: headers() }
    );
    const partyText = await partyRes.text();
    let partyBody: Record<string, unknown> = {};
    try { partyBody = JSON.parse(partyText); } catch { /* non-JSON */ }
    if (!partyRes.ok || !Array.isArray(partyBody) || partyBody.length === 0) {
      return null;
    }

    const partyRaw = partyBody[0] as Omit<Party, "is_registered" | "ntn_strn"> & { ntn_strn?: string };
    const party: Party = {
      ...partyRaw,
      ntn_strn: partyRaw.ntn_strn,
      is_registered: Boolean(partyRaw.ntn_strn),
      opening_balance: Number(partyRaw.opening_balance ?? 0),
      opening_balance_type: partyRaw.opening_balance_type === "Cr" ? "Cr" : "Dr",
    };

    const isBuyer = party.party_type === "CUSTOMER" || party.party_type === "BOTH";
    const isSupplier = party.party_type === "SUPPLIER" || party.party_type === "BOTH";

    const [salesRes, receiptsRes, purchaseRes, vouchers] = await Promise.all([
      isBuyer
        ? fetchRest(
            `${SUPABASE_URL}/rest/v1/sales_invoices?customer_id=eq.${partyId}&select=id,invoice_number,taxable_value_pkr,sales_tax_amount_pkr,further_tax_amount_pkr,total_invoice_value_pkr,is_posted,created_at&order=created_at.asc`,
            "crm sales_invoices"
          )
        : Promise.resolve([]),
      isBuyer
        ? fetchRest(
            `${SUPABASE_URL}/rest/v1/customer_receipt_vouchers?customer_id=eq.${partyId}&status=eq.POSTED&select=id,voucher_no,receipt_date,amount,payment_mode,reference_no&order=receipt_date.asc`,
            "crm customer_receipt_vouchers"
          )
        : Promise.resolve([]),
      isSupplier
        ? fetchRest(
            `${SUPABASE_URL}/rest/v1/purchase_invoices?vendor_id=eq.${partyId}&status=in.(pending_approval,posted)&select=id,invoice_number,grn_number,taxable_amount,tax_amount,total_payable,status,created_at&order=created_at.asc`,
            "crm purchase_invoices"
          )
        : Promise.resolve([]),
      fetchPartyPaymentVouchers(party.name),
    ]);

    const sales = (Array.isArray(salesRes) ? salesRes : []) as PartyInvoice[];
    const receipts = (Array.isArray(receiptsRes) ? receiptsRes : []) as ReceiptRow[];
    const purchases = (Array.isArray(purchaseRes) ? purchaseRes : []) as PurchaseInvoiceRow[];

    // Payment vouchers have no party_id; matched by payee_name in fetchPartyPaymentVouchers.
    // Side rule: a voucher to a supplier-ish party sits on the sell (AP) side; a voucher to a
    // pure customer (refund/advance) sits on the buy (AR) side so it reduces their outstanding.
    const voucherSide: "buy" | "sell" = party.party_type === "CUSTOMER" ? "buy" : "sell";

    // Debit / credit columns follow the party's own account, NOT a universal
    // "invoice = debit" rule: AR side invoices debit, AP side invoices credit.
    const docs: PartyStatementDoc[] = [];

    const push = (
      base: Omit<PartyStatementDoc, "doc_type" | "side" | "amount">,
      side: "buy" | "sell",
      docType: PartyLedgerDocType,
      amount: number
    ) => {
      docs.push({ ...base, doc_type: docType, side, amount });
    };

    for (const inv of sales) {
      push(
        {
          id: inv.id,
          date: inv.created_at,
          doc_no: inv.invoice_number,
          remarks: `Sales Invoice - ${inv.is_posted ? "POSTED" : "DRAFT"}`,
        },
        "buy",
        "SALES_INVOICE",
        num(inv.total_invoice_value_pkr)
      );
    }

    for (const pinv of purchases) {
      push(
        {
          id: pinv.id,
          date: pinv.created_at,
          doc_no: pinv.invoice_number,
          remarks: `Purchase Invoice${pinv.grn_number ? ` - GRN ${pinv.grn_number}` : ""} - ${PURCHASE_STATUS_LABEL[pinv.status]}`,
        },
        "sell",
        "PURCHASE_INVOICE",
        num(pinv.total_payable)
      );
    }

    for (const r of receipts) {
      push(
        {
          id: r.id,
          date: r.receipt_date,
          doc_no: r.voucher_no,
          remarks: `Receipt - ${r.payment_mode}${r.reference_no ? ` - REF # ${r.reference_no}` : ""}`,
        },
        "buy",
        "RECEIPT_VOUCHER",
        num(r.amount)
      );
    }

    for (const v of vouchers) {
      push(
        {
          id: v.id,
          date: v.voucher_date,
          doc_no: v.voucher_no,
          remarks: ledgerRemarks(v),
        },
        voucherSide,
        "PAYMENT_VOUCHER",
        num(v.amount)
      );
    }

    const ledger = buildPartyLedgerEntries(docs, partySignedOpeningBalance(party));

    // Per-side totals are derived from the document type (invoice vs payment),
    // never from which column the document was presented in - so the sell (AP)
    // side still reports invoice value / paid / outstanding for a supplier.
    const sides: PartyDetail["sides"] = {};
    if (isBuyer) sides.buy = computeSideTotals(ledger, "buy");
    if (isSupplier) sides.sell = computeSideTotals(ledger, "sell");

    // Legacy top-level totals = primary side (BOTH falls back to buy; drawer shows sides separately).
    const primary = party.party_type === "SUPPLIER" ? sides.sell : sides.buy;

    // recent_invoices kept populated for backwards compatibility (drawer now renders `ledger`).
    const recentInvoices: PartyInvoice[] =
      party.party_type === "SUPPLIER"
        ? purchases.map((p) => ({
            id: p.id,
            invoice_number: p.invoice_number,
            taxable_value_pkr: num(p.taxable_amount),
            sales_tax_amount_pkr: num(p.tax_amount),
            further_tax_amount_pkr: 0,
            total_invoice_value_pkr: num(p.total_payable),
            is_posted: p.status === "posted",
            created_at: p.created_at,
          }))
        : sales;

    return {
      ...party,
      total_invoices: primary?.total_invoice_value ?? 0,
      total_invoice_value: primary?.total_invoice_value ?? 0,
      total_paid: primary?.total_paid ?? 0,
      outstanding_balance: primary?.outstanding_balance ?? 0,
      invoice_count: primary?.invoice_count ?? 0,
      recent_invoices: recentInvoices,
      ledger,
      sides,
      /** Signed closing balance of the combined statement: positive = Dr, negative = Cr. */
      closing_balance: ledger.length ? ledger[ledger.length - 1].balance : partySignedOpeningBalance(party),
    };
  } catch (err) {
    console.error("Supabase Error [crm fetchPartyDetails]:", err instanceof Error ? err.message : err);
    return null;
  }
}

// sortLedgerEntries / computeLedgerBalances / partySignedOpeningBalance are
// re-exported from "@/lib/party-statement" (see imports at the top of this file).

// ============================================================================
// CREATE PARTY
// ============================================================================

export async function createParty(data: {
  name: string;
  party_type: "SUPPLIER" | "CUSTOMER" | "BOTH";
  phone?: string;
  email?: string;
  address?: string;
  opening_balance?: number;
  opening_balance_type?: "Dr" | "Cr";
}): Promise<Party | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/parties`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        name: data.name,
        party_type: data.party_type,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        opening_balance: Math.max(0, Number(data.opening_balance ?? 0)),
        opening_balance_type: data.opening_balance_type === "Cr" ? "Cr" : "Dr",
      }),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok) {
      const { message, code, details, hint } = body as { message?: string; code?: string; details?: string; hint?: string };
      console.error("Supabase Error [crm createParty]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return null;
    }
    const row = (Array.isArray(body) ? body[0] : body) as Party;
    return {
      ...row,
      ntn_strn: undefined,
      is_registered: false,
      opening_balance: Number(row.opening_balance ?? 0),
      opening_balance_type: row.opening_balance_type === "Cr" ? "Cr" : "Dr",
    } as Party;
  } catch (err) {
    console.error("Supabase Error [crm createParty]:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ============================================================================
// DELETE PARTY (with FK safety)
// ============================================================================

export interface DeletePartyResult {
  ok: boolean;
  error?: string;
}

export async function deleteParty(partyId: string): Promise<DeletePartyResult> {
  if (!SUPABASE_URL) return { ok: false, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/parties?id=eq.${partyId}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { /* non-JSON */ }

      const code = body?.code as string | undefined;
      // FK violation: 23503 = foreign_key_violation
      if (code === "23503") {
        return {
          ok: false,
          error: "Cannot delete contact because they have linked transactions. Archive them instead.",
        };
      }

      const { message, details, hint } = body as { message?: string; details?: string; hint?: string };
      console.error("Supabase Error [crm deleteParty]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return { ok: false, error: message ?? `Delete failed (status ${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    console.error("Supabase Error [crm deleteParty]:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Network error. Please check your connection." };
  }
}

// ============================================================================
// UPDATE PARTY
// ============================================================================

export async function updateParty(
  id: string,
  data: {
    name?: string;
    party_type?: "SUPPLIER" | "CUSTOMER" | "BOTH";
    phone?: string;
    email?: string;
    address?: string;
    opening_balance?: number;
    opening_balance_type?: "Dr" | "Cr";
  }
): Promise<Party | null> {
  if (!SUPABASE_URL) return null;
  try {
    const payload: Record<string, unknown> = { ...data };
    if (payload.opening_balance !== undefined) {
      payload.opening_balance = Math.max(0, Number(payload.opening_balance) || 0);
    }
    if (payload.opening_balance_type !== undefined) {
      payload.opening_balance_type = payload.opening_balance_type === "Cr" ? "Cr" : "Dr";
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/parties?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* non-JSON */ }
    if (!res.ok) {
      const { message, code, details, hint } = body as { message?: string; code?: string; details?: string; hint?: string };
      console.error("Supabase Error [crm updateParty]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return null;
    }
    const row = (Array.isArray(body) ? body[0] : body) as Party;
    return {
      ...row,
      is_registered: Boolean(row.ntn_strn),
      opening_balance: Number(row.opening_balance ?? 0),
      opening_balance_type: row.opening_balance_type === "Cr" ? "Cr" : "Dr",
    } as Party;
  } catch (err) {
    console.error("Supabase Error [crm updateParty]:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ============================================================================
// CUSTOMER LEDGER (payment voucher history, printable HTML)
// ============================================================================

const LEDGER_TYPE_LABEL: Record<PaymentVoucher["voucher_type"], string> = {
  CASH_PAYMENT: "CASH PAID",
  PARTY_PAYMENT: "PARTY PAYMENT",
  BANK_PAYMENT: "BANK PAYMENT",
  SALARY_PAYMENT: "SALARY PAID",
};

const LEDGER_PARTY_TYPE_LABEL: Record<Party["party_type"], string> = {
  CUSTOMER: "Buyer",
  SUPPLIER: "Supplier",
  BOTH: "Buyer / Supplier",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ledger figures: thousands separators, no currency prefix, negatives in parentheses. */
function formatLedgerAmount(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `(${abs})` : abs;
}

/** dd-Mon-yy, as printed on the ledger. */
function formatLedgerDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

/** One line per voucher, mirroring the "Remarks" column of a printed vendor ledger. */
function ledgerRemarks(v: PaymentVoucher): string {
  const parts: string[] = [LEDGER_TYPE_LABEL[v.voucher_type]];
  if (v.reference_no) parts.push(`REF # ${v.reference_no}`);
  if (v.purpose) parts.push(v.purpose);
  if (v.credit_account) parts.push(`FROM ${v.credit_account.account_name}`);
  parts.push(`TO ${v.payee_name}`);
  if (v.remarks) parts.push(v.remarks);
  return parts.join(" - ");
}

/**
 * Party ledger print (iframe/PDF): company + report title, period, opening balance, party block,
 * then Date / Doc. No / Remarks / Debit / Credit / Balance with running balance and period totals.
 * Debit / credit presentation follows the party type: customer invoices debit / receipts credit,
 * supplier purchase invoices credit / payments debit -> balance is Dr for customers (amount
 * receivable) and Cr for suppliers (amount payable). Entries are re-sorted and re-balanced here
 * with the same shared helpers the drawer uses.
 */
export function generatePartyLedgerHTML(
  party: Party,
  ledger: PartyLedgerEntry[],
  options: { openingBalance?: number } = {}
): string {
  const openingBalance = options.openingBalance ?? partySignedOpeningBalance(party);
  const entries = computeLedgerBalances(ledger, openingBalance);
  const now = new Date();
  const from = entries.length ? entries[0].date : now.toISOString();
  const to = entries.length ? entries[entries.length - 1].date : now.toISOString();

  let totalDebit = 0;
  let totalCredit = 0;
  const rows = entries.map((e) => {
    totalDebit += e.debit;
    totalCredit += e.credit;
    return `
      <tr>
        <td class="date">${formatLedgerDate(e.date)}</td>
        <td class="mono">${escapeHtml(e.doc_no)}</td>
        <td class="remarks">${escapeHtml(e.remarks)}</td>
        <td class="num">${formatLedgerAmount(e.debit)}</td>
        <td class="num">${formatLedgerAmount(e.credit)}</td>
        <td class="num bold">${formatLedgerAmount(Math.abs(e.balance))} ${balanceSide(e.balance)}</td>
      </tr>`;
  });
  const finalBalance = entries.length ? entries[entries.length - 1].balance : openingBalance;
  const balanceLabel = balanceAmountLabel(party.party_type, finalBalance);
  const closingUr = balanceLabel === "Amount Payable" ? UR.amountPayable : UR.amountReceivable;
  const footerNoteEn =
    party.party_type === "SUPPLIER"
      ? "Purchase invoices are credits - payments are debits - balance is the amount payable"
      : party.party_type === "BOTH"
      ? "Buyer side: invoices debit / payments credit - supplier side: invoices credit / payments debit"
      : "Sales invoices are debits - receipts are credits - balance is the amount receivable";
  const footerNoteUr =
    party.party_type === "SUPPLIER" ? UR.ledgerFooterNoteSupplier
    : party.party_type === "BOTH" ? UR.ledgerFooterNoteBoth
    : UR.ledgerFooterNoteCustomer;

  const bodyRows = rows.length > 0
    ? rows.join("")
    : `<tr><td class="empty" colspan="6">No financial documents recorded for this party.</td></tr>`;

  const reportTitle =
    party.party_type === "SUPPLIER" ? "Supplier Ledger"
    : party.party_type === "BOTH" ? "Buyer / Supplier Ledger"
    : "Customer Ledger";
  const reportTitleUr =
    party.party_type === "SUPPLIER" ? UR.supplierLedger
    : party.party_type === "BOTH" ? UR.buyerSupplierLedger
    : UR.customerLedger;

  const stamp = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).replace(/ /g, "-")
    + "&nbsp;&nbsp;&nbsp;" + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8">
    <title>${reportTitle} - ${escapeHtml(party.name)}</title>
    <style>
      ${URDU_HTML_STYLES}
      @page{size:A4;margin:14mm 12mm 18mm 12mm;}
      ${SANS_FONT_FACES_CSS}
      body{font-family:${SANS_FONT_FAMILY_CSS};margin:0;padding:0;color:#111;font-size:12px;font-weight:400;}
      .stamp{text-align:right;font-size:11px;color:#333;margin-bottom:6px;}
      .company{font-size:${COMPANY_HEADER_FONT_SIZE_PX}px;font-weight:700;margin:0;}
      .company-block{display:flex;align-items:center;gap:10px;}
      .company-block img{width:48px;height:48px;object-fit:contain;}
      .report{font-size:18px;font-weight:700;margin:2px 0 4px 0;}
      .period{font-size:11px;margin:0 0 10px 0;}
      .top{display:flex;justify-content:space-between;align-items:flex-start;}
      .opening{text-align:right;}
      .opening .label{font-size:11px;font-weight:600;}
      .opening .value{font-size:15px;font-weight:600;margin-top:2px;}
      .customer{margin:6px 0 10px 0;}
      .customer .name{font-size:14px;font-weight:600;text-decoration:underline;margin-bottom:4px;}
      .customer .meta{font-size:11px;color:#333;line-height:1.5;}
      .customer .meta span{display:inline-block;margin-right:18px;}
      table{width:100%;border-collapse:collapse;}
      thead th{font-size:11px;font-weight:600;text-align:left;padding:6px 6px;border-top:1.5px solid #111;border-bottom:1.5px solid #111;}
      thead th.num{text-align:right;}
      tbody td{padding:7px 6px;border-bottom:1px solid #999;vertical-align:top;font-size:11px;}
      td.date{white-space:nowrap;width:64px;font-variant-numeric:tabular-nums;}
      td.mono{font-variant-numeric:tabular-nums;white-space:nowrap;width:80px;}
      td.remarks{font-size:10px;line-height:1.35;}
      td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;width:80px;}
      td.bold{font-weight:600;}
      td.empty{text-align:center;color:#777;padding:18px 6px;}
      tfoot td{padding:8px 6px;border-top:1.5px solid #111;border-bottom:1.5px solid #111;font-weight:600;font-size:11px;}
      tfoot td.num{text-align:right;font-variant-numeric:tabular-nums;}
      thead{display:table-header-group;}
      tfoot{display:table-footer-group;}
      tr{page-break-inside:avoid;}
      .footer{margin-top:14px;font-size:10px;color:#555;display:flex;justify-content:space-between;}
    </style></head><body>
    <div class="stamp">${stamp}</div>
    <div class="top">
      <div>
        <div class="company-block">
          ${getCompanyLogoHtml({ width: 48, height: 48 })}
          <p class="company">${COMPANY_HEADER}</p>
        </div>
        <p class="report">${urUnder(reportTitle, reportTitleUr)}</p>
        <p class="period">${urUnder(`From ${formatLedgerDate(from)} To ${formatLedgerDate(to)}`, `${UR.from} ${formatLedgerDate(from)} ${UR.to} ${formatLedgerDate(to)}`)}</p>
      </div>
      <div class="opening">
        <div class="label">${urUnder("Opening Balance", UR.openingBalance)}</div>
        <div class="value">${formatLedgerAmount(Math.abs(openingBalance))} ${balanceSide(openingBalance)}</div>
        <div class="label" style="margin-top:8px;">${urUnder(balanceLabel, closingUr)}</div>
        <div class="value">${formatLedgerAmount(Math.abs(finalBalance))} ${balanceSide(finalBalance)}</div>
      </div>
    </div>
    <div class="customer">
      <div class="name">${escapeHtml(party.name)}</div>
      <div class="meta">
        <span><strong>${urUnder("Type:", UR.type)}</strong> ${LEDGER_PARTY_TYPE_LABEL[party.party_type]}</span>
        <span><strong>${urUnder("Phone:", UR.phone)}</strong> ${escapeHtml(party.phone || "-")}</span>
        <span><strong>${urUnder("Email:", UR.email)}</strong> ${escapeHtml(party.email || "-")}</span>
        ${party.address ? `<span><strong>${urUnder("Address:", UR.address)}</strong> ${escapeHtml(party.address)}</span>` : ""}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>${urUnder("Date", UR.date)}</th>
          <th>${urUnder("Doc. No", UR.docNo)}</th>
          <th>${urUnder("Remarks", UR.remarks)}</th>
          <th class="num">${urUnder("Debit", UR.debitPKR)}</th>
          <th class="num">${urUnder("Credit", UR.creditPKR)}</th>
          <th class="num">${urUnder("Balance", UR.balancePKR)}</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">${urUnder("TOTAL", UR.total)}</td>
          <td>${entries.length} entr${entries.length === 1 ? "y" : "ies"}</td>
          <td class="num">${formatLedgerAmount(totalDebit)}</td>
          <td class="num">${formatLedgerAmount(totalCredit)}</td>
          <td class="num">${formatLedgerAmount(Math.abs(finalBalance))} ${balanceSide(finalBalance)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="footer">
      <span>${urUnder("Generated by Glassco Sanitary Fittings", UR.generatedBy)}</span>
      <span>${urUnder(footerNoteEn, footerNoteUr)}</span>
      <div style="margin-top:14px;font-size:11px;text-align:center;color:#555;">${COMPANY_LEGAL_NAME}</div>
    </div>
    </body></html>`;
}
