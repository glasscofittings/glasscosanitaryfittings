"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchPaymentVouchers,
  deletePaymentVoucher,
  type PaymentVoucher,
} from "@/lib/supabase/payment-vouchers";
import PaymentVoucherForm from "@/components/modules/payment-vouchers/PaymentVoucherForm";
import PaymentVoucherList from "@/components/modules/payment-vouchers/PaymentVoucherList";
import { formatPKR } from "@/lib/utils/formatters";
import { exportPaymentVouchersToPDF, exportPaymentVoucherPDF } from "@/lib/pdf-exporter";
import { paymentVoucherPrintData, printVoucher } from "@/lib/voucher-print";
import { useAuth } from "@/components/providers/AuthProvider";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

  type VoucherTab = "ALL" | "CASH_PAYMENT" | "PARTY_PAYMENT" | "BANK_PAYMENT" | "SALARY_PAYMENT";
  type FormVoucherType = "CASH_PAYMENT" | "PARTY_PAYMENT" | "BANK_PAYMENT";

export default function PaymentVouchersPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
  const [tab, setTab] = useState<VoucherTab>("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<FormVoucherType>("CASH_PAYMENT");
  const [isLive, setIsLive] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"list" | string | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editVoucher, setEditVoucher] = useState<PaymentVoucher | null>(null);

  // Voucher type selector — Mode A (payment, money out) vs Mode B (receipt, money in)
  const pathname = usePathname() || "";
  const modeTabs = [
    { href: "/payment-vouchers", label: "Payment (CPV · BPV · PPV)" },
    { href: "/invoicing/receipts", label: "Receipt (CRV · BRV)" },
  ];
  const activeModeHref =
    modeTabs.find((t) => pathname.replace(/\/+$/, "") === t.href)?.href ?? "";

  useEffect(() => {
    let cancelled = false;
    fetchPaymentVouchers().then((data) => {
      if (cancelled) return;
      setVouchers(data);
      if (data.length > 0) setIsLive(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEscapeToClose(!!deleteConfirm, () => setDeleteConfirm(null));

  const tabFiltered = tab === "ALL" ? vouchers : vouchers.filter((v) => v.voucher_type === tab);

  const searchLower = searchQuery.toLowerCase().trim();
  const filtered = searchLower
    ? tabFiltered.filter(
        (v) =>
          v.voucher_no.toLowerCase().includes(searchLower) ||
          v.payee_name.toLowerCase().includes(searchLower) ||
          (v.purpose ?? "").toLowerCase().includes(searchLower) ||
          (v.remarks ?? "").toLowerCase().includes(searchLower)
      )
    : tabFiltered;

  const totalAmount = filtered.reduce((sum, v) => sum + v.amount, 0);
  const cashTotal = vouchers.filter((v) => v.voucher_type === "CASH_PAYMENT").reduce((s, v) => s + v.amount, 0);
  const partyTotal = vouchers.filter((v) => v.voucher_type === "PARTY_PAYMENT").reduce((s, v) => s + v.amount, 0);
  const bankTotal = vouchers.filter((v) => v.voucher_type === "BANK_PAYMENT").reduce((s, v) => s + v.amount, 0);

  function handleOpenForm(type: FormVoucherType) {
    setFormType(type);
    setFormOpen(true);
  }

  const TAB_LABELS: Record<VoucherTab, string> = {
    ALL: "All vouchers",
    CASH_PAYMENT: "Cash payment vouchers",
    PARTY_PAYMENT: "Party payment vouchers",
    BANK_PAYMENT: "Bank payment vouchers",
    SALARY_PAYMENT: "Salary payment vouchers",
  };

  const operatorName = profile?.email || "Accounts Dept";

  async function handleExportList() {
    if (filtered.length === 0 || exporting) return;
    setExporting("list");
    try {
      await exportPaymentVouchersToPDF(filtered, { subtitle: TAB_LABELS[tab], operatorName });
    } finally {
      setExporting(null);
    }
  }

  async function handleExportVoucher(voucher: PaymentVoucher) {
    if (exporting) return;
    setExporting(voucher.id);
    try {
      await exportPaymentVoucherPDF(voucher, { operatorName });
    } finally {
      setExporting(null);
    }
  }

  async function handlePrintVoucher(voucher: PaymentVoucher) {
    if (printing) return;
    setPrinting(voucher.id);
    try {
      const result = await printVoucher(paymentVoucherPrintData(voucher, { preparedBy: operatorName }));
      if (!result.success) toast.error(result.message);
    } finally {
      setPrinting(null);
    }
  }

  async function handleDelete(id: string) {
    const ok = await deletePaymentVoucher(id);
    if (ok) {
      setVouchers((prev) => prev.filter((v) => v.id !== id));
      queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
      toast.success("Voucher deleted successfully");
    }
    setDeleteConfirm(null);
  }

  function handleEdit(voucher: PaymentVoucher) {
    setEditVoucher(voucher);
  }

  function handleUpdated(updated: PaymentVoucher) {
    setVouchers((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
    toast.success("Voucher updated successfully");
    setEditVoucher(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-tight">Payment Vouchers</h1>
          <p className="text-body text-secondary mt-1">
            Mode A — money outgoing (expenses · supplier payments): Dr expense/AP · Cr Cash (1000) / Bank (1002)&nbsp;·&nbsp;
            CPV · BPV · PPV · SPV &nbsp;—&nbsp; for customer receipts use the
            <a href="/invoicing/receipts" className="text-crimson-primary hover:underline ml-1">Receipts screen →</a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}
          <button
            onClick={handleExportList}
            disabled={filtered.length === 0 || exporting !== null}
            title={filtered.length === 0 ? "No vouchers to export" : "Export the voucher list as a bilingual (English / Urdu) PDF"}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden xs:inline">{exporting === "list" ? "Exporting..." : "Export PDF"}</span>
          </button>
          <button
            onClick={() => handleOpenForm("CASH_PAYMENT")}
            className="crimson-btn text-caption px-3 py-1.5"
          >
            + Cash
          </button>
          <button
            onClick={() => handleOpenForm("BANK_PAYMENT")}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-caption sm:text-body hover:bg-bg-muted transition-colors"
          >
            + Bank
          </button>
          <button
            onClick={() => handleOpenForm("PARTY_PAYMENT")}
            title="Party Payment Voucher — for SUPPLIER / VENDOR payments only. Use the Receipts screen for customer receipts."
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-caption sm:text-body hover:bg-bg-muted transition-colors"
          >
            + Supplier
          </button>
        </div>
      </div>

      {/* Voucher type selector — Mode A (payment, money out) ↔ Mode B (receipt, money in) */}
      <div className="flex gap-1 p-1 rounded-lg bg-bg-subtle border border-border-subtle w-fit no-scrollbar">
        {modeTabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-1 rounded text-caption font-medium transition-all ${
              activeModeHref === t.href
                ? "bg-crimson-primary text-white"
                : "text-secondary hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="glow-line" />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <p className="text-caption text-muted uppercase tracking-wider font-medium">Total Vouchers</p>
            <p className="font-mono font-bold mt-1 text-crimson-primary" style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }}>{vouchers.length}</p>
          </div>
          <span className="h-2.5 w-2.5 rounded-full bg-crimson-primary" />
        </div>
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-caption text-muted uppercase tracking-wider font-medium">Cash Payments</p>
            <p className="font-mono font-bold mt-1 text-status-optimal whitespace-nowrap overflow-hidden text-ellipsis" style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }} title={formatPKR(cashTotal)}>{formatPKR(cashTotal)}</p>
          </div>
          <span className="h-2.5 w-2.5 rounded-full bg-status-optimal shrink-0" />
        </div>
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-caption text-muted uppercase tracking-wider font-medium">Bank Payments</p>
            <p className="font-mono font-bold mt-1 text-status-amber whitespace-nowrap overflow-hidden text-ellipsis" style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }} title={formatPKR(bankTotal)}>{formatPKR(bankTotal)}</p>
          </div>
          <span className="h-2.5 w-2.5 rounded-full bg-status-amber shrink-0" />
        </div>
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-caption text-muted uppercase tracking-wider font-medium">Party Payments</p>
            <p className="font-mono font-bold mt-1 text-crimson-primary whitespace-nowrap overflow-hidden text-ellipsis" style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }} title={formatPKR(partyTotal)}>{formatPKR(partyTotal)}</p>
          </div>
          <span className="h-2.5 w-2.5 rounded-full bg-crimson-primary shrink-0" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-bg-subtle border border-border-subtle overflow-x-auto max-w-full no-scrollbar">
        {([["ALL", "All"], ["CASH_PAYMENT", "Cash (CPV)"], ["BANK_PAYMENT", "Bank (BPV)"], ["PARTY_PAYMENT", "Party (PPV)"], ["SALARY_PAYMENT", "Salary (SPV)"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1 rounded text-caption font-medium transition-all ${
              tab === key ? "bg-crimson-primary text-white" : "text-secondary hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 pl-10 pr-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
          placeholder="Search by voucher #, payee, or purpose..."
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {searchQuery && (
        <p className="text-caption text-muted">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
        </p>
      )}

      {/* Filtered Total */}
      {tab !== "ALL" && (
        <div className="flex items-center gap-2 text-caption text-muted">
          <span>Showing {filtered.length} vouchers</span>
          <span>•</span>
          <span className="font-mono font-medium text-foreground">{formatPKR(totalAmount)}</span>
        </div>
      )}

      {/* List */}
      <PaymentVoucherList
        vouchers={filtered}
        onDelete={(id) => setDeleteConfirm(id)}
        onEdit={handleEdit}
        onExport={handleExportVoucher}
        onPrint={handlePrintVoucher}
        exportingId={exporting}
        printingId={printing}
      />

      {/* Form Modal — Create */}
      <PaymentVoucherForm
        open={formOpen}
        voucherType={formType}
        onClose={() => setFormOpen(false)}
        onCreated={(v) => {
          setVouchers((prev) => [v, ...prev]);
          queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
        }}
      />

      {/* Form Modal — Edit */}
      <PaymentVoucherForm
        open={!!editVoucher}
        voucherType={
          editVoucher?.voucher_type === "PARTY_PAYMENT"
            ? "PARTY_PAYMENT"
            : editVoucher?.voucher_type === "BANK_PAYMENT"
              ? "BANK_PAYMENT"
              : "CASH_PAYMENT"
        }
        onClose={() => setEditVoucher(null)}
        editVoucher={editVoucher}
        onUpdated={handleUpdated}
      />

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-h2 font-semibold mb-2">Delete Voucher</h3>
              <p className="text-body text-secondary mb-4">
                Are you sure you want to delete this payment voucher? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="flex-1 h-9 rounded-lg bg-status-alert text-white font-medium text-body hover:bg-status-alert/80 transition-colors"
                >
                  Delete Voucher
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
