"use client";

import { type SalesInvoice, calcLineDiscountAmount, generateInvoiceHTML, postInvoiceWithLedger, resolveInvoiceItemBrands, findDispatchRecordByInvoice, approveDispatch } from "@/lib/supabase/invoicing";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useOperatorStore } from "@/lib/store/useOperatorStore";
import { toast } from "sonner";
import { translateBatchToUrdu } from "@/lib/geminiTranslator";
import { formatPKR } from "@/lib/utils/formatters";
import { loadCompanyProfile } from "@/lib/company-settings";
import { COMPANY_HEADER, COMPANY_LEGAL_NAME } from "@/lib/branding";

import { useState } from "react";

function LogoMark() {
  const [src] = useState(() => loadCompanyProfile().logo || null);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-10 w-10 object-contain shrink-0" />;
}

interface Props {
  invoice: SalesInvoice | null;
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}

export default function InvoicePreviewDrawer({ invoice, open, onClose, onPosted }: Props) {
  const [posting, setPosting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(open, onClose);

  if (!invoice || !open) return null;

  // Discounts can exist per line (sales_invoice_items) and/or at invoice level
  // (XD). The summary must show BOTH, mirroring the printed invoice.
  const lineDiscountsTotal = (invoice.items ?? []).reduce(
    (sum, item) => sum + calcLineDiscountAmount(item),
    0,
  );
  const totalDiscountShown =
    Math.round((lineDiscountsTotal + (invoice.discount_pkr ?? 0)) * 100) / 100;
  const subTotalShown = invoice.taxable_value_pkr + totalDiscountShown;

  async function handlePost() {
    if (!invoice || posting) return;
    setPosting(true);
    setError(null);
    try {
      const dispatch = await findDispatchRecordByInvoice(invoice.id);

      // Pending dispatch → approval is the ONLY way to post: it flips the
      // status, deducts stock, and debits the customer's ledger together.
      if (dispatch && (dispatch.status ?? "dispatched") === "pending_approval") {
        let operatorName: string;
        try {
          operatorName = await useOperatorStore.getState().open("Approve Dispatch");
        } catch {
          return; // operator cancelled attribution — nothing must happen
        }
        const result = await approveDispatch(
          dispatch.id,
          operatorName,
          process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
        );
        if (result.success) {
          toast.success(
            result.alreadyApproved
              ? `${invoice.invoice_number} was already approved.`
              : `Dispatch approved — stock deducted and customer ledger updated.`,
          );
          onPosted();
          onClose();
        } else {
          setError(result.error ?? "Approval failed. Please check stock and ledger accounts and try again.");
        }
        return;
      }

      // Invoices from before the approval workflow had their stock deducted at
      // creation (stock_deducted=true) — posting their ledger directly stays valid.
      if (invoice.stock_deducted) {
        const ok = await postInvoiceWithLedger(invoice);
        if (ok) {
          onPosted();
          onClose();
        } else {
          setError("Failed to post invoice. Please check ledger accounts and try again.");
        }
        return;
      }

      // New-flow invoice that has not been printed yet: printing creates its
      // pending dispatch, and approval posts everything. Posting straight from
      // here would put the ledger debit ahead of the approval step.
      setError(
        "This invoice is awaiting dispatch approval. Print it to create its dispatch entry, then approve it from Dispatch History.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error posting invoice");
    } finally {
      setPosting(false);
    }
  }

  async function handlePrint() {
    if (!invoice || printing) return;
    setPrinting(true);
    try {
      // Batch-translate item descriptions to Urdu before generating the document.
      // Falls back to the original English text when the Gemini key is missing or the call fails.
      const sourceNames = (invoice.items ?? []).map((item) => item.product_name);
      const translatedNames = await translateBatchToUrdu(sourceNames);
      const urduItemNames = sourceNames.map((source, index) => {
        const translated = translatedNames[index];
        return translated && translated !== source ? translated : undefined;
      });

      const itemBrands = await resolveInvoiceItemBrands(invoice.items ?? []);
      const html = generateInvoiceHTML(invoice, { urduItemNames, itemBrands });
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
    } finally {
      setPrinting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[90] w-full max-w-lg bg-[var(--drawer-bg)] border-l border-[var(--drawer-border)] backdrop-blur-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--glass-border)] shrink-0">
          <div>
            <h2 className="text-h2 font-semibold">Invoice Preview</h2>
            <p className="text-caption text-muted font-mono mt-0.5">{invoice.invoice_number}</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <LogoMark />
                <div>
                  <div className="text-lg font-bold text-crimson-primary">{COMPANY_HEADER}</div>
                  <div className="text-caption text-muted">Tax Invoice</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-body font-semibold">{invoice.invoice_number}</div>
                <div className="text-caption text-muted">
                  {new Date(invoice.created_at).toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "numeric" })}
                </div>
              </div>
            </div>

            <div className="glow-line" />

            <div>
              <p className="text-[10px] text-muted uppercase tracking-wider mb-1">Bill To</p>
              <p className="text-body font-medium">{invoice.parties?.name ?? "—"}</p>
              <p className="text-caption text-muted">
                {invoice.parties?.is_registered ? "Registered" : "Unregistered"} Buyer
              </p>
            </div>

            <div className="glass-card overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="px-4 py-2 text-[10px] text-muted uppercase tracking-wider">Item</th>
                    <th className="px-4 py-2 text-[10px] text-muted uppercase tracking-wider text-right">Qty</th>
                    <th className="px-4 py-2 text-[10px] text-muted uppercase tracking-wider text-right">Price</th>
                    <th className="px-4 py-2 text-[10px] text-muted uppercase tracking-wider text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items && invoice.items.length > 0 ? (
                    invoice.items.map((item) => (
                      <tr key={item.id} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-2 text-body text-foreground">{item.product_name}</td>
                        <td className="px-4 py-2 text-body text-secondary text-right font-mono whitespace-nowrap">
                          {item.quantity} {item.unit_of_measure}
                        </td>
                        <td className="px-4 py-2 text-body text-secondary text-right font-mono whitespace-nowrap">
                          {formatPKR(item.unit_price_pkr)}
                        </td>
                        <td className="px-4 py-2 text-body text-foreground text-right font-mono font-medium whitespace-nowrap">
                          {formatPKR(item.line_total_pkr)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-center text-caption text-muted">
                        No line items — values only
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="glass-card p-4 space-y-2">
              {totalDiscountShown > 0 && (
                <>
                  <div className="flex justify-between text-body">
                    <span className="text-secondary">Sub Total</span>
                    <span className="font-mono text-num-table text-foreground whitespace-nowrap">
                      {formatPKR(subTotalShown)}
                    </span>
                  </div>
                  <div className="flex justify-between text-body">
                    <span className="text-secondary">Discount (Line + XD)</span>
                    <span className="font-mono text-num-table text-status-amber whitespace-nowrap">− {formatPKR(totalDiscountShown)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-body">
                <span className="text-secondary">Taxable Value</span>
                <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(invoice.taxable_value_pkr)}</span>
              </div>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Sales Tax ({invoice.sales_tax_rate ?? 0}%)</span>
                <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(invoice.sales_tax_amount_pkr)}</span>
              </div>
              {invoice.further_tax_amount_pkr > 0 && (
                <div className="flex justify-between text-body">
                  <span className="text-secondary">Further Tax ({invoice.further_tax_rate ?? 0}%)</span>
                  <span className="font-mono text-num-table text-status-amber whitespace-nowrap">{formatPKR(invoice.further_tax_amount_pkr)}</span>
                </div>
              )}
              <div className="glow-line my-2" />
              <div className="flex justify-between text-body font-semibold">
                <span className="text-foreground">Grand Total</span>
                <span className="font-mono text-num-kpi text-crimson-primary whitespace-nowrap">{formatPKR(invoice.total_invoice_value_pkr)}</span>
              </div>
            </div>

            <div className="text-center text-[10px] text-muted">
              {invoice.is_posted ? (
                <span className="text-status-optimal">POSTED</span>
              ) : (
                <span className="text-status-amber">DRAFT — Not yet posted</span>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-status-error/15 border border-status-error/30 text-status-error text-caption">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-[var(--glass-border)] shrink-0">
          <div className="flex gap-3">
            {!invoice.is_posted && (
              <button
                onClick={handlePost}
                disabled={posting}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {posting ? "Posting..." : "Post Invoice"}
              </button>
            )}
            <button
              onClick={handlePrint}
              disabled={printing}
              className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:text-foreground hover:bg-bg-subtle disabled:opacity-60 disabled:cursor-wait transition-colors"
            >
              {printing ? "Translating..." : "Print / Save PDF"}
            </button>
            <button
              onClick={onClose}
              className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:text-foreground hover:bg-bg-subtle transition-colors"
            >
              Close
            </button>
          </div>
        </div>
        <div style={{ marginTop: 14, fontSize: 11, textAlign: "center", color: "#555" }}>{COMPANY_LEGAL_NAME}</div>
      </div>
    </>
  );
}
