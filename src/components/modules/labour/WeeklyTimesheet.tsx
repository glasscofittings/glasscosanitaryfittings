"use client";

import { type Worker, type AttendanceMap } from "@/lib/supabase/labour";

interface Props {
  year: number;
  month: number;
  weekStartDay: number;
  workers: Worker[];
  attendance: AttendanceMap;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getWeekDays(year: number, month: number, weekStartDay: number): { day: number; dateStr: string; label: string; dayName: string }[] {
  const daysInMonth = getDaysInMonth(year, month);
  const days: { day: number; dateStr: string; label: string; dayName: string }[] = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let i = 0; i < 7; i++) {
    const d = weekStartDay + i;
    if (d >= 1 && d <= daysInMonth) {
      const dt = new Date(year, month - 1, d);
      days.push({
        day: d,
        dateStr: formatDate(year, month, d),
        label: String(d),
        dayName: dayNames[dt.getDay()],
      });
    }
  }
  return days;
}

const STATUS_COLORS: Record<string, string> = {
  P: "bg-status-optimal/20 text-status-optimal border-status-optimal/30",
  A: "bg-status-alert/20 text-status-alert border-status-alert/30",
  L: "bg-status-amber/20 text-status-amber border-status-amber/30",
};

export default function WeeklyTimesheet({ year, month, weekStartDay, workers, attendance }: Props) {
  const weekDays = getWeekDays(year, month, weekStartDay);

  function getWorkerWeekStats(workerId: string) {
    const att = attendance[workerId] ?? {};
    let p = 0, a = 0, l = 0;
    weekDays.forEach((d) => {
      const s = att[d.dateStr];
      if (s === "P") p++;
      else if (s === "A") a++;
      else if (s === "L") l++;
    });
    return { p, a, l, total: p + a + l };
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-h2 font-semibold">Weekly Timesheet</h2>
        <span className="badge font-mono">
          Week of {weekDays[0]?.label} – {weekDays[weekDays.length - 1]?.label}
        </span>
      </div>
      <div className="glow-line mb-4" />

      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="text-caption text-muted font-medium px-3 py-2 uppercase tracking-wider w-40">Worker</th>
              {weekDays.map((d) => (
                <th key={d.dateStr} className="text-caption text-muted font-medium px-2 py-2 uppercase tracking-wider text-center w-16">
                  <div>{d.dayName}</div>
                  <div className="text-[10px] text-muted">{d.label}</div>
                </th>
              ))}
              <th className="text-caption text-muted font-medium px-3 py-2 uppercase tracking-wider text-center w-12">Tot</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => {
              const stats = getWorkerWeekStats(w.id);
              const att = attendance[w.id] ?? {};
              return (
                <tr key={w.id} className="border-b border-border-subtle hover:bg-bg-subtle transition-colors">
                  <td className="px-3 py-2">
                    <p className="text-body text-foreground truncate">{w.full_name}</p>
                    <p className="text-[10px] text-muted truncate">{w.role_designation}</p>
                  </td>
                  {weekDays.map((d) => {
                    const status = att[d.dateStr];
                    const colorClass = status ? STATUS_COLORS[status] : "bg-bg-subtle border-border-subtle text-muted";
                    return (
                      <td key={d.dateStr} className="px-2 py-2 text-center">
                        <span className={`inline-flex items-center justify-center h-7 w-7 rounded text-[11px] font-mono font-medium border ${colorClass}`}>
                          {status ?? "—"}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] font-mono text-status-optimal">{stats.p}P</span>
                      {stats.a > 0 && <span className="text-[10px] font-mono text-status-alert">{stats.a}A</span>}
                      {stats.l > 0 && <span className="text-[10px] font-mono text-status-amber">{stats.l}L</span>}
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
