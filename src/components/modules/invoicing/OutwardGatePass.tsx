"use client";

import { type SalesInvoice, generateInvoiceHTML, resolveInvoiceItemBrands } from "@/lib/supabase/invoicing";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { UR, URDU_HTML_STYLES, urUnder } from "@/lib/pdf-urdu";
import { getCompanyLogoHtml } from "@/lib/company-settings";
import { COMPANY_HEADER, COMPANY_HEADER_FONT_SIZE_PX, COMPANY_LEGAL_NAME, SERIF_FONT_FAMILY_CSS } from "@/lib/branding";

interface Props {
  invoice: SalesInvoice | null;
  open: boolean;
  onClose: () => void;
}

export default function OutwardGatePass({ invoice, open, onClose }: Props) {
  useEscapeToClose(open, onClose);

  if (!invoice || !open) return null;

  async function handlePrintInvoice() {
    const itemBrands = await resolveInvoiceItemBrands(invoice?.items ?? []);
    const html = generateInvoiceHTML(invoice!, { itemBrands });
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
      }, 500);
    } else {
      document.body.removeChild(iframe);
    }
  }

  function handlePrint() {
    const fmt = (n: number | null | undefined) =>
      (n ?? 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const salesTaxRate = invoice!.sales_tax_rate ?? 0;
    const furtherTaxRate = invoice!.further_tax_rate ?? 0;
    const furtherTaxAmt = invoice!.further_tax_amount_pkr ?? 0;

    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"><title>OGP - ${invoice!.invoice_number}</title>
      <style>
${URDU_HTML_STYLES}
        body{font-family:${SERIF_FONT_FAMILY_CSS};margin:0;padding:20px;color:#0f172a;}
        @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap;}
        @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Bold.ttf') format('truetype');font-style:normal;font-weight:700;font-display:swap;}
        .header{display:flex;justify-content:space-between;border-bottom:2px solid #dc2626;padding-bottom:12px;margin-bottom:16px;}
        .brand{font-size:${COMPANY_HEADER_FONT_SIZE_PX}px;font-weight:700;color:#dc2626;}
        .brand-block{display:flex;align-items:center;gap:10px;}
        .brand-block img{width:44px;height:44px;object-fit:contain;}
        .title{font-size:14px;font-weight:600;margin-top:4px;}
        .field{margin-bottom:12px;}
        .field label{font-size:10px;text-transform:uppercase;color:#94a3b8;display:block;margin-bottom:2px;}
        .field p{margin:0;font-size:13px;font-weight:500;}
        .items-table{width:100%;border-collapse:collapse;margin-top:12px;}
        .items-table th{background:#f8fafc;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #e5e7eb;}
        .items-table td{padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb;}
        .summary-table{width:320px;margin-left:auto;margin-top:16px;border-collapse:collapse;}
        .summary-table td{padding:4px 8px;font-size:12px;}
        .summary-table .total-row td{font-weight:700;font-size:14px;border-top:2px solid #dc2626;padding-top:8px;}
        .signatures{display:flex;justify-content:space-between;margin-top:40px;padding-top:12px;border-top:1px solid #e5e7eb;}
        .sig-box{width:30%;text-align:center;}
        .sig-box .line{border-top:1px solid #0f172a;margin-top:40px;padding-top:4px;font-size:10px;color:#64748b;}
      </style></head><body>
      <div class="header">
        <div class="brand-block">
          ${getCompanyLogoHtml({ width: 44, height: 44 })}
          <div>
            <div class="brand">${COMPANY_HEADER}</div>
            <div class="title">${urUnder("Outward Gate Pass & Tax Summary", UR.outwardGatePass)}</div>
          </div>
        </div>
        </div>
        <div style="text-align:right;font-size:12px;color:#64748b;">
          <div style="font-weight:600;color:#0f172a;">OGP-${invoice!.invoice_number}</div>
          <div>${urUnder(`Date: ${new Date().toLocaleDateString("en-PK")}`, UR.date)}</div>
          <div>${urUnder(`Time: ${new Date().toLocaleTimeString("en-PK")}`, UR.time)}</div>
        </div>
      </div>
      <div style="display:flex;gap:20px;">
        <div class="field" style="flex:1;"><label>${urUnder("Invoice Reference", UR.invoiceReference)}</label><p>${invoice!.invoice_number}</p></div>
        <div class="field" style="flex:1;"><label>${urUnder("Customer", UR.customer)}</label><p>${invoice!.parties?.name ?? "—"}</p></div>
      </div>

      <table class="items-table">
        <thead>
          <tr>
            <th>${urUnder("Product", UR.product)}</th>
            <th style="text-align:center;">${urUnder("Qty", UR.qty)}</th>
            <th style="text-align:right;">${urUnder("Unit Price", UR.unitPrice)}</th>
            <th style="text-align:right;">${urUnder("Line Total", UR.lineTotal)}</th>
          </tr>
        </thead>
        <tbody>
          ${(invoice!.items ?? []).map((item) => `
            <tr>
              <td>${item.product_name}</td>
              <td style="text-align:center;">${item.quantity} ${item.unit_of_measure}</td>
              <td style="text-align:right;">PKR ${fmt(item.unit_price_pkr)}</td>
              <td style="text-align:right;">PKR ${fmt(item.line_total_pkr)}</td>
            </tr>
          `).join("")}
          ${(invoice!.items ?? []).length === 0 ? `<tr><td colspan="4" style="text-align:center;color:#94a3b8;">${urUnder("No line items", UR.noLineItems)}</td></tr>` : ""}
        </tbody>
      </table>

      <table class="summary-table">
        <tr><td>${urUnder("Taxable Value", UR.taxableValue)}</td><td style="text-align:right;font-family:monospace;">PKR ${fmt(invoice!.taxable_value_pkr)}</td></tr>
        <tr><td>${urUnder(`Sales Tax (${salesTaxRate}%)`, UR.salesTax)}</td><td style="text-align:right;font-family:monospace;">PKR ${fmt(invoice!.sales_tax_amount_pkr)}</td></tr>
        ${furtherTaxAmt > 0 ? `<tr><td>${urUnder(`Further Tax (${furtherTaxRate}%)`, UR.furtherTax)}</td><td style="text-align:right;font-family:monospace;color:#d97706;">PKR ${fmt(furtherTaxAmt)}</td></tr>` : ""}
        <tr class="total-row"><td>${urUnder("Total Invoice Value", UR.totalInvoiceValue)}</td><td style="text-align:right;font-family:monospace;color:#dc2626;">PKR ${fmt(invoice!.total_invoice_value_pkr)}</td></tr>
      </table>

      <div class="signatures">
        <div class="sig-box"><div class="line">${urUnder("Store Keeper", UR.storeKeeper)}</div></div>
        <div class="sig-box"><div class="line">${urUnder("Driver / Transporter", UR.driverTransporter)}</div></div>
        <div class="sig-box"><div class="line">${urUnder("Security Guard", UR.securityGuard)}</div></div>
      </div>
      <div style="margin-top:14px;font-size:11px;text-align:center;color:#555;">${COMPANY_LEGAL_NAME}</div>
    </div>
    </body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
      }, 500);
    } else {
      document.body.removeChild(iframe);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg glass-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">Outward Gate Pass</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="glow-line mb-4" />

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-3">
              <p className="text-[10px] text-muted uppercase">Invoice</p>
              <p className="text-caption font-mono text-foreground">{invoice.invoice_number}</p>
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-muted uppercase">Date</p>
              <p className="text-caption text-foreground">{new Date().toLocaleDateString("en-PK")}</p>
            </div>
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-muted uppercase">Customer</p>
            <p className="text-body font-medium text-foreground">{invoice.parties?.name ?? "—"}</p>
          </div>

          <div className="glass-card p-3 space-y-1.5">
            <div className="flex justify-between text-body">
              <span className="text-secondary text-caption">Taxable Value</span>
              <span className="font-mono text-caption text-foreground">PKR {invoice.taxable_value_pkr?.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-secondary text-caption">Sales Tax ({invoice.sales_tax_rate ?? 0}%)</span>
              <span className="font-mono text-caption text-foreground">PKR {invoice.sales_tax_amount_pkr?.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</span>
            </div>
            {(invoice.further_tax_amount_pkr ?? 0) > 0 && (
              <div className="flex justify-between text-body">
                <span className="text-secondary text-caption">Further Tax ({invoice.further_tax_rate ?? 0}%)</span>
                <span className="font-mono text-caption text-status-amber">PKR {invoice.further_tax_amount_pkr?.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="border-t border-border-subtle pt-1 mt-1 flex justify-between">
              <span className="text-caption font-medium text-foreground">Total Invoice Value</span>
              <span className="text-num-kpi font-mono font-bold text-crimson-primary">PKR {invoice.total_invoice_value_pkr?.toLocaleString("en-PK", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="glass-card p-3">
            <p className="text-[10px] text-muted uppercase mb-1">Items</p>
            {(invoice.items ?? []).length === 0 ? (
              <p className="text-caption text-muted">No line items attached</p>
            ) : (
              <div className="space-y-1">
                {(invoice.items ?? []).map((item, i) => (
                  <div key={i} className="flex justify-between text-caption">
                    <span className="text-foreground">{item.product_name}</span>
                    <span className="font-mono text-muted">{item.quantity} {item.unit_of_measure}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={handlePrint} className="crimson-btn flex-1">
            Print OGP
          </button>
          <button onClick={handlePrintInvoice} className="h-9 px-4 rounded-lg bg-bg-muted text-foreground border border-border-default hover:bg-bg-subtle transition-colors text-body font-medium">
            Print Full Invoice
          </button>
          <button onClick={onClose} className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
