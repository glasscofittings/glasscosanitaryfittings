"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Search,
  RefreshCw,
  FileText,
  Eye,
  Edit,
  Trash,
  Send,
  CheckCircle2,
  FileSignature,
} from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import GlassCard from "@/components/ui/GlassCard";
import { formatPKR } from "@/lib/utils/formatters";
import {
  type Quotation,
  type QuotationStatus,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUSES,
  effectiveQuotationStatus,
  fetchQuotations,
  filterQuotations,
  summarizeQuotations,
  canCreateQuotation,
  deleteQuotation,
} from "@/lib/supabase/quotations";
import QuotationFormModal from "@/components/modules/quotations/QuotationFormModal";
import QuotationDetailModal from "@/components/modules/quotations/QuotationDetailModal";
import { useAuth } from "@/components/providers/AuthProvider";

type StatusTab = QuotationStatus | "ALL";
type DatePreset = "ALL" | "TODAY" | "THIS_MONTH" | "LAST_30_DAYS";

const STATUS_BADGES: Record<QuotationStatus, string> = {
  DRAFT: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  ISSUED: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  ACCEPTED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  REJECTED: "bg-red-500/15 text-red-400 border-red-500/30",
  EXPIRED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  CANCELLED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
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

export default function QuotationsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const role = profile?.role;

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("ALL");
  const [datePreset, setDatePreset] = useState<DatePreset>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editQuotation, setEditQuotation] = useState<Quotation | null>(null);
  const [detailQuotation, setDetailQuotation] = useState<Quotation | null>(null);

  const loadData = useCallback(async () => {
    try {
      const rows = await fetchQuotations();
      setQuotations(rows);
    } catch {
      toast.error("Failed to load quotations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleDeleteQuotation = async (q: Quotation) => {
    if (window.confirm("Are you sure you want to delete this quotation?")) {
      setLoading(true);
      const result = await deleteQuotation(q.id, role);
      setLoading(false);
      if (result.success) {
        void loadData();
        toast.success("Quotation deleted.");
      } else {
        toast.error(result.error ?? "Failed to delete quotation.");
      }
    }
  };

  const handleChanged = useCallback(() => {
    void loadData();
    // A converted invoice may post to the ledger later — refresh related caches.
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
  }, [loadData, queryClient]);

  const handleDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const today = new Date().toISOString().slice(0, 10);
    if (preset === "ALL") {
      setStartDate("");
      setEndDate("");
    } else if (preset === "TODAY") {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === "THIS_MONTH") {
      setStartDate(`${today.slice(0, 7)}-01`);
      setEndDate(today);
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(today);
    }
  };

  const summary = useMemo(() => summarizeQuotations(quotations), [quotations]);

  const filtered = useMemo(
    () =>
      filterQuotations(quotations, {
        search: searchQuery,
        status: statusTab,
        startDate,
        endDate,
      }),
    [quotations, searchQuery, statusTab, startDate, endDate],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: quotations.length };
    for (const status of QUOTATION_STATUSES) counts[status] = 0;
    for (const q of quotations) counts[q.status] = (counts[q.status] ?? 0) + 1;
    return counts;
  }, [quotations]);

  const openCreate = () => {
    setEditQuotation(null);
    setFormOpen(true);
  };

  const openEdit = (q: Quotation) => {
    setDetailQuotation(null);
    setEditQuotation(q);
    setFormOpen(true);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Quotations</h1>
          <p className="text-xs text-muted mt-0.5">
            Customer offers — no ledger posting, no stock movement until converted to an invoice
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRefresh()}
            className="p-2 rounded-lg border border-border-subtle bg-surface-card text-muted hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <CrimsonButton
            onClick={openCreate}
            disabled={!canCreateQuotation(role)}
            title={canCreateQuotation(role) ? undefined : "No permission to create quotations"}
          >
            <Plus className="w-4 h-4" /> New Quotation
          </CrimsonButton>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Quotations", value: String(summary.total_count), icon: FileText },
          { label: "Awaiting Decision (Issued)", value: String(summary.issued_count), icon: Send },
          {
            label: "Accepted Value",
            value: formatPKR(summary.accepted_value_pkr),
            icon: CheckCircle2,
          },
          { label: "Converted to Invoices", value: String(summary.converted_count), icon: FileSignature },
        ].map((card) => (
          <GlassCard key={card.label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted">{card.label}</span>
              <card.icon className="w-4 h-4 text-crimson-primary" />
            </div>
            <div className="mt-2 text-lg font-bold font-mono text-foreground">{card.value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["ALL", ...QUOTATION_STATUSES] as StatusTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusTab(tab)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
                statusTab === tab
                  ? "bg-crimson-primary text-white"
                  : "text-muted hover:bg-neutral-800/30"
              }`}
            >
              {tab === "ALL" ? "All" : QUOTATION_STATUS_LABELS[tab as QuotationStatus]}
              <span className="ml-1 font-mono opacity-70">{statusCounts[tab] ?? 0}</span>
            </button>
          ))}
          <span className="text-xs text-muted font-mono ml-auto">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
            <input
              type="text"
              placeholder="Search number, customer, product…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                ["ALL", "All"],
                ["TODAY", "Today"],
                ["THIS_MONTH", "This Month"],
                ["LAST_30_DAYS", "Last 30 Days"],
              ] as Array<[DatePreset, string]>
            ).map(([preset, label]) => (
              <button
                key={preset}
                onClick={() => handleDatePreset(preset)}
                className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                  datePreset === preset
                    ? "border-crimson-primary bg-crimson-primary/15 text-crimson-primary"
                    : "border-border-subtle text-muted hover:bg-neutral-800/30"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
          />
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-10 flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-crimson-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-muted">Loading quotations…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-10 h-10 mx-auto text-muted/50" />
            <p className="text-sm text-muted mt-3">
              {quotations.length === 0
                ? "No quotations yet — create your first customer offer."
                : "No quotations match the current filters."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-neutral-900/40 text-muted uppercase tracking-wider text-[10px]">
                  <th className="px-4 py-3">Quotation #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Valid Until</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Items</th>
                  <th className="px-4 py-3 text-right">Grand Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => {
                  const effective = effectiveQuotationStatus(q);
                  return (
                    <tr
                      key={q.id}
                      onClick={() => setDetailQuotation(q)}
                      className="border-t border-border-subtle hover:bg-neutral-800/25 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono font-bold text-foreground">
                        {q.quotation_number}
                      </td>
                      <td className="px-4 py-3 text-muted">{fmtDate(q.quotation_date)}</td>
                      <td className="px-4 py-3 text-muted">{fmtDate(q.valid_until)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">{q.customer_name}</div>
                        {q.customer_phone && (
                          <div className="text-[10px] text-muted">{q.customer_phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted">
                        {(q.items ?? []).length}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                        {formatPKR(q.grand_total_pkr)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGES[effective]}`}
                        >
                          {QUOTATION_STATUS_LABELS[effective]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-muted">
                        {q.invoice?.invoice_number ?? (q.converted_invoice_id ? "linked" : "—")}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          {/* Edit button — disabled if already converted to invoice OR cancelled */}
                          {(!q.converted_invoice_id && effective !== "CANCELLED") && (
                            <button
                              onClick={() => openEdit(q)}
                              className="p-1.5 rounded-md bg-bg-muted text-secondary border border-border-default hover:text-foreground hover:bg-bg-subtle transition-colors"
                              title="Edit quotation"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Delete button — disabled if already converted */}
                          {(!q.converted_invoice_id) && (
                            <button
                              onClick={() => handleDeleteQuotation(q)}
                              className="p-1.5 rounded-md bg-status-alert/10 text-status-alert text-caption font-medium border border-status-alert/20 hover:bg-status-alert/20 transition-colors"
                              title="Delete quotation"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* View button — always enabled */}
                          <button
                            onClick={() => setDetailQuotation(q)}
                            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
                            title="View quotation"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Modals */}
      {formOpen && (
        <QuotationFormModal
          isOpen={formOpen}
          editQuotation={editQuotation}
          onClose={() => {
            setFormOpen(false);
            setEditQuotation(null);
          }}
          onSuccess={() => {
            void loadData();
          }}
        />
      )}

      {detailQuotation && (
        <QuotationDetailModal
          isOpen={!!detailQuotation}
          quotation={detailQuotation}
          onClose={() => setDetailQuotation(null)}
          onEdit={openEdit}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
