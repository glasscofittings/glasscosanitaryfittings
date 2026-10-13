"use client";

import { type AttendanceMap } from "@/lib/supabase/labour";

interface Props {
  year: number;
  month: number;
  attendance: AttendanceMap;
  workerId: string;
  onToggle: (date: string) => void;
}

const STATUS_CYCLE: Record<string, "P" | "A" | "L" | undefined> = {
  undefined: "P",
  "P": "A",
  "A": "L",
  "L": undefined,
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  P: { bg: "bg-status-optimal/20", text: "text-status-optimal", border: "border-status-optimal/30", label: "P" },
  A: { bg: "bg-status-alert/20", text: "text-status-alert", border: "border-status-alert/30", label: "A" },
  L: { bg: "bg-status-amber/20", text: "text-status-amber", border: "border-status-amber/30", label: "L" },
};

export default function AttendanceCalendarGrid({ year, month, attendance, workerId, onToggle }: Props) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const workerAtt = attendance[workerId] ?? {};

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  const summary = { P: 0, A: 0, L: 0 };
  Object.values(workerAtt).forEach((s) => {
    if (s === "P") summary.P++;
    else if (s === "A") summary.A++;
    else if (s === "L") summary.L++;
  });

  function handleClick(day: number) {
    const dateStr = formatDate(year, month, day);
    onToggle(dateStr);
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-h2 font-semibold">{monthName}</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-caption">
            <span className="h-2 w-2 rounded-full bg-status-optimal" />
            <span className="text-secondary">{summary.P}P</span>
          </div>
          <div className="flex items-center gap-1.5 text-caption">
            <span className="h-2 w-2 rounded-full bg-status-alert" />
            <span className="text-secondary">{summary.A}A</span>
          </div>
          <div className="flex items-center gap-1.5 text-caption">
            <span className="h-2 w-2 rounded-full bg-status-amber" />
            <span className="text-secondary">{summary.L}L</span>
          </div>
        </div>
      </div>
      <div className="glow-line mb-4" />

      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center text-caption text-muted font-medium py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;

          const dateStr = formatDate(year, month, day);
          const status = workerAtt[dateStr];
          const style = status ? STATUS_STYLES[status] : null;
          const isToday = new Date().toISOString().slice(0, 10) === dateStr;

          return (
            <button
              key={day}
              onClick={() => handleClick(day)}
              className={`h-10 rounded-lg text-body font-medium transition-all border flex items-center justify-center ${
                style
                  ? `${style.bg} ${style.text} ${style.border}`
                  : isToday
                    ? "bg-bg-muted border-crimson-primary/30 text-foreground"
                    : "bg-bg-subtle border-border-subtle text-secondary hover:bg-bg-muted hover:border-border-default"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-border-subtle">
        <span className="text-caption text-muted">Click cell to cycle</span>
        <div className="flex items-center gap-2 text-caption text-muted">
          <span className="text-status-optimal">→P</span>
          <span className="text-status-alert">→A</span>
          <span className="text-status-amber">→L</span>
          <span>→Clear</span>
        </div>
      </div>
    </div>
  );
}
