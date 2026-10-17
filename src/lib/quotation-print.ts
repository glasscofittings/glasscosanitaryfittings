/**
 * Quotation printing — A4 HTML rendering + print trigger.
 *
 * The renderer works from an allow-listed projection of the quotation: internal
 * notes, estimated cost, profit and margin are dropped before anything is
 * turned into markup, so internal commercial data can never leak onto a
 * customer-facing document (tests assert this with canary values).
 */

import type { Quotation, QuotationItem } from "@/lib/supabase/quotations";
import { QUOTATION_STATUS_LABELS } from "@/lib/supabase/quotations";
import {
  DEFAULT_COMPANY,
  getExportDocumentTitle,
  loadCompanyProfile,
} from "@/lib/company-settings";
import {
  COMPANY_HEADER_FONT_SIZE_PX,
  COMPANY_LEGAL_NAME,
  SERIF_FONT_FAMILY_CSS,
} from "@/lib/branding";
import { URDU_HTML_STYLES, UR, urSpan, urUnder } from "@/lib/pdf-urdu";
import {
  REFERENCE_ADDRESS,
  REFERENCE_EMAIL,
  REFERENCE_PHONE,
} from "@/lib/supabase/invoicing";

export const QUOTATION_NOT_INVOICE_LABEL = "QUOTATION — NOT A FINAL INVOICE";

/** Customer-facing projection: no internal_notes / cost / profit / margin. */
export interface QuotationCustomerView {
  quotation_number: string;
  quotation_date: string;
  valid_until: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  status: string;
  subtotal_pkr: number;
  discount_pkr: number;
  tax_amount_pkr: number;
  additional_charges_pkr: number;
  grand_total_pkr: number;
  terms: string | null;
  notes: string | null;
  items: Array<{
    product_code: string | null;
    product_name: string;
    description: string | null;
    unit: string;
    quantity: number;
    unit_price_pkr: number;
    discount_percent: number;
    tax_rate: number;
    line_total_pkr: number;
  }>;
}

export function toCustomerView(q: Quotation): QuotationCustomerView {
  return {
    quotation_number: q.quotation_number,
    quotation_date: q.quotation_date,
    valid_until: q.valid_until ?? null,
    customer_name: q.customer_name,
    customer_phone: q.customer_phone ?? null,
    customer_address: q.customer_address ?? null,
    status: QUOTATION_STATUS_LABELS[q.status] ?? q.status,
    subtotal_pkr: Number(q.subtotal_pkr) || 0,
    discount_pkr: Number(q.discount_pkr) || 0,
    tax_amount_pkr: Number(q.tax_amount_pkr) || 0,
    additional_charges_pkr: Number(q.additional_charges_pkr) || 0,
    grand_total_pkr: Number(q.grand_total_pkr) || 0,
    terms: q.terms ?? null,
    notes: q.notes ?? null,
    items: (q.items ?? []).map((item: QuotationItem) => ({
      product_code: item.product_code ?? null,
      product_name: item.product_name,
      description: item.description ?? null,
      unit: item.unit || "PCS",
      quantity: Number(item.quantity) || 0,
      unit_price_pkr: Number(item.unit_price_pkr) || 0,
      discount_percent: Number(item.discount_percent) || 0,
      tax_rate: Number(item.tax_rate) || 0,
      line_total_pkr: Number(item.line_total_pkr) || 0,
    })),
  };
}

/** Parses YYYY-MM-DD without timezone shifts (no Date parsing). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const mi = Number(m) - 1;
  return `${d} ${months[mi] ?? m} ${y}`;
}

const esc = (v: string | null | undefined): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmt = (n: number): string =>
  (Number(n) || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Renders a professional A4 quotation mirroring the Sale Invoice design.
 */
