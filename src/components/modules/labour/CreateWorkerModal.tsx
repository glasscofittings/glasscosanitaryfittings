"use client";

import { useState } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { createWorker, type Worker } from "@/lib/supabase/labour";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (worker: Worker) => void;
}

export default function CreateWorkerModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [salary, setSalary] = useState("");
  const [joinDate, setJoinDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEscapeToClose(open, onClose);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !role.trim() || !salary.trim()) {
      setError("All fields are required.");
      return;
    }
    const salaryNum = parseFloat(salary);
    if (isNaN(salaryNum) || salaryNum <= 0) {
      setError("Salary must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      const worker = await createWorker({
        full_name: name.trim(),
        role_designation: role.trim(),
        base_salary_pkr: salaryNum,
        joining_date: joinDate,
      });
      onCreated(worker);
      setName("");
      setRole("");
      setSalary("");
      setJoinDate(new Date().toISOString().slice(0, 10));
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create worker. Please try again.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md glass-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">Add New Worker</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="glow-line mb-4" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(capitalizeFirst(e.target.value))}
              className="glass-input w-full"
              placeholder="e.g. Ahmad Khan"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Role / Designation</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(capitalizeFirst(e.target.value))}
              className="glass-input w-full"
              placeholder="e.g. CNC Operator"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Base Salary (PKR)</label>
              <input
                type="number"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                className="glass-input w-full font-mono"
                placeholder="45000"
                min="0"
              />
            </div>
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">Joining Date</label>
              <input
                type="date"
                value={joinDate}
                onChange={(e) => setJoinDate(e.target.value)}
                className="glass-input w-full"
              />
            </div>
          </div>

          {error && (
            <p className="text-caption text-status-alert">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="crimson-btn flex-1" style={{ backgroundColor: "transparent", border: "1px solid var(--border-default)" }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="crimson-btn flex-1">
              {saving ? "Saving..." : "Add Worker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
