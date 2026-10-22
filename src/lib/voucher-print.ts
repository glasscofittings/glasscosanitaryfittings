import { UR, URDU_HTML_STYLES, numberToUrduWords, urSpan, urUnder } from "@/lib/pdf-urdu";
import {
  DEFAULT_COMPANY,
  getExportDocumentTitle,
  loadCompanyProfile,
} from "@/lib/company-settings";
import { REFERENCE_EMAIL, REFERENCE_PHONE } from "@/lib/supabase/invoicing";
import { COMPANY_HEADER_FONT_SIZE_PX, COMPANY_LEGAL_NAME, SERIF_FONT_FAMILY_CSS } from "@/lib/branding";
import { numberToWords, type PaymentVoucher } from "@/lib/supabase/payment-vouchers";
import type { CustomerReceiptVoucher } from "@/lib/supabase/receipt-vouchers";

export type VoucherKind = "RECEIPT" | "PAYMENT" | "JOURNAL";

export interface VoucherPrintLine {
  /** Ledger account head, e.g. "5000 - Office Expense" or the payee / customer name. */
  accountHead: string;
  /** Short English explanation rendered under the account head. */
  description?: string;
  /** Urdu translation of the description, rendered beneath it (RTL). */
  descriptionUr?: string;
  /** Ref / Cheque No shown in the centre column. */
  ref?: string;
  debit?: number;
  credit?: number;
}

export interface VoucherPrintData {
  kind: VoucherKind;
  voucherNo: string;
  /** ISO date (or date-time) string; formatted as `30-Sep-2026`. */
  voucherDate: string;
  /** e.g. "Cash", "Bank", "Cheque", "Cash / Bank". */
  paymentMode?: string;
  partyName: string;
  partyPhone?: string;
  partyAddress?: string;
  lines: VoucherPrintLine[];
  /** Total used for the amount-in-words line when `amountInWords` is absent. */
  amount?: number;
  /** Stored English amount in words (payment vouchers keep one). */
  amountInWords?: string;
  /** Narration / memo rendered in the Description box. */
  narration?: string;
  /** Shown under the "Prepared By" signature slot. */
  preparedBy?: string;
}

/** Sub-header per voucher type — spaced English letters + Urdu, per the ERP house style. */
const VOUCHER_TITLES: Record<VoucherKind, { en: string; ur: string }> = {
  RECEIPT: { en: "C A S H&nbsp;&nbsp;R E C E I P T&nbsp;&nbsp;V O U C H E R", ur: "رسید کیش وؤچر" },
  PAYMENT: { en: "P A Y M E N T&nbsp;&nbsp;V O U C H E R", ur: "ادائی وؤچر" },
  JOURNAL: { en: "J O U R N A L&nbsp;&nbsp;V O U C H E R", ur: "جرنل وؤچر" },
};

const PAYMENT_MODE_BY_TYPE: Record<PaymentVoucher["voucher_type"], string> = {
  CASH_PAYMENT: "Cash",
  BANK_PAYMENT: "Bank",
  SALARY_PAYMENT: "Bank",
  PARTY_PAYMENT: "Cash / Bank",
};

const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v: string | null | undefined) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

/** Normalises any stored/computed amount-in-words into the ERP house format: "Rupees … Only". */
function toWordsLine(amount: number, stored?: string | null): string {
  const raw = (stored && stored.trim()) || numberToWords(amount);
  const core = raw.replace(/^\s*Rupees\s+/i, "").replace(/\s+Only$/i, "").trim();
  return core ? `Rupees ${core} Only` : "Rupees Zero Only";
}

const acctLabel = (code?: string | null, name?: string | null): string => {
  const c = code?.trim();
  const n = name?.trim();
  if (c && n) return `${c} - ${n}`;
  return n || c || "—";
};

