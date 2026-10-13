"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import {
  X,
  Printer,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Ban,
  Download,
  ExternalLink,
} from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import { formatPKR } from "@/lib/utils/formatters";
import {
  type Expense,
  cancelExpense,
  deleteExpenseDraft,
} from "@/lib/supabase/expenses";
import { useAuth } from "@/components/providers/AuthProvider";

interface ExpenseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense;
  onSettle: (expense: Expense) => void;
  onRefresh: () => void;
  onExportPDF: (expense: Expense) => void;
}

export default function ExpenseDetailModal({
  isOpen,
  onClose,
  expense,
  onSettle,
  onRefresh,
  onExportPDF,
}: ExpenseDetailModalProps) {
  const { profile } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!isOpen) return null;

  const handleCancelExpense = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please provide a reason for cancelling this expense.");
      return;
    }

    setCancelling(true);
    try {
      const operatorName = profile?.email || "Terminal Operator";
      const { error } = await cancelExpense(expense.id, operatorName, cancelReason);

      if (error) {
        toast.error(`Cancellation failed: ${error}`);
        setCancelling(false);
        return;
      }

      toast.success(`Expense ${expense.expense_number} cancelled and journal entries reversed.`);
      onRefresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel expense.");
      setCancelling(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!confirm("Are you sure you want to permanently delete this draft expense?")) return;

    setDeleting(true);
    try {
      const { success, error } = await deleteExpenseDraft(expense.id);
      if (!success) {
        toast.error(error || "Failed to delete draft.");
        setDeleting(false);
        return;
      }
      toast.success("Draft expense deleted.");
      onRefresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete draft.");
      setDeleting(false);
    }
  };

  const statusBadge = () => {
    switch (expense.status) {
      case "PAID":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" /> PAID
          </span>
        );
      case "UNPAID":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Clock className="w-3.5 h-3.5" /> UNPAID / ACCRUED
          </span>
        );
      case "DRAFT":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-surface-subtle text-muted border border-border-subtle">
            <FileText className="w-3.5 h-3.5" /> DRAFT
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
            <Ban className="w-3.5 h-3.5" /> CANCELLED
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-muted">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-foreground font-mono">
                  {expense.expense_number}
                </span>
                {statusBadge()}
              </div>
              <p className="text-xs text-muted mt-0.5">
                Recorded on {new Date(expense.expense_date).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Main Info Card */}
          <div className="p-4 rounded-lg bg-surface-subtle border border-border-subtle flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted font-medium">Category</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{expense.category}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-muted font-medium">Amount</p>
              <p className="text-xl font-bold text-foreground mt-0.5 font-mono">
                {formatPKR(expense.amount)}
              </p>
            </div>
          </div>

          {/* Details Table */}
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border-subtle">
              <span className="text-muted">Description:</span>
              <span className="font-medium text-foreground text-right max-w-[280px]">
                {expense.description}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-border-subtle">
              <span className="text-muted">Payee / Vendor:</span>
              <span className="font-medium text-foreground">
                {expense.payee_name || "—"}
                {expense.party && (
                  <span className="text-muted ml-1">({expense.party.name})</span>
                )}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-border-subtle">
              <span className="text-muted">Payment Method:</span>
              <span className="font-medium text-foreground">{expense.payment_method}</span>
            </div>

            {/* Accounting Breakdown */}
            <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle space-y-1.5 my-3">
              <p className="font-bold text-foreground uppercase tracking-wider text-[11px]">
                General Ledger Posting Breakdown
              </p>

              <div className="flex justify-between text-emerald-400">
                <span>DEBIT: Expense Account</span>
                <span className="font-mono font-medium">
                  {expense.expense_account
                    ? `[${expense.expense_account.account_code}] ${expense.expense_account.account_name}`
                    : "Resolved in Ledger"}
                </span>
              </div>

              <div className="flex justify-between text-blue-400">
                <span>
                  CREDIT: {expense.status === "UNPAID" ? "Accounts Payable" : "Cash / Bank"}
                </span>
                <span className="font-mono font-medium">
                  {expense.status === "UNPAID"
                    ? expense.payable_account
                      ? `[${expense.payable_account.account_code}] ${expense.payable_account.account_name}`
                      : "[2001] Accounts Payable"
                    : expense.payment_account
                    ? `[${expense.payment_account.account_code}] ${expense.payment_account.account_name}`
                    : "Cash / Bank"}
                </span>
              </div>

              {expense.journal_entry_id && (
                <div className="flex justify-between text-muted text-[10px] pt-1 border-t border-border-subtle">
                  <span>Journal Ref:</span>
                  <span className="font-mono">{expense.journal_entry_id}</span>
                </div>
              )}

              {expense.payment_journal_entry_id && (
                <div className="flex justify-between text-emerald-500 text-[10px]">
                  <span>Payment Settlement Ref:</span>
                  <span className="font-mono">{expense.payment_journal_entry_id}</span>
                </div>
              )}
            </div>

            {expense.notes && (
              <div className="py-1.5 border-b border-border-subtle">
                <span className="text-muted block mb-0.5">Notes:</span>
                <p className="text-foreground whitespace-pre-wrap">{expense.notes}</p>
              </div>
            )}

            {/* Receipt Attachment preview */}
            {expense.receipt_url && (
              <div className="py-2">
                <span className="text-muted block mb-1">Receipt Attachment:</span>
                {expense.receipt_url.startsWith("data:image") ? (
                  <div className="border border-border-subtle rounded-lg overflow-hidden max-h-48">
                    <img
                      src={expense.receipt_url}
                      alt="Receipt Attachment"
                      className="w-full h-auto object-contain max-h-48"
                    />
                  </div>
                ) : (
                  <a
                    href={expense.receipt_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-crimson-primary hover:underline font-medium"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View Receipt Document
                  </a>
                )}
              </div>
            )}

            <div className="flex justify-between text-muted text-[11px] pt-2">
              <span>Recorded By:</span>
              <span>{expense.operator_name || "System Operator"}</span>
            </div>
          </div>

          {/* Cancellation Prompt inline */}
          {showCancelPrompt && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400">
                <AlertTriangle className="w-4 h-4" /> Cancel Expense & Reverse Ledger
              </div>
              <p className="text-[11px] text-muted">
                Cancelling will permanently reverse and delete associated journal entries so posted balances remain untouched.
              </p>
              <input
                type="text"
                placeholder="Reason for cancellation (required)…"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded bg-surface-subtle border border-border-subtle text-foreground focus:outline-none"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCancelPrompt(false)}
                  className="px-2.5 py-1 text-xs text-muted hover:text-foreground"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCancelExpense}
                  disabled={cancelling}
                  className="px-3 py-1 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-700"
                >
                  {cancelling ? "Cancelling…" : "Confirm Cancel"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle bg-bg-muted">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onExportPDF(expense)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border-subtle text-foreground hover:bg-bg-hover transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Print / Export PDF
            </button>

            {expense.status !== "CANCELLED" && !showCancelPrompt && (
              <button
                onClick={() => setShowCancelPrompt(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Cancel Expense
              </button>
            )}

            {expense.status === "DRAFT" && (
              <button
                onClick={handleDeleteDraft}
                disabled={deleting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
              >
                {deleting ? "Deleting…" : "Delete Draft"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {expense.status === "UNPAID" && (
              <CrimsonButton
                onClick={() => {
                  onSettle(expense);
                  onClose();
                }}
              >
                Record Payment
              </CrimsonButton>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
