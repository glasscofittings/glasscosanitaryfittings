"use client";

import { useState, useEffect } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { updateWorker, type Worker } from "@/lib/supabase/labour";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  open: boolean;
  worker: Worker | null;
  onClose: () => void;
  onSaved: (worker: Worker) => void;
}

export default function EditWorkerModal({ open, worker, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [salary, setSalary] = useState("");
  const [joinDate, setJoinDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (worker) {
      setName(worker.full_name);
      setRole(worker.role_designation);
      setSalary(String(worker.base_salary_pkr));
      setJoinDate(worker.joining_date || new Date().toISOString().slice(0, 10));
    }
  }, [worker]);

  useEscapeToClose(open, onClose);

  if (!open || !worker) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!worker) return;
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
    const result = await updateWorker(worker.id, {
      full_name: name.trim(),
      role_designation: role.trim(),
      base_salary_pkr: salaryNum,
      joining_date: joinDate,
    });
    setSaving(false);
    if (result) {
      onSaved(result);
      onClose();
    } else {
      setError("Failed to update worker. Please try again.");
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div
          className="glass-card w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Edit Worker</h2>
              <p className="text-caption text-muted mt-0.5">{worker.full_name}</p>
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

          <div className="p-5 overflow-y-auto flex-1">
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
                <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="crimson-btn flex-1" style={{ backgroundColor: "transparent", border: "1px solid var(--border-default)" }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="crimson-btn flex-1">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
