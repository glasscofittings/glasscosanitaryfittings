import { formatPKR } from "@/lib/utils/formatters";
import { balanceSide } from "@/lib/party-statement";
import { getExportDocumentTitle } from "@/lib/company-settings";
import { SANS_FONT_FACES_CSS, SANS_FONT_FAMILY_CSS } from "@/lib/pdf-font";
import { PRINT_HEAD_META, PRINT_BASE_CSS } from "@/lib/print-html";

/** PKR amount with the non-breaking space Rs glue so the symbol never splits from the figure. */
function amount(value: number): string {
  return formatPKR(value);
}

/** Money cell: strictly single-line tabular figures, auto-shrinking for very long amounts. */
function moneyCell(html: string, rawLength = html.length): string {
  const tier = rawLength >= 22 ? " xtight" : rawLength > 17 ? " tight" : "";
  return `<td class="num${tier}">${html}</td>`;
}

/** Balance cell: amount + small Dr/Cr suffix, sized so the pair never wraps. */
function balanceCell(balance: number): string {
  const side = balanceSide(balance);
  const text = `${amount(Math.abs(balance))} ${side}`;
  return moneyCell(
    `${amount(Math.abs(balance))}<span class="side">${side}</span>`,
    text.length,
  );
}

/** Party/account fields the statement header needs. */
export interface StatementTarget {
  type: "PARTY" | "ACCOUNT";
  name: string;
  phone?: string;
  address?: string;
  party_type?: "SUPPLIER" | "CUSTOMER" | "BOTH" | "VENDOR";
  account_type?: string;
}

export interface StatementRow {
  date: string;
  voucherNo: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementHTMLInput {
  target: StatementTarget;
  /** Period start (inclusive), ISO date or empty for inception. */
  startDate?: string;
  /** Human period label shown under the customer details. */
  periodLabel: string;
  rows: StatementRow[];
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  /** Manager-facing closing label, e.g. "Amount Receivable". */
  closingLabel: string;
  closingUrLabel?: string;
  conventionNote: string;
}

/** Statement date for print: "05 Sep 2026". */
export function formatStatementDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Escape user/company data before it is injected into print HTML. */
function escText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Short, printable text for the statement's InvDesc column. Long system
 * identifiers (JE-20260930-34279-257, UUIDs) and trailing party names are
 * dropped so rows read like "Credit Sales (INV-2026-7327)".
 */
export function cleanStatementDescription(raw: string): string {
  const source = (raw || "").trim();
  if (!source) return "—";

  const sales = source.match(
    /\bsales\s*invoice\s+([A-Za-z0-9][A-Za-z0-9\-/]*)/i,
  );
  if (sales) return `Credit Sales (${sales[1]})`;

  const receipt = source.match(/payment\s*received[^\[]*\[([^\]]+)\]/i);
  if (receipt) return `Payment Received (${receipt[1].trim()})`;

  const purchase = source.match(/purchase\s*invoice[^\[]*\[([^\]]+)\]/i);
  if (purchase) {
    // "[PINV-2026-00010 - GRN-2026-00010]" -> keep the invoice number only.
    return `Purchase Invoice (${purchase[1].split(/\s+-\s+/)[0].trim()})`;
  }

  const cleaned = source
    .replace(/\b(?:JE|JV|PV|RC)-\d{8}-[A-Za-z0-9-]+/g, "")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–—:,]+$/, "")
    .trim();
  return cleaned || "—";
}

/**
 * Bill number for column 2: the document number inside the narration
 * (INV-/PINV-/CR-/...), otherwise the voucher, shortened to fit the column
 * (about 13 monospace characters at A4) so it can never break out of the cell.
 */
export function displayBillNo(voucherNo: string, narration: string): string {
  const doc = (narration || "").match(
    /\b((?:PINV|INV|GRN|JV|PV|RV|GV|PI|CR)-[A-Za-z0-9][A-Za-z0-9\-/]*)\b/i,
  );
  const raw = doc ? doc[1] : (voucherNo || "").trim();
  if (!raw) return "—";
  return shortenBillNo(raw);
}

/** Longest bill number the BillNo column can show without wrapping. */
const BILL_NO_MAX = 13;

/** JE-20260930-001 -> JE-001, PINV-2026-00010 -> PINV-00010 (full number stays in InvDesc). */
function shortenBillNo(raw: string): string {
  if (raw.length <= BILL_NO_MAX) return raw;
  const parts = raw.split("-").filter(Boolean);
  if (parts.length >= 2) {
    const short = `${parts[0]}-${parts[parts.length - 1]}`;
    if (short.length <= BILL_NO_MAX) return short;
    const tail = parts[parts.length - 1].slice(
      -(BILL_NO_MAX - parts[0].length - 1),
    );
    return `${parts[0]}-${tail}`;
  }
  return `${raw.slice(0, BILL_NO_MAX - 1)}…`;
}

