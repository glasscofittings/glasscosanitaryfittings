"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  fetchReceiptVouchers,
  fetchReceiptAccounts,
  fetchReceiptJournalAccounts,
  updateReceiptVoucher,
  deleteReceiptVoucher,
  computeARAging,
  type CustomerReceiptVoucher,
} from "@/lib/supabase/receipt-vouchers";
import { createReceiptVoucherAction } from "@/app/actions/receipt-voucher";
import { fetchCustomers, fetchInvoices, type Party, type SalesInvoice } from "@/lib/supabase/invoicing";
import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";
import {
  isLiquidFundsAccount,
  isReceiptCreditAllowed,
  isReceivableAccount,
  type ChartAccount,
} from "@/lib/ledger/voucher-rules";
import { formatPKR } from "@/lib/utils/formatters";
import { printVoucher, receiptVoucherPrintData } from "@/lib/voucher-print";
import {
  Receipt,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle,
  Search,
  Pencil,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { capitalizeFirst } from "@/lib/utils";

export default function CustomerReceiptsPage() {
  const [vouchers, setVouchers] = useState<CustomerReceiptVoucher[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"vouchers" | "aging">("vouchers");
  const [searchQuery, setSearchQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerReceiptVoucher | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CustomerReceiptVoucher | null>(null);
  const [busy, setBusy] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Form states
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [debitAccountId, setDebitAccountId] = useState("");
  const [creditAccountId, setCreditAccountId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [receiptAmount, setReceiptAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<"CASH" | "BANK_TRANSFER" | "CHEQUE" | "ONLINE">("BANK_TRANSFER");
  const [referenceNo, setReferenceNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Bumped on every modal open so a slow account prefill can never overwrite
  // the fields of a newer open (create or a different edit).
  const openSeq = useRef(0);

  // Voucher mode selector — Mode A (payment, money out) vs Mode B (receipt, money in)
  const pathname = usePathname() || "";
  const modeTabs = [
    { href: "/payment-vouchers", label: "Payment (CPV · BPV · PPV)" },
    { href: "/invoicing/receipts", label: "Receipt (CRV · BRV)" },
  ];
  const activeModeHref =
    modeTabs.find((t) => pathname.replace(/\/+$/, "") === t.href)?.href ?? "";

  function accountIdByCode(code: string): string {
    return accounts.find((a) => a.account_code === code)?.id ?? "";
  }

  /** Mode B debit default: CASH → 1000, everything else → 1002. */
  function defaultDebitForMode(mode: typeof paymentMode): string {
    return accountIdByCode(mode === "CASH" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [vData, cData, iData, aData] = await Promise.all([
        fetchReceiptVouchers(),
        fetchCustomers(),
        fetchInvoices(),
        fetchReceiptAccounts(),
      ]);
      setVouchers(vData);
      setCustomers(cData);
      setInvoices(iData);
      setAccounts(aData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchReceiptVouchers(), fetchCustomers(), fetchInvoices(), fetchReceiptAccounts()])
      .then(([vData, cData, iData, aData]) => {
        if (cancelled) return;
        setVouchers(vData);
        setCustomers(cData);
        setInvoices(iData);
        setAccounts(aData);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const agingBuckets = useMemo(() => computeARAging(invoices), [invoices]);

  const customerUnpaidInvoices = useMemo(() => {
    if (!selectedCustomerId) return [];
    return invoices.filter((i) => i.customer_id === selectedCustomerId && i.is_posted);
  }, [invoices, selectedCustomerId]);

  useEscapeToClose(modalOpen, closeModal);
  useEscapeToClose(!!deleteConfirm, () => setDeleteConfirm(null));

  function openCreate() {
    openSeq.current += 1;
    setEditing(null);
    setSelectedCustomerId("");
    setReceiptDate(new Date().toISOString().split("T")[0]);
    setReceiptAmount(0);
    setPaymentMode("BANK_TRANSFER");
    setDebitAccountId(accountIdByCode(ACCOUNT_CODES.BANK));
    setCreditAccountId(accountIdByCode(ACCOUNT_CODES.AR));
    setReferenceNo("");
    setRemarks("");
    setModalOpen(true);
  }

  function openEdit(v: CustomerReceiptVoucher) {
    openSeq.current += 1;
    const seq = openSeq.current;
    setEditing(v);
    setSelectedCustomerId(v.customer_id || "");
    setReceiptDate(v.receipt_date);
    setReceiptAmount(Number(v.amount));
    setPaymentMode(v.payment_mode);
    setReferenceNo(v.reference_no || "");
    setRemarks(v.remarks || "");
    // Prefill the Mode B dropdowns from the entry's current journal_lines.
    setDebitAccountId("");
    setCreditAccountId("");
    fetchReceiptJournalAccounts(v.voucher_no).then((acc) => {
      if (seq !== openSeq.current) return; // superseded by another open
      setDebitAccountId(
        acc.debitAccountId ?? defaultDebitForMode(v.payment_mode)
      );
      setCreditAccountId(acc.creditAccountId ?? accountIdByCode(ACCOUNT_CODES.AR));
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  async function handlePrint(v: CustomerReceiptVoucher) {
    if (printingId) return;
    setPrintingId(v.id);
    try {
      const customer = customers.find((c) => c.id === v.customer_id);
      const result = await printVoucher(
        receiptVoucherPrintData(v, { phone: customer?.phone, address: customer?.address })
      );
      if (!result.success) toast.error(result.message);
    } finally {
      setPrintingId(null);
    }
  }

  async function handleSubmitVoucher(e: React.FormEvent) {
    e.preventDefault();

    // Mode B posting rules (shared — voucher-rules.ts): Dr Cash/Bank, Cr party.
    const debitAcc = accounts.find((a) => a.id === debitAccountId);
    const creditAcc = accounts.find((a) => a.id === creditAccountId);
    if (!debitAcc || !isLiquidFundsAccount(debitAcc)) {
      toast.error("Pick the money-in account — Cash in Hand (1000) or Bank (1002).");
      return;
    }
    if (!creditAcc || !isReceiptCreditAllowed(creditAcc)) {
      toast.error(
        "Pick the party account to credit — 1100 Accounts Receivable, 1201 Trade Debts, or a customer advance."
      );
      return;
    }
    if (receiptAmount <= 0) {
      toast.error("Please enter a valid payment amount");
      return;
    }
    if (!selectedCustomerId) {
      // Party association is mandatory for receivable credits: the CREDIT line
      // carries party_id so the customer's balance reduces immediately.
      toast.error(
        isReceivableAccount(creditAcc)
          ? "Select the customer — crediting 1100/1201 requires a party_id so the customer's balance reduces."
          : "Please select a customer"
      );
      return;
    }

    setSubmitting(true);
    try {
      const customer = customers.find((c) => c.id === selectedCustomerId);
      const customerName = customer?.name || "Customer";

      if (editing) {
        const res = await updateReceiptVoucher(
          editing.id,
          {
            customer_id: selectedCustomerId,
            customer_name: customerName,
            receipt_date: receiptDate || editing.receipt_date,
            amount: receiptAmount,
            payment_mode: paymentMode,
            reference_no: referenceNo,
            remarks,
            debit_account_id: debitAccountId,
            credit_account_id: creditAccountId,
          },
          editing
        );
        if (res.data) {
          toast.success(`Receipt voucher ${editing.voucher_no} updated`);
          closeModal();
          loadData();
        } else {
          toast.error(res.error || "Failed to update receipt voucher");
        }
        return;
      }

      const allocations = customerUnpaidInvoices.length > 0 ? [
        {
          invoice_id: customerUnpaidInvoices[0].id,
          invoice_number: customerUnpaidInvoices[0].invoice_number,
          allocated_amount: receiptAmount,
        }
      ] : [];

      const res = await createReceiptVoucherAction({
        customer_id: selectedCustomerId,
        customer_name: customerName,
        receipt_date: receiptDate || new Date().toISOString().split("T")[0],
        amount: receiptAmount,
        payment_mode: paymentMode,
        reference_no: referenceNo,
        remarks,
        allocations,
        debit_account_id: debitAccountId,
        credit_account_id: creditAccountId,
      });

      if (res.success) {
        toast.success(`Receipt voucher ${res.voucher_no} posted successfully`);
        closeModal();
        loadData();
      } else {
        toast.error(res.error || "Failed to create receipt voucher");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setBusy(true);
    try {
      const res = await deleteReceiptVoucher(deleteConfirm.id, deleteConfirm.voucher_no);
      if (res.success) {
        toast.success(`Receipt voucher ${deleteConfirm.voucher_no} deleted`);
        setVouchers((prev) => prev.filter((v) => v.id !== deleteConfirm.id));
        setDeleteConfirm(null);
      } else {
        toast.error(res.error || "Failed to delete receipt voucher");
      }
    } finally {
      setBusy(false);
    }
  }

  const filteredVouchers = vouchers.filter((v) => {
    const q = searchQuery.toLowerCase();
    return (
      v.voucher_no.toLowerCase().includes(q) ||
      v.customer_name.toLowerCase().includes(q) ||
      (v.reference_no || "").toLowerCase().includes(q)
    );
  });

  const totalCollected = vouchers.reduce((sum, v) => sum + Number(v.amount), 0);
  const totalOutstanding = agingBuckets.reduce((sum, b) => sum + b.totalDue, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Receipt className="h-7 w-7 text-crimson-primary" />
            Customer Receipts (AR)
          </h1>
          <p className="text-body text-secondary mt-1">
            Mode B — money incoming: Dr Cash/Bank (1000/1002) · Cr party account (1100 / 1201)
            &nbsp;·&nbsp; CRV (cash) · BRV (bank)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            className="h-9 px-3 rounded-lg bg-bg-muted text-secondary hover:text-foreground border border-border-default transition-colors flex items-center gap-1.5 text-caption font-medium"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={openCreate}
            className="crimson-btn text-caption px-4 py-2 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Record Customer Payment
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card p-4 border border-border-default/60">
          <div className="flex items-center justify-between">
            <span className="text-caption text-secondary uppercase font-semibold tracking-wider">Total Collected</span>
            <CheckCircle className="h-4 w-4 text-status-optimal" />
          </div>
          <p className="mt-2 font-mono text-num-kpi text-status-optimal font-bold">{formatPKR(totalCollected)}</p>
          <p className="text-[11px] text-muted mt-1">{vouchers.length} posted vouchers</p>
        </div>

        <div className="glass-card p-4 border border-border-default/60">
          <div className="flex items-center justify-between">
            <span className="text-caption text-secondary uppercase font-semibold tracking-wider">Total AR Outstanding</span>
            <Clock className="h-4 w-4 text-status-amber" />
          </div>
          <p className="mt-2 font-mono text-num-kpi text-status-amber font-bold">{formatPKR(totalOutstanding)}</p>
          <p className="text-[11px] text-muted mt-1">Across {agingBuckets.length} buyers</p>
        </div>

        <div className="glass-card p-4 border border-border-default/60">
          <div className="flex items-center justify-between">
            <span className="text-caption text-secondary uppercase font-semibold tracking-wider">Over 90 Days Overdue</span>
            <Clock className="h-4 w-4 text-status-error" />
          </div>
          <p className="mt-2 font-mono text-num-kpi text-status-error font-bold">
            {formatPKR(agingBuckets.reduce((sum, b) => sum + b.over90, 0))}
          </p>
          <p className="text-[11px] text-muted mt-1">High risk aging</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab("vouchers")}
            className={`px-3 py-1.5 rounded-md text-caption font-medium transition-colors ${
              tab === "vouchers"
                ? "bg-crimson-primary/10 text-crimson-primary border border-crimson-primary/30"
                : "text-secondary hover:text-foreground"
            }`}
          >
            Receipt Vouchers ({vouchers.length})
          </button>
          <button
            onClick={() => setTab("aging")}
            className={`px-3 py-1.5 rounded-md text-caption font-medium transition-colors ${
              tab === "aging"
                ? "bg-crimson-primary/10 text-crimson-primary border border-crimson-primary/30"
                : "text-secondary hover:text-foreground"
            }`}
          >
            AR Aging Analysis
          </button>
        </div>

        {tab === "vouchers" && (
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
            <input
              type="text"
              placeholder="Search voucher, customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 text-caption bg-obsidian-bg border border-border-default rounded-md text-foreground focus:outline-none focus:border-crimson-primary"
            />
          </div>
        )}
      </div>

      {/* Content */}
      {tab === "vouchers" ? (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">Voucher #</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">Date</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">Customer</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">Payment Mode</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">Reference / Cheque</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right">Amount Received</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-center">Status</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVouchers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-caption text-muted">
                    No customer receipt vouchers recorded yet.
                  </td>
                </tr>
              ) : (
                filteredVouchers.map((v) => (
                  <tr key={v.id} className="border-b border-border-subtle hover:bg-bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-body font-semibold text-crimson-primary">{v.voucher_no}</td>
                    <td className="px-4 py-3 text-caption text-secondary">{v.receipt_date}</td>
                    <td className="px-4 py-3 text-body font-medium text-foreground">{v.customer_name}</td>
                    <td className="px-4 py-3 text-caption text-secondary">
                      <span className="px-2 py-0.5 rounded bg-bg-muted border border-border-subtle font-mono text-[11px]">
                        {v.payment_mode}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-caption text-muted">{v.reference_no || "—"}</td>
                    <td className="px-4 py-3 font-mono text-body font-bold text-right text-status-optimal">
                      {formatPKR(v.amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-status-optimal/15 text-status-optimal">
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handlePrint(v)}
                          title="Print voucher (English + Urdu)"
                          disabled={printingId !== null}
                          className="h-7 w-7 rounded-md bg-bg-muted border border-border-default text-secondary hover:text-foreground hover:border-crimson-primary/40 transition-colors flex items-center justify-center disabled:opacity-50"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(v)}
                          title="Edit voucher"
                          className="h-7 w-7 rounded-md bg-bg-muted border border-border-default text-secondary hover:text-foreground hover:border-crimson-primary/40 transition-colors flex items-center justify-center"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(v)}
                          title="Delete voucher"
                          className="h-7 w-7 rounded-md bg-bg-muted border border-border-default text-secondary hover:text-status-alert hover:border-status-alert/40 transition-colors flex items-center justify-center"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Aging Table */
        <div className="glass-card overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">Customer</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right">Current (0-30d)</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right">31-60 Days</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right">61-90 Days</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right">90+ Days</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right">Total Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {agingBuckets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-caption text-muted">
                    No outstanding accounts receivable found.
                  </td>
                </tr>
              ) : (
                agingBuckets.map((b) => (
                  <tr key={b.customerId} className="border-b border-border-subtle hover:bg-bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-body text-foreground">{b.customerName}</div>
                      <div className="text-[11px] text-muted">{b.invoiceCount} invoices</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-body text-right text-secondary">{formatPKR(b.current)}</td>
                    <td className="px-4 py-3 font-mono text-body text-right text-secondary">{formatPKR(b.days31_60)}</td>
                    <td className="px-4 py-3 font-mono text-body text-right text-status-amber">{formatPKR(b.days61_90)}</td>
                    <td className="px-4 py-3 font-mono text-body text-right text-status-error font-semibold">{formatPKR(b.over90)}</td>
                    <td className="px-4 py-3 font-mono text-body font-bold text-right text-foreground">{formatPKR(b.totalDue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Record / Edit Receipt Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-lg p-6 border border-border-default/80 space-y-4">
            <h2 className="text-h2 font-bold text-foreground flex items-center gap-2">
              <Receipt className="h-5 w-5 text-crimson-primary" />
              {editing ? `Edit ${editing.voucher_no}` : "Record Customer Payment (AR)"}
            </h2>
            <p className="text-caption text-secondary">
              {editing
                ? "Update receipt details — linked ledger entry stays in sync."
                : "Record funds collected from customer and auto-post double entry to the general ledger."}
            </p>

            <form onSubmit={handleSubmitVoucher} className="space-y-4">
              <div>
                <label className="block text-caption text-secondary mb-1">Customer</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary"
                  required
                >
                  <option value="">Select customer...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-caption text-secondary mb-1">Receipt Date</label>
                  <input
                    type="date"
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body font-mono focus:border-crimson-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-caption text-secondary mb-1">Payment Amount (PKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={receiptAmount || ""}
                    onChange={(e) => setReceiptAmount(parseFloat(e.target.value) || 0)}
                    className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body font-mono focus:border-crimson-primary"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-caption text-secondary mb-1">Payment Mode</label>
                <select
                  value={paymentMode}
                  onChange={(e) => {
                    const m = e.target.value as typeof paymentMode;
                    setPaymentMode(m);
                    // The debit (money-in) side follows the mode unless re-picked.
                    setDebitAccountId(defaultDebitForMode(m));
                  }}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary"
                >
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CASH">Cash in Hand</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="ONLINE">Online</option>
                </select>
              </div>

              {/* Mode B sides: Dr Cash/Bank (fixed list), Cr party account */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-caption text-secondary mb-1">
                    Debit — Money In *
                  </label>
                  <select
                    value={debitAccountId}
                    onChange={(e) => setDebitAccountId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary"
                    required
                  >
                    <option value="">— Select —</option>
                    {accounts
                      .filter((a) => isLiquidFundsAccount(a))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_code} — {a.account_name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-caption text-secondary mb-1">
                    Credit — Party Account *
                  </label>
                  <select
                    value={creditAccountId}
                    onChange={(e) => setCreditAccountId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary"
                    required
                  >
                    <option value="">— Select —</option>
                    {accounts
                      .filter((a) => isReceiptCreditAllowed(a))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_code} — {a.account_name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-muted -mt-2">
                Posts: Dr {debitAccountId ? accounts.find((a) => a.id === debitAccountId)?.account_name ?? "" : "Cash/Bank"} ·
                Cr {creditAccountId ? accounts.find((a) => a.id === creditAccountId)?.account_name ?? "" : "party account"} —
                the credit lands on the customer&apos;s ledger account with their party_id and reduces
                their balance immediately.
              </p>

              <div>
                <label className="block text-caption text-secondary mb-1">Reference / Cheque Number</label>
                <input
                  type="text"
                  placeholder="e.g. TXN-98421 or Cheque # 049182"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary"
                />
              </div>

              <div>
                <label className="block text-caption text-secondary mb-1">Remarks</label>
                <textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(capitalizeFirst(e.target.value))}
                  placeholder="Payment remarks or bank notes..."
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-lg bg-bg-muted text-secondary hover:text-foreground border border-border-default text-caption"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="crimson-btn px-4 py-2 text-caption font-semibold"
                >
                  {submitting
                    ? editing
                      ? "Updating..."
                      : "Posting..."
                    : editing
                      ? "Update Receipt Voucher"
                      : "Post Receipt Voucher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-h2 font-semibold mb-2">Delete Receipt Voucher</h3>
              <p className="text-body text-secondary mb-1">
                Delete <span className="font-mono font-semibold text-foreground">{deleteConfirm.voucher_no}</span>?
              </p>
              <p className="text-caption text-muted mb-4">
                This also removes its linked ledger entry. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex-1 h-9 rounded-lg bg-status-alert text-white font-medium text-body hover:bg-status-alert/80 transition-colors disabled:opacity-60"
                >
                  {busy ? "Deleting..." : "Delete Voucher"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
