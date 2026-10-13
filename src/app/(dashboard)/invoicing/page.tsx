"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { fetchCustomers, fetchInvoices, fetchDispatchRecords, attachDispatchLineItems, dispatchItemsToInvoiceItems, deleteInvoice, type Party, type SalesInvoice, type DispatchLineItem, type DispatchRecord } from "@/lib/supabase/invoicing";
import { fetchInvoicesWithDispatch, generateSlipInvoiceHTML, triggerSlipPrint, getInvoiceTaxLines, type DispatchInvoice } from "@/lib/supabase/catalog";
import { fetchPendingPurchaseInvoices } from "@/lib/supabase/purchase-invoices";
import InvoiceGenerator from "@/components/modules/invoicing/InvoiceGenerator";
import InvoicesTable from "@/components/modules/invoicing/InvoicesTable";
import PostPrintDrawer from "@/components/modules/invoicing/PostPrintDrawer";
import InvoicePreviewDrawer from "@/components/modules/invoicing/InvoicePreviewDrawer";
import OutwardGatePass from "@/components/modules/invoicing/OutwardGatePass";
import BackupModal from "@/components/modules/invoicing/BackupModal";
import EditInvoiceModal from "@/components/modules/invoicing/EditInvoiceModal";
import { runAutoBackupIfNeeded } from "@/lib/supabase/backup";
import { formatBytes } from "@/lib/backup-exporter";
import { formatPKR } from "@/lib/utils/formatters";
import { getExportCompanyName, loadCompanyProfile } from "@/lib/company-settings";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

