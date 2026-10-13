"use client";

import React, { useState, useMemo } from "react";
import { toast } from "sonner";
import { X, CheckCircle2 } from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import { formatPKR } from "@/lib/utils/formatters";
import { type Account } from "@/lib/supabase/ledger";
import {
  type Expense,
  type ExpensePaymentMethod,
  payUnpaidExpense,
} from "@/lib/supabase/expenses";
import { useAuth } from "@/components/providers/AuthProvider";

interface PayExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense;
  accounts: Account[];
  onSuccess: (updated: Expense) => void;
}

export default function PayExpenseModal({
  isOpen,
  onClose,
  expense,
  accounts,
  onSuccess,
}: PayExpenseModalProps) {
  const { profile } = useAuth();
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>("CASH");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Available Cash / Bank liquid accounts
  const liquidAccounts = useMemo(() => {
    return accounts.filter(
      (a) =>
        a.is_liquid_funds ||
        a.is_default_cash ||
        a.account_code === "1000" ||
        a.account_code === "1002" ||
        (a.account_type === "ASSET" && /cash|bank/i.test(a.account_name))
    );
  }, [accounts]);

  // Set default cash account
  React.useEffect(() => {
    if (isOpen && liquidAccounts.length > 0 && !paymentAccountId) {
      const defaultAcc =
        liquidAccounts.find((a) => a.is_default_cash || a.account_code === "1000") ||
        liquidAccounts[0];
      setPaymentAccountId(defaultAcc.id);
    }
  }, [isOpen, liquidAccounts, paymentAccountId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Entry guard: a rapid double-click must not start two payment attempts
    // before the first setState lands (the RPC guards the server side too,
    // but the degraded REST path has no such protection).
    if (isSubmitting) return;
    if (!paymentAccountId) {
      toast.error("Please select a Cash or Bank payment account.");
      return;
    }

    setIsSubmitting(true);
    try {
      const operatorName = profile?.email || "Terminal Operator";
      const { data, error } = await payUnpaidExpense(
        expense.id,
        paymentAccountId,
        paymentMethod,
        paymentDate,
        operatorName
      );

      if (error) {
        toast.error(`Payment failed: ${error}`);
        setIsSubmitting(false);
        return;
      }

      if (data) {
        toast.success(`Expense ${expense.expense_number} marked as PAID. Posted to ledger.`);
        onSuccess(data);
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-muted">
          <div>
            <h2 className="text-base font-bold text-foreground">Record Expense Payment</h2>
            <p className="text-xs text-muted mt-0.5">Settle accrued expense from Cash / Bank</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted">Expense No:</span>
              <span className="font-mono font-semibold text-foreground">{expense.expense_number}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted">Payee / Vendor:</span>
              <span className="font-medium text-foreground">{expense.payee_name || "—"}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted">Description:</span>
              <span className="font-medium text-foreground truncate max-w-[200px]">
                {expense.description}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs pt-1 border-t border-border-subtle">
              <span className="text-muted font-semibold">Total Amount:</span>
              <span className="font-bold text-sm text-foreground">{formatPKR(expense.amount)}</span>
            </div>
          </div>

          {/* Double Entry explanation */}
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 space-y-0.5">
            <p className="font-semibold">Double-Entry Journal Posting:</p>
            <p>• DEBIT: Accounts Payable (2001) {formatPKR(expense.amount)}</p>
            <p>• CREDIT: Selected Cash/Bank Account {formatPKR(expense.amount)}</p>
          </div>

          {/* Payment Date */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Payment Date</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              required
            />
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Payment Method</label>
            <div className="flex gap-4">
              {(["CASH", "BANK", "CHEQUE"] as ExpensePaymentMethod[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="payMethod"
                    value={m}
                    checked={paymentMethod === m}
                    onChange={() => setPaymentMethod(m)}
                    className="accent-crimson-primary"
                  />
                  <span>{m}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Cash / Bank Account */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Credit Account (Money Out) <span className="text-red-500">*</span>
            </label>
            <select
              value={paymentAccountId}
              onChange={(e) => setPaymentAccountId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              required
            >
              {liquidAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.account_code}] {a.account_name}
                </option>
              ))}
            </select>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium rounded-lg text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <CrimsonButton type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Settling…" : "Confirm & Settle"}
            </CrimsonButton>
          </div>
        </form>
      </div>
    </div>
  );
}
