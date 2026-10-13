"use client";

import { useEffect, useState } from "react";
import {
  fetchWorkers,
  fetchAttendance,
  upsertAttendance,
  buildAttendanceMap,
  deleteWorker,
  type Worker,
  type AttendanceMap,
} from "@/lib/supabase/labour";
import WorkerRoster from "@/components/modules/labour/WorkerRoster";
import AttendanceCalendarGrid from "@/components/modules/labour/AttendanceCalendarGrid";
import SalaryCard from "@/components/modules/labour/SalaryCard";
import CreateWorkerModal from "@/components/modules/labour/CreateWorkerModal";
import EditWorkerModal from "@/components/modules/labour/EditWorkerModal";
import IssueLoanModal from "@/components/modules/labour/IssueLoanModal";
import LoanTrackingPanel from "@/components/modules/labour/LoanTrackingPanel";
import WeeklyTimesheet from "@/components/modules/labour/WeeklyTimesheet";
import TaskAssignmentPanel from "@/components/modules/labour/TaskAssignmentPanel";
import { toast } from "sonner";

type TabKey = "attendance" | "salary" | "loans" | "timesheet" | "tasks";

function getMonthAttendanceSummary(
  workers: Worker[],
  attendance: AttendanceMap
) {
  return workers.map((w) => {
    const dayMap = attendance[w.id] ?? {};
    const values = Object.values(dayMap);
    return {
      workerId: w.id,
      present: values.filter((v) => v === "P").length,
      absent: values.filter((v) => v === "A").length,
      leave: values.filter((v) => v === "L").length,
    };
  });
}

