"use client";

import { useState } from "react";
import { type Account, createJournalEntry } from "@/lib/supabase/ledger";
import PartyNameCombobox from "@/components/ui/PartyNameCombobox";
import AccountCombobox from "@/components/ui/AccountCombobox";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import type { Party } from "@/lib/supabase/crm";
import { capitalizeFirst } from "@/lib/utils";

interface LineDraft {
  key: string;
  account_id: string;
  debit: string;
  credit: string;
}

interface Props {
  accounts: Account[];
  open: boolean;
  onClose: () => void;
  onSaved: (headerOnly?: boolean) => void;
}

function nextJVNumber(): string {
  const y = new Date().getFullYear();
  const seq = String(Date.now()).slice(-4);
  return `JV-${y}-${seq}`;
}

export default function NewJournalEntryModal({ accounts, open, onClose, onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [entryDate, setEntryDate] = useState(today);
  const [refNumber, setRefNumber] = useState(nextJVNumber);
  const [narration, setNarration] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerParty, setCustomerParty] = useState<Party | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([
    { key: "1", account_id: "", debit: "", credit: "" },
    { key: "2", account_id: "", debit: "", credit: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalDebit = lines.reduce((a, l) => a + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((a, l) => a + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
  const hasCompleteLines = lines.every((l) => l.account_id && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0));

  const inputCls = "h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const numCls = "h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body font-mono text-right focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  function addLine() {
    setLines((prev) => [...prev, { key: String(Date.now()), account_id: "", debit: "", credit: "" }]);
  }

  function removeLine(index: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof LineDraft, value: string) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const updated = { ...l, [field]: value };
        if (field === "debit" && value) updated.credit = "";
        if (field === "credit" && value) updated.debit = "";
        return updated;
      })
    );
  }

  async function handleSubmit(status: "DRAFT" | "POSTED") {
    if (!narration.trim()) {
      setError("Remarks is required.");
      return;
    }
    if (customerName.trim() && !customerParty) {
      setError(`"${customerName.trim()}" is not a CRM contact. Pick one from the list, or add it in CRM first.`);
      return;
    }
    const hasLines = lines.some((l) => l.account_id && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0));
    if (status === "POSTED" && !hasLines) {
      setError("Add at least one journal line (debit or credit) before posting.");
      return;
    }
    setSaving(true);
    setError(null);

    const { data, error: saveError, linesSaved } = await createJournalEntry({
      entry_date: entryDate,
      narration: narration.trim(),
      customer_name: customerName.trim() || undefined,
      lines: lines
        .filter((l) => l.account_id)
        .map((l) => ({
          account_id: l.account_id,
          debit_pkr: parseFloat(l.debit) || 0,
          credit_pkr: parseFloat(l.credit) || 0,
        })),
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: "Accounts Dept",
      status,
    });

    setSaving(false);
    if (data) {
      const headerOnly = status === "DRAFT" && linesSaved === false;
      onSaved(headerOnly);
      onClose();
      resetForm();
    } else {
      setError(saveError ?? "Failed to save journal entry.");
    }
  }

  function resetForm() {
    setEntryDate(today);
    setRefNumber(nextJVNumber());
    setNarration("");
    setCustomerName("");
    setLines([
      { key: "1", account_id: "", debit: "", credit: "" },
      { key: "2", account_id: "", debit: "", credit: "" },
    ]);
    setError(null);
  }

  useEscapeToClose(open, onClose);

  if (!open) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-3xl p-6 border border-border-default shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-h2 font-semibold">New Journal Entry</h2>
              <p className="text-caption text-muted mt-0.5">Double-entry journal posting</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="glow-line mb-5" />

          <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Date</label>
                <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Reference #</label>
                <input value={refNumber} onChange={(e) => setRefNumber(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Customer / Party Name</label>
                <PartyNameCombobox
                  value={customerName}
                  onChange={setCustomerName}
                  onMatchChange={setCustomerParty}
                  placeholder="Start typing a CRM contact, or enter a new name"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Remarks *</label>
                <textarea value={narration} onChange={(e) => setNarration(capitalizeFirst(e.target.value))} placeholder="Description of this entry..." rows={3} className={`${inputCls} h-auto py-2 resize-y`} />
              </div>
            </div>

            <div className="glass-card overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="px-4 py-2 text-[10px] text-muted uppercase tracking-wider w-[40%]">Account</th>
                    <th className="px-4 py-2 text-[10px] text-muted uppercase tracking-wider text-right w-[22%]">Debit (PKR)</th>
                    <th className="px-4 py-2 text-[10px] text-muted uppercase tracking-wider text-right w-[22%]">Credit (PKR)</th>
                    <th className="px-4 py-2 w-[16%]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={line.key} className="border-b border-border-subtle last:border-0">
                      <td className="px-3 py-2">
                        <AccountCombobox
                          value={line.account_id}
                          onChange={(id) => updateLine(idx, "account_id", id)}
                          accounts={accounts}
                          className={inputCls}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit}
                          onChange={(e) => updateLine(idx, "debit", e.target.value)}
                          placeholder="0.00"
                          className={`${numCls} w-full`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit}
                          onChange={(e) => updateLine(idx, "credit", e.target.value)}
                          placeholder="0.00"
                          className={`${numCls} w-full`}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {lines.length > 2 && (
                          <button type="button" onClick={() => removeLine(idx)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted hover:text-status-error hover:bg-status-error/10 transition-colors">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border-default bg-bg-subtle">
                    <td className="px-4 py-2">
                      <button type="button" onClick={addLine} className="text-caption text-crimson-primary hover:text-crimson-dark font-medium transition-colors">
                        + Add Line
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`font-mono text-body font-semibold ${Math.abs(totalDebit - totalCredit) < 0.01 ? "text-status-optimal" : "text-status-error"}`}>
                        {totalDebit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`font-mono text-body font-semibold ${Math.abs(totalDebit - totalCredit) < 0.01 ? "text-status-optimal" : "text-status-error"}`}>
                        {totalCredit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {!balanced && totalDebit > 0 && (
              <div className="flex items-center gap-2 text-caption text-status-error bg-status-error/10 px-3 py-2 rounded-lg border border-status-error/20">
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Debits ({totalDebit.toLocaleString("en-PK")}) ≠ Credits ({totalCredit.toLocaleString("en-PK")}) — difference: {Math.abs(totalDebit - totalCredit).toLocaleString("en-PK", { minimumFractionDigits: 2 })}.
                  <br />
                  <span className="text-muted">Single-sided entries are allowed. You can Save Draft or Post as-is.</span>
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-caption text-status-error bg-status-error/10 px-3 py-2 rounded-lg border border-status-error/20">
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <div className="glow-line" />

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={saving || !narration.trim()}
                onClick={() => handleSubmit("DRAFT")}
                className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:text-foreground hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>
              <button
                type="button"
                disabled={saving || !narration.trim() || !hasCompleteLines}
                onClick={() => handleSubmit("POSTED")}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving..." : "Post Entry"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
