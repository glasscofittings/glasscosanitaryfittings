import { create } from "zustand";

export type LabourTaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

export interface LabourTask {
  id: string;
  workerId: string;
  title: string;
  batchOrder: string;
  status: LabourTaskStatus;
  createdAt: string;
}

const NEXT_STATUS: Record<LabourTaskStatus, LabourTaskStatus> = {
  PENDING: "IN_PROGRESS",
  IN_PROGRESS: "COMPLETED",
  COMPLETED: "PENDING",
};

const SEED_TASKS: LabourTask[] = [
  { id: "t1", workerId: "w1", title: "Batch mixing — Super Gloss White", batchOrder: "BO-2026-042", status: "IN_PROGRESS", createdAt: "2026-09-12T08:30:00Z" },
  { id: "t2", workerId: "w2", title: "CNC cutting — Valve housing", batchOrder: "BO-2026-041", status: "PENDING", createdAt: "2026-09-12T09:00:00Z" },
  { id: "t3", workerId: "w3", title: "QC sampling — Matt Finish Primer", batchOrder: "BO-2026-040", status: "COMPLETED", createdAt: "2026-09-11T14:00:00Z" },
  { id: "t4", workerId: "w1", title: "Raw material weighing — TiO2", batchOrder: "BO-2026-042", status: "COMPLETED", createdAt: "2026-09-12T07:00:00Z" },
  { id: "t5", workerId: "w4", title: "Store reconciliation — WH-01", batchOrder: "—", status: "PENDING", createdAt: "2026-09-12T10:00:00Z" },
];

interface LabourTaskState {
  tasks: LabourTask[];
  addTask: (input: { workerId: string; title: string; batchOrder?: string }) => void;
  cycleStatus: (taskId: string) => void;
}

export const useLabourTaskStore = create<LabourTaskState>((set) => ({
  tasks: SEED_TASKS,

  addTask: ({ workerId, title, batchOrder }) =>
    set((s) => ({
      tasks: [
        {
          id: `t${Date.now()}`,
          workerId,
          title: title.trim(),
          batchOrder: batchOrder?.trim() || "—",
          status: "PENDING",
          createdAt: new Date().toISOString(),
        },
        ...s.tasks,
      ],
    })),

  cycleStatus: (taskId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: NEXT_STATUS[t.status] } : t)),
    })),
}));
