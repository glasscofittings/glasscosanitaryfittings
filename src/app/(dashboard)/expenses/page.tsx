"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Filter,
  Download,
  RefreshCw,
  FileText,
  Clock,
  CheckCircle2,
  Ban,
  Printer,
  Eye,
  Pencil,
  CreditCard,
  Calendar,
} from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import GlassCard from "@/components/ui/GlassCard";
import { formatPKR } from "@/lib/utils/formatters";
import { fetchAccounts, type Account } from "@/lib/supabase/ledger";
import {
  type Expense,
  type ExpenseCategory,
  type ExpenseStatus,
  type ExpensePaymentMethod,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  fetchExpenses,
  calculateExpenseSummary,
} from "@/lib/supabase/expenses";
import { exportExpensesReportPDF, exportExpenseVoucherPDF } from "@/lib/pdf-exporter";
import ExpenseSummaryCards from "@/components/modules/expenses/ExpenseSummaryCards";
import ExpenseFormModal from "@/components/modules/expenses/ExpenseFormModal";
import ExpenseDetailModal from "@/components/modules/expenses/ExpenseDetailModal";
import PayExpenseModal from "@/components/modules/expenses/PayExpenseModal";
import { useAuth } from "@/components/providers/AuthProvider";

type StatusTab = "ALL" | "PAID" | "UNPAID" | "DRAFT" | "CANCELLED";
type DatePreset = "ALL" | "TODAY" | "THIS_MONTH" | "LAST_30_DAYS";

