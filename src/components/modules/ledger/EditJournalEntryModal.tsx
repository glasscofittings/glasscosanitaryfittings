"use client";

import { useState } from "react";
import {
  type Account,
  type JournalEntryWithLines,
  updateJournalEntry,
  deleteJournalLines,
  addJournalLines,
} from "@/lib/supabase/ledger";
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
  entry: JournalEntryWithLines | null;
  accounts: Account[];
  open: boolean;
  onClose: () => void;
  onSaved: (headerOnly?: boolean) => void;
}

export default function EditJournalEntryModal({ entry, accounts, open, onClose, onSaved }: Props) {
  // State is initialized from `entry`; the parent remounts via `key={entry.id}`.
  const [entryDate, setEntryDate] = useState(entry?.entry_date?.slice(0, 10) ?? "");
  const [narration, setNarration] = useState(entry?.narration ?? "");
  const [customerName, setCustomerName] = useState(entry?.customer_name ?? "");
  const [customerParty, setCustomerParty] = useState<Party | null>(null);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (entry?.journal_lines ?? []).map((l, i) => ({
      key: String(i + 1),
      account_id: l.account_id,
      debit: l.debit_pkr > 0 ? String(l.debit_pkr) : "",
      credit: l.credit_pkr > 0 ? String(l.credit_pkr) : "",
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalDebit = lines.reduce((a, l) => a + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((a, l) => a + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const inputCls =
    "h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const numCls =
    "h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body font-mono text-right focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entry || !narration.trim()) {
      setError("Remarks is required.");
      return;
    }
    if (customerName.trim() && !customerParty) {
      setError(`"${customerName.trim()}" is not a CRM contact. Pick one from the list, or add it in CRM first.`);
      return;
    }

    const filtered = lines
      .filter((l) => l.account_id)
      .map((l) => ({
        account_id: l.account_id,
        debit_pkr: parseFloat(l.debit) || 0,
        credit_pkr: parseFloat(l.credit) || 0,
      }));

    const isBalanced =
      Math.abs(
        filtered.reduce((a, l) => a + Math.round(l.debit_pkr * 100), 0) -
          filtered.reduce((a, l) => a + Math.round(l.credit_pkr * 100), 0)
      ) < 1;

    // Posted entries must keep at least one line (single-sided OK).
    if (entry.status === "POSTED" && filtered.length === 0) {
      setError("Posted entries must keep journal lines.");
      return;
    }

    setSaving(true);
    setError(null);

    const okMeta = await updateJournalEntry(entry.id, {
      entry_date: entryDate,
      narration: narration.trim(),
      customer_name: customerName.trim() || null,
      is_balanced: filtered.length > 0 && isBalanced,
    });
    if (!okMeta) {
      setSaving(false);
      setError("Failed to update journal entry metadata.");
      return;
    }

    await deleteJournalLines(entry.id);

    if (filtered.length > 0) {
      const okLines = await addJournalLines(entry.id, filtered);
      if (!okLines) {
        setSaving(false);
        setError("Entry metadata saved but lines failed — please re-edit.");
        return;
      }
    }

    setSaving(false);
    onSaved(false);
    onClose();
  }

  useEscapeToClose(open, onClose);

  if (!open || !entry) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-3xl p-6 border border-border-default shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-h2 font-semibold">Edit Journal Entry</h2>
              <p className="text-caption text-muted mt-0.5">{entry.entry_number}</p>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="glow-line mb-5" />

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Date</label>
                <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Remarks *</label>
                <textarea
                  value={narration}
                  onChange={(e) => setNarration(capitalizeFirst(e.target.value))}
                  placeholder="Description of this entry..."
                  rows={3}
                  className={`${inputCls} h-auto py-2 resize-y`}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">Customer / Party Name</label>
                <PartyNameCombobox
                  value={customerName}
                  onChange={setCustomerName}
                  onMatchChange={setCustomerParty}
                  placeholder="Start typing a CRM contact, or enter a new name"
                  className={inputCls}
                />
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
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="h-7 w-7 rounded-md flex items-center justify-center text-muted hover:text-status-error hover:bg-status-error/10 transition-colors"
                          >
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
                      <button
                        type="button"
                        onClick={addLine}
                        className="text-caption text-crimson-primary hover:text-crimson-dark font-medium transition-colors"
                      >
                        + Add Line
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`font-mono text-body font-semibold ${
                          Math.abs(totalDebit - totalCredit) < 0.01 ? "text-status-optimal" : "text-status-error"
                        }`}
                      >
                        {totalDebit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`font-mono text-body font-semibold ${
                          Math.abs(totalDebit - totalCredit) < 0.01 ? "text-status-optimal" : "text-status-error"
                        }`}
                      >
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
                  Debits ({totalDebit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}) ≠ Credits ({totalCredit.toLocaleString("en-PK", { minimumFractionDigits: 2 })}) — difference:{" "}
                  {Math.abs(totalDebit - totalCredit).toLocaleString("en-PK", { minimumFractionDigits: 2 })}.
                  <br />
                  <span className="text-muted">Single-sided entries are allowed. You can save as-is.</span>
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
                type="submit"
                disabled={saving || !narration.trim()}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving..." : "Save Changes"}
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
