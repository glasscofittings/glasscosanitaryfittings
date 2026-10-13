"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import {
  X,
  Printer,
  FileDown,
  Pencil,
  CheckCircle2,
  XCircle,
  Send,
  Ban,
  Clock,
  RotateCcw,
  Lock,
  FileSignature,
  ExternalLink,
} from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import { formatPKR } from "@/lib/utils/formatters";
import {
  type Quotation,
  type QuotationStatus,
  QUOTATION_TRANSITIONS,
  QUOTATION_STATUS_LABELS,
  effectiveQuotationStatus,
  isQuotationConverted,
  isQuotationEditable,
  canEditQuotation,
  canSetQuotationStatus,
  canConvertQuotation,
  canViewQuotationMargins,
  checkQuotationConvertible,
  setQuotationStatus,
  convertQuotationToInvoice,
} from "@/lib/supabase/quotations";
import {
  triggerQuotationPrint,
  QUOTATION_NOT_INVOICE_LABEL,
} from "@/lib/quotation-print";
import { exportQuotationPDF } from "@/lib/pdf-exporter";
import { useAuth } from "@/components/providers/AuthProvider";

interface QuotationDetailModalProps {
  isOpen: boolean;
  quotation: Quotation;
  onClose: () => void;
  onEdit: (quotation: Quotation) => void;
  /** Fired after any successful mutation so the page can reload the list. */
  onChanged: () => void;
}