export default function LabourPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [attendance, setAttendance] = useState<AttendanceMap>({});
  const [isLive, setIsLive] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("attendance");
  const [salaryRefreshKey, setSalaryRefreshKey] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showIssueLoan, setShowIssueLoan] = useState(false);

  async function loadAll() {
    const [workerList, attendanceRecords] = await Promise.all([
      fetchWorkers(),
      fetchAttendance(year, month),
    ]);
    if (workerList.length > 0) {
      setWorkers(workerList);
      setIsLive(true);
      setSelectedWorker((prev) => prev ?? workerList[0]);
    }
    setAttendance(buildAttendanceMap(attendanceRecords));
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const [workerList, attendanceRecords] = await Promise.all([
        fetchWorkers(),
        fetchAttendance(year, month),
      ]);
      if (cancelled) return;
      if (workerList.length > 0) {
        setWorkers(workerList);
        setIsLive(true);
        setSelectedWorker((prev) => prev ?? workerList[0]);
      }
      setAttendance(buildAttendanceMap(attendanceRecords));
    }
    run();
    return () => { cancelled = true; };
  }, [year, month]);

  async function handleToggleAttendance(date: string) {
    if (!selectedWorker) return;
    const current = attendance[selectedWorker.id]?.[date];
    const next =
      current === undefined ? "P" :
      current === "P" ? "A" :
      current === "A" ? "L" : undefined;

    if (next === undefined) {
      setAttendance((prev) => {
        const copy = { ...prev };
        if (copy[selectedWorker.id]) {
          const inner = { ...copy[selectedWorker.id] };
          delete inner[date];
          copy[selectedWorker.id] = inner;
        }
        return copy;
      });
    } else {
      await upsertAttendance(selectedWorker.id, date, next);
      setAttendance((prev) => ({
        ...prev,
        [selectedWorker.id]: {
          ...(prev[selectedWorker.id] ?? {}),
          [date]: next,
        },
      }));
    }
  }

  async function handleDeleteWorker() {
    if (!selectedWorker) return;
    const ok = await deleteWorker(selectedWorker.id);
    if (ok) {
      const remaining = workers.filter((w) => w.id !== selectedWorker.id);
      setWorkers(remaining);
      setSelectedWorker(remaining[0] ?? null);
      toast.success("Worker removed");
    } else {
      toast.error("Failed to remove worker");
    }
  }

  const attendanceSummary = getMonthAttendanceSummary(workers, attendance);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "attendance", label: "Attendance" },
    { key: "salary", label: "Salary" },
    { key: "loans", label: "Loans" },
    { key: "timesheet", label: "Timesheet" },
    { key: "tasks", label: "Tasks" },
  ];

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-h1 font-bold">Labour / HR</h1>
          <p className="text-caption text-muted">
            {isLive
              ? `${workers.length} active workers`
              : "Demo data — connect Supabase to sync"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="input-base text-sm px-3 py-1.5"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="input-base text-sm px-3 py-1.5"
          >
            {[2023, 2024, 2025, 2026].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary text-sm"
          >
            + Add Worker
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Worker Roster */}
        <div className="w-[260px] shrink-0 overflow-hidden flex flex-col">
          <WorkerRoster
            workers={workers}
            selectedId={selectedWorker?.id ?? null}
            onSelect={setSelectedWorker}
            attendanceSummary={attendanceSummary}
          />
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 min-w-0 flex flex-col glass-card overflow-hidden">
          {selectedWorker ? (
            <>
              {/* Worker header */}
              <div className="p-5 pb-0">
                <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <h2 className="text-h2 font-semibold">{selectedWorker.full_name}</h2>
                    <p className="text-caption text-muted">{selectedWorker.role_designation}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowEdit(true)}
                      className="btn-secondary text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setShowIssueLoan(true)}
                      className="btn-secondary text-sm"
                    >
                      Issue Loan
                    </button>
                    <button
                      onClick={handleDeleteWorker}
                      className="btn-danger text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 border-b border-[var(--glass-border)]">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setActiveTab(t.key)}
                      className={[
                        "px-4 py-2 text-sm font-medium border-b-2 transition-all",
                        activeTab === t.key
                          ? "border-crimson-primary text-crimson-primary"
                          : "border-transparent text-muted hover:text-foreground",
                      ].join(" ")}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto p-5">
                {activeTab === "attendance" && (
                  <AttendanceCalendarGrid
                    year={year}
                    month={month}
                    attendance={attendance}
                    workerId={selectedWorker.id}
                    onToggle={handleToggleAttendance}
                  />
                )}
                {activeTab === "salary" && (
                  <SalaryCard
                    key={selectedWorker.id}
                    worker={selectedWorker}
                    year={year}
                    month={month}
                    attendance={attendance}
                    refreshKey={salaryRefreshKey}
                    onPaid={() => setSalaryRefreshKey((k) => k + 1)}
                  />
                )}
                {activeTab === "loans" && (
                  <LoanTrackingPanel
                    selectedWorker={selectedWorker}
                    onRefresh={() => setSalaryRefreshKey((k) => k + 1)}
                  />
                )}
                {activeTab === "timesheet" && (
                  <WeeklyTimesheet
                    year={year}
                    month={month}
                    weekStartDay={1}
                    workers={workers}
                    attendance={attendance}
                  />
                )}
                {activeTab === "tasks" && (
                  <TaskAssignmentPanel worker={selectedWorker} />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted">
              <p>Select a worker from the roster</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <CreateWorkerModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(worker) => {
          setWorkers((prev) => [...prev, worker]);
          setSelectedWorker(worker);
          setShowCreate(false);
          toast.success("Worker added successfully");
        }}
      />
      <EditWorkerModal
        open={showEdit}
        worker={selectedWorker}
        onClose={() => setShowEdit(false)}
        onSaved={(updated) => {
          setWorkers((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
          setSelectedWorker(updated);
          setShowEdit(false);
          toast.success("Worker updated");
        }}
      />
      <IssueLoanModal
        open={showIssueLoan}
        worker={selectedWorker}
        onClose={() => setShowIssueLoan(false)}
        onCreated={() => {
          setShowIssueLoan(false);
          setActiveTab("loans");
          setSalaryRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
