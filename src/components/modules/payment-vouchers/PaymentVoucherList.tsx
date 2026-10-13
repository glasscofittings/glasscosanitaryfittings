"use client";

import { formatPKR } from "@/lib/utils/formatters";
import type { PaymentVoucher } from "@/lib/supabase/payment-vouchers";

interface Props {
  vouchers: PaymentVoucher[];
  onDelete: (id: string) => void;
  onEdit?: (voucher: PaymentVoucher) => void;
  onExport?: (voucher: PaymentVoucher) => void;
  onPrint?: (voucher: PaymentVoucher) => void;
  exportingId?: string | null;
  printingId?: string | null;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  CASH_PAYMENT: { label: "CPV", color: "bg-status-optimal/10 text-status-optimal border-status-optimal/20" },
  PARTY_PAYMENT: { label: "PPV", color: "bg-crimson-primary/10 text-crimson-primary border-crimson-primary/20" },
  BANK_PAYMENT: { label: "BPV", color: "bg-status-amber/10 text-status-amber border-status-amber/20" },
  SALARY_PAYMENT: { label: "SPV", color: "bg-status-amber/10 text-status-amber border-status-amber/20" },
};

export default function PaymentVoucherList({ vouchers, onDelete, onEdit, onExport, onPrint, exportingId = null, printingId = null }: Props) {
  if (vouchers.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-muted">
        No payment vouchers found. Create one to get started.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {vouchers.map((v) => {
        const typeInfo = TYPE_LABELS[v.voucher_type] ?? { label: "???", color: "" };
        return (
          <div
            key={v.id}
            className="glass-card p-4 flex items-center justify-between hover:bg-[var(--nav-hover-bg)] transition-colors"
          >
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <span className={`badge font-mono text-caption border ${typeInfo.color}`}>
                {typeInfo.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-body font-medium text-foreground">{v.voucher_no}</span>
                  <span className="text-caption text-muted">•</span>
                  <span className="text-caption text-muted">{v.voucher_date}</span>
                </div>
                <p className="text-caption text-secondary truncate mt-0.5">
                  {v.payee_name}
                  {v.payee_name_ur ? <span lang="ur" dir="rtl" className="ml-1.5 text-muted">({v.payee_name_ur})</span> : null}
                  {v.purpose ? ` — ${v.purpose}` : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-mono text-body font-semibold text-foreground">{formatPKR(v.amount)}</p>
                  {(v.debit_account || v.debit_account_name) && (
                    <p className="text-caption text-muted font-mono">
                      DR: {v.debit_account_name || v.debit_account?.account_code || ''}
                    </p>
                  )}
                  {(v.credit_account || v.credit_account_name) && (
                    <p className="text-caption text-muted font-mono">
                      CR: {v.credit_account_name || v.credit_account?.account_code || ''}
                    </p>
                  )}
                </div>
              {onPrint && (
                <button
                  onClick={() => onPrint(v)}
                  disabled={printingId !== null}
                  className="h-7 px-2 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  title="Print this voucher (English + Urdu)"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  {printingId === v.id ? "..." : "Print"}
                </button>
              )}
              {onExport && (
                <button
                  onClick={() => onExport(v)}
                  disabled={exportingId !== null}
                  className="h-7 px-2 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  title="Download this voucher as a bilingual PDF"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {exportingId === v.id ? "..." : "PDF"}
                </button>
              )}
              {onEdit && (
                <button
                  onClick={() => onEdit(v)}
                  className="h-7 px-2 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground transition-colors flex items-center gap-1"
                  title="Edit voucher"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => onDelete(v.id)}
                className="h-7 px-2 rounded-md bg-status-alert/10 text-status-alert border border-status-alert/20 text-caption font-medium hover:bg-status-alert/20 transition-colors flex items-center gap-1"
                title="Delete voucher"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
