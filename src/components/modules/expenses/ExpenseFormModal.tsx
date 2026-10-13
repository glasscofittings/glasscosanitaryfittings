"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { X, Upload, Check, AlertCircle } from "lucide-react";
import CrimsonButton from "@/components/ui/CrimsonButton";
import { formatPKR } from "@/lib/utils/formatters";
import { type Account } from "@/lib/supabase/ledger";
import { type Party, fetchParties } from "@/lib/supabase/crm";
import {
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMethod,
  type ExpenseStatus,
  EXPENSE_CATEGORIES,
  createExpense,
  updateExpenseDraft,
} from "@/lib/supabase/expenses";
import { useAuth } from "@/components/providers/AuthProvider";

interface ExpenseFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onSuccess: (expense: Expense) => void;
  editExpense?: Expense | null;
}

export default function ExpenseFormModal({
  isOpen,
  onClose,
  accounts,
  onSuccess,
  editExpense,
}: ExpenseFormModalProps) {
  const { profile } = useAuth();
  const [parties, setParties] = useState<Party[]>([]);

  // Form states
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<ExpenseCategory>("MISCELLANEOUS");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<ExpenseStatus>("PAID");
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>("CASH");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [payableAccountId, setPayableAccountId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastSubmitTimestampRef = useRef<number>(0);

  // Filter accounts
  const expenseAccounts = useMemo(() => {
    return accounts.filter((a) => a.account_type === "EXPENSE");
  }, [accounts]);

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

  const liabilityAccounts = useMemo(() => {
    return accounts.filter(
      (a) =>
        a.account_type === "LIABILITY" ||
        a.account_code === "2001" ||
        /payable/i.test(a.account_name)
    );
  }, [accounts]);

  // Load CRM parties
  useEffect(() => {
    if (isOpen) {
      fetchParties("ALL").then(setParties).catch(() => {});
    }
  }, [isOpen]);

  // Set default accounts when accounts load or category changes
  useEffect(() => {
    if (!isOpen) return;

    if (!editExpense) {
      // Find default expense account based on category
      const targetCat = EXPENSE_CATEGORIES.find((c) => c.value === category);
      const defaultCode = targetCat?.defaultCode;

      let matched = expenseAccounts.find((a) => a.account_code === defaultCode);
      if (!matched && targetCat) {
        const keyword = targetCat.label.split(" ")[0].toLowerCase();
        matched = expenseAccounts.find((a) => a.account_name.toLowerCase().includes(keyword));
      }
      if (!matched && expenseAccounts.length > 0) {
        matched = expenseAccounts[0];
      }
      if (matched && !expenseAccountId) {
        setExpenseAccountId(matched.id);
      }

      // Default liquid account (Cash in Hand 1000)
      if (!paymentAccountId && liquidAccounts.length > 0) {
        const cashAcc = liquidAccounts.find(
          (a) => a.is_default_cash || a.account_code === "1000"
        ) || liquidAccounts[0];
        setPaymentAccountId(cashAcc.id);
      }

      // Default payable account (2001)
      if (!payableAccountId && liabilityAccounts.length > 0) {
        const apAcc = liabilityAccounts.find(
          (a) => a.account_code === "2001"
        ) || liabilityAccounts[0];
        setPayableAccountId(apAcc.id);
      }
    }
  }, [isOpen, category, expenseAccounts, liquidAccounts, liabilityAccounts, editExpense, expenseAccountId, paymentAccountId, payableAccountId]);

  // Auto-switch account when category changes in create mode
  const handleCategoryChange = (newCat: ExpenseCategory) => {
    setCategory(newCat);
    const targetCat = EXPENSE_CATEGORIES.find((c) => c.value === newCat);
    const defaultCode = targetCat?.defaultCode;

    let matched = expenseAccounts.find((a) => a.account_code === defaultCode);
    if (!matched && targetCat) {
      const keyword = targetCat.label.split(" ")[0].toLowerCase();
      matched = expenseAccounts.find((a) => a.account_name.toLowerCase().includes(keyword));
    }
    if (matched) {
      setExpenseAccountId(matched.id);
    }
  };

  // Populate when editing
  useEffect(() => {
    if (editExpense && isOpen) {
      setExpenseDate(editExpense.expense_date);
      setCategory(editExpense.category);
      setDescription(editExpense.description);
      setAmount(editExpense.amount.toString());
      setStatus(editExpense.status);
      setPaymentMethod(editExpense.payment_method);
      setExpenseAccountId(editExpense.expense_account_id);
      setPaymentAccountId(editExpense.payment_account_id || "");
      setPayableAccountId(editExpense.payable_account_id || "");
      setPayeeName(editExpense.payee_name || "");
      setSelectedPartyId(editExpense.party_id || null);
      setNotes(editExpense.notes || "");
      setReceiptUrl(editExpense.receipt_url || null);
    } else if (!editExpense && isOpen) {
      // Reset form
      setExpenseDate(new Date().toISOString().slice(0, 10));
      setCategory("MISCELLANEOUS");
      setDescription("");
      setAmount("");
      setStatus("PAID");
      setPaymentMethod("CASH");
      setPayeeName("");
      setSelectedPartyId(null);
      setNotes("");
      setReceiptUrl(null);
      setReceiptFileName("");
      setErrors({});
    }
  }, [editExpense, isOpen]);

  // Handle receipt file upload (Base64 data url for offline/desktop storage)
  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Receipt file must be under 5MB.");
      return;
    }

    setReceiptFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setReceiptUrl(reader.result as string);
      toast.success(`Attached receipt: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handlePartySelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const partyId = e.target.value;
    if (!partyId) {
      setSelectedPartyId(null);
      return;
    }
    const found = parties.find((p) => p.id === partyId);
    if (found) {
      setSelectedPartyId(found.id);
      setPayeeName(found.name);
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!description.trim()) {
      errs.description = "Description is required.";
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      errs.amount = "Valid amount greater than 0 is required.";
    }

    if (!expenseAccountId) {
      errs.expenseAccountId = "Debit expense account is required.";
    }

    if (status === "PAID" && !paymentAccountId) {
      errs.paymentAccountId = "Cash or Bank payment account is required for paid expenses.";
    }

    if (status === "UNPAID" && !payableAccountId) {
      errs.payableAccountId = "Accounts payable liability account is required for unpaid expenses.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard duplicate submission
    const now = Date.now();
    if (isSubmitting || now - lastSubmitTimestampRef.current < 2000) {
      return;
    }

    if (!validate()) {
      toast.error("Please correct the errors in the form.");
      return;
    }

    setIsSubmitting(true);
    lastSubmitTimestampRef.current = now;

    try {
      const numAmount = parseFloat(amount);
      const operatorName = profile?.email || "Terminal Operator";

      const payload = {
        expense_date: expenseDate,
        category,
        description: description.trim(),
        amount: numAmount,
        status,
        payment_method: status === "UNPAID" ? ("PAYABLE" as ExpensePaymentMethod) : paymentMethod,
        expense_account_id: expenseAccountId,
        payment_account_id: status === "PAID" ? paymentAccountId : null,
        payable_account_id: status === "UNPAID" ? payableAccountId : null,
        party_id: selectedPartyId || null,
        payee_name: payeeName.trim() || null,
        notes: notes.trim() || null,
        receipt_url: receiptUrl || null,
        operator_name: operatorName,
      };

      // Edits are DRAFT-only PATCHes (never a re-post): an edit can therefore
      // never create a duplicate expense or a second journal entry. Creation
      // keeps using the posting RPC / fallback.
      const { data, error } = editExpense
        ? await updateExpenseDraft(editExpense.id, payload)
        : await createExpense(payload);

      if (error) {
        toast.error(`Error saving expense: ${error}`);
        setIsSubmitting(false);
        return;
      }

      if (data) {
        toast.success(
          editExpense
            ? `Expense ${data.expense_number} updated.`
            : status === "DRAFT"
            ? "Expense saved as draft."
            : status === "UNPAID"
            ? `Expense ${data.expense_number} recorded as accrued payable.`
            : `Expense ${data.expense_number} recorded and posted to ledger.`
        );
        onSuccess(data);
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-muted">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {editExpense ? "Edit Expense" : "Record New Expense"}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Double-entry expense posting integrated with Chart of Accounts
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Status Selection Pill */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Expense Status & Accounting Treatment
            </label>
            <div className="grid grid-cols-3 gap-2">
              {editExpense && (
                <p className="col-span-3 text-[11px] text-muted">
                  Editing a draft — the status stays <strong>Draft</strong> and nothing posts
                  to the ledger from this screen.
                </p>
              )}
              <button
                type="button"
                disabled={Boolean(editExpense)}
                onClick={() => {
                  setStatus("PAID");
                  if (paymentMethod === "PAYABLE") setPaymentMethod("CASH");
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all text-center ${
                  status === "PAID"
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                    : "border-border-subtle text-muted hover:bg-bg-hover"
                }`}
              >
                <div>✓ Paid Immediately</div>
                <div className="text-[10px] font-normal opacity-75 mt-0.5">Dr Expense · Cr Cash/Bank</div>
              </button>

              <button
                type="button"
                disabled={Boolean(editExpense)}
                onClick={() => {
                  setStatus("UNPAID");
                  setPaymentMethod("PAYABLE");
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all text-center ${
                  status === "UNPAID"
                    ? "border-amber-500 bg-amber-500/15 text-amber-400"
                    : "border-border-subtle text-muted hover:bg-bg-hover"
                }`}
              >
                <div>⏳ Unpaid / Payable</div>
                <div className="text-[10px] font-normal opacity-75 mt-0.5">Dr Expense · Cr Accounts Payable</div>
              </button>

              <button
                type="button"
                disabled={Boolean(editExpense)}
                onClick={() => setStatus("DRAFT")}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all text-center ${
                  status === "DRAFT"
                    ? "border-border-strong bg-bg-active text-muted"
                    : "border-border-subtle text-muted hover:bg-bg-hover"
                }`}
              >
                <div>📝 Draft Only</div>
                <div className="text-[10px] font-normal opacity-75 mt-0.5">Does not post to ledger</div>
              </button>
            </div>
          </div>

          {/* Date & Category */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Expense Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value as ExpenseCategory)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description & Amount */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1">
                Description / Purpose <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Factory generator diesel refill (150 Litres)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border text-foreground focus:outline-none ${
                  errors.description ? "border-red-500" : "border-border-subtle focus:border-crimson-primary"
                }`}
                required
              />
              {errors.description && (
                <p className="text-[11px] text-red-500 mt-1">{errors.description}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Amount (PKR) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`w-full px-3 py-2 text-sm font-mono font-bold rounded-lg bg-surface-subtle border text-foreground focus:outline-none ${
                  errors.amount ? "border-red-500" : "border-border-subtle focus:border-crimson-primary"
                }`}
                required
              />
              {amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
                <p className="text-[11px] text-muted font-medium mt-1">
                  Preview: {formatPKR(parseFloat(amount))}
                </p>
              )}
              {errors.amount && <p className="text-[11px] text-red-500 mt-1">{errors.amount}</p>}
            </div>
          </div>

          {/* Accounting Section: Debit & Credit Accounts */}
          <div className="p-4 rounded-lg bg-bg-subtle border border-border-subtle space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                Chart of Accounts Dual-Entry Posting
              </span>
              <span className="text-[10px] text-muted">· Dynamically verified</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Debit Side: Expense Account */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  DEBIT: Expense Account <span className="text-red-500">*</span>
                </label>
                <select
                  value={expenseAccountId}
                  onChange={(e) => setExpenseAccountId(e.target.value)}
                  className={`w-full px-3 py-2 text-xs font-mono rounded-lg bg-surface-subtle border text-foreground focus:outline-none ${
                    errors.expenseAccountId ? "border-red-500" : "border-border-subtle focus:border-crimson-primary"
                  }`}
                >
                  <option value="">Select Expense Account</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.account_code}] {a.account_name}
                    </option>
                  ))}
                </select>
                {errors.expenseAccountId && (
                  <p className="text-[11px] text-red-500 mt-1">{errors.expenseAccountId}</p>
                )}
              </div>

              {/* Credit Side: Cash/Bank OR Accounts Payable */}
              <div>
                {status === "PAID" ? (
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      CREDIT: Cash / Bank Account <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={paymentAccountId}
                      onChange={(e) => setPaymentAccountId(e.target.value)}
                      className={`w-full px-3 py-2 text-xs font-mono rounded-lg bg-surface-subtle border text-foreground focus:outline-none ${
                        errors.paymentAccountId ? "border-red-500" : "border-border-subtle focus:border-crimson-primary"
                      }`}
                    >
                      <option value="">Select Cash/Bank Account</option>
                      {liquidAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          [{a.account_code}] {a.account_name}
                        </option>
                      ))}
                    </select>
                    {errors.paymentAccountId && (
                      <p className="text-[11px] text-red-500 mt-1">{errors.paymentAccountId}</p>
                    )}
                  </div>
                ) : status === "UNPAID" ? (
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      CREDIT: Accounts Payable (Liability) <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={payableAccountId}
                      onChange={(e) => setPayableAccountId(e.target.value)}
                      className={`w-full px-3 py-2 text-xs font-mono rounded-lg bg-surface-subtle border text-foreground focus:outline-none ${
                        errors.payableAccountId ? "border-red-500" : "border-border-subtle focus:border-crimson-primary"
                      }`}
                    >
                      <option value="">Select Liability Account</option>
                      {liabilityAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          [{a.account_code}] {a.account_name}
                        </option>
                      ))}
                    </select>
                    {errors.payableAccountId && (
                      <p className="text-[11px] text-red-500 mt-1">{errors.payableAccountId}</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">
                      CREDIT: Account (Draft)
                    </label>
                    <div className="px-3 py-2 text-xs text-muted rounded-lg bg-surface-subtle border border-border-subtle italic">
                      No posting will occur in draft status
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Method selector if Paid */}
            {status === "PAID" && (
              <div className="flex items-center gap-4 pt-1">
                <span className="text-xs font-medium text-muted">Payment Method:</span>
                {(["CASH", "BANK", "CHEQUE"] as ExpensePaymentMethod[]).map((method) => (
                  <label key={method} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={method}
                      checked={paymentMethod === method}
                      onChange={() => setPaymentMethod(method)}
                      className="accent-crimson-primary"
                    />
                    <span>{method}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Payee / Supplier Linkage */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Link to Supplier / Party (Optional)
              </label>
              <select
                value={selectedPartyId || ""}
                onChange={handlePartySelect}
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              >
                <option value="">None / One-time Vendor</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.party_type || "Party"})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Payee / Supplier Name
              </label>
              <input
                type="text"
                placeholder="e.g. Shell Petrol Pump / PSO / Landlord"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
              />
            </div>
          </div>

          {/* Notes & Receipt Attachment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Notes / Remarks</label>
              <textarea
                rows={3}
                placeholder="Additional notes, invoice reference, approval notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Receipt / Invoice Attachment
              </label>
              <div className="border-2 border-dashed border-border-subtle rounded-lg p-3 text-center hover:border-crimson-primary transition-colors">
                <input
                  type="file"
                  id="receipt-upload"
                  accept="image/*,application/pdf"
                  onChange={handleReceiptUpload}
                  className="hidden"
                />
                <label
                  htmlFor="receipt-upload"
                  className="cursor-pointer flex flex-col items-center justify-center gap-1"
                >
                  <Upload className="w-5 h-5 text-muted" />
                  <span className="text-xs font-medium text-foreground">
                    {receiptFileName ? receiptFileName : "Click to attach receipt (Image/PDF)"}
                  </span>
                  <span className="text-[10px] text-muted">Max file size: 5MB</span>
                </label>
                {receiptUrl && (
                  <div className="mt-2 text-[11px] text-emerald-500 font-medium flex items-center justify-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Receipt attached successfully
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium rounded-lg text-muted hover:text-foreground hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>

            <CrimsonButton
              type="submit"
              disabled={isSubmitting}
              className="min-w-[140px]"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Posting…
                </span>
              ) : status === "DRAFT" ? (
                "Save as Draft"
              ) : status === "UNPAID" ? (
                "Accrue Expense"
              ) : (
                "Post & Pay Expense"
              )}
            </CrimsonButton>
          </div>
        </form>
      </div>
    </div>
  );
}
