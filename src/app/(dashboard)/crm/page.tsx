"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchParties,
  fetchPartyDetails,
  fetchCRMStats,
  createParty,
  updateParty,
  deleteParty,
  generatePartyLedgerHTML,
  type Party,
  type PartyDetail,
  type CRMStats,
} from "@/lib/supabase/crm";
import { formatPKR } from "@/lib/utils/formatters";
import { exportPartiesToPDF } from "@/lib/pdf-exporter";
import { balanceAmountLabel, balanceSide } from "@/lib/party-statement";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { capitalizeFirst } from "@/lib/utils";

type FilterTab = "ALL" | "BUYER" | "SUPPLIER";

export default function CRMPage() {
  const [parties, setParties] = useState<Party[]>([]);
  const [stats, setStats] = useState<CRMStats>({ total_buyers: 0, total_suppliers: 0, total_receivables: 0, total_payables: 0 });
  const [filter, setFilter] = useState<FilterTab>("ALL");
  const [search, setSearch] = useState("");
  const [loadedFilter, setLoadedFilter] = useState<FilterTab | null>(null);
  const loading = loadedFilter !== filter;
  const [addOpen, setAddOpen] = useState(false);
  const [editParty, setEditParty] = useState<Party | null>(null);
  const [detailParty, setDetailParty] = useState<PartyDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Party | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fetchAll = useCallback(
    () => Promise.all([fetchParties(filter === "ALL" ? "ALL" : filter), fetchCRMStats()]),
    [filter]
  );

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(([p, s]) => {
      if (cancelled) return;
      setParties(p);
      setStats(s);
      setLoadedFilter(filter);
    });
    return () => { cancelled = true; };
  }, [fetchAll, filter]);

  useEscapeToClose(addOpen, () => setAddOpen(false));
  useEscapeToClose(!!editParty, () => setEditParty(null));
  useEscapeToClose(detailOpen && !!detailParty, () => {
    setDetailOpen(false);
    setDetailParty(null);
  });
  useEscapeToClose(!!deleteTarget, () => {
    setDeleteTarget(null);
    setDeleteError("");
  });

  async function load() {
    const [p, s] = await fetchAll();
    setParties(p);
    setStats(s);
    setLoadedFilter(filter);
  }

  const filtered = parties.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.phone ?? "").toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q);
  });

  function typeBadge(type: string) {
    if (type === "SUPPLIER") return "bg-blue-500/15 text-blue-400 border-blue-500/20";
    if (type === "BOTH") return "bg-purple-500/15 text-purple-400 border-purple-500/20";
    return "bg-status-optimal/15 text-status-optimal border-status-optimal/20";
  }

  function typeLabel(type: string) {
    if (type === "CUSTOMER") return "Buyer";
    if (type === "BOTH") return "Both";
    return "Supplier";
  }

  async function handleExportPDF() {
    if (filtered.length === 0) return;
    const scope = filter === "ALL" ? "All contacts" : filter === "BUYER" ? "Buyers only" : "Suppliers only";
    await exportPartiesToPDF(filtered, {
      subtitle: search ? `${scope} | Filtered by "${search.trim()}"` : scope,
      operatorName: "CRM Manager",
    });
  }

  async function handleExportLedger(party: Party) {
    if (exportingId) return;
    setExportingId(party.id);
    try {
      const details = await fetchPartyDetails(party.id);
      if (!details) return;
      const html = generatePartyLedgerHTML(details, details.ledger);
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
      setExportingId(null);
    }
  }

  async function handleViewDetails(party: Party) {
    const details = await fetchPartyDetails(party.id);
    if (details) {
      setDetailParty(details);
      setDetailOpen(true);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    const result = await deleteParty(deleteTarget.id);
    setDeleting(false);
    if (result.ok) {
      setParties((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      load();
    } else {
      setDeleteError(result.error ?? "Failed to delete contact.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display font-bold tracking-tight">CRM</h1>
          <p className="text-body text-secondary mt-1">Manage buyers, suppliers & contacts</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={handleExportPDF}
            disabled={loading || filtered.length === 0}
            title={filtered.length === 0 ? "No contacts to export" : "Export the contacts table as a PDF"}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden xs:inline">Export PDF</span>
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors"
          >
            + Add Contact
          </button>
        </div>
      </div>

      <div className="glow-line" />

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Buyers" value={stats.total_buyers.toString()} accent="green" />
        <KPICard label="Total Suppliers" value={stats.total_suppliers.toString()} accent="blue" />
        <KPICard label="Total Receivables" value={formatPKR(stats.total_receivables)} accent="amber" />
        <KPICard label="Total Payables" value={formatPKR(stats.total_payables)} accent="crimson" />
      </div>

      {/* Search + Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-10 pr-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-bg-muted border border-border-subtle self-start sm:self-auto">
          {(["ALL", "BUYER", "SUPPLIER"] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-md text-caption font-medium transition-colors ${
                filter === tab
                  ? "bg-crimson-primary text-white"
                  : "text-secondary hover:text-foreground hover:bg-bg-subtle"
              }`}
            >
              {tab === "ALL" ? "All" : tab === "BUYER" ? "Buyers" : "Suppliers"}
            </button>
          ))}
        </div>
      </div>

      {/* Data Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[200px]">Name</th>
                <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[100px]">Type</th>
                <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[160px]">Phone</th>
                <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[200px]">Email</th>
                <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[200px]">Address</th>
                <th className="px-4 py-3 text-caption text-muted font-medium uppercase tracking-wider min-w-[220px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-secondary">
                    Loading contacts...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">
                    No contacts found.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border-subtle hover:bg-bg-subtle transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground text-body">{p.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-caption font-medium px-2 py-0.5 rounded border ${typeBadge(p.party_type)}`}>
                        {typeLabel(p.party_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-body text-secondary font-mono">{p.phone || "—"}</td>
                    <td className="px-4 py-3 text-body text-secondary">{p.email || "—"}</td>
                    <td className="px-4 py-3 text-caption text-secondary truncate max-w-[200px]" title={p.address ?? ""}>
                      {p.address || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewDetails(p)}
                          className="h-7 px-2.5 rounded-md text-caption text-secondary hover:text-foreground hover:bg-bg-muted border border-border-subtle transition-colors"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => setEditParty(p)}
                          className="h-7 px-2.5 rounded-md text-caption text-secondary hover:text-foreground hover:bg-bg-muted border border-border-subtle transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleExportLedger(p)}
                          disabled={exportingId !== null}
                          title="Print this contact's payment voucher ledger as a PDF"
                          className="h-7 px-2.5 rounded-md text-caption text-secondary hover:text-foreground hover:bg-bg-muted border border-border-subtle transition-colors disabled:text-disabled disabled:cursor-not-allowed"
                        >
                          {exportingId === p.id ? "Preparing..." : "Export PDF"}
                        </button>
                        <button
                          onClick={() => { setDeleteTarget(p); setDeleteError(""); }}
                          title="Delete contact"
                          className="h-7 w-7 rounded-md flex items-center justify-center text-caption text-secondary hover:text-status-error hover:bg-status-error/10 border border-border-subtle transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Contact Modal */}
      {addOpen && (
        <PartyModal
          onClose={() => setAddOpen(false)}
          onSaved={(p) => { setParties((prev) => [...prev, p]); setAddOpen(false); load(); }}
        />
      )}

      {/* Edit Contact Modal */}
      {editParty && (
        <PartyModal
          party={editParty}
          onClose={() => setEditParty(null)}
          onSaved={(p) => { setParties((prev) => prev.map((x) => x.id === p.id ? p : x)); setEditParty(null); load(); }}
        />
      )}

      {/* Detail Drawer */}
      {detailOpen && detailParty && (
        <PartyDetailDrawer
          party={detailParty}
          onClose={() => { setDetailOpen(false); setDetailParty(null); }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          contactName={deleteTarget.name}
          error={deleteError}
          deleting={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(""); }}
        />
      )}
    </div>
  );
}

// ============================================================================
// KPICard
// ============================================================================

function KPICard({ label, value, accent }: { label: string; value: string; accent: "crimson" | "green" | "amber" | "blue" }) {
  const accentMap = {
    crimson: { dot: "bg-crimson-primary", text: "text-crimson-primary" },
    green: { dot: "bg-status-optimal", text: "text-status-optimal" },
    amber: { dot: "bg-status-amber", text: "text-status-amber" },
    blue: { dot: "bg-blue-500", text: "text-blue-400" },
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

// ============================================================================
// PartyModal (Add / Edit)
// ============================================================================

function PartyModal({ party, onClose, onSaved }: { party?: Party; onClose: () => void; onSaved: (p: Party) => void }) {
  const [name, setName] = useState(party?.name ?? "");
  const [partyType, setPartyType] = useState<"SUPPLIER" | "CUSTOMER" | "BOTH">(party?.party_type ?? "CUSTOMER");
  const [phone, setPhone] = useState(party?.phone ?? "");
  const [email, setEmail] = useState(party?.email ?? "");
  const [address, setAddress] = useState(party?.address ?? "");
  const [openingBalance, setOpeningBalance] = useState(
    String(Math.abs(Number(party?.opening_balance ?? 0)) || "")
  );
  const [openingType, setOpeningType] = useState<"Dr" | "Cr">(party?.opening_balance_type ?? "Dr");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const data = {
        name: name.trim(),
        party_type: partyType,
        phone: phone || undefined,
        email: email || undefined,
        address: address || undefined,
        opening_balance: Math.max(0, Number(openingBalance) || 0),
        opening_balance_type: openingType,
      };
      const result = party ? await updateParty(party.id, data) : await createParty(data);
      if (result) {
        onSaved(result);
      } else {
        setError("Failed to save. Check console for details.");
      }
    } catch {
      setError("An unexpected error occurred.");
    }
    setSaving(false);
  }

  const inputCls = "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel" style={{ zIndex: 80 }}>
        <div className="drawer-header">
          <h2 className="text-h2 font-semibold">{party ? "Edit Contact" : "New Contact"}</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="drawer-body">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-caption text-status-alert bg-status-alert/10 border border-status-alert/20 rounded-lg px-3 py-2">{error}</div>
            )}

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Contact Name *</label>
              <input value={name} onChange={(e) => setName(capitalizeFirst(e.target.value))} className={inputCls} placeholder="e.g. Karachi Traders" />
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Type</label>
              <select value={partyType} onChange={(e) => setPartyType(e.target.value as typeof partyType)} className={inputCls}>
                <option value="CUSTOMER">Buyer / Customer</option>
                <option value="SUPPLIER">Supplier / Vendor</option>
                <option value="BOTH">Both</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="+92-..." />
              </div>
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="name@company.com" />
              </div>
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Address</label>
              <input value={address} onChange={(e) => setAddress(capitalizeFirst(e.target.value))} className={inputCls} placeholder="City, Area" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Opening Balance (Rs)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  className={inputCls}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Balance Side</label>
                <select value={openingType} onChange={(e) => setOpeningType(e.target.value as "Dr" | "Cr")} className={inputCls}>
                  <option value="Dr">Dr (Debit / Receivable)</option>
                  <option value="Cr">Cr (Credit / Payable)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors disabled:opacity-50">
                {saving ? "Saving..." : party ? "Update Contact" : "Create Contact"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// PartyDetailDrawer
// ============================================================================

function PartyDetailDrawer({ party, onClose }: { party: PartyDetail; onClose: () => void }) {
  function typeBadge(type: string) {
    if (type === "SUPPLIER") return "bg-blue-500/15 text-blue-400 border-blue-500/20";
    if (type === "BOTH") return "bg-purple-500/15 text-purple-400 border-purple-500/20";
    return "bg-status-optimal/15 text-status-optimal border-status-optimal/20";
  }

  function typeLabel(type: string) {
    if (type === "CUSTOMER") return "Buyer";
    if (type === "BOTH") return "Both";
    return "Supplier";
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel" style={{ zIndex: 80 }}>
        <div className="drawer-header">
          <div className="flex items-center gap-3">
            <h2 className="text-h2 font-semibold">{party.name}</h2>
            <span className={`inline-block text-caption font-medium px-2 py-0.5 rounded border ${typeBadge(party.party_type)}`}>
              {typeLabel(party.party_type)}
            </span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="drawer-body space-y-6">
          {/* Contact Info */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-caption text-muted uppercase tracking-wider font-medium">Contact Information</h3>
            <div className="grid grid-cols-2 gap-3 text-body">
              <div>
                <span className="text-muted text-caption">Phone</span>
                <p className="text-foreground font-mono">{party.phone || "—"}</p>
              </div>
              <div>
                <span className="text-muted text-caption">Email</span>
                <p className="text-foreground">{party.email || "—"}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted text-caption">Address</span>
                <p className="text-foreground">{party.address || "—"}</p>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-caption text-muted uppercase tracking-wider font-medium">Financial Summary</h3>
            {party.party_type === "BOTH" ? (
              <div className="space-y-4">
                {(["buy", "sell"] as const).map((side) => {
                  const totals = party.sides[side];
                  if (!totals) return null;
                  const amountLabel = side === "buy" ? "Amount Receivable" : "Amount Payable";
                  return (
                    <div key={side} className="space-y-2">
                      <span className="text-caption text-muted uppercase tracking-wider">
                        {side === "buy" ? "Buyer Side" : "Supplier Side"} &mdash; {amountLabel}
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-muted text-caption">Invoices</span>
                          <p className="font-mono font-bold text-foreground">{totals.invoice_count}</p>
                        </div>
                        <div>
                          <span className="text-muted text-caption">Invoice Value</span>
                          <p className="font-mono font-bold text-foreground">{formatPKR(totals.total_invoice_value)}</p>
                        </div>
                        <div>
                          <span className="text-muted text-caption">Paid</span>
                          <p className="font-mono font-bold text-foreground">{formatPKR(totals.total_paid)}</p>
                        </div>
                        <div>
                          <span className="text-muted text-caption">{amountLabel}</span>
                          <p className={`font-mono font-bold ${totals.outstanding_balance > 0 ? "text-crimson-primary" : "text-status-optimal"}`}>
                            {formatPKR(Math.abs(totals.outstanding_balance))}{" "}
                            <span className="text-caption font-medium">{side === "buy" ? "Dr" : "Cr"}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-muted text-caption">Total Invoices</span>
                  <p className="font-mono font-bold text-foreground">{party.invoice_count}</p>
                </div>
                <div>
                  <span className="text-muted text-caption">Invoice Value</span>
                  <p className="font-mono font-bold text-foreground">{formatPKR(party.total_invoice_value)}</p>
                </div>
                <div>
                  <span className="text-muted text-caption">Total Paid</span>
                  <p className="font-mono font-bold text-foreground">{formatPKR(party.total_paid)}</p>
                </div>
                <div>
                  <span className="text-muted text-caption">Unpaid Invoices</span>
                  <p className={`font-mono font-bold ${party.outstanding_balance > 0 ? "text-crimson-primary" : "text-status-optimal"}`}>
                    {formatPKR(party.outstanding_balance)}
                  </p>
                </div>
                <div className="col-span-2 rounded-lg border border-border-default bg-bg-muted/60 px-3 py-2 flex items-center justify-between">
                  <span className="text-caption text-muted uppercase tracking-wider font-medium">
                    {balanceAmountLabel(party.party_type, party.closing_balance)}
                  </span>
                  <p className="font-mono font-bold text-foreground">
                    {formatPKR(Math.abs(party.closing_balance))}{" "}
                    <span className="text-caption font-medium text-secondary">{balanceSide(party.closing_balance)}</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-3">
            {(party.party_type === "CUSTOMER" || party.party_type === "BOTH") && (
              <a
                href="/invoicing/"
                className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors inline-flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Create Invoice
              </a>
            )}
            {(party.party_type === "SUPPLIER" || party.party_type === "BOTH") && (
              <a
                href="/procurement/"
                className="h-9 px-4 rounded-lg bg-blue-500 text-white font-medium text-body hover:bg-blue-600 transition-colors inline-flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Log Material Entry
              </a>
            )}
          </div>

          {/* Combined Ledger */}
          <div className="glass-card overflow-hidden">
            <div className="p-4 pb-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-caption text-muted uppercase tracking-wider font-medium">Ledger</h3>
                <span className="text-caption text-muted">
                  {balanceAmountLabel(party.party_type, party.closing_balance)}:{" "}
                  <strong className="font-mono text-foreground">
                    {formatPKR(Math.abs(party.closing_balance))} {balanceSide(party.closing_balance)}
                  </strong>
                </span>
              </div>
              <div className="glow-line mb-3" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="px-4 py-2 text-caption text-muted font-medium">Date</th>
                    <th className="px-4 py-2 text-caption text-muted font-medium">Doc. No</th>
                    <th className="px-4 py-2 text-caption text-muted font-medium">Details</th>
                    <th className="px-4 py-2 text-caption text-muted font-medium text-right">Debit</th>
                    <th className="px-4 py-2 text-caption text-muted font-medium text-right">Credit</th>
                    <th className="px-4 py-2 text-caption text-muted font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {party.ledger.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-caption text-muted">
                        No financial documents recorded for this party.
                      </td>
                    </tr>
                  )}
                  {party.ledger.map((e) => (
                    <tr key={`${e.doc_type}-${e.id}`} className="border-b border-border-subtle hover:bg-bg-subtle transition-colors">
                      <td className="px-4 py-2 text-caption text-secondary whitespace-nowrap">
                        {new Date(e.date).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "2-digit" })}
                      </td>
                      <td className="px-4 py-2 font-mono text-num-code text-secondary text-caption">{e.doc_no}</td>
                      <td className="px-4 py-2 text-caption text-secondary">{e.remarks}</td>
                      <td className="px-4 py-2 text-right font-mono text-num-table text-secondary text-caption">
                        {e.debit > 0 ? formatPKR(e.debit) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-num-table text-secondary text-caption">
                        {e.credit > 0 ? formatPKR(e.credit) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-num-table font-bold text-foreground text-caption">
                        {formatPKR(Math.abs(e.balance))} <span className="text-[10px] font-normal text-secondary">{balanceSide(e.balance)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {party.ledger.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border-default font-bold">
                      <td colSpan={3} className="px-4 py-2 text-caption text-muted uppercase">Total ({party.ledger.length} documents)</td>
                      <td className="px-4 py-2 text-right font-mono text-num-table text-foreground text-caption">
                        {formatPKR(party.ledger.reduce((s, e) => s + e.debit, 0))}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-num-table text-foreground text-caption">
                        {formatPKR(party.ledger.reduce((s, e) => s + e.credit, 0))}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-num-table text-foreground text-caption">
                        {formatPKR(Math.abs(party.ledger[party.ledger.length - 1].balance))}{" "}
                        <span className="text-[10px] font-normal">{balanceSide(party.ledger[party.ledger.length - 1].balance)}</span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// DeleteConfirmModal
// ============================================================================

function DeleteConfirmModal({
  contactName,
  error,
  deleting,
  onConfirm,
  onCancel,
}: {
  contactName: string;
  error: string;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-md p-6 border border-border-default shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-4 mb-5">
            <div className="h-10 w-10 rounded-full bg-status-error/10 flex items-center justify-center shrink-0">
              <svg className="h-5 w-5 text-status-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-h2 font-semibold text-foreground">Delete Contact</h2>
              <p className="text-body text-secondary mt-1">
                Are you sure you want to delete <span className="font-semibold text-foreground">{contactName}</span>? This action cannot be undone.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-caption text-status-error bg-status-error/10 px-3 py-2 rounded-lg border border-status-error/20 mb-4">
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={deleting}
              className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="flex-1 h-9 rounded-lg bg-status-error text-white font-medium text-body hover:bg-status-error/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? "Deleting..." : "Delete Contact"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