export function generateVoucherHTML(data: VoucherPrintData): string {
  const profile = loadCompanyProfile();
  const customized = (value: string | undefined, fallback: string) =>
    Boolean(value && value.trim() && value.trim() !== fallback);
  const docTitle = getExportDocumentTitle();
  const contactPhone = customized(profile.phone, DEFAULT_COMPANY.phone) ? profile.phone.trim() : REFERENCE_PHONE;
  const contactEmail = customized(profile.email, DEFAULT_COMPANY.email) ? profile.email.trim() : REFERENCE_EMAIL;
  const contactWebsite = profile.website?.trim() || "www.glasscosanitary.com";
  const footerBrand = COMPANY_LEGAL_NAME;
  const titleSize = Math.min(COMPANY_HEADER_FONT_SIZE_PX, 24);

  const title = VOUCHER_TITLES[data.kind];
  const totalDebit = r2(data.lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0));
  const totalCredit = r2(data.lines.reduce((sum, l) => sum + Number(l.credit ?? 0), 0));
  const wordsEn = toWordsLine(r2(data.amount ?? totalDebit), data.amountInWords);
  const wordsUr = numberToUrduWords(r2(data.amount ?? totalDebit));

  const th = (en: string, ur: string, cls = "") =>
    `<th${cls ? ` class="${cls}"` : ""}>${urUnder(en, ur)}</th>`;
  const metaRow = (label: string, labelUr: string, value: string) =>
    `<div class="kv"><span class="k">${label}${urSpan(labelUr, "margin-left:5px;")}</span><span class="v">${value}</span></div>`;

  const lineRows =
    data.lines.length > 0
      ? data.lines
          .map((ln, index) => {
            const ref = ln.ref?.trim();
            const debit = Number(ln.debit ?? 0);
            const credit = Number(ln.credit ?? 0);
            return `
      <tr>
        <td class="ctr mono ">${index + 1}</td>
        <td>
          <div class="acct color:#27292bff;font-weight:600">${esc(ln.accountHead)}</div>
          ${ln.description ? `<div class="desc color:#27292bff;font-weight:600">${esc(ln.description)}</div>` : ""}
          ${ln.descriptionUr ? `<div class="ur color:#27292bff;font-weight:600" lang="ur" dir="rtl">${esc(ln.descriptionUr)}</div>` : ""}
        </td>
        <td class="ctr mono">${ref ? esc(ref) : "&mdash;"}</td>
        <td class="num">${debit > 0 ? fmt(debit) : ""}</td>
        <td class="num">${credit > 0 ? fmt(credit) : ""}</td>
      </tr>`;
          })
          .join("")
      : `<tr><td class="empty" colspan="5">${urUnder("No ledger lines recorded for this voucher", UR.noLines)}</td></tr>`;

  const totalRow =
    data.lines.length > 0
      ? `<tr class="total-row">
        <td colspan="3">${urUnder("Total", UR.totalRow)}</td>
        <td class="num">${fmt(totalDebit)}</td>
        <td class="num">${fmt(totalCredit)}</td>
      </tr>`
      : "";

  return `
    <!DOCTYPE html>
    <html lang="en"><head><meta charset="utf-8">
    <title>${esc(data.voucherNo)}</title>
    <style>
      ${URDU_HTML_STYLES}
      @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap;}
      @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Bold.ttf') format('truetype');font-style:normal;font-weight:700;font-display:swap;}
      *{box-sizing:border-box;}
      html,body{margin:0;padding:0;background:#eef1f5;}
      body{font-family:${SERIF_FONT_FAMILY_CSS};color:#09090b;font-size:11px;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .ur,[lang="ur"]{font-family:'Amiri','Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;}
      .sheet{position:relative;width:210mm;min-height:297mm;margin:10px auto;background:#fff;padding:11mm 12mm 9mm;display:flex;flex-direction:column;box-shadow:0 6px 26px rgba(15,23,42,.18);}
      .head{text-align:center;}
      .brand-name{font-size:${titleSize}px;line-height:1.15;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#09090b;}
      .rule{border-top:1px solid #45484dff;margin:8px 0;}
      .subtitle{font-size:12.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#09090b;}
      .subtitle .ur{text-transform:none;letter-spacing:normal;font-size:11px;}
      .meta{display:flex;justify-content:space-between;gap:8mm;margin-top:6mm;page-break-inside:avoid;}
      .meta-l{flex:1 1 auto;min-width:0;}
      .party-head{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#09090b;border-bottom:1px solid #cbd5e1;padding-bottom:5px;margin-bottom:4px;}
      .party-head .ur{text-transform:none;letter-spacing:normal;font-size:10px;color:#09090b;}
      .meta-l .kv{padding:2px 0;}
      .meta-l .kv .v{font-family:${SERIF_FONT_FAMILY_CSS};font-weight:600;white-space:normal;text-align:right;color:#09090b;word-break:break-word;}
      .meta-l .kv .v.name{font-size:12px;font-weight:700;}
      .meta-r{flex:0 0 auto;min-width:80mm;}
      .kv{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:1.5px 0;font-size:10.5px;page-break-inside:avoid;}
      .kv .k{color:#09090b;white-space:nowrap;}
      .kv .v{font-weight:700;text-align:right;white-space:nowrap;font-family:'Courier New',monospace;color:#09090b;}
      table.items{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6mm;}
      table.items th,table.items td{border:1px solid #4170b3ff;padding:5px 6px;vertical-align:middle;}
      table.items thead th{background:#e8eef7;color:#09090b;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;text-align:left;}
      table.items thead th .ur{text-align:inherit;text-transform:none;letter-spacing:normal;font-weight:600;font-size:9px;}
      table.items tbody td{font-size:10.5px;}
      table.items .ctr{text-align:center;}
      table.items .num{text-align:right;white-space:nowrap;font-family:'Courier New',monospace;}
      .mono{font-family:'Courier New',monospace;}
      .acct{font-weight:600;color:#09090b;}
      .desc{font-size:9.5px;color:#09090b;margin-top:1px;}
      .empty{text-align:center;color:#09090b;padding:14px 6px;}
      tr{page-break-inside:avoid;}
      thead{display:table-header-group;}
      tr.total-row td{background:#EBF3FA;font-weight:700;color:#09090b;}
      .words{margin-top:5mm;background:#e8eef7;border:1px solid #43474bff;padding:7px 12px;page-break-inside:avoid;}
      .words-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#27292bff;}
      .words-head .ur{text-transform:none;letter-spacing:normal;font-size:10.5px;}
      .words-en{font-size:11.5px;font-weight:700;color:#0f172a;margin-top:4px;}
      .words .ur.words-ur{text-align:right;font-size:11.5px;margin-top:2px;color:#1e293b;}
      .narration{margin-top:4mm;border:1px solid #cbd5e1;padding:7px 12px;page-break-inside:avoid;}
      .nar-head{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475569;}
      .nar-head .ur{text-transform:none;letter-spacing:normal;font-size:10px;}
      .nar-body{margin-top:4px;font-size:11px;color:#1e293b;white-space:pre-wrap;}
      /* Page foot = signatures + footer as one atomic block: bottom-anchored via
         the flex auto-margin (dynamic spacing - it collapses so the block snaps
         right below the totals when the page can't pin it), never orphaned onto
         a fresh page while any room is left (break-before: avoid), never split
         mid-block (break-inside: avoid). */
      .page-foot{margin-top:auto;break-inside:avoid;page-break-inside:avoid;break-before:avoid;page-break-before:avoid;}
      .signatures{display:flex;padding-top:16px;border-top:1px solid #09090b;page-break-inside:avoid;}
      .sig{flex:1;text-align:center;font-size:10.5px;font-weight:700;color:#0f172a;padding:0 6px;}
      .sig .ur{text-align:center;font-weight:400;}
      .sig-name{margin-top:7px;font-size:10px;font-weight:400;color:#334155;border-top:1px dashed #94a3b8;display:inline-block;padding-top:3px;min-width:140px;}
      .footer{margin-top:12px;text-align:center;page-break-inside:avoid;}
      .footer .legal{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#334155;}
      .footer .contact-line{font-size:9.5px;color:#64748b;margin-top:2px;}
      @page{size:A4 portrait;margin:0;}
      @media print{
        html,body{background:#fff;}
        /* Reserve the REAL page area (100vh in print = paper minus @page
           margins), not a hard 297mm: on Letter or with dialog/printer margins
           a rigid 297mm sheet overflows the page and orphans the footer. */
        .sheet{margin:0;box-shadow:none;min-height:100vh;}
        *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
        a[href]:after{content:none!important;}
      }
    </style></head><body>
    <div class="sheet">
      <div class="head">
        <div class="brand-name">${esc(docTitle)}</div>
        <div class="rule"></div>
        <div class="subtitle">${title.en}&nbsp;&nbsp;/&nbsp;${urSpan(title.ur, "margin-left:4px;font-size:11px;letter-spacing:normal;")}</div>
      </div>

      <div class="meta">
        <div class="meta-l">
          <div class="party-head">PARTY DETAILS${urSpan("پارٹی کی تفصیلات", " color:#27292bff;font-size:11px;margin-left:6px;")}</div>
          <div class="kv"><span class="k">Account Title / Name</span><span class="v name">${esc(data.partyName) || "&mdash;"}</span></div>
          <div class="kv"><span class="k">Phone</span><span class="v">${esc(data.partyPhone) || "&mdash;"}</span></div>
          <div class="kv"><span class="k">Address</span><span class="v">${esc(data.partyAddress) || "&mdash;"}</span></div>
        </div>
        <div class="meta-r">
          ${metaRow("Voucher No", "نمبر وؤچر", esc(data.voucherNo))}
          ${metaRow("Date", UR.date, esc(fmtDate(data.voucherDate)))}
          ${metaRow("Payment Mode", "طریقہ ادائی", esc(data.paymentMode || "Cash / Bank"))}
          ${metaRow("Page", UR.pageOf, "1 of 1")}
        </div>
      </div>

      <table class="items">
        <colgroup>
          <col style="width:6%"><col style="width:44%"><col style="width:16%"><col style="width:17%"><col style="width:17%">
        </colgroup>
        <thead>
          <tr>
            ${th("Sr.#", UR.srNo, "ctr")}
            ${th("Account Head & Description", "تفصیل کھاتہ")}
            ${th("Ref / Cheque No", "ریفرنس نمبر", "ctr")}
            ${th("Debit (Rs.)", UR.debit, "num")}
            ${th("Credit (Rs.)", UR.credit, "num")}
          </tr>
        </thead>
        <tbody>${lineRows}${totalRow}</tbody>
      </table>

      <div class="words">
        <div class="words-head"><span>Amount in Words</span>${urSpan("لفظوں میں رقم")}</div>
        <div class="words-en">${esc(wordsEn)}</div>
        <div class="ur words-ur" lang="ur" dir="rtl">${esc(wordsUr)}</div>
      </div>

      <div class="narration">
        <div class="nar-head">Description / Particulars${urSpan(UR.narrationDescription, "margin-left:6px;")}</div>
        <div class="nar-body">${esc(data.narration) || "&mdash;"}</div>
      </div>

      <div class="page-foot">
        <div class="signatures">
          <div class="sig">${urUnder("Prepared By", UR.preparedBy)}${
            data.preparedBy ? `<div class="sig-name">${esc(data.preparedBy)}</div>` : ""
          }</div>
          <div class="sig">${urUnder("Receiver Signature", UR.receivedBy)}</div>
          <div class="sig">${urUnder("Authorised Signatory", UR.authorisedSignatory)}</div>
        </div>

        <div class="footer">
          <div class="legal">${esc(footerBrand)}</div>
          <div class="contact-line">${esc(contactEmail)} | ${esc(contactWebsite)} | ${esc(contactPhone)}</div>
        </div>
      </div>
    </div>
    </body></html>`;
}

