"use client";

import { useState, useEffect } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  updateWorker,
  type Worker,
  type EmploymentType,
  type CostClass,
  type PayMethod,
} from "@/lib/supabase/labour";
import { capitalizeFirst } from "@/lib/utils";
import { DEFAULT_BASE_SALARY_PKR, defaultOvertimeRate } from "@/lib/salary";

interface Props {
  open: boolean;
  worker: Worker | null;
  onClose: () => void;
  onSaved: (worker: Worker) => void;
}

const EMPLOYMENT_OPTIONS: Array<{ value: EmploymentType; label: string }> = [
  { value: "PERMANENT_SALARY", label: "Permanent salary" },
  { value: "DAILY_PAY", label: "Daily pay" },
  { value: "PART_TIME_WAGE", label: "Part-time" },
];

const COST_CLASS_OPTIONS: Array<{ value: CostClass; label: string }> = [
  { value: "PRODUCTION", label: "Production = COGS" },
  { value: "ADMIN", label: "Administration = OPEX" },
];

const PAY_METHOD_OPTIONS: Array<{ value: PayMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "BANK", label: "Bank" },
];

export default function EditWorkerModal({ open, worker, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [salary, setSalary] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("");
  const [joinDate, setJoinDate] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("PERMANENT_SALARY");
  const [costClass, setCostClass] = useState<CostClass>("PRODUCTION");
  const [payMethod, setPayMethod] = useState<PayMethod>("CASH");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [cnic, setCnic] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isDailyWorker = employmentType !== "PERMANENT_SALARY";
  const payFieldLabel = isDailyWorker ? "Daily Rate (PKR)" : "Monthly Salary (PKR)";

  useEffect(() => {
    if (worker) {
      setName(worker.full_name);
      setRole(worker.role_designation);
      setSalary(String(worker.base_salary_pkr));
      setOvertimeRate(String(worker.overtime_rate_pkr ?? defaultOvertimeRate(worker.base_salary_pkr, worker.employment_type)));
      setJoinDate(worker.joining_date || new Date().toISOString().slice(0, 10));
      setEmploymentType(worker.employment_type ?? "PERMANENT_SALARY");
      setCostClass(worker.cost_class ?? "PRODUCTION");
      setPayMethod(worker.default_pay_method ?? "CASH");
      setBankName(worker.bank_name ?? "");
      setIban(worker.account_iban ?? "");
      setCnic(worker.cnic_no ?? "");
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
      setError(isDailyWorker ? "Daily rate must be a positive number." : "Salary must be a positive number.");
      return;
    }
    const overtimeNum = parseFloat(overtimeRate);
    if (isNaN(overtimeNum) || overtimeNum < 0) {
      setError("Overtime rate must be zero or a positive number.");
      return;
    }
    if (!cnic.trim()) {
      setError("CNIC is required.");
      return;
    }
    if (payMethod === "BANK" && (!bankName.trim() || !iban.trim())) {
      setError("Bank name and IBAN are required for bank payments.");
      return;
    }
    setSaving(true);
    const result = await updateWorker(worker.id, {
      full_name: name.trim(),
      role_designation: role.trim(),
      base_salary_pkr: salaryNum,
      overtime_rate_pkr: overtimeNum,
      joining_date: joinDate,
      employment_type: employmentType,
      cost_class: costClass,
      default_pay_method: payMethod,
      cost_center: worker.cost_center ?? null,
      bank_name: payMethod === "BANK" ? bankName.trim() : null,
      account_iban: payMethod === "BANK" ? iban.trim() : null,
      cnic_no: cnic.trim(),
    });
    setSaving(false);
    if (result) {
      onSaved(result);
      onClose();
    } else {
      setError("Failed to update worker. Please try again.");
    }
  }

  const labelCls = "block text-caption text-muted uppercase tracking-wider font-medium mb-1.5";

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
                <label className={labelCls}>Full Name</label>
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
                <label className={labelCls}>Role / Designation</label>
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
                  <label className={labelCls}>Employment Type</label>
                  <select
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
                    className="glass-input w-full"
                  >
                    {EMPLOYMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Cost Class</label>
                  <select
                    value={costClass}
                    onChange={(e) => setCostClass(e.target.value as CostClass)}
                    className="glass-input w-full"
                  >
                    {COST_CLASS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{payFieldLabel}</label>
                  <input
                    type="number"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    className="glass-input w-full font-mono"
                    placeholder={String(DEFAULT_BASE_SALARY_PKR)}
                    min="0"
                  />
                </div>
                <div>
                  <label className={labelCls}>Joining Date</label>
                  <input
                    type="date"
                    value={joinDate}
                    onChange={(e) => setJoinDate(e.target.value)}
                    className="glass-input w-full"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Pay Method</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PayMethod)}
                    className="glass-input w-full"
                  >
                    {PAY_METHOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>CNIC</label>
                  <input
                    type="text"
                    value={cnic}
                    onChange={(e) => setCnic(e.target.value)}
                    className="glass-input w-full font-mono"
                    placeholder="xxxxx-xxxxxxx-x"
                  />
                </div>
              </div>
              {payMethod === "BANK" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Bank Name</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(capitalizeFirst(e.target.value))}
                      className="glass-input w-full"
                      placeholder="e.g. HBL"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>IBAN</label>
                    <input
                      type="text"
                      value={iban}
                      onChange={(e) => setIban(e.target.value)}
                      className="glass-input w-full font-mono"
                      placeholder="PKxx xxxx xxxx xxxx"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls}>Overtime Rate (PKR / hour)</label>
                <input
                  type="number"
                  value={overtimeRate}
                  onChange={(e) => setOvertimeRate(e.target.value)}
                  className="glass-input w-full font-mono"
                  min="0"
                  step="any"
                />
                <p className="text-[10px] text-muted mt-1">
                  Paid for each hour worked after 5:00 PM. Suggested for this {isDailyWorker ? "rate" : "salary"}: PKR{" "}
                  {defaultOvertimeRate(parseFloat(salary) || 0, employmentType).toLocaleString()}/hr (
                  {isDailyWorker ? "daily rate ÷ 9 hrs" : "salary ÷ 30 days ÷ 9 hrs"})
                </p>
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
