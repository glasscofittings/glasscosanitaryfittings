"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAvailableFunds,
  fetchCapitalInjections,
  recordCapitalInjection,
  updateCapitalInjection,
  type AvailableFunds,
  type CapitalInjection,
} from "@/lib/supabase/ledger";
import { formatPKR } from "@/lib/utils/formatters";
import { useAuth } from "@/components/providers/AuthProvider";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  /** Bump to re-fetch (e.g. after journal entry save). */
  refreshKey?: number;
  /** Layout variant to match host page card style. */
  variant?: "dashboard" | "ledger";
}

/**
 * Available Funds = live SUM(debit - credit) over liquid accounts (Cash 1000 + Bank 1002).
 * Never a stored balance — always recomputed from journal_lines.
 */
export default function AvailableFundsCard({ refreshKey = 0, variant = "ledger" }: Props) {
  const { profile } = useAuth();
  const nodeId = useDeviceStore((s) => s.nodeId);
  const isOwner = profile?.role === "OWNER";

  const [funds, setFunds] = useState<AvailableFunds | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAvailableFunds().then((f) => {
      if (cancelled) return;
      setFunds(f);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const cash = funds?.cashBalance ?? 0;
  const bank = funds?.bankBalance ?? 0;
  const total = funds?.total ?? 0;

  return (
    <>
      <div className={`glass-card ${variant === "dashboard" ? "p-5" : "p-4"} min-w-0 overflow-hidden`}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="text-caption text-muted uppercase tracking-wider font-medium">
              Available Funds
            </p>
            <p className="text-[10px] text-muted mt-0.5">Cash + Bank · live from ledger</p>
          </div>
          {isOwner && (
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                onClick={() => setEditOpen(true)}
                className="h-7 px-2.5 rounded-md bg-bg-muted border border-border-default text-secondary text-caption font-semibold hover:bg-bg-subtle hover:text-foreground transition-colors"
                title="Correct a wrongly recorded capital injection (OWNER only)"
              >
                Edit
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="h-7 px-2.5 rounded-md bg-crimson-primary/10 border border-crimson-primary/30 text-crimson-primary text-caption font-semibold hover:bg-crimson-primary hover:text-white transition-colors"
                title="Record owner capital injection (OWNER only)"
              >
                + Add Funds
              </button>
            </div>
          )}
        </div>

        <p
          className="font-bold font-mono tracking-tight text-foreground whitespace-nowrap overflow-hidden text-ellipsis"
          style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }}
          title="Live SUM(debit − credit) on Cash + Bank journal_lines"
        >
          {loading ? "—" : formatPKR(total)}
        </p>

        <div className="mt-3 space-y-1.5 border-t border-border-subtle pt-2.5">
          <div className="flex items-baseline justify-between gap-2 min-w-0">
            <span className="text-[10px] text-muted uppercase shrink-0">Cash</span>
            <span
              className="font-mono text-caption font-medium text-foreground whitespace-nowrap overflow-hidden text-ellipsis"
              title={loading ? undefined : formatPKR(cash)}
            >
              {loading ? "—" : formatPKR(cash)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 min-w-0">
            <span className="text-[10px] text-muted uppercase shrink-0">Bank</span>
            <span
              className="font-mono text-caption font-medium text-foreground whitespace-nowrap overflow-hidden text-ellipsis"
              title={loading ? undefined : formatPKR(bank)}
            >
              {loading ? "—" : formatPKR(bank)}
            </span>
          </div>
        </div>
      </div>

      {addOpen && (
        <AddFundsModal
          onClose={() => setAddOpen(false)}
          onSaved={(entryNumber) => {
            setAddOpen(false);
            toast.success(`Capital injection posted as ${entryNumber}`);
            fetchAvailableFunds().then(setFunds);
          }}
          nodeId={nodeId}
          operatorName={profile?.email ?? "OWNER"}
        />
      )}

      {editOpen && (
        <EditFundsModal
          onClose={() => setEditOpen(false)}
          onSaved={(entryNumber) => {
            setEditOpen(false);
            toast.success(`Capital injection ${entryNumber} corrected`);
            fetchAvailableFunds().then(setFunds);
          }}
          nodeId={nodeId}
          operatorName={profile?.email ?? "OWNER"}
        />
      )}
    </>
  );
}

function AddFundsModal({
  onClose,
  onSaved,
  nodeId,
  operatorName,
}: {
  onClose: () => void;
  onSaved: (entryNumber: string) => void;
  nodeId: string;
  operatorName: string;
}) {
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState<"CASH" | "BANK">("CASH");
  const [narration, setNarration] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEscapeToClose(true, onClose);

  const amountNum = parseFloat(amount) || 0;
  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!(amountNum > 0)) {
      setError("Amount must be greater than zero.");
      return;
    }
    setSaving(true);
    setError("");
    const { data, error: err } = await recordCapitalInjection({
      amount: amountNum,
      target,
      narration:
        narration.trim() ||
        `Capital injection — ${target === "BANK" ? "Bank" : "Cash"}`,
      operatorName,
      deviceNode: nodeId,
    });
    setSaving(false);
    if (err || !data) {
      setError(err ?? "Failed to record capital injection.");
      return;
    }
    onSaved(data.entry_number);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm glass-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-h2 font-semibold">Add Funds</h2>
            <p className="text-caption text-muted mt-0.5">
              Owner capital injection · posts a real journal entry
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-caption text-status-alert bg-status-alert/10 border border-status-alert/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
              Amount (Rs) *
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
              placeholder="100000"
              autoFocus
            />
          </div>

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
              Target Account
            </label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as "CASH" | "BANK")}
              className={inputCls}
            >
              <option value="CASH">Cash in Hand (1000)</option>
              <option value="BANK">Bank Account (1002)</option>
            </select>
          </div>

          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
              Narration
            </label>
            <input
              value={narration}
              onChange={(e) => setNarration(capitalizeFirst(e.target.value))}
              className={inputCls}
              placeholder="Owner capital injection"
            />
          </div>

          <p className="text-[10px] text-muted">
            Dr {target === "BANK" ? "Bank 1002" : "Cash 1000"} · Cr Owner&apos;s Equity 3000 ·
            entry appears in Ledger + Trial Balance
          </p>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Record Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditFundsModal({
  onClose,
  onSaved,
  nodeId,
  operatorName,
}: {
  onClose: () => void;
  onSaved: (entryNumber: string) => void;
  nodeId: string;
  operatorName: string;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CapitalInjection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState<"CASH" | "BANK">("CASH");
  const [narration, setNarration] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEscapeToClose(true, onClose);

  const amountNum = parseFloat(amount) || 0;
  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";

  useEffect(() => {
    let cancelled = false;
    fetchCapitalInjections().then((list) => {
      if (cancelled) return;
      setItems(list);
      const first = list[0];
      if (first) {
        setSelectedId(first.id);
        setAmount(first.amount.toFixed(2));
        setTarget(first.target);
        setNarration(first.narration ?? "");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) {
      setError("Select a capital injection to edit.");
      return;
    }
    if (!(amountNum > 0)) {
      setError("Amount must be greater than zero.");
      return;
    }
    setSaving(true);
    setError("");
    const { data, error: err } = await updateCapitalInjection({
      entryId: selectedId,
      amount: amountNum,
      target,
      narration: narration.trim(),
      operatorName,
      deviceNode: nodeId,
    });
    setSaving(false);
    if (err || !data) {
      setError(err ?? "Failed to update capital injection.");
      return;
    }
    onSaved(data.entry_number);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm glass-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-h2 font-semibold">Edit Funds</h2>
            <p className="text-caption text-muted mt-0.5">
              Correct a capital injection · rewrites the posted journal entry
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="text-caption text-muted text-center py-8">
            Loading capital injections…
          </div>
        ) : items.length === 0 ? (
          <div className="space-y-4">
            <div className="text-caption text-muted text-center py-6">
              No capital injections recorded yet — use{" "}
              <span className="text-foreground font-medium">+ Add Funds</span> first.
            </div>
            <div className="flex justify-end pt-3 border-t border-border-subtle">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-caption text-status-alert bg-status-alert/10 border border-status-alert/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
                Capital Injection Entry *
              </label>
              <select
                value={selectedId}
                onChange={(e) => {
                  const item = items.find((i) => i.id === e.target.value);
                  if (!item) return;
                  setSelectedId(item.id);
                  setAmount(item.amount.toFixed(2));
                  setTarget(item.target);
                  setNarration(item.narration ?? "");
                  setError("");
                }}
                className={inputCls}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.entry_number} · {formatPKR(item.amount)} · {item.entry_date}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
                Amount (Rs) *
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputCls}
                placeholder="100000"
                autoFocus
              />
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
                Target Account
              </label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as "CASH" | "BANK")}
                className={inputCls}
              >
                <option value="CASH">Cash in Hand (1000)</option>
                <option value="BANK">Bank Account (1002)</option>
              </select>
            </div>

            <div>
              <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
                Narration
              </label>
              <input
                value={narration}
                onChange={(e) => setNarration(capitalizeFirst(e.target.value))}
                className={inputCls}
                placeholder="Owner capital injection"
              />
            </div>

            <p className="text-[10px] text-muted">
              Dr {target === "BANK" ? "Bank 1002" : "Cash 1000"} · Cr Owner&apos;s Equity 3000 ·
              entry keeps its number & date · Available Funds re-computes live
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-subtle">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
