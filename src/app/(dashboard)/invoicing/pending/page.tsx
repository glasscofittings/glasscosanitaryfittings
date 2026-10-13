"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Search,
  RefreshCw,
  Shield,
} from "lucide-react";
import {
  verifyThreeWayMatch,
  type MatchingResult,
} from "@/lib/matching/verifier";
import { approveAndPostPurchaseInvoice } from "@/lib/supabase/purchase-invoices";
import { useAuth } from "@/components/providers/AuthProvider";
import { formatPKR } from "@/lib/utils/formatters";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

// ── Types ────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  invoice_number: string;
  grn_id: string | null;
  grn_number: string;
  grn_accepted_qty: number | null;
  grn_unit_price: number | null;
  vendor_id: string | null;
  vendor_name: string;
  taxable_amount: number;
  tax_amount: number;
  total_payable: number;
  status: string;
  items: Array<{
    description?: string;
    lot_code?: string;
    quantity: number;
    unit_of_measure?: string;
    unit_price?: number;
    total_amount?: number;
  }>;
  created_at: string;
  // PO data (if linked)
  po_id: string | null;
  po_number: string | null;
  po_total_amount: number | null;
  // Match result (computed client-side)
  matchResult?: MatchingResult;
}

type UserRole = "gate_keeper" | "qc_inspector" | "ap_accountant" | "plant_manager" | "admin";

// ── Helpers ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function restHeaders(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

function getUserRole(profile: { role?: string } | null): UserRole {
  const role = profile?.role ?? "";
  if (role === "OWNER") return "admin";
  if (role === "TERMINAL") return "ap_accountant";
  return "ap_accountant";
}

function canApprove(role: UserRole, match?: MatchingResult): boolean {
  if (!match) return role === "ap_accountant" || role === "plant_manager" || role === "admin";
  if (!match.isMatch) return role === "plant_manager" || role === "admin";
  return role === "ap_accountant" || role === "plant_manager" || role === "admin";
}

// ── Approve Confirm Modal ────────────────────────────────────────────────────

