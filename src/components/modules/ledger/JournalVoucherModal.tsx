"use client";

import { useState } from "react";
import { type Account, createJournalEntry } from "@/lib/supabase/ledger";
import { formatPKR } from "@/lib/utils/formatters";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  accounts: Account[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface LineDraft {
  account_id: string;
  debit_pkr: number;
  credit_pkr: number;
}

export default function JournalVoucherModal({ accounts, open, onClose, onCreated }: Props) {
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { account_id: "", debit_pkr: 0, credit_pkr: 0 },
    { account_id: "", debit_pkr: 0, credit_pkr: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEscapeToClose(open, () => { onClose(); resetForm(); });

  if (!open) return null;

  const totalDebit = lines.reduce((a, l) => a + l.debit_pkr, 0);
  const totalCredit = lines.reduce((a, l) => a + l.credit_pkr, 0);
  const diff = totalDebit - totalCredit;
  const isBalanced = Math.abs(diff) < 0.01 && totalDebit > 0;
  const isValid = entryDate && narration.trim() && lines.length >= 2 && isBalanced;

  function addLine() {
    setLines([...lines, { account_id: "", debit_pkr: 0, credit_pkr: 0 }]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof LineDraft, value: string | number) {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  }

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    const { data, error: saveError } = await createJournalEntry({
      entry_date: entryDate,
      narration: narration.trim(),
      lines: lines.filter((l) => l.account_id),
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: "Accounts Dept",
      status: "DRAFT",
    });

    setSubmitting(false);
    if (data) {
      onCreated();
      onClose();
      resetForm();
    } else {
      setError(saveError ?? "Failed to create entry.");
    }
  }

  function resetForm() {
    setEntryDate(new Date().toISOString().slice(0, 10));
    setNarration("");
    setLines([
      { account_id: "", debit_pkr: 0, credit_pkr: 0 },
      { account_id: "", debit_pkr: 0, credit_pkr: 0 },
    ]);
    setError("");
  }

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={() => { onClose(); resetForm(); }} />

      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Journal Voucher</h2>
              <p className="text-caption text-muted mt-0.5">Double-entry transaction posting</p>
            </div>
            <button
              onClick={() => { onClose(); resetForm(); }}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-5 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">Date</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body font-mono focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
                />
              </div>
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">Remarks</label>
                <textarea
                  value={narration}
                  onChange={(e) => setNarration(capitalizeFirst(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors resize-y"
                  rows={3}
                  placeholder="Description of this transaction..."
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-caption text-secondary uppercase tracking-wider font-medium">Journal Lines ({lines.length})</label>
                <button type="button" onClick={addLine} className="text-caption text-crimson-primary hover:text-crimson-light transition-colors font-medium">
                  + Add Line
                </button>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 px-1">
                  <div className="col-span-5 text-caption text-muted">Account</div>
                  <div className="col-span-3 text-caption text-muted text-right">Debit (PKR)</div>
                  <div className="col-span-3 text-caption text-muted text-right">Credit (PKR)</div>
                  <div className="col-span-1" />
                </div>

                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <select
                        value={line.account_id}
                        onChange={(e) => updateLine(idx, "account_id", e.target.value)}
                        className="w-full h-9 px-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors truncate"
                      >
                        <option value="">Select...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.debit_pkr || ""}
                        onChange={(e) => updateLine(idx, "debit_pkr", parseFloat(e.target.value) || 0)}
                        className="w-full h-9 px-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors text-right"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.credit_pkr || ""}
                        onChange={(e) => updateLine(idx, "credit_pkr", parseFloat(e.target.value) || 0)}
                        className="w-full h-9 px-2 rounded-lg bg-obsidian-bg border border-border-default text-foreground font-mono text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors text-right"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {lines.length > 2 && (
                        <button type="button" onClick={() => removeLine(idx)} className="h-7 w-7 rounded flex items-center justify-center text-muted hover:text-status-alert transition-colors">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card p-4 space-y-2">
              <div className="flex justify-between text-body">
                <span className="text-secondary">Total Debit</span>
                <span className={`font-mono font-bold ${totalDebit > 0 ? "text-foreground" : "text-muted"}`}>{formatPKR(totalDebit)}</span>
              </div>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Total Credit</span>
                <span className={`font-mono font-bold ${totalCredit > 0 ? "text-foreground" : "text-muted"}`}>{formatPKR(totalCredit)}</span>
              </div>
              <div className="glow-line my-2" />
              <div className="flex justify-between text-body font-semibold">
                <span className="text-secondary">Difference</span>
                <span className={`font-mono ${isBalanced ? "text-status-optimal" : "text-status-alert"}`}>
                  {isBalanced ? "BALANCED" : formatPKR(Math.abs(diff))}
                </span>
              </div>
            </div>

            {!isBalanced && totalDebit > 0 && (
              <div className="bg-status-alert/10 border border-status-alert/20 rounded-lg p-3 text-caption text-status-alert">
                Cannot submit: Total Debits ({formatPKR(totalDebit)}) must equal Total Credits ({formatPKR(totalCredit)}).
              </div>
            )}

            {error && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>

          <div className="p-5 border-t border-border-subtle shrink-0">
            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting || !isValid}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Posting..." : "Post Journal Entry"}
              </button>
              <button
                onClick={() => { onClose(); resetForm(); }}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