/** Party-aware statement heading; the customer statement matches the reference layout. */
export function statementTitleFor(target: StatementTarget): string {
  if (target.type !== "PARTY") return "Account Statement";
  if (target.party_type === "CUSTOMER") return "Customer Account Statement";
  if (target.party_type === "SUPPLIER" || target.party_type === "VENDOR")
    return "Supplier Account Statement";
  return "Party Account Statement";
}

/** Single-page A4 customer statement HTML for the iframe print path. */
export function generateStatementHTML(input: StatementHTMLInput): string {
  const {
    target,
    startDate,
    periodLabel,
    rows,
    openingBalance,
    periodDebit,
    periodCredit,
    closingBalance,
    closingLabel,
    conventionNote,
  } = input;

  const statementTitle = statementTitleFor(target);
  const docTitle = getExportDocumentTitle().toUpperCase();
  const statementDate = formatStatementDate(new Date().toISOString());
  
  const nameLabel =
    target.type === "ACCOUNT"
      ? "Account Name"
      : target.party_type === "SUPPLIER" || target.party_type === "VENDOR"
        ? "Supplier Name"
        : "Customer Name";
  const closingIsDr = balanceSide(closingBalance) === "Dr";

  const mrow = (label: string, value: string, cls = "") =>
    `<div class="mrow"><span class="mlbl">${label}</span><span class="mval${cls ? ` ${cls}` : ""}">${value}</span></div>`;

  const rowsHtml = rows
    .map(
      (tx) => `
        <tr>
          <td class="ctr">${formatStatementDate(tx.date)}</td>
          <td class="ctr">${escText(displayBillNo(tx.voucherNo, tx.narration))}</td>
          <td class="desc">${escText(cleanStatementDescription(tx.narration))}</td>
          ${moneyCell(tx.debit > 0 ? amount(tx.debit) : "—")}
          ${moneyCell(tx.credit > 0 ? amount(tx.credit) : "—")}
          ${balanceCell(tx.balance)}
        </tr>
      `,
    )
    .join("");

  const openingRowHtml = `
        <tr class="opening">
          <td class="ctr">${startDate ? formatStatementDate(startDate) : "—"}</td>
          <td class="ctr">—</td>
          <td class="desc">Opening Balance</td>
          <td class="num">—</td>
          <td class="num">—</td>
          ${balanceCell(openingBalance)}
        </tr>
      `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">${PRINT_HEAD_META}
  <title>${escText(statementTitle)} - ${escText(target.name)}</title>
  <style>
        ${SANS_FONT_FACES_CSS}
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    ${PRINT_BASE_CSS}
    html { background: #eef1f5; }
    body { font-family: ${SANS_FONT_FAMILY_CSS}; color: #09090b; font-size: 11px; font-weight: 400; line-height: 1.35; }
    .sheet { width: 190mm; min-height: 277mm; margin: 10mm auto; background: #fff; box-shadow: 0 6px 26px rgba(15,23,42,.15); display: flex; flex-direction: column; }

    /* Executive header */
    .title { text-align: center; font-size: 30px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #09090b; line-height: 1.15; }
    .title-rule { border: 0; border-top: 2px solid #1e293b; margin-top: 6px; }
    .banner { margin-top: 6px; color: #09090b; display: flex; justify-content: space-between; align-items: center; text: center;  gap: 12px; padding: 8px 14px; border-radius: 3px; page-break-inside: avoid; }
    .banner .lbl { font-size: 12px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; color: #09090b;  }

    /* Customer metadata grid card */
    .meta { display: flex; gap: 8mm; margin-top: 12px; background: #d8e2f4; border: 1px solid #09090b; border-radius: 6px; padding: 14px 16px; page-break-inside: avoid; }
    .meta-col { flex: 1; min-width: 0; }
    .mrow { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 3px 0; }
    .mlbl { font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #09090b; white-space: nowrap; }
    .mval { text-align: right; font-size: 12px; font-weight: 600; color: #09090b; white-space: normal; overflow-wrap: anywhere; }
    .mval.name { font-size: 16px; font-weight: 600; line-height: 1.3; color: #09090b; }

    /* Ledger table */
    table.stmt { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 12px; border: 1px solid #09090b; font-size: 10.5px; }
    table.stmt th, table.stmt td { vertical-align: top; }
    thead th { background: #d8e2f4; color:#09090b; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; padding: 7px 8px; border-bottom: 2px solid #27292bff; }
    thead th + th { border-left: 2px solid #27292bff; }
    .h-ctr { text-align: center; }
    .h-lft { text-align: left; }
    thead th.num { text-align: right; }

    tbody td { padding: 4px 8px; border-bottom: 2px solid #27292bff; font-size: 11px; font-weight: 600; color: #09090b; }
    table.stmt td + td { border-left: 2px solid #27292bff; }
    tbody tr:nth-child(even) td  
    tbody tr.opening td  font-weight: 600; border-bottom: 1px solid #27292bff; }
    td.ctr { padding: 4px 6px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; font-size: 11px; }
    td.num { padding: 4px 5px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 11px; line-height: 1.2; color: #09090b; }
    td.desc { overflow-wrap: anywhere; }
   
    td.num.tight { font-size: 8px; }
    td.num.xtight { font-size: 7px; }
    .side { font-size: 12px; font-weight: 600; color: #09090b; margin-left: 4px; }
    td.empty { text-align: center; padding: 22px 8px; color: #09090b; }

    tfoot td { background: #d8e2f4; font-weight: 800; font-size: 14px; border-top: 2px solid #0f172a; color: #09090b; }
    tfoot td.tlabel { padding: 10px 12px; }
    tfoot td.num { font-weight: 600; }

    /* Bottom: disclaimer + receivable / payable callout */
    .bottom { margin-top: auto; padding-top: 14px; display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; page-break-inside: avoid; }
    .note { flex: 1; min-width: 0; max-width: 95mm; font-size: 10px; font-weight: 400; font-style: italic; color: #18181b; line-height: 1.45; }
    .callout { flex: 0 0 auto; min-width: 70mm; padding: 10px 14px; border: 1px solid #09090b; border-left-width: 4px; border-radius: 6px; background: #fff; }
    .callout.dr { border-left-color: #047857; background: #d8e2f4; }
    .callout.cr { border-left-color: #334155; background: #d8e2f4; }
    .co-label { font-size: 9.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: #18181b; }
    .co-amount { margin-top: 4px; font-size: 18px; font-weight: 700; color: #09090b; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .co-amount .side { font-size: 11px; margin-left: 5px; color: #18181b; }

    tr, .meta, .bottom { page-break-inside: avoid; }
    thead { display: table-header-group; }
    /* Vertical margin must stay <= 8mm: Chromium/Edge skip their built-in
       print header & footer (date, title, URL, page no.) when it cannot fit,
       which keeps the slip clean. 7mm + the sheet's 3mm padding-top recreate
       the original 10mm visual inset on page 1; pages 2+ get 7mm. */
    @page { size: A4 portrait; margin: 7mm 10mm; }
    @media print {
      html, body { background: #fff; }
      .sheet { margin: 0 auto; box-shadow: none; min-height: 280mm; padding-top: 3mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      a[href]:after { content: none !important; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <h1 class="title">${escText(docTitle)}</h1>
    <hr class="title-rule">
    <div class="banner">
      <span class="lbl">${escText(statementTitle)}</span>
    </div>

    <div class="meta">
      <div class="meta-col">
        ${mrow(nameLabel, escText(target.name), "name")}
        ${target.phone ? mrow("Phone / Mobile", escText(target.phone)) : ""}
        ${target.address ? mrow("Address", escText(target.address)) : ""}
      </div>
      <div class="meta-col">
        ${mrow("Statement Period", escText(periodLabel))}
        ${mrow("Total Entries", `${rows.length} entries`)}
        ${mrow("Statement Date", statementDate)}
      </div>
    </div>

    <table class="stmt">
      <colgroup>
        <col style="width:12%"><col style="width:12%"><col style="width:36%"><col style="width:13%"><col style="width:13%"><col style="width:14%">
      </colgroup>
      <thead>
        <tr>
          <th class="h-ctr">Bill Date</th>
          <th class="h-ctr">Bill No</th>
          <th class="h-lft">Description</th>
          <th class="num">Debit</th>
          <th class="num">Credit</th>
          <th class="num">Balance</th>
        </tr>
      </thead>
      <tbody>
        ${openingRowHtml}
        ${rowsHtml || `<tr><td class="empty" colspan="6">No transactions recorded in this period.</td></tr>`}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="tlabel">Total</td>
          ${moneyCell(amount(periodDebit))}
          ${moneyCell(amount(periodCredit))}
          ${balanceCell(closingBalance)}
        </tr>
      </tfoot>
    </table>

    <div class="bottom">
      <div class="note">${escText(conventionNote)}</div>
      <div class="callout ${closingIsDr ? "dr" : "cr"}">
        <div class="co-label">${escText(closingLabel)}</div>
        <div class="co-amount">${amount(Math.abs(closingBalance))}<span class="side">${balanceSide(closingBalance)}</span></div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}