function ApproveConfirmModal({
  invoice,
  busy,
  onConfirm,
  onCancel,
}: {
  invoice: InvoiceRow;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        style={{ zIndex: 200 }}
        onClick={() => !busy && onCancel()}
      />
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 201 }}>
        <div className="glass-card p-6 w-full max-w-md pointer-events-auto shadow-2xl border border-status-optimal/20">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-status-optimal/10 border border-status-optimal/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-status-optimal" />
            </div>
            <div>
              <h3 className="text-h3 font-semibold text-foreground">Approve &amp; Post to Ledger</h3>
              <p className="text-body text-secondary mt-1">
                This will post a double-entry journal for{" "}
                <span className="font-mono font-semibold text-foreground">{invoice.invoice_number}</span>:
              </p>
            </div>
          </div>

          <div className="bg-bg-muted border border-border-default rounded-lg p-4 mb-4 space-y-2">
            <div className="flex justify-between text-body">
              <span className="text-muted">Vendor</span>
              <span className="font-medium text-foreground">{invoice.vendor_name || "—"}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-muted">GRN Reference</span>
              <span className="font-mono text-secondary">{invoice.grn_number || "—"}</span>
            </div>
            <div className="flex justify-between text-body">
              <span className="text-muted">Total Payable</span>
              <span className="font-mono font-bold text-foreground">{formatPKR(invoice.total_payable)}</span>
            </div>
            <div className="glow-line" />
            <div className="flex justify-between text-caption text-muted">
              <span>DEBIT → 1101 Raw Material / Inventory</span>
              <span className="font-mono">{formatPKR(invoice.total_payable)}</span>
            </div>
            <div className="flex justify-between text-caption text-muted">
              <span>CREDIT → 2001 Accounts Payable</span>
              <span className="font-mono">{formatPKR(invoice.total_payable)}</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={onCancel}
              disabled={busy}
              className="h-9 px-4 rounded-lg text-body font-medium bg-bg-muted text-secondary border border-border-default hover:bg-bg-subtle hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="h-9 px-5 rounded-lg text-body font-medium bg-status-optimal text-white hover:opacity-90 disabled:opacity-50 transition-opacity inline-flex items-center gap-2"
            >
              {busy && <RefreshCw className="h-4 w-4 animate-spin" />}
              {busy ? "Posting…" : "Approve & Post"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PendingInvoicesPage() {
  const { profile } = useAuth();
  const userRole = getUserRole(profile);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [dismissConfirmId, setDismissConfirmId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<InvoiceRow | null>(null);

  // ── Data Fetching ────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      // Fetch purchase_invoices with GRN data
      const invRes = await fetch(
        `${SUPABASE_URL}/rest/v1/purchase_invoices?status=eq.pending_approval&select=*&order=created_at.desc`,
        { headers: restHeaders() }
      );

      if (!invRes.ok) {
        console.error("Failed to fetch pending invoices", invRes.status);
        setInvoices([]);
        return;
      }

      const invData = await invRes.json();
      if (!Array.isArray(invData) || invData.length === 0) {
        setInvoices([]);
        return;
      }

      // Fetch GRN data for variance calculation
      const grnIds = invData
        .map((inv: { grn_id: string | null }) => inv.grn_id)
        .filter(Boolean);

      const grnMap = new Map<string, { accepted_qty: number; unit_price_pkr: number }>();
      if (grnIds.length > 0) {
        const grnRes = await fetch(
          `${SUPABASE_URL}/rest/v1/goods_receipt_notes?select=id,accepted_qty,unit_price_pkr&id=in.(${grnIds.join(",")})`,
          { headers: restHeaders() }
        );
        if (grnRes.ok) {
          const grnData = await grnRes.json();
          if (Array.isArray(grnData)) {
            for (const g of grnData) {
              grnMap.set(g.id, {
                accepted_qty: Number(g.accepted_qty) || 0,
                unit_price_pkr: Number(g.unit_price_pkr) || 0,
              });
            }
          }
        }
      }

      // Fetch PO data for invoices that have a po_id
      const poIds = invData
        .map((inv: { po_id: string | null }) => inv.po_id)
        .filter(Boolean);

      const poMap = new Map<string, { total_amount_pkr: number; po_number: string }>();
      if (poIds.length > 0) {
        const poRes = await fetch(
          `${SUPABASE_URL}/rest/v1/purchase_orders?select=id,po_number,total_amount_pkr&id=in.(${poIds.join(",")})`,
          { headers: restHeaders() }
        );
        if (poRes.ok) {
          const poData = await poRes.json();
          if (Array.isArray(poData)) {
            for (const p of poData) {
              poMap.set(p.id, {
                total_amount_pkr: Number(p.total_amount_pkr) || 0,
                po_number: p.po_number as string,
              });
            }
          }
        }
      }

      // Enrich with GRN + PO data and compute 3-way match
      const enriched: InvoiceRow[] = invData.map((inv: Record<string, unknown>) => {
        const grn = grnMap.get(inv.grn_id as string);
        const po = poMap.get(inv.po_id as string);

        // Bug #3 fix: sum ALL line item quantities (not just first)
        const invoiceQty = Array.isArray(inv.items)
          ? (inv.items as Array<Record<string, unknown>>).reduce(
              (sum, item) => sum + (Number(item.quantity) || 0),
              0
            )
          : 0;

        // Bug #1 fix: use actual unit_price from line items (not taxable_amount / qty)
        const invoiceUnitPrice =
          Array.isArray(inv.items) && inv.items.length > 0
            ? Number((inv.items as Array<Record<string, unknown>>)[0]?.unit_price) || 0
            : 0;

        // Bug #2 fix: 3-way match uses PO as baseline, not GRN vs itself
        let matchResult: MatchingResult | undefined;
        if (grn && po) {
          // Derive PO unit price from PO total and GRN qty (PO may not store per-unit)
          const poUnitPrice =
            grn.accepted_qty > 0
              ? Math.round((po.total_amount_pkr / grn.accepted_qty) * 100) / 100
              : po.total_amount_pkr;
          matchResult = verifyThreeWayMatch({
            poUnitPrice: poUnitPrice,
            poQty: grn.accepted_qty,
            grnUnitPrice: grn.unit_price_pkr,
            grnAcceptedQty: grn.accepted_qty,
            invoiceUnitPrice: invoiceUnitPrice,
            invoiceQty: invoiceQty || grn.accepted_qty,
          });
        } else if (grn) {
          // Fallback: GRN vs invoice only (no PO linked)
          matchResult = verifyThreeWayMatch({
            poUnitPrice: grn.unit_price_pkr,
            poQty: grn.accepted_qty,
            grnUnitPrice: grn.unit_price_pkr,
            grnAcceptedQty: grn.accepted_qty,
            invoiceUnitPrice: invoiceUnitPrice,
            invoiceQty: invoiceQty || grn.accepted_qty,
          });
        }

        return {
          id: inv.id as string,
          invoice_number: (inv.invoice_number as string) || "",
          grn_id: (inv.grn_id as string) || null,
          grn_number: (inv.grn_number as string) || "",
          grn_accepted_qty: grn?.accepted_qty ?? null,
          grn_unit_price: grn?.unit_price_pkr ?? null,
          vendor_id: (inv.vendor_id as string) || null,
          vendor_name: (inv.vendor_name as string) || "",
          taxable_amount: Number(inv.taxable_amount) || 0,
          tax_amount: Number(inv.tax_amount) || 0,
          total_payable: Number(inv.total_payable) || 0,
          status: (inv.status as string) || "pending_approval",
          items: Array.isArray(inv.items)
            ? (inv.items as Array<Record<string, unknown>>).map((i) => ({
                description: (i.description as string) || "",
                lot_code: (i.lot_code as string) || "",
                quantity: Number(i.quantity) || 0,
                unit_of_measure: (i.unit_of_measure as string) || "KG",
                unit_price: Number(i.unit_price) || 0,
                total_amount: Number(i.total_amount) || 0,
              }))
            : [],
          created_at: (inv.created_at as string) || "",
          po_id: (inv.po_id as string) || null,
          po_number: po?.po_number ?? null,
          po_total_amount: po?.total_amount_pkr ?? null,
          matchResult,
        };
      });

      setInvoices(enriched);
    } catch (err) {
      console.error("Error loading pending invoices:", err);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadData();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadData]);

  // ── Search ───────────────────────────────────────────────────────────────

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const grn = (inv.grn_number || "").toLowerCase();
      const vendor = (inv.vendor_name || "").toLowerCase();
      const invNo = (inv.invoice_number || "").toLowerCase();
      const itemsStr = (inv.items || [])
        .map((i) => i.description || "")
        .join(" ")
        .toLowerCase();
      return grn.includes(q) || vendor.includes(q) || invNo.includes(q) || itemsStr.includes(q);
    });
  }, [invoices, searchQuery]);

  useEscapeToClose(!!approveTarget, () => {
    if (!processingId) setApproveTarget(null);
  });

  // ── Approve & Post Handler ───────────────────────────────────────────────
  // Uses the canonical approve_and_post_purchase_invoice RPC (SECURITY DEFINER)
  // with a journal_entries fallback — the same proven path the Payables page uses.
  // Posts DR 1101 / CR 2001, marks the invoice posted, marks the GRN invoiced,
  // and writes the audit log — all in one call.

  async function handleApproveAndPost(inv: InvoiceRow) {
    if (!canApprove(userRole, inv.matchResult)) {
      toast.error("You do not have permission to approve this invoice. Manager or admin role required.");
      setApproveTarget(null);
      return;
    }

    setProcessingId(inv.id);
    try {
      const result = await approveAndPostPurchaseInvoice({
        invoice_id: inv.id,
        operator_name: profile?.email ?? "AP Accountant",
      });

      if (!result.success) {
        toast.error(result.error || "Failed to approve & post invoice");
        return;
      }

      toast.success(
        `${inv.invoice_number} posted — DR 1101 / CR 2001, ${formatPKR(inv.total_payable)}`
      );
      setInvoices((prev) => prev.filter((item) => item.id !== inv.id));
      setApproveTarget(null);
    } catch (err) {
      console.error("Error approving invoice:", err);
      toast.error(err instanceof Error ? err.message : "Failed to approve & post invoice");
    } finally {
      setProcessingId(null);
      setApproveTarget(null);
    }
  }

  // ── Dismiss Handler ──────────────────────────────────────────────────────

  async function handleDismiss(invId: string) {
    setProcessingId(invId);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/purchase_invoices?id=eq.${invId}`,
        { method: "DELETE", headers: restHeaders() }
      );
      if (res.ok) {
        toast.success("Invoice dismissed. No financial entries recorded.");
        setInvoices((prev) => prev.filter((item) => item.id !== invId));
      } else {
        toast.error("Failed to dismiss invoice");
      }
    } catch (err) {
      console.error("Error dismissing invoice:", err);
      toast.error(err instanceof Error ? err.message : "Failed to dismiss invoice");
    } finally {
      setProcessingId(null);
      setDismissConfirmId(null);
    }
  }

  // ── Derived State ────────────────────────────────────────────────────────

  const totalPendingAmount = filteredInvoices.reduce(
    (sum, i) => sum + (Number(i.total_payable) || 0),
    0
  );

  const blockedCount = filteredInvoices.filter(
    (i) => i.matchResult && !i.matchResult.isMatch
  ).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-caption">
            <Link
              href="/invoicing/"
              className="text-muted hover:text-foreground transition-colors"
            >
              ← Invoicing
            </Link>
            <span className="text-muted">/</span>
            <span className="text-secondary font-medium">Pending Invoices</span>
          </div>
          <h1 className="text-display font-bold tracking-tight mt-1">
            Pending Vendor Invoices
          </h1>
          <p className="text-body text-secondary mt-1">
            3-Way Match queue — approve to post double-entry to Accounts Payable
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-caption text-secondary capitalize">
            <Shield className="h-3.5 w-3.5" />
            {userRole.replace("_", " ")}
          </span>
          <button
            onClick={() => {
              setLoading(true);
              void loadData();
            }}
            disabled={loading}
            className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle hover:text-foreground transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="glow-line" />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <p className="text-caption text-muted uppercase tracking-wider font-medium">Pending</p>
          <p className="text-num-kpi font-mono font-bold mt-1 text-status-amber">{invoices.length}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-caption text-muted uppercase tracking-wider font-medium">Blocked Variance</p>
          <p className="text-num-kpi font-mono font-bold mt-1 text-status-alert">{blockedCount}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-caption text-muted uppercase tracking-wider font-medium">Total Pending Value</p>
          <p className="text-num-kpi font-mono font-bold mt-1 text-foreground truncate">
            {formatPKR(totalPendingAmount)}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-caption text-muted uppercase tracking-wider font-medium">Ledger Status</p>
          <p className="text-body font-semibold mt-1 text-status-optimal">Strictly Isolated</p>
          <p className="text-caption text-muted">No balance until approved</p>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h2 font-semibold">Pending Approval Queue</h2>
            <span className="badge">{filteredInvoices.length} pending</span>
          </div>

          {/* Search */}
          <div className="relative mb-4 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by GRN #, vendor, or material..."
              className="w-full h-9 pl-9 pr-9 rounded-lg bg-bg-muted border border-border-default text-body text-foreground placeholder:text-muted focus:outline-none focus:border-crimson-primary/60 focus:ring-1 focus:ring-crimson-primary/20 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="glow-line mb-0" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-muted/40">
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[140px]">
                  GRN #
                </th>
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[140px]">
                  Vendor
                </th>
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px]">
                  Qty (KG)
                </th>
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[120px] text-right">
                  Unit Price
                </th>
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[130px] text-right">
                  Payable (PKR)
                </th>
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[140px] text-center">
                  3-Way Match
                </th>
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px] text-center">
                  Status
                </th>
                <th className="px-5 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[220px] text-center">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-body text-muted">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading pending invoices...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-body text-muted">
                    {searchQuery
                      ? `No pending invoices matching "${searchQuery}"`
                      : "No pending vendor invoices. Create a GRN from Material Intake to start the purchase pipeline."}
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const isBusy = processingId === inv.id;
                  const hasVariance = inv.matchResult ? !inv.matchResult.isMatch : false;
                  const canApproveRow = canApprove(userRole, inv.matchResult);

                  return (
                    <tr
                      key={inv.id}
                      className={`border-b border-border-subtle last:border-0 hover:bg-bg-subtle transition-colors ${
                        hasVariance ? "bg-status-alert/5" : ""
                      }`}
                    >
                      {/* GRN # */}
                      <td className="px-5 py-3">
                        <span className="font-mono text-body font-semibold text-foreground whitespace-nowrap">
                          {inv.grn_number || "—"}
                        </span>
                        <div className="text-caption text-muted font-mono">
                          {inv.invoice_number}
                        </div>
                      </td>

                      {/* Vendor */}
                      <td className="px-5 py-3 text-body font-medium text-foreground">
                        {inv.vendor_name || "—"}
                      </td>

                      {/* Qty */}
                      <td className="px-5 py-3 text-body text-secondary font-mono">
                        {inv.grn_accepted_qty?.toLocaleString() ?? inv.items?.[0]?.quantity ?? "—"}
                      </td>

                      {/* Unit Price */}
                      <td className="px-5 py-3 text-body text-secondary font-mono text-right">
                        {inv.grn_unit_price
                          ? formatPKR(inv.grn_unit_price)
                          : inv.items?.[0]?.unit_price
                            ? formatPKR(inv.items[0].unit_price!)
                            : "—"}
                      </td>

                      {/* Payable */}
                      <td className="px-5 py-3 text-right font-mono text-num-table font-bold text-foreground whitespace-nowrap">
                        {formatPKR(inv.total_payable)}
                      </td>

                      {/* 3-Way Match */}
                      <td className="px-5 py-3 text-center">
                        {inv.matchResult ? (
                          inv.matchResult.isMatch ? (
                            <span className="inline-flex items-center gap-1 text-caption font-medium text-status-optimal bg-status-optimal/10 border border-status-optimal/20 rounded-full px-2.5 py-0.5">
                              <CheckCircle2 className="h-3 w-3" />
                              Matched
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-caption font-medium text-status-alert bg-status-alert/10 border border-status-alert/20 rounded-full px-2.5 py-0.5"
                              title={inv.matchResult.reason}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Blocked Variance
                            </span>
                          )
                        ) : (
                          <span className="text-caption text-muted">N/A</span>
                        )}
                        {inv.matchResult && !inv.matchResult.isMatch && (
                          <div className="text-caption text-status-alert mt-0.5">
                            Price: {inv.matchResult.priceVariance.toFixed(1)}% | Qty:{" "}
                            {inv.matchResult.qtyVariance.toFixed(1)}%
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3 text-center">
                        <span className="inline-block text-caption font-medium px-2 py-0.5 rounded border bg-status-amber/15 text-status-amber border-status-amber/20">
                          Pending
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {canApproveRow ? (
                            <button
                              onClick={() => setApproveTarget(inv)}
                              disabled={isBusy}
                              className="h-7 px-3 rounded-md bg-status-optimal/10 text-status-optimal text-caption font-medium border border-status-optimal/20 hover:bg-status-optimal/20 transition-colors inline-flex items-center gap-1 disabled:opacity-40"
                              title="Approve & Post double-entry to GL"
                            >
                              {isBusy ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              Approve &amp; Post
                            </button>
                          ) : (
                            <span
                              className="text-caption text-status-alert font-medium"
                              title="Requires plant_manager or admin role to approve blocked variance"
                            >
                              Manager Required
                            </span>
                          )}

                          {dismissConfirmId === inv.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDismiss(inv.id)}
                                disabled={isBusy}
                                className="h-7 px-2 rounded-md bg-status-alert text-white text-caption font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDismissConfirmId(null)}
                                disabled={isBusy}
                                className="h-7 px-2 rounded-md bg-bg-muted text-secondary border border-border-default text-caption hover:text-foreground transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDismissConfirmId(inv.id)}
                              disabled={isBusy}
                              className="h-7 px-2.5 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-status-alert hover:border-status-alert/30 transition-colors inline-flex items-center gap-1 disabled:opacity-40"
                              title="Dismiss — no financial entries"
                            >
                              <Trash2 className="h-3 w-3" />
                              Dismiss
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approve Confirm Modal */}
      {approveTarget && (
        <ApproveConfirmModal
          invoice={approveTarget}
          busy={processingId === approveTarget.id}
          onConfirm={() => handleApproveAndPost(approveTarget)}
          onCancel={() => !processingId && setApproveTarget(null)}
        />
      )}
    </div>
  );
}
