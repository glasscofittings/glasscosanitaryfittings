"use client";

import { useEffect, useState, useCallback } from "react";
import { useOperatorStore } from "@/lib/store/useOperatorStore";
import { fetchWorkers, type Worker } from "@/lib/supabase/labour";
import CrimsonButton from "@/components/ui/CrimsonButton";

const MOCK_WORKERS: Worker[] = [
  { id: "w1", full_name: "Talha Ijaz", role_designation: "Mixer Lead", base_salary_pkr: 45000, joining_date: "", is_active: true },
  { id: "w2", full_name: "Ali Raza", role_designation: "QC Technician", base_salary_pkr: 38000, joining_date: "", is_active: true },
  { id: "w3", full_name: "Hassan Ahmed", role_designation: "Warehouse Operator", base_salary_pkr: 35000, joining_date: "", is_active: true },
  { id: "w4", full_name: "Bilal Khan", role_designation: "Gate Clerk", base_salary_pkr: 32000, joining_date: "", is_active: true },
  { id: "w5", full_name: "Usman Malik", role_designation: "Packaging Lead", base_salary_pkr: 40000, joining_date: "", is_active: true },
];

function OperatorModalInner() {
  const { actionLabel, confirm, cancel } = useOperatorStore();
  const [workers, setWorkers] = useState<Worker[]>(MOCK_WORKERS);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchWorkers().then((w) => {
      if (!active) return;
      const authorized = w.filter((op) => op.role_designation?.toLowerCase() !== "worker");
      setWorkers(authorized.length > 0 ? authorized : MOCK_WORKERS);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const handleConfirm = useCallback(() => {
    if (selected) confirm(selected);
  }, [selected, confirm]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--overlay-bg)] backdrop-blur-sm" onClick={cancel} />

      <div className="glass-card relative z-10 w-full max-w-md mx-4 p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-8 w-8 rounded-lg bg-crimson-primary/15 flex items-center justify-center">
            <svg className="h-4 w-4 text-crimson-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <div>
            <h2 className="text-h2 font-semibold">Operator Attribution Required</h2>
            <p className="text-caption text-muted mt-0.5">{actionLabel}</p>
          </div>
        </div>

        <div className="glow-line mb-4" />

        <div className="flex flex-col gap-1.5 mb-6">
          <label className="text-caption font-medium text-muted uppercase tracking-wider">
            Select Active Operator
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={loading}
            className="h-9 px-3 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-foreground font-mono text-body focus:border-[#DC2626] focus:outline-none focus:ring-2 focus:ring-[#DC2626]/20 transition-colors appearance-none"
          >
            <option value="">
              {loading ? "Loading staff..." : "— Select operator —"}
            </option>
            {workers
              .filter((w) => w.role_designation?.toLowerCase() !== "worker")
              .map((w) => (
              <option key={w.id} value={w.full_name}>
                {w.full_name} ({w.role_designation})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end gap-3">
          <CrimsonButton variant="ghost" onClick={cancel}>
            Cancel
          </CrimsonButton>
          <CrimsonButton
            onClick={handleConfirm}
            disabled={!selected}
            className={!selected ? "opacity-40 cursor-not-allowed" : ""}
          >
            Confirm Action
          </CrimsonButton>
        </div>
      </div>
    </div>
  );
}

export default function OperatorModal() {
  const isOpen = useOperatorStore((s) => s.isOpen);
  const nonce = useOperatorStore((s) => s.nonce);
  if (!isOpen) return null;
  return <OperatorModalInner key={nonce} />;
}