/** Sends the voucher to the printer: Tauri native print first, hidden-iframe browser print as fallback. */
export async function printVoucher(data: VoucherPrintData): Promise<{ success: boolean; message: string }> {
  const html = generateVoucherHTML(data);

  const invoke =
    (typeof window !== "undefined" &&
      (window as {
        __TAURI__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>> };
      }).__TAURI__?.invoke) ??
    null;
  if (invoke) {
    try {
      const base64 = btoa(unescape(encodeURIComponent(html)));
      const result = await invoke("print_html_document", { html_base64: base64, printer_name: "default" });
      if (result?.success) return { success: true, message: "Print job sent to printer" };
    } catch {
      // fall through to browser print
    }
  }

  return new Promise((resolve) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:none;";
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (!doc) {
        document.body.removeChild(iframe);
        resolve({ success: false, message: "Could not open print frame" });
        return;
      }
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            // already removed
          }
          resolve({ success: true, message: "Print dialog opened" });
        }, 1000);
      }, 500);
    } catch (err) {
      resolve({ success: false, message: err instanceof Error ? err.message : "Print failed" });
    }
  });
}

/** Maps a stored payment voucher (CPV / BPV / PPV / SPV) onto the printable voucher shape. */
export function paymentVoucherPrintData(
  v: PaymentVoucher,
  opts: { preparedBy?: string } = {}
): VoucherPrintData {
  const debitHead = acctLabel(v.debit_account?.account_code, v.debit_account_name || v.debit_account?.account_name);
  const creditHead = acctLabel(v.credit_account?.account_code, v.credit_account_name || v.credit_account?.account_name);
  return {
    kind: "PAYMENT",
    voucherNo: v.voucher_no,
    voucherDate: v.voucher_date,
    paymentMode: PAYMENT_MODE_BY_TYPE[v.voucher_type] ?? "Cash / Bank",
    partyName: v.payee_name,
    partyAddress: v.payee_address ?? undefined,
    lines: [
      {
        accountHead: debitHead,
        description: v.purpose ?? undefined,
        descriptionUr: v.purpose_ur ?? undefined,
        debit: v.amount,
      },
      {
        accountHead: creditHead,
        ref: v.reference_no ?? undefined,
        credit: v.amount,
      },
    ],
    amount: v.amount,
    amountInWords: v.amount_in_words,
    narration: [v.purpose, v.remarks].filter(Boolean).join(" • "),
    preparedBy: opts.preparedBy ?? v.created_by ?? undefined,
  };
}