export function generateQuotationHTML(quotation: Quotation): string {
  const q = toCustomerView(quotation);

  const profile = loadCompanyProfile();
  const customized = (value: string | undefined, fallback: string) =>
    Boolean(value && value.trim() && value.trim() !== fallback);
  const docTitle = getExportDocumentTitle();
  const contactPhone = customized(profile.phone, DEFAULT_COMPANY.phone)
    ? profile.phone.trim()
    : REFERENCE_PHONE;
  const contactTel = profile.telephone?.trim() || DEFAULT_COMPANY.telephone;
  const contactEmail = customized(profile.email, DEFAULT_COMPANY.email)
    ? profile.email.trim()
    : REFERENCE_EMAIL;
  const contactWebsite = profile.website?.trim() || "www.glasscosanitary.com";
  const socialFacebook = profile.facebook?.trim() || "";
  const socialInstagram = profile.instagram?.trim() || "";
  const socialWhatsapp = profile.whatsapp?.trim() || "";
  const socialParts = [
    socialFacebook ? `FB: ${esc(socialFacebook)}` : "",
    socialInstagram ? `IG: ${esc(socialInstagram)}` : "",
    socialWhatsapp ? `WhatsApp: ${esc(socialWhatsapp)}` : "",
  ].filter(Boolean);
  const footerBrand = COMPANY_LEGAL_NAME;

  const qtyFmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString("en-PK") : fmt(n);
  const titleSize = Math.min(COMPANY_HEADER_FONT_SIZE_PX, 30);
  const grossItems = q.items.length;

  const th = (en: string, ur: string, cls = "") =>
    `<th${cls ? ` class="${cls}"` : ""}>${urUnder(en, ur)}</th>`;
  const metaRow = (label: string, labelUr: string, value: string) =>
    `<div class="kv"><span class="k">${label}${urSpan(labelUr, "margin-left:5px;")}</span><span class="v">${value}</span></div>`;

  const itemRows =
    grossItems > 0
      ? q.items
          .map(
            (item, index) => `
      <tr>
        <td class="ctr mono">${index + 1}</td>
        <td>
          <div class="prod" dir="auto">${esc(item.product_name)}</div>
          ${item.description ? `<div class="desc">${esc(item.description)}</div>` : ""}
        </td>
        <td class="ctr mono">${esc(item.product_code || "—")}</td>
        <td class="ctr">${esc(item.unit || "PCS")}</td>
        <td class="ctr mono">${qtyFmt(item.quantity)}</td>
        <td class="num">${fmt(item.unit_price_pkr)}</td>
        <td class="num">${fmt(item.discount_percent)}</td>
        <td class="num">${fmt(item.line_total_pkr)}</td>
      </tr>`,
          )
          .join("")
      : `<tr><td class="empty" colspan="8">${urUnder("No line items recorded for this quotation", UR.noLineItemsRecorded)}</td></tr>`;

  const totalQty = q.items.reduce((sum, item) => sum + item.quantity, 0);
  const grossLinesTotal = q.items.reduce(
    (sum, item) => sum + (item.quantity * item.unit_price_pkr),
    0
  );
  const totalRow =
    grossItems > 0
      ? `<tr class="total-row">
        <td colspan="4">${urUnder("Total", UR.totalRow)}</td>
        <td class="ctr">${qtyFmt(totalQty)}</td>
        <td></td>
        <td></td>
        <td class="num">${fmt(grossLinesTotal || q.subtotal_pkr)}</td>
      </tr>`
      : "";

  const summaryRows = [
    ...(q.discount_pkr > 0
      ? [`<tr><td>${urUnder("Discount / Extra Discount (XD)", UR.discountXd)}</td><td class="amt">PKR ${fmt(q.discount_pkr)}</td></tr>`]
      : [`<tr><td>${urUnder("Discount / Extra Discount (XD)", UR.discountXd)}</td><td class="amt">PKR 0.00</td></tr>`]),
    `<tr><td>${urUnder("Sales Tax (GST)", UR.salesTax)}</td><td class="amt">PKR ${fmt(q.tax_amount_pkr)}</td></tr>`,
    ...(q.additional_charges_pkr > 0
      ? [
          `<tr><td>${urUnder("Additional Charges", UR.subTotal)}</td><td class="amt">PKR ${fmt(q.additional_charges_pkr)}</td></tr>`,
        ]
      : []),
  ].join("");

  const grandTotalRow = `<tr class="grand"><td><span class="grand-en">Total Amount</span>${urSpan("کل رقم (کوٹیشن)", "margin-left:8px;font-size:9.5pt;")}</td><td class="amt">PKR ${fmt(q.grand_total_pkr)}</td></tr>`;

  const addressRow = q.customer_address
    ? `<div class="cust-addr">${esc(q.customer_address)}</div>`
    : "";
  const contactParts = [q.customer_phone].filter(Boolean) as string[];
  const contactRow = contactParts.length
    ? `<div class="cust-contact">${contactParts.map((v) => esc(v)).join(" &bull; ")}</div>`
    : "";

  return `
    <!DOCTYPE html>
    <html lang="en"><head><meta charset="utf-8">
    <title>${esc(q.quotation_number)}</title>
    <style>
      ${URDU_HTML_STYLES}
      @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap;}
      @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Bold.ttf') format('truetype');font-style:normal;font-weight:700;font-display:swap;}
      *{box-sizing:border-box;}
      html,body{margin:0;padding:0;background:#eef1f5;}
      body{font-family:${SERIF_FONT_FAMILY_CSS};color:#09090b;font-size:11px;font-weight:600;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .ur,[lang="ur"]{font-family:'Amiri','Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;}
      .sheet{position:relative;width:210mm;min-height:297mm;margin:10px auto;background:#fff;padding:11mm 12mm 9mm;display:flex;flex-direction:column;box-shadow:0 6px 26px rgba(15,23,42,.18);}
      .head{text-align:center;}
      .brand-name{font-size:${titleSize}px;line-height:1.15;font-weight:900;letter-spacing:.03em;text-transform:uppercase;color:#09090b;}
      .rule{border-top:1px solid #1D5298;margin:8px 0;}
      .subtitle{display:block;background:#1D5298;color:#fff;font-size:13.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:3px;}
      .subtitle .ur{text-transform:none;letter-spacing:normal;font-size:11.5px;color:#fff;}
      .meta{display:flex;justify-content:space-between;gap:10mm;margin-top:6mm;page-break-inside:avoid;}
      .meta-l{flex:1 1 auto;min-width:0;}
      .to{font-size:10.5px;font-weight:700;color:#09090b;}
      .cust-name{font-size:12.5px;font-weight:700;color:#09090b;margin-top:3px;}
      .cust-addr{margin-top:2px;color:#18181b;}
      .cust-contact{margin-top:2px;color:#18181b;}
      .meta-r{flex:0 0 auto;min-width:78mm;}
      .kv{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:1.5px 0;font-size:10.5px;page-break-inside:avoid;}
      .kv .k{color:#18181b;white-space:nowrap;}
      .kv .v{font-weight:700;text-align:right;white-space:nowrap;font-family:'Courier New',monospace;color:#09090b;}
      table.items{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6mm;}
      table.items th,table.items td{border:2px solid #3c3f42ff;padding:5px 6px;vertical-align:middle;}
      table.items thead th{background:#1D5298;color:#fff;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;text-align:left;}
      table.items thead th .ur{text-align:inherit;text-transform:none;letter-spacing:normal;font-weight:600;font-size:9px;color:#fff;}
      table.items tbody td{font-size:10.5px;color:#09090b;}
      table.items .ctr{text-align:center;}
      table.items .num{text-align:right;white-space:nowrap;font-family:'Courier New',monospace;}
      .mono{font-family:'Courier New',monospace;}
      .prod{font-weight:700;color:#09090b;}
      .desc{font-size:9.5px;color:#52525b;}
      .empty{text-align:center;color:#09090b;padding:14px 6px;}
      tr{page-break-inside:avoid;}
      thead{display:table-header-group;}
      tr.total-row td{background:#EBF3FA;font-weight:700;color:#09090b;}
      .lower{display:flex;justify-content:flex-end;margin-top:5mm;}
      /* Summary Box */
      .summary-col{display:flex;flex-direction:column;gap:3px;width:38%;min-width:60mm;max-width:96mm;page-break-inside:avoid;}
      .summary{width:100%;border-collapse:collapse;page-break-inside:avoid;}
      .summary td{padding:4px 8px;font-size:9pt;}
      .summary td.amt{text-align:right;font-family:'Courier New',monospace;font-weight:700;white-space:nowrap;color:#09090b;}
      .summary tr.grand td{font-size:10pt;font-weight:700;padding-top:5px;padding-bottom:5px;color:#09090b;}
      .summary.grand-box{border:1px solid #1D5298;background:#EBF3FA;page-break-inside:avoid;}
      .summary.grand-box td{background:#EBF3FA;color:#1D5298;}
      .terms{margin-top:5mm;border:1px solid #d4d4d8;padding:6px 9px;page-break-inside:avoid;}
      .terms h4{margin:0 0 3px;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#18181b;}
      .terms p{margin:1px 0;font-size:9.5px;color:#27272a;white-space:pre-wrap;}
      .disclaimer-note{margin-top:4mm;text-align:center;font-size:9px;color:#71717a;font-style:italic;}
      .signatures{display:flex;justify-content:space-between;gap:30px;margin-top:auto;padding-top:16px;border-top:1px solid #0f172a;page-break-inside:avoid;}
      .sig{width:46%;text-align:center;font-size:10.5px;font-weight:700;color:#09090b;}
      .sig .ur{text-align:center;font-weight:600;}
      /* Footer */
      .footer{margin-top:12px;text-align:center;page-break-inside:avoid;}
      .footer .legal{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#18181b;}
      .footer .contact-line{font-size:9.5px;font-weight:600;color:#09090b;margin-top:2px;}
      .footer .social-line{margin-top:1px;}
      @page{size:A4 portrait;margin:0;}
      @media print{
        html,body{background:#fff;}
        .sheet{margin:0;box-shadow:none;}
        *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
        a[href]:after{content:none!important;}
      }
    </style></head><body>
    <div class="sheet">
      <div class="head">
        <div class="brand-name">${esc(docTitle)}</div>
        <div class="rule"></div>
        <div class="subtitle">Q U O T A T I O N&nbsp;&nbsp;/&nbsp;${urSpan(UR.quotation, "margin-left:4px;font-size:11.5px;letter-spacing:normal;")}</div>
      </div>

      <div class="meta">
        <div class="meta-l">
          <div class="to"><span>TO:</span>${urSpan("وصول کنندہ", "margin-left:6px;")}</div>
          <div class="cust-name">${esc(q.customer_name) || "&mdash;"}</div>
          ${addressRow}
          ${contactRow}
        </div>
        <div class="meta-r">
          ${metaRow("Mob", UR.phone, esc(contactPhone))}
          ${metaRow("Tel", UR.tel, esc(contactTel))}
          ${metaRow("QTN No", UR.quotationNo, esc(q.quotation_number))}
          ${metaRow("Date", UR.date, esc(formatDate(q.quotation_date)))}
          ${q.valid_until ? metaRow("Valid Until", UR.validUntil, esc(formatDate(q.valid_until))) : ""}
          ${metaRow("Page", UR.pageOf, "1 of 1")}
        </div>
      </div>

      <table class="items">
        <colgroup>
          <col style="width:6%">
          <col style="width:28%">
          <col style="width:11%">
          <col style="width:8%">
          <col style="width:8%">
          <col style="width:12%">
          <col style="width:11%">
          <col style="width:16%">
        </colgroup>
        <thead>
          <tr>
            ${th("SR. #", "نمبر", "ctr")}
            ${th("PRODUCT NAME", "پروڈکٹ کا نام")}
            ${th("CODE", "کوڈ", "ctr")}
            ${th("UNIT", "یونٹ", "ctr")}
            ${th("QTY", "مقدار", "ctr")}
            ${th("RATE", "قیمت", "num")}
            ${th("DISC. %", "ڈسکاؤنٹ %", "num")}
            ${th("TOTAL PRICE", "کل قیمت", "num")}
          </tr>
        </thead>
        <tbody>${itemRows}${totalRow}</tbody>
      </table>

      <div class="lower">
        <div class="summary-col">
          <table class="summary">
            ${summaryRows}
          </table>
          <table class="summary grand-box">
            ${grandTotalRow}
          </table>
        </div>
      </div>

      ${q.terms || q.notes ? `
      <div class="terms">
        ${q.terms ? `<h4>Terms &amp; Conditions</h4><p>${esc(q.terms)}</p>` : ""}
        ${q.notes ? `<h4>Notes</h4><p>${esc(q.notes)}</p>` : ""}
      </div>` : ""}

      <div class="disclaimer-note">* Note: This is a quotation proposal and does not constitute a final tax invoice or sale agreement.</div>

      <div class="signatures">
        <div class="sig">${urUnder("Received By (Customer)", "وصول کنندہ (گاہک)")}</div>
        <div class="sig">${urUnder("Authorised Signatory", "اختیار یافتہ دستخط کنندہ")}</div>
      </div>

      <div class="footer">
        <div class="legal">${esc(footerBrand)}</div>
        <div class="contact-line">${esc(contactEmail)} | ${esc(contactWebsite)} | ${esc(contactPhone)}</div>
        ${socialParts.length > 0 ? `<div class="contact-line social-line">${socialParts.join(" | ")}</div>` : ""}
      </div>
    </div>
    </body></html>`;
}

/**
 * Sends the quotation to the printer: Tauri native print when running as a
 * desktop app, otherwise a hidden browser print frame.
 */
export async function triggerQuotationPrint(
  quotation: Quotation,
): Promise<{ success: boolean; message: string }> {
  const html = generateQuotationHTML(quotation);

  const invoke =
    (typeof window !== "undefined" &&
      (
        window as unknown as {
          __TAURI__?: {
            invoke?: (
              cmd: string,
              args?: Record<string, unknown>,
            ) => Promise<Record<string, unknown>>;
          };
        }
      ).__TAURI__?.invoke) ??
    null;
  if (invoke) {
    try {
      const base64 = btoa(unescape(encodeURIComponent(html)));
      const result = await invoke("print_html_document", {
        html_base64: base64,
        printer_name: "default",
      });
      if (result?.success) return { success: true, message: "Print job sent to printer" };
    } catch {
      // fall through to browser print
    }
  }

  return new Promise((resolve) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:none;";
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
            /* already removed */
          }
          resolve({ success: true, message: "Print dialog opened" });
        }, 1000);
      }, 500);
    } catch (err) {
      resolve({
        success: false,
        message: err instanceof Error ? err.message : "Print failed",
      });
    }
  });
}
