"use client";

import { useState } from "react";
import { toast } from "sonner";
import { type Account, createAccount, updateAccount, deleteAccount } from "@/lib/supabase/ledger";

interface Props {
  accounts: Account[];
  onRefresh: () => void;
  /** Called when the user clicks "View Ledger" for an account row. */
  onViewLedger?: (account: Account) => void;
}

const TYPE_LABELS: Record<Account["account_type"], { label: string; color: string }> = {
  ASSET: { label: "Asset", color: "bg-crimson-primary/15 text-crimson-light border-crimson-primary/20" },
  LIABILITY: { label: "Liability", color: "bg-status-amber/15 text-status-amber border-status-amber/20" },
  EQUITY: { label: "Equity", color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  REVENUE: { label: "Revenue", color: "bg-status-optimal/15 text-status-optimal border-status-optimal/20" },
  EXPENSE: { label: "Expense", color: "bg-purple-500/15 text-purple-400 border-purple-500/20" },
};

export default function AccountManager({ accounts, onRefresh, onViewLedger }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["account_type"]>("ASSET");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<string>("ALL");

  const filtered = filter === "ALL" ? accounts : accounts.filter((a) => a.account_type === filter);

  function startEdit(acc: Account) {
    setEditId(acc.id);
    setCode(acc.account_code);
    setName(acc.account_name);
    setType(acc.account_type);
    setShowForm(true);
  }

  function startCreate() {
    setEditId(null);
    setCode("");
    setName("");
    setType("ASSET");
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditId(null);
    setCode("");
    setName("");
    setType("ASSET");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setSaving(true);

    const isEdit = editId !== null;
    const ok = isEdit
      ? await updateAccount(editId!, { account_name: name.trim(), account_type: type })
      : (await createAccount({ account_code: code.trim(), account_name: name.trim(), account_type: type })) !== null;

    setSaving(false);

    if (!ok) {
      toast.error("Could not save account — it may already exist or the database refused the write.");
      return;
    }

    toast.success(isEdit ? "Account updated." : "Account created.");
    cancelForm();
    onRefresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this account? This cannot be undone.")) return;
    const ok = await deleteAccount(id);
    if (!ok) {
      toast.error("Could not delete account.");
      return;
    }
    toast.success("Account deleted.");
    onRefresh();
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-h2 font-semibold">Chart of Accounts</h2>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 px-2 rounded-lg bg-bg-muted border border-border-default text-caption text-secondary focus:outline-none"
          >
            <option value="ALL">All Types</option>
            {Object.keys(TYPE_LABELS).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t as Account["account_type"]].label}</option>
            ))}
          </select>
          <button onClick={startCreate} className="crimson-btn text-caption px-3 py-1">
            + Add Account
          </button>
        </div>
      </div>
      <div className="glow-line mb-4" />

      {showForm && (
        <form onSubmit={handleSave} className="mb-4 p-3 rounded-lg bg-bg-subtle border border-border-subtle space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-muted uppercase mb-1">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="glass-input w-full text-caption font-mono"
                placeholder="e.g. 5005"
                disabled={!!editId}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted uppercase mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="glass-input w-full text-caption"
                placeholder="e.g. Freight Expense"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted uppercase mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as Account["account_type"])}
                className="glass-input w-full text-caption"
              >
                {Object.keys(TYPE_LABELS).map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t as Account["account_type"]].label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="crimson-btn text-caption px-3">
              {saving ? "Saving..." : editId ? "Update" : "Create"}
            </button>
            <button type="button" onClick={cancelForm} className="text-caption text-muted hover:text-foreground px-2">Cancel</button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="text-caption text-muted font-medium px-3 py-2 uppercase tracking-wider w-20">Code</th>
              <th className="text-caption text-muted font-medium px-3 py-2 uppercase tracking-wider">Name</th>
              <th className="text-caption text-muted font-medium px-3 py-2 uppercase tracking-wider w-24">Type</th>
              {onViewLedger && <th className="text-caption text-muted font-medium px-3 py-2 uppercase tracking-wider w-28">Ledger</th>}
              <th className="text-caption text-muted font-medium px-3 py-2 uppercase tracking-wider w-20" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((acc) => {
              const t = TYPE_LABELS[acc.account_type];
              return (
                <tr key={acc.id} className="border-b border-border-subtle hover:bg-bg-subtle transition-colors">
                  <td className="px-3 py-2 font-mono text-caption text-secondary">{acc.account_code}</td>
                  <td className="px-3 py-2 text-body text-foreground">{acc.account_name}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border ${t.color}`}>
                      {t.label}
                    </span>
                  </td>
                  {onViewLedger && (
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onViewLedger(acc)}
                        className="h-6 px-2.5 rounded-md bg-crimson-primary/10 border border-crimson-primary/25 text-crimson-primary hover:bg-crimson-primary hover:text-white text-[10px] font-semibold transition-colors whitespace-nowrap"
                        title={`View ledger for ${acc.account_name}`}
                      >
                        View Ledger
                      </button>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(acc)} className="text-caption text-muted hover:text-foreground px-1">Edit</button>
                      <button onClick={() => handleDelete(acc.id)} className="text-caption text-muted hover:text-status-alert px-1">Del</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
