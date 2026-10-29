"use client";

import { type Worker } from "@/lib/supabase/labour";
import { PayrollHeadBadge, PayrollWageGroupBadge } from "@/components/modules/payroll/PayrollBadges";

interface Props {
  workers: Worker[];
  selectedId: string | null;
  onSelect: (worker: Worker) => void;
  attendanceSummary: { workerId: string; present: number; absent: number; leave: number }[];
}

export default function WorkerRoster({ workers, selectedId, onSelect, attendanceSummary }: Props) {
  function getSummary(workerId: string) {
    return attendanceSummary.find((s) => s.workerId === workerId) ?? { present: 0, absent: 0, leave: 0 };
  }

  return (
    <div className="glass-card overflow-hidden h-full flex flex-col">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold">Worker Roster</h2>
          <span className="badge">{workers.length} active</span>
        </div>
        <div className="glow-line mb-4" />
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="space-y-2">
          {workers.map((worker) => {
            const s = getSummary(worker.id);
            const isSelected = worker.id === selectedId;
            return (
              <button
                key={worker.id}
                onClick={() => onSelect(worker)}
                className={`w-full text-left p-3 rounded-lg transition-all ${
                  isSelected
                    ? "bg-crimson-primary/10 border border-crimson-primary/20"
                    : "bg-bg-subtle border border-border-subtle hover:bg-bg-subtle hover:border-border-default"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-body font-medium text-foreground truncate">{worker.full_name}</p>
                    <p className="text-caption text-muted truncate">{worker.role_designation}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <PayrollHeadBadge costClass={worker.cost_class || "PRODUCTION"} />
                      <PayrollWageGroupBadge employmentType={worker.employment_type} />
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {s.present > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-status-optimal/15 text-status-optimal border border-status-optimal/20">
                        {s.present}P
                      </span>
                    )}
                    {s.absent > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-status-alert/15 text-status-alert border border-status-alert/20">
                        {s.absent}A
                      </span>
                    )}
                    {s.leave > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-status-amber/15 text-status-amber border border-status-amber/20">
                        {s.leave}L
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-caption text-muted">
                  <span className="font-mono">PKR {worker.base_salary_pkr.toLocaleString()}</span>
                  <span>·</span>
                  <span>Joined {new Date(worker.joining_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