const STATUS_STYLES: Record<QuotationStatus, string> = {
  DRAFT: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  ISSUED: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  ACCEPTED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  REJECTED: "bg-red-500/15 text-red-400 border-red-500/30",
  EXPIRED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  CANCELLED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const ACTION_ICONS: Record<QuotationStatus, React.ElementType> = {
  DRAFT: RotateCcw,
  ISSUED: Send,
  ACCEPTED: CheckCircle2,
  REJECTED: XCircle,
  EXPIRED: Clock,
  CANCELLED: Ban,
};

const fmtDate = (iso?: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[Number(m) - 1] ?? m} ${y}`;
};

export default function QuotationDetailModal({
  isOpen,
  quotation,
  onClose,
  onEdit,
  onChanged,
}: QuotationDetailModalProps) {
  const { profile } = useAuth();
  const role = profile?.role;
  const [busy, setBusy] = useState<string | null>(null);
  const [convertArmed, setConvertArmed] = useState(false);

  if (!isOpen) return null;

  const status = effectiveQuotationStatus(quotation);
  const converted = isQuotationConverted(quotation);
  const editable = !converted && isQuotationEditable(quotation.status);
  const showMargins = canViewQuotationMargins(role);
  const cost = Number(quotation.estimated_cost_pkr) || 0;
  const profit = Number(quotation.estimated_profit_pkr) || 0;
  const margin = Number(quotation.margin_percent) || 0;
  const markup = cost > 0 ? (profit / cost) * 100 : 0;

  const nextStatuses = (QUOTATION_TRANSITIONS[quotation.status] ?? []).filter((next) =>
    canSetQuotationStatus(role, next),
  );

  const convertCheck = checkQuotationConvertible(quotation, role);

  const handleStatus = async (next: QuotationStatus) => {
    setBusy(next);
    try {
      const result = await setQuotationStatus(quotation.id, next, {
        role,
        current: quotation,
        operator_name: profile?.email ?? "Terminal Operator",
        reason: "",
      });
      if (result.error || !result.quotation) {
        toast.error(result.error ?? "Status change failed.");
        return;
      }
      toast.success(
        `${quotation.quotation_number}: ${QUOTATION_STATUS_LABELS[next]} ✓`,
      );
      onChanged();
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = async () => {
    setBusy("print");
    try {
      const result = await triggerQuotationPrint(quotation);
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = async () => {
    setBusy("pdf");
    try {
      await exportQuotationPDF(quotation, { operatorName: profile?.email ?? undefined });
      toast.success("Quotation PDF generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF export failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleConvert = async () => {
    if (!convertArmed) {
      setConvertArmed(true);
      window.setTimeout(() => setConvertArmed(false), 4000);
      return;
    }
    setConvertArmed(false);
    setBusy("convert");
    try {
      const result = await convertQuotationToInvoice(quotation, {
        role,
        operator_name: profile?.email ?? "Accounts Dept",
      });
      if (result.error || !result.invoice) {
        toast.error(result.error ?? "Conversion failed.");
        return;
      }
      if (result.alreadyConverted) {
        toast.info(
          `Invoice ${result.invoice.invoice_number} already existed for this quotation — linked instead of creating a duplicate.`,
        );
      } else {
        toast.success(
          `Invoice ${result.invoice.invoice_number} created from ${quotation.quotation_number}. Post it from Dispatch / Sales when ready.`,
        );
      }
      if (result.linkWarning) {
        toast.warning(
          `Invoice created but the quotation link could not be saved: ${result.linkWarning} (it will heal on retry).`,
        );
      }
      onChanged();
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const renderStatusLabel = (s: QuotationStatus): React.ReactNode => {
    const Icon = ACTION_ICONS[s];
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[s]}`}
      >
        <Icon className="w-3 h-3" />
        {QUOTATION_STATUS_LABELS[s]}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-neutral-900/40">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-foreground">
                {quotation.quotation_number}
              </h2>
              {renderStatusLabel(status)}
              {converted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider bg-purple-500/15 text-purple-300 border-purple-500/30">
                  <FileSignature className="w-3 h-3" /> Converted
                </span>
              )}
            </div>
            <p className="text-[11px] font-bold text-amber-500 mt-1 tracking-wide">
              {QUOTATION_NOT_INVOICE_LABEL}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">Customer</div>
              <div className="font-semibold text-foreground">{quotation.customer_name}</div>
              {quotation.customer_phone && (
                <div className="text-xs text-muted">{quotation.customer_phone}</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">Date</div>
              <div className="font-mono text-foreground">{fmtDate(quotation.quotation_date)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">Valid Until</div>
              <div className="font-mono text-foreground">{fmtDate(quotation.valid_until)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">Created by</div>
              <div className="text-xs text-muted">{quotation.operator_name ?? "—"}</div>
            </div>
          </div>

          {/* Items */}
          <div className="overflow-x-auto border border-border-subtle rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-neutral-900/40 text-muted uppercase tracking-wider text-[10px]">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Disc%</th>
                  <th className="px-3 py-2 text-right">Tax%</th>
                  <th className="px-3 py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {(quotation.items ?? []).map((item, i) => (
                  <tr key={item.id ?? i} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-muted">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-foreground">{item.product_name}</div>
                      {item.product_code && (
                        <div className="text-[10px] font-mono text-muted">{item.product_code}</div>
                      )}
                      {item.description && (
                        <div className="text-[10px] text-muted">{item.description}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{item.quantity}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatPKR(item.unit_price_pkr)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {item.discount_percent ?? 0}
                      {(item.discount_pkr ?? 0) > 0 && (
                        <span className="text-[10px] text-muted">
                          {" "}
                          ({formatPKR(item.discount_pkr ?? 0)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{item.tax_rate ?? 0}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                      {formatPKR(item.line_total_pkr ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals + internal panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-slate-50 border border-border-subtle space-y-1.5 text-sm">
              {[
                ["Subtotal", quotation.subtotal_pkr],
                ...(Number(quotation.discount_pkr) > 0
                  ? [["Less: Discount", -Number(quotation.discount_pkr)] as [string, number]]
                  : []),
                ["Sales Tax", quotation.tax_amount_pkr],
                ...(Number(quotation.additional_charges_pkr) > 0
                  ? [["Additional Charges", Number(quotation.additional_charges_pkr)] as [string, number]]
                  : []),
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-gray-500">
                  <span>{label as string}</span>
                  <span className="font-mono">{formatPKR(value as number)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 mt-1 border-t border-border-subtle text-foreground font-bold">
                <span>Grand Total</span>
                <span className="font-mono">{formatPKR(quotation.grand_total_pkr)}</span>
              </div>
            </div>

            {showMargins && (
              <div className="p-4 rounded-lg border border-purple-500/30 bg-slate-50 space-y-1.5 text-sm">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  <Lock className="w-3 h-3" /> Internal — never printed
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Estimated cost</span>
                  <span className="font-mono">{formatPKR(cost)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Estimated profit</span>
                  <span className="font-mono">{formatPKR(profit)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Margin (profit / net sales)</span>
                  <span className="font-mono">{margin.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Markup (profit / cost)</span>
                  <span className="font-mono">{markup.toFixed(2)}%</span>
                </div>
                {quotation.internal_notes && (
                  <p className="text-[11px] text-gray-500 pt-1 border-t border-border-subtle whitespace-pre-wrap">
                    {quotation.internal_notes}
                  </p>
                )}
              </div>
            )}
          </div>

          {quotation.terms && (
            <div className="p-3 rounded-lg border border-border-subtle text-xs text-muted whitespace-pre-wrap">
              <span className="font-bold text-foreground block mb-1">Terms &amp; Conditions</span>
              {quotation.terms}
            </div>
          )}

          {converted && quotation.invoice && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-purple-500/30 bg-purple-500/5 text-xs text-purple-200">
              <ExternalLink className="w-4 h-4" />
              Converted to invoice{" "}
              <span className="font-mono font-bold">{quotation.invoice.invoice_number}</span>
              {quotation.invoice.is_posted
                ? " (posted to the sales ledger)."
                : " (not yet posted — posting happens in Dispatch / Sales)."}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-border-subtle">
            <button
              onClick={handlePrint}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-border-subtle text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button
              onClick={handlePdf}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-border-subtle text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
            >
              <FileDown className="w-3.5 h-3.5" /> Download PDF
            </button>

            {editable && canEditQuotation(role) && (
              <button
                onClick={() => onEdit(quotation)}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-border-subtle text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}

            <div className="flex-1" />

            {/* Status transitions */}
            {nextStatuses.map((next) => (
              <button
                key={next}
                onClick={() => handleStatus(next)}
                disabled={busy !== null}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                  next === "ACCEPTED"
                    ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                    : next === "CANCELLED" || next === "REJECTED"
                      ? "border-red-500/40 text-red-400 hover:bg-red-500/10"
                      : "border-border-subtle text-muted hover:text-foreground hover:bg-neutral-800/40"
                }`}
              >
                {React.createElement(ACTION_ICONS[next], { className: "w-3.5 h-3.5" })}
                {QUOTATION_STATUS_LABELS[next]}
                {busy === next && "…"}
              </button>
            ))}

            {/* Convert to invoice */}
            {!converted && canConvertQuotation(role) && (
              <CrimsonButton
                onClick={handleConvert}
                disabled={busy !== null || !convertCheck.ok}
                title={convertCheck.ok ? undefined : convertCheck.reason}
                className="min-w-[170px]"
              >
                {busy === "convert" ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Converting…
                  </span>
                ) : convertArmed ? (
                  "Confirm — create invoice?"
                ) : !convertCheck.ok ? (
                  "Cannot convert"
                ) : (
                  "Convert to Invoice"
                )}
              </CrimsonButton>
            )}
          </div>
          {!converted && !convertCheck.ok && canConvertQuotation(role) && (
            <p className="text-[11px] text-muted -mt-2">{convertCheck.reason}</p>
          )}
        </div>
      </div>
    </div>
  );
}
