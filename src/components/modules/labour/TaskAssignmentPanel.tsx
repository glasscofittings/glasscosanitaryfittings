"use client";

import { useState } from "react";
import { type Worker } from "@/lib/supabase/labour";
import { useLabourTaskStore } from "@/lib/store/useLabourTaskStore";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  worker: Worker;
}

const STATUS_STYLES = {
  PENDING: { bg: "bg-status-amber/15", text: "text-status-amber", border: "border-status-amber/20", label: "PENDING" },
  IN_PROGRESS: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/20", label: "IN PROGRESS" },
  COMPLETED: { bg: "bg-status-optimal/15", text: "text-status-optimal", border: "border-status-optimal/20", label: "DONE" },
};

export default function TaskAssignmentPanel({ worker }: Props) {
  const tasks = useLabourTaskStore((s) => s.tasks);
  const addTaskToBoard = useLabourTaskStore((s) => s.addTask);
  const cycleStatus = useLabourTaskStore((s) => s.cycleStatus);
  const [newTitle, setNewTitle] = useState("");
  const [newBatch, setNewBatch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const workerTasks = tasks.filter((t) => t.workerId === worker.id);
  const pendingCount = workerTasks.filter((t) => t.status === "PENDING").length;
  const inProgressCount = workerTasks.filter((t) => t.status === "IN_PROGRESS").length;

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    addTaskToBoard({ workerId: worker.id, title: newTitle, batchOrder: newBatch });
    setNewTitle("");
    setNewBatch("");
    setShowForm(false);
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-h2 font-semibold">Task Board</h2>
          <p className="text-caption text-muted mt-0.5">{worker.full_name}</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-status-amber/15 text-status-amber border border-status-amber/20">
              {pendingCount} pending
            </span>
          )}
          {inProgressCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
              {inProgressCount} active
            </span>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="crimson-btn text-caption px-3 py-1"
          >
            + New Task
          </button>
        </div>
      </div>
      <div className="glow-line mb-4" />

      {showForm && (
        <form onSubmit={addTask} className="mb-4 p-3 rounded-lg bg-bg-subtle border border-border-subtle space-y-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(capitalizeFirst(e.target.value))}
            className="glass-input w-full text-caption"
            placeholder="Task description..."
            autoFocus
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={newBatch}
              onChange={(e) => setNewBatch(e.target.value)}
              className="glass-input flex-1 text-caption"
              placeholder="Batch order # (optional)"
            />
            <button type="submit" className="crimson-btn text-caption px-3">Add</button>
            <button type="button" onClick={() => setShowForm(false)} className="text-caption text-muted hover:text-foreground px-2">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {workerTasks.length === 0 ? (
          <p className="text-caption text-muted text-center py-4">No tasks assigned.</p>
        ) : (
          workerTasks.map((task) => {
            const s = STATUS_STYLES[task.status];
            return (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 rounded-lg bg-bg-subtle border border-border-subtle hover:border-border-default transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-body text-foreground truncate">{task.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-caption text-muted">
                    <span className="font-mono">{task.batchOrder}</span>
                    <span>·</span>
                    <span>{new Date(task.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <button
                  onClick={() => cycleStatus(task.id)}
                  className={`text-[10px] font-mono font-medium px-2 py-1 rounded border ${s.bg} ${s.text} ${s.border} hover:opacity-80 transition-opacity shrink-0 ml-3`}
                >
                  {s.label}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