/** Maps a customer receipt voucher onto the printable voucher shape. */
export function receiptVoucherPrintData(
  v: CustomerReceiptVoucher,
  opts: { phone?: string; address?: string; preparedBy?: string } = {}
): VoucherPrintData {
  const modeLabel =
    v.payment_mode === "CASH"
      ? "Cash"
      : v.payment_mode === "CHEQUE"
        ? "Cheque"
        : v.payment_mode === "ONLINE"
          ? "Online"
          : "Bank";
  const allocations = (v.allocations ?? []).filter((a) => a.invoice_number?.trim());
  const allocText = allocations.length
    ? `Against ${allocations.map((a) => a.invoice_number).join(", ")}`
    : undefined;
  return {
    kind: "RECEIPT",
    voucherNo: v.voucher_no,
    voucherDate: v.receipt_date,
    paymentMode: modeLabel,
    partyName: v.customer_name,
    partyPhone: opts.phone,
    partyAddress: opts.address,
    lines: [
      { accountHead: "Cash / Bank", ref: v.reference_no ?? undefined, debit: v.amount },
      { accountHead: v.customer_name, description: allocText, credit: v.amount },
    ],
    amount: v.amount,
    narration: [v.remarks, allocText].filter(Boolean).join(" • "),
    preparedBy: opts.preparedBy,
  };
}

/** Maps a journal entry (narration + debit/credit lines) onto the printable voucher shape. */
export function journalVoucherPrintData(input: {
  voucherNo?: string;
  date: string;
  narration: string;
  partyName?: string;
  preparedBy?: string;
  lines: Array<{ accountHead: string; ref?: string; description?: string; debit?: number; credit?: number }>;
}): VoucherPrintData {
  const total = r2(input.lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0));
  return {
    kind: "JOURNAL",
    voucherNo: input.voucherNo?.trim() || "—",
    voucherDate: input.date,
    paymentMode: "—",
    partyName: input.partyName?.trim() || "—",
    lines: input.lines,
    amount: total,
    narration: input.narration,
    preparedBy: input.preparedBy,
  };
}