export default function ExpensesPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | "ALL">("ALL");
  const [statusTab, setStatusTab] = useState<StatusTab>("ALL");
  const [datePreset, setDatePreset] = useState<DatePreset>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [payExpense, setPayExpense] = useState<Expense | null>(null);
  const [exportingReport, setExportingReport] = useState(false);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      const [accs, exps] = await Promise.all([fetchAccounts(), fetchExpenses()]);
      setAccounts(accs);
      setExpenses(exps);
    } catch (err) {
      console.error("Failed to load expenses:", err);
      toast.error("Failed to load expense records.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle date preset change
  const handleDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const today = new Date().toISOString().slice(0, 10);

    if (preset === "TODAY") {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === "THIS_MONTH") {
      const firstDay = `${today.slice(0, 7)}-01`;
      setStartDate(firstDay);
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

  // Filtered expenses list
  const filteredExpenses = useMemo(() => {
    let result = [...expenses];

    // Status filter
    if (statusTab !== "ALL") {
      result = result.filter((e) => e.status === statusTab);
    }

    // Category filter
    if (selectedCategory !== "ALL") {
      result = result.filter((e) => e.category === selectedCategory);
    }

    // Date filters
    if (startDate) {
      result = result.filter((e) => e.expense_date >= startDate);
    }
    if (endDate) {
      result = result.filter((e) => e.expense_date <= endDate);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.expense_number.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          (e.payee_name && e.payee_name.toLowerCase().includes(q)) ||
          (e.notes && e.notes.toLowerCase().includes(q)) ||
          e.category.toLowerCase().includes(q)
      );
    }

    return result;
  }, [expenses, statusTab, selectedCategory, startDate, endDate, searchQuery]);

  // Summary Metrics
  const summary = useMemo(() => {
    return calculateExpenseSummary(expenses);
  }, [expenses]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    toast.success("Expense list updated.");
  };

  const handleExpenseCreated = (newExp: Expense) => {
    // Upsert by id: creation prepends, an in-place draft edit replaces —
    // never both (which would duplicate the row in the table).
    setExpenses((prev) =>
      prev.some((e) => e.id === newExp.id)
        ? prev.map((e) => (e.id === newExp.id ? newExp : e))
        : [newExp, ...prev]
    );
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
    queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
  };

  const handleExportReport = async () => {
    if (filteredExpenses.length === 0 || exportingReport) return;
    setExportingReport(true);
    try {
      const operatorName = profile?.email || "Finance Dept";
      const subtitle =
        statusTab !== "ALL"
          ? `Status: ${statusTab} | Category: ${selectedCategory}`
          : `Category: ${selectedCategory}`;

      await exportExpensesReportPDF(filteredExpenses, { subtitle, operatorName });
      toast.success("Expense report exported.");
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setExportingReport(false);
    }
  };

  const handleExportSingleVoucher = async (exp: Expense) => {
    try {
      const operatorName = profile?.email || "Finance Dept";
      await exportExpenseVoucherPDF(exp, { operatorName });
      toast.success(`Voucher ${exp.expense_number} exported.`);
    } catch (err) {
      toast.error(`Voucher export failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const renderStatusBadge = (status: ExpenseStatus) => {
    switch (status) {
      case "PAID":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> PAID
          </span>
        );
      case "UNPAID":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Clock className="w-3 h-3" /> UNPAID
          </span>
        );
      case "DRAFT":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-bg-active text-muted border border-border-default">
            <FileText className="w-3 h-3" /> DRAFT
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
            <Ban className="w-3 h-3" /> CANCELLED
          </span>
        );
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Expense Management
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Double-entry expense tracking, category budgeting, and accruals
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg border border-border-subtle bg-surface-card text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={handleExportReport}
            disabled={exportingReport || filteredExpenses.length === 0}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-border-subtle bg-surface-card text-foreground hover:bg-bg-hover transition-colors inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-muted" />
            <span>Export Report</span>
          </button>

          <CrimsonButton
            onClick={() => {
              setEditExpense(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Record Expense</span>
          </CrimsonButton>
        </div>
      </div>

      {/* Summary KPI Cards & Category Breakdown */}
      <ExpenseSummaryCards
        summary={summary}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      {/* Controls & Filters Bar */}
      <GlassCard className="p-4 space-y-3">
        {/* Status Tabs */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-border-subtle">
          <div className="flex items-center gap-1 overflow-x-auto">
            {(
              [
                { key: "ALL", label: "All Expenses" },
                { key: "PAID", label: "Paid" },
                { key: "UNPAID", label: "Unpaid / Accrued" },
                { key: "DRAFT", label: "Drafts" },
                { key: "CANCELLED", label: "Cancelled" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setStatusTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusTab === t.key
                    ? "bg-crimson-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground hover:bg-bg-hover"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <span className="text-xs text-muted font-mono">
            {filteredExpenses.length} of {expenses.length} records
          </span>
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by #, description, payee…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            />
          </div>

          {/* Category Dropdown */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as ExpenseCategory | "ALL")}
              className="w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
            >
              <option value="ALL">All Categories</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
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

          {/* Date Range Inputs */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset("ALL");
              }}
              className="w-1/2 px-2 py-1.5 text-[11px] rounded bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              title="Start Date"
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
              title="End Date"
            />
          </div>
        </div>
      </GlassCard>

      {/* Main Expense Table */}
      <GlassCard className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted">
            <div className="w-6 h-6 border-2 border-crimson-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading expenses…</p>
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="p-12 text-center text-muted space-y-2">
            <FileText className="w-10 h-10 mx-auto text-muted/50" />
            <p className="text-sm font-medium">No expenses found</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              No expense records match the current filters. Clear your filters or record a new expense.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-muted text-muted uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4 font-semibold">Expense #</th>
                  <th className="py-3 px-3 font-semibold">Date</th>
                  <th className="py-3 px-3 font-semibold">Category</th>
                  <th className="py-3 px-4 font-semibold">Description / Payee</th>
                  <th className="py-3 px-3 font-semibold">Status</th>
                  <th className="py-3 px-3 font-semibold">Debit (Expense)</th>
                  <th className="py-3 px-3 font-semibold">Credit (Payment/AP)</th>
                  <th className="py-3 px-4 font-semibold text-right">Amount (PKR)</th>
                  <th className="py-3 px-4 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/50 font-normal">
                {filteredExpenses.map((exp) => (
                  <tr
                    key={exp.id}
                    className="hover:bg-bg-hover transition-colors cursor-pointer group"
                    onClick={() => setDetailExpense(exp)}
                  >
                    {/* Expense Number */}
                    <td className="py-3 px-4 font-mono font-semibold text-foreground whitespace-nowrap">
                      {exp.expense_number}
                    </td>

                    {/* Date */}
                    <td className="py-3 px-3 text-muted whitespace-nowrap">
                      {new Date(exp.expense_date).toLocaleDateString()}
                    </td>

                    {/* Category */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-surface-subtle text-foreground border border-border-subtle">
                        {EXPENSE_CATEGORY_LABELS[exp.category] || exp.category}
                      </span>
                    </td>

                    {/* Description / Payee */}
                    <td className="py-3 px-4 max-w-[220px]">
                      <div className="font-medium text-foreground truncate" title={exp.description}>
                        {exp.description}
                      </div>
                      {exp.payee_name && (
                        <div className="text-[11px] text-muted truncate">
                          Payee: {exp.payee_name}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3 whitespace-nowrap">{renderStatusBadge(exp.status)}</td>

                    {/* Debit Account */}
                    <td className="py-3 px-3 text-muted truncate max-w-[140px]" title={exp.expense_account?.account_name}>
                      {exp.expense_account
                        ? `[${exp.expense_account.account_code}] ${exp.expense_account.account_name}`
                        : "Expense Account"}
                    </td>

                    {/* Credit Account */}
                    <td className="py-3 px-3 text-muted truncate max-w-[140px]">
                      {exp.status === "UNPAID"
                        ? exp.payable_account
                          ? `[${exp.payable_account.account_code}] ${exp.payable_account.account_name}`
                          : "[2001] Accounts Payable"
                        : exp.payment_account
                        ? `[${exp.payment_account.account_code}] ${exp.payment_account.account_name}`
                        : "Cash/Bank"}
                    </td>

                    {/* Amount */}
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground whitespace-nowrap">
                      {formatPKR(exp.amount)}
                    </td>

                    {/* Actions */}
                    <td
                      className="py-3 px-4 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setDetailExpense(exp)}
                          className="p-1 rounded text-muted hover:text-foreground hover:bg-bg-hover"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {exp.status === "DRAFT" && (
                          <button
                            onClick={() => {
                              setEditExpense(exp);
                              setFormOpen(true);
                            }}
                            className="p-1 rounded text-muted hover:text-foreground hover:bg-bg-hover"
                            title="Edit Draft"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {exp.status === "UNPAID" && (
                          <button
                            onClick={() => setPayExpense(exp)}
                            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                            title="Record Payment"
                          >
                            Pay
                          </button>
                        )}

                        <button
                          onClick={() => handleExportSingleVoucher(exp)}
                          className="p-1 rounded text-muted hover:text-foreground hover:bg-bg-hover"
                          title="Print Voucher"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Expense Form Modal (Create / Edit) */}
      <ExpenseFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        accounts={accounts}
        onSuccess={handleExpenseCreated}
        editExpense={editExpense}
      />

      {/* Expense Detail Modal */}
      {detailExpense && (
        <ExpenseDetailModal
          isOpen={!!detailExpense}
          onClose={() => setDetailExpense(null)}
          expense={detailExpense}
          onSettle={(exp) => setPayExpense(exp)}
          onRefresh={loadData}
          onExportPDF={handleExportSingleVoucher}
        />
      )}

      {/* Pay Unpaid Expense Modal */}
      {payExpense && (
        <PayExpenseModal
          isOpen={!!payExpense}
          onClose={() => setPayExpense(null)}
          expense={payExpense}
          accounts={accounts}
          onSuccess={() => {
            loadData();
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
          }}
        />
      )}
    </div>
  );
}