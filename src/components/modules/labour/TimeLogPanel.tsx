"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  saveTimeLog,
  type Worker,
  type AttendanceMap,
  type AttendanceRecord,
  type TimeLogMap,
} from "@/lib/supabase/labour";
import {
  SHIFT_START,
  SHIFT_END,
  calculateDayTime,
  calculateEarnedSalary,
  formatMinutes,
} from "@/lib/salary";

interface Props {
  worker: Worker;
  year: number;
  month: number;
  attendance: AttendanceMap;
  timeLogs: TimeLogMap;
  onSaved: (record: AttendanceRecord) => void;
}

interface Draft {
  checkIn: string;
  checkOut: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localToday(): string {
  const d = new Date();
  return formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function to12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export default function TimeLogPanel({ worker, year, month, attendance, timeLogs, onSaved }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingDate, setSavingDate] = useState<string | null>(null);

  const daysInMonth = new Date(year, month, 0).getDate();
  const today = localToday();
  const workerAtt = attendance[worker.id] ?? {};
  const workerTimes = timeLogs[worker.id] ?? {};
  const salary = calculateEarnedSalary(worker, attendance, year, month, timeLogs);
  const monthLabel = new Date(year, month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  const todayInMonth = today.startsWith(`${year}-${String(month).padStart(2, "0")}-`);
  const todayLog = workerTimes[today];

  function savedValue(date: string): Draft {
    const log = workerTimes[date];
    return { checkIn: log?.checkIn ?? "", checkOut: log?.checkOut ?? "" };
  }

  function currentValue(date: string): Draft {
    return drafts[date] ?? savedValue(date);
  }

  function setField(date: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [date]: { ...currentValue(date), [field]: value } }));
  }

  async function persist(date: string, checkIn: string, checkOut: string) {
    if (!checkIn && checkOut) {
      toast.error("Log the arrival time before the departure time");
      return;
    }
    if (checkIn && checkOut && checkOut <= checkIn) {
      toast.error("Departure must be after arrival");
      return;
    }
    setSavingDate(date);
    const { record, error } = await saveTimeLog(worker.id, date, checkIn || null, checkOut || null);
    setSavingDate(null);
    if (!record) {
      toast.error(error ?? "Failed to save time log");
      return;
    }
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[date];
      return copy;
    });
    onSaved(record);
    toast.success("Time log saved");
  }

  async function clockIn() {
    await persist(today, nowHHMM(), "");
  }

  async function clockOut() {
    if (!todayLog?.checkIn) return;
    await persist(today, todayLog.checkIn, nowHHMM());
  }

  const rows = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const date = formatDate(year, month, day);
    return { day, date, dayName: DAY_NAMES[new Date(year, month - 1, day).getDay()] };
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="glass-card p-4">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
          <div>
            <h2 className="text-body font-semibold text-foreground">Time Log — {monthLabel}</h2>
            <p className="text-caption text-muted mt-0.5">
              Shift {to12h(SHIFT_START)} – {to12h(SHIFT_END)} · time after {to12h(SHIFT_END)} is overtime ·
              late arrival / early departure is deducted
            </p>
          </div>
          {todayInMonth && (
            <div className="flex items-center gap-2">
              <button
                onClick={clockIn}
                disabled={!!todayLog?.checkIn || savingDate === today}
                title={todayLog?.checkIn ? `Arrived at ${to12h(todayLog.checkIn)}` : "Log arrival now"}
                className="h-8 px-3 rounded-md bg-crimson-primary text-white text-caption font-medium hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {todayLog?.checkIn ? `In ${to12h(todayLog.checkIn)}` : "Clock In"}
              </button>
              <button
                onClick={clockOut}
                disabled={!todayLog?.checkIn || !!todayLog?.checkOut || savingDate === today}
                title={todayLog?.checkOut ? `Left at ${to12h(todayLog.checkOut)}` : "Log departure now"}
                className="h-8 px-3 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {todayLog?.checkOut ? `Out ${to12h(todayLog.checkOut)}` : "Clock Out"}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
            <p className="text-[10px] text-muted uppercase">Present</p>
            <p className="text-body font-mono font-medium text-status-optimal mt-0.5">
              {salary.presentDays} day{salary.presentDays === 1 ? "" : "s"}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
            <p className="text-[10px] text-muted uppercase">Overtime</p>
            <p className="text-body font-mono font-medium text-foreground mt-0.5">
              {formatMinutes(salary.overtimeMinutes)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
            <p className="text-[10px] text-muted uppercase">Overtime Rate</p>
            <p className="text-body font-mono font-medium text-foreground mt-0.5">
              PKR {salary.overtimeRate.toLocaleString()}/hr
            </p>
          </div>
          <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
            <p className="text-[10px] text-muted uppercase">Overtime Pay</p>
            <p className="text-body font-mono font-medium text-status-optimal mt-0.5">
              PKR {salary.overtimePay.toLocaleString()}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-bg-subtle border border-border-subtle">
            <p className="text-[10px] text-muted uppercase">Undertime Deduction</p>
            <p className="text-body font-mono font-medium text-status-alert mt-0.5">
              − PKR {salary.undertimeDeduction.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted mt-0.5">
              {formatMinutes(salary.undertimeMinutes)} × PKR {salary.hourlyRate.toFixed(2)}/hr
            </p>
          </div>
        </div>
      </div>

      {/* Daily log */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border-subtle text-caption text-muted uppercase">
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-3 py-2">Arrived</th>
                <th className="text-left font-medium px-3 py-2">Left</th>
                <th className="text-right font-medium px-3 py-2">Worked</th>
                <th className="text-right font-medium px-3 py-2">Overtime</th>
                <th className="text-right font-medium px-3 py-2">Undertime</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ day, date, dayName }) => {
                const status = workerAtt[date];
                const value = currentValue(date);
                const saved = savedValue(date);
                const dirty = value.checkIn !== saved.checkIn || value.checkOut !== saved.checkOut;
                const time = calculateDayTime(value.checkIn, value.checkOut);
                const late = time && time.lateMinutes > 0;
                const locked = status === "A" || status === "L";
                const isToday = date === today;

                return (
                  <tr
                    key={date}
                    className={`border-b border-border-subtle last:border-0 ${isToday ? "bg-crimson-primary/5" : ""}`}
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="font-mono text-foreground">{String(day).padStart(2, "0")}</span>{" "}
                      <span className="text-caption text-muted">{dayName}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      {status === "P" && <span className="text-caption font-medium text-status-optimal">Present</span>}
                      {status === "A" && <span className="text-caption font-medium text-status-alert">Absent</span>}
                      {status === "L" && <span className="text-caption font-medium text-status-amber">Leave</span>}
                      {!status && <span className="text-caption text-muted">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="time"
                        value={value.checkIn}
                        disabled={locked}
                        onChange={(e) => setField(date, "checkIn", e.target.value)}
                        title={locked ? "Change attendance to Present to log times" : undefined}
                        className="glass-input h-8 px-2 font-mono text-caption disabled:opacity-40"
                      />
                      {late && (
                        <span className="ml-1.5 text-[10px] text-status-amber">late {formatMinutes(time.lateMinutes)}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="time"
                        value={value.checkOut}
                        disabled={locked}
                        onChange={(e) => setField(date, "checkOut", e.target.value)}
                        title={locked ? "Change attendance to Present to log times" : undefined}
                        className="glass-input h-8 px-2 font-mono text-caption disabled:opacity-40"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-caption text-secondary whitespace-nowrap">
                      {time ? formatMinutes(time.workedMinutes) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-caption whitespace-nowrap">
                      {time && time.overtimeMinutes > 0 ? (
                        <span className="text-status-optimal font-medium">{formatMinutes(time.overtimeMinutes)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-caption whitespace-nowrap">
                      {time && time.undertimeMinutes > 0 ? (
                        <span className="text-status-alert font-medium">{formatMinutes(time.undertimeMinutes)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {dirty && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() =>
                              setDrafts((prev) => {
                                const copy = { ...prev };
                                delete copy[date];
                                return copy;
                              })
                            }
                            className="h-7 px-2 rounded-md text-caption text-muted hover:text-foreground transition-colors"
                          >
                            Undo
                          </button>
                          <button
                            onClick={() => persist(date, value.checkIn, value.checkOut)}
                            disabled={savingDate === date}
                            className="h-7 px-3 rounded-md bg-crimson-primary text-white text-caption font-medium hover:bg-crimson-dark disabled:opacity-50 transition-colors"
                          >
                            {savingDate === date ? "Saving..." : "Save"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted px-3 py-2 border-t border-border-subtle">
          Logging a time marks the day Present. Undertime is only deducted once both times are logged. Absent / Leave days can&apos;t carry times — change them on the Attendance tab first.
        </p>
      </div>
    </div>
  );
}