export default function InvoicingPage() {
  const [customers, setCustomers] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [dispatchRecords, setDispatchRecords] = useState<DispatchRecord[]>([]);
  const [genOpen, setGenOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoice | null>(null);
  const [postDrawerOpen, setPostDrawerOpen] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<SalesInvoice | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ogpInvoice, setOgpInvoice] = useState<SalesInvoice | null>(null);
  const [ogpOpen, setOgpOpen] = useState(false);
  const [pendingLineItems, setPendingLineItems] = useState<DispatchLineItem[]>([]);
  const [backupOpen, setBackupOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [editInvoice, setEditInvoice] = useState<SalesInvoice | null>(null);
  const [dispatchInvoices, setDispatchInvoices] = useState<DispatchInvoice[]>([]);
  const [slipInvoice, setSlipInvoice] = useState<DispatchInvoice | null>(null);
  const [tab, setTab] = useState<"invoices" | "dispatch">("invoices");
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SalesInvoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  const query = searchQuery.trim().toLowerCase();

  const filteredInvoices = invoices.filter((inv) => {
    if (!query) return true;
    const invNumber = inv.invoice_number?.toLowerCase() ?? "";
    const customerName = (inv.parties?.name ?? "").toLowerCase();
    const status = (inv.is_posted ? "posted" : "draft").toLowerCase();
    return invNumber.includes(query) || customerName.includes(query) || status.includes(query);
  });

  const filteredDispatchInvoices = dispatchInvoices.filter((inv) => {
    if (!query) return true;
    const invNumber = inv.invoice_no?.toLowerCase() ?? "";
    const customerName = (inv.dispatch?.customer_name || inv.dispatch?.parties?.name || "").toLowerCase();
    const status = (inv.status === "PAID" ? "paid" : "invoiced").toLowerCase();
    return invNumber.includes(query) || customerName.includes(query) || status.includes(query);
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [c, inv, dispatch, dispInv, pendingInv] = await Promise.all([
        fetchCustomers(),
        fetchInvoices(),
        fetchDispatchRecords(),
        fetchInvoicesWithDispatch(),
        fetchPendingPurchaseInvoices(),
      ]);
      if (cancelled) return;
      if (c.length > 0) {
        setCustomers(c);
        setIsLive(true);
      }
      if (inv.length > 0) setInvoices(attachDispatchLineItems(inv, dispatch));
      if (dispatch.length > 0) setDispatchRecords(dispatch);
      if (dispInv.length > 0) setDispatchInvoices(dispInv);
      setPendingCount(pendingInv.length);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Auto-backup: download 24h backup once per day if enabled
  useEffect(() => {
    runAutoBackupIfNeeded().then((res) => {
      if (res.triggered) {
        console.log(
          res.result?.success
            ? `Auto-backup complete: ${res.result.recordCount} records (${formatBytes(res.result.byteSize)})`
            : "Auto-backup triggered but no records found"
        );
      }
    });
  }, []);

  useEscapeToClose(genOpen, () => setGenOpen(false));
  useEscapeToClose(!!deleteTarget, () => {
    if (!deleting) setDeleteTarget(null);
  });
  useEscapeToClose(!!slipInvoice, () => setSlipInvoice(null));

  const draftCount = invoices.filter((i) => !i.is_posted).length;
  const totalRevenue = invoices.filter((i) => i.is_posted).reduce((a, i) => a + i.total_invoice_value_pkr, 0);
  const totalTax = invoices.filter((i) => i.is_posted).reduce((a, i) => a + i.sales_tax_amount_pkr + i.further_tax_amount_pkr, 0);

  function handlePost(invoice: SalesInvoice, items?: DispatchLineItem[]) {
    setSelectedInvoice(invoice);
    setPendingLineItems(items ?? []);
    setPostDrawerOpen(true);
  }

  function handleView(invoice: SalesInvoice) {
    setPreviewInvoice(invoice);
    setPreviewOpen(true);
  }

  function handleEdit(invoice: SalesInvoice) {
    setEditInvoice(invoice);
  }

  function handleDelete(invoice: SalesInvoice) {
    setDeleteTarget(invoice);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    setDeleting(true);
    const res = await deleteInvoice({
      id: target.id,
      invoice_number: target.invoice_number,
      is_posted: target.is_posted,
      items: target.items,
    });
    setDeleting(false);
    if (!res.success) {
      toast.error(`Could not delete ${target.invoice_number}: ${res.error ?? "unknown error"}`);
      return;
    }
    setDeleteTarget(null);
    setInvoices((prev) => prev.filter((i) => i.id !== target.id));
    setDispatchRecords((prev) => prev.filter((r) => r.invoice_id !== target.id));
    setDispatchInvoices((prev) => prev.filter((di) => di.invoice_no !== target.invoice_number));
    handleRefresh();
    const notes = [
      res.ledgerRemoved ? "ledger entry removed" : null,
      res.stockRestored ? "stock returned to inventory" : null,
    ].filter(Boolean).join(", ");
    toast.success(notes ? `${target.invoice_number} deleted — ${notes}` : `${target.invoice_number} deleted`);
  }

  function handlePosted(invoice: SalesInvoice) {
    const items = invoice.items && invoice.items.length > 0
      ? invoice.items
      : dispatchItemsToInvoiceItems(invoice.id, pendingLineItems);
    setOgpInvoice({ ...invoice, items });
    setOgpOpen(true);
    handleRefresh();
  }

  function handleRefresh() {
    Promise.all([
      fetchInvoices(),
      fetchDispatchRecords(),
      fetchInvoicesWithDispatch(),
      fetchPendingPurchaseInvoices(),
    ]).then(([inv, dispatch, dispInv, pendingInv]) => {
      if (inv.length > 0) setInvoices(attachDispatchLineItems(inv, dispatch));
      if (dispatch.length > 0) setDispatchRecords(dispatch);
      if (dispInv.length > 0) setDispatchInvoices(dispInv);
      setPendingCount(pendingInv.length);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-tight">Invoicing</h1>
          <p className="text-body text-secondary mt-1">FBR GST Sales Invoicing</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}
          <button
            onClick={() => setBackupOpen(true)}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden xs:inline">Backup</span>
          </button>
          <button
            onClick={() => setGenOpen(true)}
            className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors"
          >
            + New Invoice
          </button>
        </div>
      </div>

      <div className="glow-line" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Invoices" value={invoices.length.toString()} accent="crimson" />
        <KPICard label="Draft" value={draftCount.toString()} accent="amber" />
        <KPICard label="Posted Revenue" value={formatPKR(totalRevenue)} accent="green" />
        <KPICard label="Total Tax Collected" value={formatPKR(totalTax)} accent="crimson" />
      </div>

      <div className="flex gap-1 bg-bg-muted rounded-lg p-1 overflow-x-auto">
        <button
          onClick={() => setTab("invoices")}
          className={`flex-1 h-8 rounded-md text-body font-medium transition-colors whitespace-nowrap px-3 ${
            tab === "invoices" ? "bg-bg-primary text-foreground shadow-sm" : "text-secondary hover:text-foreground"
          }`}
        >
          Sales Invoices
        </button>
        <button
          onClick={() => setTab("dispatch")}
          className={`flex-1 h-8 rounded-md text-body font-medium transition-colors whitespace-nowrap px-3 ${
            tab === "dispatch" ? "bg-bg-primary text-foreground shadow-sm" : "text-secondary hover:text-foreground"
          }`}
        >
          Dispatch Invoices ({dispatchInvoices.length})
        </button>
        <Link
          href="/invoicing/pending/"
          className="flex-1 h-8 rounded-md text-body font-medium transition-colors text-secondary hover:text-foreground flex items-center justify-center gap-1.5 whitespace-nowrap px-3"
        >
          <span>Pending Vendor Invoices</span>
          {pendingCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-status-amber/20 text-status-amber border border-status-amber/30">
              {pendingCount}
            </span>
          )}
        </Link>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 pl-10 pr-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
          placeholder="Search by invoice #, customer name, or status..."
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

      {tab === "invoices" && (
        <>
          {filteredInvoices.length === 0 && searchQuery ? (
            <div className="glass-card p-8 text-center text-body text-muted">
              No invoices found matching &quot;{searchQuery}&quot;
            </div>
          ) : (
            <InvoicesTable invoices={filteredInvoices} onPost={handlePost} onView={handleView} onEdit={handleEdit} onDelete={handleDelete} />
          )}
          <DispatchHistoryTable records={dispatchRecords} />
        </>
      )}

      {tab === "dispatch" && (
        filteredDispatchInvoices.length === 0 && searchQuery ? (
          <div className="glass-card p-8 text-center text-body text-muted">
            No dispatch invoices found matching &quot;{searchQuery}&quot;
          </div>
        ) : (
          <DispatchInvoicesTable invoices={filteredDispatchInvoices} onSlipClick={setSlipInvoice} />
        )
      )}

      {genOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setGenOpen(false)} />
          <div className="drawer-panel" style={{ zIndex: 80 }}>
            <div className="drawer-header">
              <h2 className="text-h2 font-semibold">New Tax Invoice</h2>
              <button
                onClick={() => setGenOpen(false)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="drawer-body">
              <InvoiceGenerator
                customers={customers}
                onCreated={handleRefresh}
                onPost={(inv, items) => { handleRefresh(); handlePost(inv, items); }}
                onClose={() => setGenOpen(false)}
                onCustomerCreated={(c) => { setCustomers((prev) => [...prev, c]); }}
              />
            </div>
          </div>
        </>
      )}

      <PostPrintDrawer
        invoice={selectedInvoice}
        lineItems={pendingLineItems}
        open={postDrawerOpen}
        onClose={() => { setPostDrawerOpen(false); setSelectedInvoice(null); setPendingLineItems([]); }}
        onPosted={() => { if (selectedInvoice) handlePosted(selectedInvoice); }}
      />

      <InvoicePreviewDrawer
        invoice={previewInvoice}
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewInvoice(null); }}
        onPosted={() => { handleRefresh(); setPreviewOpen(false); setPreviewInvoice(null); }}
      />

      <OutwardGatePass
        invoice={ogpInvoice}
        open={ogpOpen}
        onClose={() => { setOgpOpen(false); setOgpInvoice(null); }}
      />

      <BackupModal
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
      />

      {editInvoice && (
        <EditInvoiceModal
          invoice={editInvoice}
          customers={customers}
          open={!!editInvoice}
          onClose={() => setEditInvoice(null)}
          onSaved={handleRefresh}
        />
      )}

      {slipInvoice && (
        <SlipInvoiceModal
          invoice={slipInvoice}
          open={!!slipInvoice}
          onClose={() => setSlipInvoice(null)}
        />
      )}

      {deleteTarget && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={() => { if (!deleting) setDeleteTarget(null); }} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-border-subtle flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-h2 font-semibold text-status-alert">Delete invoice?</h2>
                  <p className="text-body text-secondary mt-1 font-mono">{deleteTarget.invoice_number}</p>
                </div>
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors disabled:opacity-50"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-5 space-y-3 text-body text-secondary">
                <p>
                  This permanently removes the invoice, its line items and any dispatch records
                  linked to it. It cannot be undone.
                </p>
                {deleteTarget.is_posted && (
                  <p className="text-status-amber bg-status-amber/10 border border-status-amber/20 rounded-lg px-3 py-2">
                    This invoice is <strong>posted</strong>. Its ledger entry
                    &ldquo;Sales invoice {deleteTarget.invoice_number} posted&rdquo; will also be
                    removed so the books stay balanced.
                  </p>
                )}
              </div>
              <div className="p-5 border-t border-border-subtle flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="h-9 px-4 rounded-lg bg-status-alert text-white font-medium text-body hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleting ? "Deleting..." : "Delete Invoice"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KPICard({ label, value, accent }: { label: string; value: string; accent: "crimson" | "green" | "amber" }) {
  const accentMap = {
    crimson: { dot: "bg-crimson-primary", text: "text-crimson-primary" },
    green: { dot: "bg-status-optimal", text: "text-status-optimal" },
    amber: { dot: "bg-status-amber", text: "text-status-amber" },
  };
  return (
    <div className="glass-card p-4 flex items-center justify-between">
      <div>
        <p className="text-caption text-muted uppercase tracking-wider font-medium">{label}</p>
        <p className={`font-bold mt-1 font-mono ${accentMap[accent].text}`} style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }}>{value}</p>
      </div>
      <span className={`h-2.5 w-2.5 rounded-full ${accentMap[accent].dot}`} />
    </div>
  );
}

function DispatchHistoryTable({ records }: { records: DispatchRecord[] }) {
  if (records.length === 0) return null;

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">Dispatch History</h2>
          <span className="badge">{records.length} dispatches</span>
        </div>
        <div className="glow-line mb-4" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[140px]">Invoice #</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[160px]">Customer</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[200px]">Products</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Taxable</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px] text-right">Tax</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Total</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[140px]">Dispatched</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px]">Operator</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const items = Array.isArray(rec.line_items) ? rec.line_items : [];
              const productNames = items.length > 0
                ? items.map((i: DispatchLineItem) => `${i.product_name} (${i.quantity})`).join(", ")
                : "—";
              return (
                <tr key={rec.id} className="border-b border-border-subtle hover:bg-bg-subtle transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-num-code text-secondary whitespace-nowrap">{rec.invoice_number}</span>
                  </td>
                  <td className="px-4 py-3 text-body text-foreground truncate">{rec.customer_name || rec.parties?.name || "—"}</td>
                  <td className="px-4 py-3 text-caption text-secondary truncate max-w-[200px]" title={productNames}>{productNames}</td>
                  <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">{formatPKR(rec.taxable_value_pkr)}</td>
                  <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">
                    {formatPKR(rec.sales_tax_amount_pkr + rec.further_tax_amount_pkr)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-num-kpi font-bold text-foreground whitespace-nowrap">{formatPKR(rec.total_invoice_value_pkr)}</td>
                  <td className="px-4 py-3 text-caption text-secondary whitespace-nowrap">
                    {new Date(rec.posted_at).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-caption text-secondary">{rec.operator_name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DispatchInvoicesTable({
  invoices,
  onSlipClick,
}: {
  invoices: DispatchInvoice[];
  onSlipClick: (inv: DispatchInvoice) => void;
}) {
  if (invoices.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <p className="text-body text-muted">No dispatch invoices yet. Dispatch a product from Inventory to generate invoices.</p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">Dispatch Invoices</h2>
          <span className="badge">{invoices.length} invoices</span>
        </div>
        <div className="glow-line mb-4" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[130px]">Invoice #</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[160px]">Customer</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[180px]">Product</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[80px] text-right">Qty</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Unit Price</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">Total</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px]">Status</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px]">Date</th>
              <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px] text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-border-subtle hover:bg-bg-subtle transition-colors">
                <td className="px-4 py-3">
                  <span className="font-mono text-num-code text-secondary whitespace-nowrap">{inv.invoice_no}</span>
                </td>
                <td className="px-4 py-3 text-body text-foreground truncate">
                  {inv.dispatch?.customer_name || inv.dispatch?.parties?.name || "—"}
                </td>
                <td className="px-4 py-3 text-caption text-secondary truncate">
                  {inv.product?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono text-num-table text-secondary">{inv.quantity_dispatched}</td>
                <td className="px-4 py-3 text-right font-mono text-num-table text-secondary whitespace-nowrap">{formatPKR(inv.unit_price)}</td>
                <td className="px-4 py-3 text-right font-mono text-num-kpi font-bold text-foreground whitespace-nowrap">{formatPKR(inv.total_amount)}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    inv.status === "PAID"
                      ? "bg-status-optimal/15 text-status-optimal"
                      : "bg-status-amber/15 text-status-amber"
                  }`}>
                    {inv.status === "PAID" ? "PAID" : "INVOICED"}
                  </span>
                </td>
                <td className="px-4 py-3 text-caption text-secondary whitespace-nowrap">
                  {inv.created_at ? new Date(inv.created_at).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => onSlipClick(inv)}
                    className="h-7 px-2.5 rounded-md bg-bg-muted text-secondary border border-border-default hover:text-foreground hover:bg-bg-subtle transition-colors inline-flex items-center gap-1 text-caption font-medium"
                    title="Generate Slip Invoice"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Slip
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlipInvoiceModal({
  invoice,
  open,
  onClose,
}: {
  invoice: DispatchInvoice;
  open: boolean;
  onClose: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState("");
  const [logoUrl] = useState(() => loadCompanyProfile().logo);

  if (!open || !invoice) return null;

  const product = invoice.product;
  const dispatch = invoice.dispatch;
  const customerName = dispatch?.customer_name ?? dispatch?.parties?.name ?? "—";
  const dispatchDate = dispatch?.dispatch_date ?? invoice.created_at?.slice(0, 10) ?? "—";
  const taxLines = getInvoiceTaxLines(invoice);

  async function handlePrint() {
    setPrinting(true);
    setPrintResult("");
    const res = await triggerSlipPrint(invoice);
    setPrinting(false);
    if (res.success) {
      setPrintResult("Print job sent successfully.");
    } else {
      setPrintResult(res.message);
    }
  }

  function handleBrowserPrint() {
    const html = generateSlipInvoiceHTML(invoice);
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
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-sm max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Slip Invoice</h2>
              <p className="text-caption text-muted mt-0.5 font-mono">{invoice.invoice_no}</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1">
            {/* Thermal slip preview */}
            <div className="bg-white text-black rounded-lg p-4 font-mono text-xs border border-border-subtle" style={{ maxWidth: "300px", margin: "0 auto" }}>
              <div className="text-center border-b border-dashed border-gray-400 pb-2 mb-2">
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-10 w-10 object-contain mx-auto mb-1" />
                )}
                <div className="text-sm font-bold tracking-wider">{getExportCompanyName()}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">SLIP INVOICE</div>
              </div>
              <div className="space-y-1 mb-2">
                <div className="flex justify-between"><span className="text-gray-500">Invoice No:</span><span className="font-bold">{invoice.invoice_no}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Date:</span><span>{dispatchDate}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Customer:</span><span>{customerName}</span></div>
              </div>
              <div className="border-t border-dashed border-gray-400 my-2" />
              <div className="space-y-1 mb-2">
                <div className="flex justify-between"><span className="text-gray-500">Product:</span><span className="font-bold">{product?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">SKU:</span><span>{product?.sku ?? "—"}</span></div>
              </div>
              <div className="border-t border-dashed border-gray-400 my-2" />
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Quantity:</span><span className="font-bold">{invoice.quantity_dispatched}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Unit Price:</span><span>PKR {invoice.unit_price.toLocaleString()}</span></div>
              </div>
              {taxLines.length > 0 && (
                <>
                  <div className="border-t border-dashed border-gray-400 my-2" />
                  <div className="space-y-1">
                    {taxLines.map((line) => (
                      <div key={line.label} className="flex justify-between">
                        <span className="text-gray-500">{line.label}:</span>
                        <span>PKR {line.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="border-t-2 border-black mt-2 pt-2 flex justify-between text-sm font-bold">
                <span>TOTAL</span>
                <span>PKR {invoice.total_amount.toLocaleString()}</span>
              </div>
              <div className="text-center border-t border-dashed border-gray-400 mt-3 pt-2 text-[9px] text-gray-400">
                Thank you for your business!
              </div>
            </div>
          </div>

          <div className="p-5 border-t border-border-subtle shrink-0 space-y-3">
            {printResult && (
              <p className={`text-caption px-3 py-2 rounded-lg ${printResult.includes("success") ? "text-status-optimal bg-status-optimal/10" : "text-status-alert bg-status-alert/10"}`}>
                {printResult}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handlePrint}
                disabled={printing}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {printing ? "Printing..." : "Print Thermal"}
              </button>
              <button
                onClick={handleBrowserPrint}
                className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted transition-colors"
              >
                Print / Save PDF
              </button>
              <button
                onClick={onClose}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
