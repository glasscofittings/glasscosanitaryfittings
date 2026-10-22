"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Download,
  RefreshCw,
  Banknote,
  Trash2,
  Factory,
  Building2,
  UserCheck,
  Users,
  Calendar,
  Printer,
  Pencil,
  Clock,
} from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import GlassCard from "@/components/ui/GlassCard";
import { formatPKR } from "@/lib/utils/formatters";
import { fetchAccounts, type Account } from "@/lib/supabase/ledger";
import { exportPayrollVoucherPDF } from "@/lib/pdf-exporter";
import {
  type PayrollEntry,
  type PayrollType,
  type EmploymentType,
  type PayrollPaymentMethod,
  PAYROLL_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  fetchPayrollEntries,
  calculatePayrollSummary,
  deletePayrollEntry,
} from "@/lib/supabase/payroll";
import PayrollSummaryCards from "@/components/modules/payroll/PayrollSummaryCards";
import PayrollFormModal from "@/components/modules/payroll/PayrollFormModal";

type DatePreset = "ALL" | "TODAY" | "THIS_MONTH" | "LAST_30_DAYS";

export default function PayrollPage() {
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<PayrollEntry | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<PayrollType | "ALL">("ALL");
  const [filterEmployment, setFilterEmployment] = useState<EmploymentType | "ALL">("ALL");
  const [filterPayment, setFilterPayment] = useState<PayrollPaymentMethod | "ALL">("ALL");
  const [datePreset, setDatePreset] = useState<DatePreset>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Deleting
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [accs, ents] = await Promise.all([fetchAccounts(), fetchPayrollEntries()]);
      setAccounts(accs);
      setEntries(ents);
    } catch (err) {
      console.error("Failed to load payroll data:", err);
      toast.error("Failed to load payroll records.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const today = new Date().toISOString().slice(0, 10);
    if (preset === "TODAY") {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === "THIS_MONTH") {
      setStartDate(`${today.slice(0, 7)}-01`);
      setEndDate(today);
    } else if (preset === "LAST_30_DAYS") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(today);
    } else {
      setStartDate("");
      setEndDate("");
    }
  };

  const filteredEntries = useMemo(() => {
    let result = [...entries];
    if (filterType !== "ALL") result = result.filter((e) => e.payroll_type === filterType);
    if (filterEmployment !== "ALL")
      result = result.filter((e) => e.employment_type === filterEmployment);
    if (filterPayment !== "ALL") result = result.filter((e) => e.payment_method === filterPayment);
    if (startDate) result = result.filter((e) => e.payroll_date >= startDate);
    if (endDate) result = result.filter((e) => e.payroll_date <= endDate);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.entry_number.toLowerCase().includes(q) ||
          e.employee_name.toLowerCase().includes(q) ||
          (e.notes && e.notes.toLowerCase().includes(q))
      );
    }
    return result;
  }, [entries, filterType, filterEmployment, filterPayment, startDate, endDate, searchQuery]);

  const summary = useMemo(() => calculatePayrollSummary(entries), [entries]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    toast.success("Payroll records refreshed.");
  };

  const handleEntrySaved = (entry: PayrollEntry) => {
    setEntries((prev) =>
      prev.some((e) => e.id === entry.id)
        ? prev.map((e) => (e.id === entry.id ? { ...e, ...entry } : e))
        : [entry, ...prev]
    );
  };

  const handlePrint = async (entry: PayrollEntry) => {
    if (printingId) return;
    setPrintingId(entry.id);
    try {
      await exportPayrollVoucherPDF(entry, { operatorName: entry.operator_name ?? undefined });
    } catch (err) {
      console.error("Failed to print payroll voucher:", err);
      toast.error("Failed to generate the payroll voucher PDF.");
    } finally {
      setPrintingId(null);
    }
  };

  const handleDelete = async (entry: PayrollEntry) => {
    if (!confirm(`Delete payroll entry ${entry.entry_number}? This will also void the journal entry.`)) return;
    setDeletingId(entry.id);
    const { error } = await deletePayrollEntry(entry.id);
    setDeletingId(null);
    if (error) {
      toast.error(`Failed to delete: ${error}`);
    } else {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      toast.success(`Entry ${entry.entry_number} deleted.`);
    }
  };

  const renderTypeBadge = (type: PayrollType) => {
    if (type === "PRODUCTION_COGS") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap">
          <Factory className="w-2.5 h-2.5" /> Production
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 whitespace-nowrap">
        <Building2 className="w-2.5 h-2.5" /> Admin
      </span>
    );
  };

  const renderEmploymentBadge = (type: EmploymentType) => {
    if (type === "PERMANENT_SALARY") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30 whitespace-nowrap">
          <UserCheck className="w-2.5 h-2.5" /> Salary
        </span>
      );
    }
    if (type === "DAILY_PAY") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30 whitespace-nowrap">
          <Clock className="w-2.5 h-2.5" /> Daily
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-500/15 text-teal-400 border border-teal-500/30 whitespace-nowrap">
        <Users className="w-2.5 h-2.5" /> Wage
      </span>
    );
  };

  const renderPaymentBadge = (method: PayrollPaymentMethod) => {
    if (method === "CASH") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
          <Banknote className="w-2.5 h-2.5" /> Cash
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 whitespace-nowrap">
        <Building2 className="w-2.5 h-2.5" /> Bank
      </span>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Banknote className="w-6 h-6 text-crimson-primary" />
            Payroll Management
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Cost allocation &amp; Cash/Bank reconciliation — Production COGS vs Admin Fixed Costs
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg border border-border-subtle bg-surface-card text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>

          <CrimsonButton
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Record Payroll</span>
          </CrimsonButton>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <PayrollSummaryCards summary={summary} />

      {/* Filters Bar */}
      <GlassCard className="p-4 space-y-3">
        {/* Type Filter Tabs */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-border-subtle">
          <div className="flex items-center gap-1 overflow-x-auto flex-wrap">
            {(
              [
                { key: "ALL", label: "All Entries" },
                { key: "PRODUCTION_COGS", label: "Production (COGS)" },
                { key: "ADMIN_FIXED", label: "Admin (Fixed)" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setFilterType(t.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterType === t.key
                    ? "bg-crimson-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground hover:bg-bg-hover"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted font-mono">
            {filteredEntries.length} of {entries.length} records
          </span>
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by #, name, notes…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            />
          </div>

          {/* Employment + Payment filters */}
          <div className="flex gap-2">
            <select
              value={filterEmployment}
              onChange={(e) => setFilterEmployment(e.target.value as EmploymentType | "ALL")}
              className="flex-1 px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            >
              <option value="ALL">All Types</option>
              <option value="PERMANENT_SALARY">Permanent Salary</option>
              <option value="PART_TIME_WAGE">Part-Time Wage</option>
              <option value="DAILY_PAY">Daily Pay</option>
            </select>
            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value as PayrollPaymentMethod | "ALL")}
              className="flex-1 px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            >
              <option value="ALL">Cash &amp; Bank</option>
              <option value="CASH">Cash Only</option>
              <option value="BANK">Bank Only</option>
            </select>
          </div>

          {/* Date Presets */}
          <div className="flex gap-1">
            {(
              [
                { key: "ALL", label: "All Time" },
                { key: "TODAY", label: "Today" },
                { key: "THIS_MONTH", label: "Month" },
              ] as const
            ).map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => handleDatePreset(p.key)}
                className={`flex-1 py-1 px-2 rounded text-[11px] font-medium border transition-colors ${
                  datePreset === p.key
                    ? "border-crimson-primary bg-crimson-primary/15 text-crimson-primary"
                    : "border-border-subtle text-muted hover:bg-bg-hover"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset("ALL");
              }}
              className="w-1/2 px-2 py-1.5 text-[11px] rounded bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            />
            <span className="text-muted text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset("ALL");
              }}
              className="w-1/2 px-2 py-1.5 text-[11px] rounded bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            />
          </div>
        </div>
      </GlassCard>

      {/* Payroll Data Table */}
      <GlassCard className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted">
            <div className="w-6 h-6 border-2 border-crimson-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading payroll records…</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-12 text-center text-muted space-y-2">
            <Banknote className="w-10 h-10 mx-auto text-muted/40" />
            <p className="text-sm font-medium">No payroll entries found</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              No records match the current filters. Click{" "}
              <strong>Record Payroll</strong> to add the first entry.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-muted text-muted uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4 font-semibold">Entry #</th>
                  <th className="py-3 px-3 font-semibold">Date</th>
                  <th className="py-3 px-4 font-semibold">Employee / Payee</th>
                  <th className="py-3 px-3 font-semibold">Category</th>
                  <th className="py-3 px-3 font-semibold">Type</th>
                  <th className="py-3 px-3 font-semibold">Payment</th>
                  <th className="py-3 px-3 font-semibold">Debit (Expense)</th>
                  <th className="py-3 px-3 font-semibold">Credit (Cash/Bank)</th>
                  <th className="py-3 px-4 font-semibold text-right">Amount (PKR)</th>
                  <th className="py-3 px-4 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/50">
                {filteredEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-bg-hover transition-colors group"
                  >
                    {/* Entry # */}
                    <td className="py-3 px-4 font-mono font-semibold text-foreground whitespace-nowrap">
                      {entry.entry_number}
                    </td>

                    {/* Date */}
                    <td className="py-3 px-3 text-muted whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(entry.payroll_date).toLocaleDateString()}
                      </span>
                    </td>

                    {/* Employee */}
                    <td className="py-3 px-4 max-w-[200px]">
                      <div className="font-medium text-foreground truncate" title={entry.employee_name}>
                        {entry.employee_name}
                      </div>
                      {entry.notes && (
                        <div className="text-[10px] text-muted truncate">{entry.notes}</div>
                      )}
                    </td>

                    {/* Payroll Type */}
                    <td className="py-3 px-3 whitespace-nowrap">{renderTypeBadge(entry.payroll_type)}</td>

                    {/* Employment Type */}
                    <td className="py-3 px-3 whitespace-nowrap">{renderEmploymentBadge(entry.employment_type)}</td>

                    {/* Payment Method */}
                    <td className="py-3 px-3 whitespace-nowrap">{renderPaymentBadge(entry.payment_method)}</td>

                    {/* Debit Account */}
                    <td
                      className="py-3 px-3 text-muted truncate max-w-[140px]"
                      title={entry.expense_account?.account_name}
                    >
                      {entry.expense_account
                        ? `[${entry.expense_account.account_code}] ${entry.expense_account.account_name}`
                        : "—"}
                    </td>

                    {/* Credit Account */}
                    <td className="py-3 px-3 text-muted truncate max-w-[140px]">
                      {entry.payment_account
                        ? `[${entry.payment_account.account_code}] ${entry.payment_account.account_name}`
                        : "—"}
                    </td>

                    {/* Amount */}
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground whitespace-nowrap">
                      {formatPKR(entry.amount)}
                    </td>

                    {/* Actions */}
                    <td
                      className="py-3 px-4 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handlePrint(entry)}
                          disabled={printingId === entry.id}
                          className="p-1 rounded text-muted hover:text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-60"
                          title="Print Payroll Voucher"
                        >
                          {printingId === entry.id ? (
                            <span className="w-3.5 h-3.5 border border-muted border-t-transparent rounded-full animate-spin inline-block" />
                          ) : (
                            <Printer className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => setEditEntry(entry)}
                          className="p-1 rounded text-muted hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                          title="Edit Entry"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(entry)}
                          disabled={deletingId === entry.id}
                          className="p-1 rounded text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                          title="Delete Entry"
                        >
                          {deletingId === entry.id ? (
                            <span className="w-3.5 h-3.5 border border-muted border-t-transparent rounded-full animate-spin inline-block" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Table Footer totals */}
              {filteredEntries.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border-subtle bg-bg-muted">
                    <td colSpan={8} className="py-3 px-4 text-xs font-semibold text-muted">
                      Total ({filteredEntries.length} entries)
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                      {formatPKR(filteredEntries.reduce((s, e) => s + e.amount, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </GlassCard>

      {/* Payroll Form Modal (create + edit) */}
      <PayrollFormModal
        isOpen={formOpen || editEntry !== null}
        onClose={() => {
          setFormOpen(false);
          setEditEntry(null);
        }}
        entry={editEntry}
        accounts={accounts}
        onSuccess={(entry) => {
          handleEntrySaved(entry);
          setFormOpen(false);
          setEditEntry(null);
        }}
      />
    </div>
  );
}
