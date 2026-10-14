"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { type SalesInvoice, type DispatchLineItem, postGSTPaintsInvoice, triggerPrint, generateInvoiceHTML, createDispatchRecord, dispatchItemsToInvoiceItems, resolveInvoiceItemBrands, fetchInvoiceById } from "@/lib/supabase/invoicing";
import { useOperatorStore } from "@/lib/store/useOperatorStore";
import { formatPKR } from "@/lib/utils/formatters";

interface Props {
  invoice: SalesInvoice | null;
  lineItems?: DispatchLineItem[];
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}

export default function PostPrintDrawer({ invoice, lineItems = [], open, onClose, onPosted }: Props) {
  const [posting, setPosting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [step, setStep] = useState<"idle" | "posting" | "posted" | "printing" | "print-done" | "error">("idle");
  const [printResult, setPrintResult] = useState("");
  // Holds the freshly-saved invoice after a successful post so retry/print and
  // PDF export render from the authoritative DB row, not stale pre-post state.
  const [postedInvoice, setPostedInvoice] = useState<SalesInvoice | null>(null);

  useEscapeToClose(open, handleClose);

  if (!invoice || !open) return null;

  // The invoice row itself carries no products; print with the line items handed to this drawer.
  // Prefer the freshly-posted record when available so reprints match what was saved.
  const baseInvoice = postedInvoice ?? invoice;
  const printableInvoice: SalesInvoice =
    baseInvoice.items && baseInvoice.items.length > 0
      ? baseInvoice
      : { ...baseInvoice, items: dispatchItemsToInvoiceItems(invoice.id, lineItems) };

  async function handlePostAndPrint() {
    if (!invoice) return;

    let operatorName: string;
    try {
      operatorName = await useOperatorStore.getState().open("Post GST Invoice & Print");
    } catch {
      return;
    }

    setPosting(true);
    setStep("posting");

    let rpcData: { invoice_number: string; total_payable: number } | null = null;
    try {
      const { data, error } = await postGSTPaintsInvoice({
        invoice_id: invoice.id,
        customer_id: invoice.customer_id,
        taxable_value_pkr: invoice.taxable_value_pkr,
        apply_further_tax: invoice.further_tax_amount_pkr > 0,
        operator_name: operatorName,
        device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
        line_items: [],
      });
      if (error || !data) {
        setStep("error");
        setPrintResult(error ?? "Failed to post invoice via RPC. Check connection and try again.");
        setPosting(false);
        return;
      }
      rpcData = data;
    } catch (err) {
      console.error("RPC call threw an exception:", err);
      setStep("error");
      setPrintResult(err instanceof Error ? err.message : "RPC call failed unexpectedly.");
      setPosting(false);
      return;
    }

    setStep("posted");
    setPosting(false);

    // Persist dispatch record. Prefer explicit line items; fall back to the
    // invoice's own items so products/customer survive on the dispatch row.
    const dispatchLineItems: DispatchLineItem[] =
      lineItems.length > 0
        ? lineItems
        : (invoice.items ?? []).map((i) => ({
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: i.quantity,
            unit_price_pkr: i.unit_price_pkr,
            line_total_pkr: i.line_total_pkr,
            unit_of_measure: i.unit_of_measure,
            discount_percent: i.discount_percent,
            discount_pkr: i.discount_pkr,
          }));
    const dispatchRecord = await createDispatchRecord({
      invoice_id: invoice.id,
      invoice_number: rpcData.invoice_number || invoice.invoice_number,
      customer_id: invoice.customer_id,
      customer_name: invoice.parties?.name ?? "",
      taxable_value_pkr: invoice.taxable_value_pkr,
      sales_tax_rate: invoice.sales_tax_rate,
      sales_tax_amount_pkr: invoice.sales_tax_amount_pkr,
      further_tax_rate: invoice.further_tax_rate,
      further_tax_amount_pkr: invoice.further_tax_amount_pkr,
      total_invoice_value_pkr: rpcData.total_payable,
      line_items: dispatchLineItems,
      operator_name: operatorName,
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
    });
    if (!dispatchRecord) {
      toast.warning(
        `Invoice ${rpcData.invoice_number || invoice.invoice_number} was posted, but its dispatch record could not be saved.`
      );
    }

    setPrinting(true);
    setStep("printing");

    // The RPC has already recalculated + persisted the final invoice row.
    // Re-fetch it from the database so the PDF is rendered from the
    // authoritative saved record (tax = 0 by default) rather than the stale
    // component state that was captured before posting. This removes the
    // "print twice to see correct values" bug.
    const fresh = await fetchInvoiceById(invoice.id);

    // Build a fully-enriched invoice for printing from the freshly-saved row.
    // Fall back to the pre-post invoice only if the refetch fails, and always
    // carry the RPC-confirmed total so the printed total matches the ledger.
    const postedInvoice: SalesInvoice = {
      ...(fresh ?? invoice),
      total_invoice_value_pkr: rpcData.total_payable,
      items:
        fresh && fresh.items && fresh.items.length > 0
          ? fresh.items
          : (invoice.items && invoice.items.length > 0
              ? invoice.items
              : dispatchItemsToInvoiceItems(invoice.id, lineItems)),
    };
    setPostedInvoice(postedInvoice);

    let printRes;
    try {
      printRes = await triggerPrint(postedInvoice);
    } catch (err) {
      console.error("Print call threw an exception:", err);
      setStep("error");
      setPrintResult("Print job failed unexpectedly. Check console for details.");
      setPrinting(false);
      return;
    }

    setPrinting(false);

    if (printRes.success) {
      setStep("print-done");
      setPrintResult(printRes.message);
      onPosted();
    } else {
      setStep("error");
      setPrintResult(printRes.message);
    }
  }

  async function handleRetryPrint() {
    if (!invoice) return;
    setPrinting(true);
    setStep("printing");

    let printRes;
    try {
      printRes = await triggerPrint(printableInvoice);
    } catch (err) {
      console.error("Retry print threw an exception:", err);
      setStep("error");
      setPrintResult("Print retry failed unexpectedly. Check console for details.");
      setPrinting(false);
      return;
    }

    setPrinting(false);

    if (printRes.success) {
      setStep("print-done");
      setPrintResult(printRes.message);
      onPosted();
    } else {
      setStep("error");
      setPrintResult(printRes.message);
    }
  }

  async function handlePDFExport() {
    if (!invoice) return;
    const itemBrands = await resolveInvoiceItemBrands(printableInvoice.items ?? []);
    const html = generateInvoiceHTML(printableInvoice, { itemBrands });
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

  function handleClose() {
    setStep("idle");
    setPrintResult("");
    setPostedInvoice(null);
    onClose();
  }

  return (
    <>
      {open && <div className="drawer-overlay" onClick={handleClose} />}

      <div className={`drawer-panel ${open ? "" : "closed"}`}>
        <div className="drawer-header">
          <div>
            <h2 className="text-h2 font-semibold">Post &amp; Print</h2>
            <p className="text-caption text-muted font-mono mt-0.5">{invoice.invoice_number}</p>
          </div>
          <button
            onClick={handleClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="drawer-body space-y-6">
          <div className="glass-card p-4 space-y-2">
            <div className="flex justify-between text-body">
              <span className="text-secondary">Customer</span>
              <span className="text-foreground font-medium">{invoice.parties?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-secondary">Taxable Value</span>
              <span className="font-mono text-num-table text-foreground">{formatPKR(invoice.taxable_value_pkr)}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-secondary">Sales Tax ({invoice.sales_tax_rate ?? 0}%)</span>
              <span className="font-mono text-num-table text-foreground">{formatPKR(invoice.sales_tax_amount_pkr)}</span>
            </div>
            {invoice.further_tax_amount_pkr > 0 && (
              <div className="flex justify-between text-body">
                <span className="text-secondary">Further Tax ({invoice.further_tax_rate ?? 0}%)</span>
                <span className="font-mono text-num-table text-status-amber">{formatPKR(invoice.further_tax_amount_pkr)}</span>
              </div>
            )}
            <div className="glow-line my-2" />
            <div className="flex justify-between text-body font-semibold">
              <span className="text-foreground">Total Invoice Value</span>
              <span className="font-mono text-num-kpi text-crimson-primary">{formatPKR(invoice.total_invoice_value_pkr)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <StepIndicator
              label="Operator Attribution"
              status={step === "idle" ? "pending" : step === "posting" ? "done" : step === "posted" || step === "printing" || step === "print-done" ? "done" : step === "error" ? "error" : "pending"}
            />
            <StepIndicator
              label="Post GST invoice via RPC"
              status={step === "idle" ? "pending" : step === "posting" ? "active" : step === "posted" || step === "printing" || step === "print-done" ? "done" : step === "error" && !posting ? "error" : "pending"}
            />
            <StepIndicator
              label="Print via Desktop Printer"
              status={
                step === "idle" || step === "posting" || step === "posted" ? "pending"
                  : step === "printing" ? "active"
                    : step === "print-done" ? "done"
                      : step === "error" ? "error" : "pending"
              }
            />
          </div>

          {step === "error" && (
            <div className="bg-status-alert/10 border border-status-alert/20 rounded-lg p-3 text-caption text-status-alert">
              <p className="font-medium mb-1">Action Required</p>
              <p className="text-secondary">{printResult}</p>
            </div>
          )}

          {step === "print-done" && (
            <div className="bg-status-optimal/10 border border-status-optimal/20 rounded-lg p-3 text-caption text-status-optimal">
              <p className="font-medium">Invoice posted, ledger entry created, and print job dispatched.</p>
            </div>
          )}

          <div className="flex gap-3">
            {step === "idle" && (
              <button
                onClick={handlePostAndPrint}
                disabled={posting}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                Post &amp; Print
              </button>
            )}
            {(step === "posted" || step === "print-done") && (
              <button
                onClick={handlePDFExport}
                className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted transition-colors"
              >
                Export PDF
              </button>
            )}
            {step === "error" && (
              <button
                onClick={handleRetryPrint}
                disabled={printing}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {printing ? "Printing..." : "Retry Print"}
              </button>
            )}
            <button
              onClick={handleClose}
              className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function StepIndicator({ label, status }: { label: string; status: "pending" | "active" | "done" | "error" }) {
  const styles = {
    pending: "bg-bg-muted border-border-default text-muted",
    active: "bg-crimson-primary/10 border-crimson-primary/30 text-crimson-light",
    done: "bg-status-optimal/10 border-status-optimal/30 text-status-optimal",
    error: "bg-status-alert/10 border-status-alert/30 text-status-alert",
  };
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-body ${styles[status]}`}>
      {status === "done" ? (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : status === "active" ? (
        <div className="h-4 w-4 rounded-full border-2 border-crimson-primary border-t-transparent animate-spin shrink-0" />
      ) : status === "error" ? (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      ) : (
        <div className="h-4 w-4 rounded-full border border-border-strong shrink-0" />
      )}
      {label}
    </div>
  );
}
