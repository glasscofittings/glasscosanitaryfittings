"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { X, AlertCircle, Check, Banknote, Building2 } from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import { formatPKR } from "@/lib/utils/formatters";
import { type Account } from "@/lib/supabase/ledger";
import {
  type PayrollEntry,
  type PayrollType,
  type EmploymentType,
  type PayrollPaymentMethod,
  PAYROLL_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  createPayrollEntry,
  updatePayrollEntry,
} from "@/lib/supabase/payroll";
import { useAuth } from "@/components/providers/AuthProvider";

interface PayrollFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onSuccess: (entry: PayrollEntry) => void;
  /** When set, the modal pre-populates and updates this entry instead of creating one. */
  entry?: PayrollEntry | null;
}

export default function PayrollFormModal({
  isOpen,
  onClose,
  accounts,
  onSuccess,
  entry = null,
}: PayrollFormModalProps) {
  const { profile } = useAuth();

  const [employeeName, setEmployeeName] = useState("");
  const [amount, setAmount] = useState("");
  const [payrollType, setPayrollType] = useState<PayrollType>("PRODUCTION_COGS");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("PART_TIME_WAGE");
  const [paymentMethod, setPaymentMethod] = useState<PayrollPaymentMethod>("CASH");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [payrollDate, setPayrollDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastSubmitRef = useRef<number>(0);

  // Filtered account lists
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "EXPENSE"),
    [accounts]
  );

  const liquidAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.is_liquid_funds ||
          a.is_default_cash ||
          a.account_code === "1000" ||
          a.account_code === "1002" ||
          (a.account_type === "ASSET" && /cash|bank/i.test(a.account_name))
      ),
    [accounts]
  );

  // Suggested default expense accounts based on payroll type
  const suggestedExpenseAccounts = useMemo(() => {
    if (payrollType === "PRODUCTION_COGS") {
      // Prefer accounts with codes 4xxx (COGS) or "labour", "wages", "production" keywords
      const cogs = expenseAccounts.filter(
        (a) =>
          a.account_code.startsWith("4") ||
          /labour|labor|wages|production|cogs/i.test(a.account_name)
      );
      return cogs.length > 0 ? cogs : expenseAccounts;
    } else {
      // Admin: prefer 5xxx or "salary", "admin", "management" keywords
      const admin = expenseAccounts.filter(
        (a) =>
          a.account_code.startsWith("5") ||
          /salary|salaries|admin|management|office/i.test(a.account_name)
      );
      return admin.length > 0 ? admin : expenseAccounts;
    }
  }, [expenseAccounts, payrollType]);

  // Auto-select cash/bank account based on payment method
  useEffect(() => {
    if (!paymentAccountId) {
      const defaultAcc = liquidAccounts.find((a) =>
        paymentMethod === "CASH"
          ? a.is_default_cash || /cash in hand/i.test(a.account_name)
          : /bank/i.test(a.account_name)
      );
      if (defaultAcc) setPaymentAccountId(defaultAcc.id);
    }
  }, [paymentMethod, liquidAccounts, paymentAccountId]);

  // Reset (create) or pre-populate (edit) when the modal opens
  useEffect(() => {
    if (isOpen) {
      setEmployeeName(entry?.employee_name ?? "");
      setAmount(entry ? String(entry.amount) : "");
      setPayrollType(entry?.payroll_type ?? "PRODUCTION_COGS");
      setEmploymentType(entry?.employment_type ?? "PART_TIME_WAGE");
      setPaymentMethod(entry?.payment_method ?? "CASH");
      setExpenseAccountId(entry?.expense_account_id ?? "");
      setPaymentAccountId(entry?.payment_account_id ?? "");
      setNotes(entry?.notes ?? "");
      setPayrollDate(entry?.payroll_date ?? new Date().toISOString().slice(0, 10));
      setErrors({});
    }
  }, [isOpen, entry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (isSubmitting || now - lastSubmitRef.current < 1500) return;
    lastSubmitRef.current = now;
    setIsSubmitting(true);

    const parsedAmount = parseFloat(amount);

    const payload = {
      employee_name: employeeName.trim(),
      amount: parsedAmount,
      payroll_type: payrollType,
      employment_type: employmentType,
      payment_method: paymentMethod,
      expense_account_id: expenseAccountId,
      payment_account_id: paymentAccountId,
      notes: notes.trim() || null,
      payroll_date: payrollDate,
      operator_name: profile?.email || "System Operator",
    };

    const { data, error } = entry
      ? await updatePayrollEntry(entry.id, payload)
      : await createPayrollEntry(payload);

    setIsSubmitting(false);

    if (error || !data) {
      toast.error(
        error || (entry ? "Failed to update payroll entry." : "Failed to record payroll entry.")
      );
      return;
    }

    toast.success(
      entry
        ? `Payroll entry ${data.entry_number} updated — journal re-posted.`
        : `Payroll entry ${data.entry_number} recorded successfully.`
    );
    onSuccess(data);
    onClose();
  };

  if (!isOpen) return null;

  const amountNum = parseFloat(amount) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto glass-card rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-surface-card/90 backdrop-blur-sm rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {entry ? "Edit Payroll Entry" : "Record Payroll Entry"}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {entry
                ? `Updating ${entry.entry_number} — re-posts Dr Expense → Cr Cash/Bank`
                : "Double-entry posting: Dr Expense → Cr Cash/Bank"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Payroll Type — big toggle cards */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Cost Category
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(["PRODUCTION_COGS", "ADMIN_FIXED"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setPayrollType(t);
                    setExpenseAccountId(""); // reset so user re-picks
                  }}
                  className={[
                    "flex flex-col items-start gap-1 p-3.5 rounded-xl border-2 transition-all text-left",
                    payrollType === t
                      ? t === "PRODUCTION_COGS"
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-blue-500 bg-blue-500/10"
                      : "border-border-subtle bg-surface-subtle hover:bg-bg-hover",
                  ].join(" ")}
                >
                  <span className="text-xs font-bold text-foreground">
                    {PAYROLL_TYPE_LABELS[t]}
                  </span>
                  <span className="text-[10px] text-muted leading-tight">
                    {t === "PRODUCTION_COGS"
                      ? "Deducted from Gross Profit (COGS)"
                      : "Fixed Admin Expense (below GP)"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Employment Type */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Employment Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(["PERMANENT_SALARY", "PART_TIME_WAGE", "DAILY_PAY"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEmploymentType(t)}
                  className={[
                    "flex flex-col items-start gap-1 p-3 rounded-xl border-2 transition-all text-left",
                    employmentType === t
                      ? "border-crimson-primary bg-crimson-primary/10"
                      : "border-border-subtle bg-surface-subtle hover:bg-bg-hover",
                  ].join(" ")}
                >
                  <span className="text-xs font-bold text-foreground">
                    {EMPLOYMENT_TYPE_LABELS[t]}
                  </span>
                  <span className="text-[10px] text-muted leading-tight">
                    {t === "PERMANENT_SALARY" ? "Fixed monthly cost" : t === "PART_TIME_WAGE" ? "Variable / hourly rate" : "Paid per day worked"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Employee Name + Amount row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                Employee / Payee Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="e.g. Ahmed Ali"
                className={`w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border ${
                  errors.employee_name ? "border-red-500" : "border-border-subtle"
                } text-foreground focus:outline-none focus:border-crimson-primary`}
              />
              {errors.employee_name && (
                <p className="text-[11px] text-red-400 mt-1">{errors.employee_name}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                Amount (PKR) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className={`w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border ${
                  errors.amount ? "border-red-500" : "border-border-subtle"
                } text-foreground focus:outline-none focus:border-crimson-primary`}
              />
              {errors.amount && <p className="text-[11px] text-red-400 mt-1">{errors.amount}</p>}
            </div>
          </div>

          {/* Payment Method — cash vs bank */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Payment Source <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod("CASH");
                  setPaymentAccountId("");
                }}
                className={[
                  "flex items-center gap-2.5 p-3.5 rounded-xl border-2 transition-all",
                  paymentMethod === "CASH"
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-border-subtle bg-surface-subtle hover:bg-bg-hover",
                ].join(" ")}
              >
                <Banknote
                  className={`w-5 h-5 ${paymentMethod === "CASH" ? "text-emerald-400" : "text-muted"}`}
                />
                <div className="text-left">
                  <p className="text-xs font-bold text-foreground">Cash Payment</p>
                  <p className="text-[10px] text-muted">Deducts from Shop Cash</p>
                </div>
                {paymentMethod === "CASH" && (
                  <Check className="w-4 h-4 text-emerald-400 ml-auto" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod("BANK");
                  setPaymentAccountId("");
                }}
                className={[
                  "flex items-center gap-2.5 p-3.5 rounded-xl border-2 transition-all",
                  paymentMethod === "BANK"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border-subtle bg-surface-subtle hover:bg-bg-hover",
                ].join(" ")}
              >
                <Building2
                  className={`w-5 h-5 ${paymentMethod === "BANK" ? "text-blue-400" : "text-muted"}`}
                />
                <div className="text-left">
                  <p className="text-xs font-bold text-foreground">Bank Transfer</p>
                  <p className="text-[10px] text-muted">Deducts from Bank Account</p>
                </div>
                {paymentMethod === "BANK" && (
                  <Check className="w-4 h-4 text-blue-400 ml-auto" />
                )}
              </button>
            </div>
          </div>

          {/* Accounts row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Expense (Debit) Account */}
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                Debit Account (Expense) <span className="text-red-400">*</span>
              </label>
              <select
                value={expenseAccountId}
                onChange={(e) => setExpenseAccountId(e.target.value)}
                className={`w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border ${
                  errors.expense_account_id ? "border-red-500" : "border-border-subtle"
                } text-foreground focus:outline-none focus:border-crimson-primary`}
              >
                <option value="">— Select expense account —</option>
                {suggestedExpenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    [{a.account_code}] {a.account_name}
                  </option>
                ))}
                {/* Show remaining accounts not in suggestions */}
                {expenseAccounts
                  .filter((a) => !suggestedExpenseAccounts.some((s) => s.id === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.account_code}] {a.account_name}
                    </option>
                  ))}
              </select>
              {errors.expense_account_id && (
                <p className="text-[11px] text-red-400 mt-1">{errors.expense_account_id}</p>
              )}
            </div>

            {/* Payment (Credit) Account */}
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                Credit Account ({paymentMethod === "CASH" ? "Cash" : "Bank"}){" "}
                <span className="text-red-400">*</span>
              </label>
              <select
                value={paymentAccountId}
                onChange={(e) => setPaymentAccountId(e.target.value)}
                className={`w-full px-3 py-2 text-xs rounded-lg bg-surface-subtle border ${
                  errors.payment_account_id ? "border-red-500" : "border-border-subtle"
                } text-foreground focus:outline-none focus:border-crimson-primary`}
              >
                <option value="">— Select cash / bank account —</option>
                {liquidAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    [{a.account_code}] {a.account_name}
                  </option>
                ))}
              </select>
              {errors.payment_account_id && (
                <p className="text-[11px] text-red-400 mt-1">{errors.payment_account_id}</p>
              )}
            </div>
          </div>

          {/* Date + Notes row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                Payroll Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={payrollDate}
                onChange={(e) => setPayrollDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                Notes (optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. October salary, week 3 wages…"
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              />
            </div>
          </div>

          {/* Journal preview banner */}
          {amountNum > 0 && expenseAccountId && paymentAccountId && (
            <div className="bg-surface-subtle rounded-xl border border-border-subtle p-4 space-y-2">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Journal Entry Preview
              </p>
              <div className="space-y-1 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-foreground">
                    Dr{" "}
                    {expenseAccounts.find((a) => a.id === expenseAccountId)?.account_name ||
                      "Expense Account"}
                  </span>
                  <span className="text-emerald-400 font-bold">{formatPKR(amountNum)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground pl-4">
                    Cr{" "}
                    {liquidAccounts.find((a) => a.id === paymentAccountId)?.account_name ||
                      "Cash / Bank"}
                  </span>
                  <span className="text-red-400 font-bold">{formatPKR(amountNum)}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted">
                Balanced entry · {PAYROLL_TYPE_LABELS[payrollType]} ·{" "}
                {EMPLOYMENT_TYPE_LABELS[employmentType]}
              </p>
            </div>
          )}

          {/* Global error */}
          {errors.global && (
            <div className="flex items-start gap-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg px-3 py-2.5 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errors.global}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border-subtle text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <CrimsonButton type="submit" disabled={isSubmitting} className="min-w-[140px]">
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {entry ? "Saving…" : "Posting…"}
                </span>
              ) : entry ? (
                "Save Changes"
              ) : (
                "Post Payroll Entry"
              )}
            </CrimsonButton>
          </div>
        </form>
      </div>
    </div>
  );
}
