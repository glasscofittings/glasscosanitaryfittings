"use client";

import { useState, useEffect } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  downloadBackup,
  isAutoBackupEnabled,
  setAutoBackupEnabled,
  hasAutoBackupRunToday,
  type BackupInterval,
  type CustomDateRange,
} from "@/lib/supabase/backup";
import { formatBytes } from "@/lib/backup-exporter";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BackupModal({ open, onClose }: Props) {
  const [autoBackup, setAutoBackup] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState<BackupInterval>("1_day");
  const [customRange, setCustomRange] = useState<CustomDateRange>({ start: "", end: "" });
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; recordCount: number; byteSize: number } | null>(null);
  const [hasRanToday, setHasRanToday] = useState(false);

  useEffect(() => {
    if (open) {
      setAutoBackup(isAutoBackupEnabled());
      setHasRanToday(hasAutoBackupRunToday());
      setResult(null);
    }
  }, [open]);

  useEscapeToClose(open, onClose);

  function handleToggleAutoBackup() {
    const next = !autoBackup;
    setAutoBackup(next);
    setAutoBackupEnabled(next);
    if (next) {
      setHasRanToday(hasAutoBackupRunToday());
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setResult(null);
    const res = await downloadBackup(
      selectedInterval,
      selectedInterval === "custom" ? customRange : undefined
    );
    setResult(res);
    setDownloading(false);
  }

  const intervals: { key: BackupInterval; label: string }[] = [
    { key: "1_day", label: "1 Day" },
    { key: "1_week", label: "1 Week" },
    { key: "1_month", label: "1 Month" },
    { key: "custom", label: "Custom" },
  ];

  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5";

  if (!open) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-lg p-6 border border-border-default shadow-2xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-h2 font-semibold">Backup Data</h2>
              <p className="text-caption text-muted mt-0.5">Export dispatch records as JSON</p>
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

          <div className="glow-line mb-5" />

          {/* Auto-Backup Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-bg-subtle border border-border-subtle mb-5">
            <div>
              <p className="text-body font-medium text-foreground">Automatic Daily Backup</p>
              <p className="text-caption text-muted mt-0.5">
                Downloads a 24-hour backup once per day on page load
              </p>
            </div>
            <button
              onClick={handleToggleAutoBackup}
              className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ml-3 ${
                autoBackup
                  ? "bg-crimson-primary"
                  : "bg-bg-muted border border-border-default"
              }`}
              type="button"
              role="switch"
              aria-checked={autoBackup}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${
                  autoBackup ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {autoBackup && hasRanToday && (
            <div className="flex items-center gap-2 text-caption text-status-optimal bg-status-optimal/10 px-3 py-2 rounded-lg border border-status-optimal/20 mb-5">
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Auto-backup already ran today
            </div>
          )}

          {/* Interval Selector */}
          <div className="mb-5">
            <label className={labelCls}>Backup Interval</label>
            <div className="grid grid-cols-4 gap-2">
              {intervals.map((iv) => (
                <button
                  key={iv.key}
                  onClick={() => setSelectedInterval(iv.key)}
                  className={`h-9 rounded-lg text-caption font-medium transition-colors border ${
                    selectedInterval === iv.key
                      ? "bg-crimson-primary text-white border-crimson-primary"
                      : "bg-bg-subtle text-secondary border-border-subtle hover:border-border-default hover:text-foreground"
                  }`}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Date Range */}
          {selectedInterval === "custom" && (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className={labelCls}>Start Date</label>
                <input
                  type="date"
                  value={customRange.start}
                  onChange={(e) => setCustomRange((p) => ({ ...p, start: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>End Date</label>
                <input
                  type="date"
                  value={customRange.end}
                  onChange={(e) => setCustomRange((p) => ({ ...p, end: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
          )}

          {/* Result Feedback */}
          {result && (
            <div
              className={`flex items-start gap-2 text-caption px-3 py-2 rounded-lg border mb-5 ${
                result.success
                  ? "text-status-optimal bg-status-optimal/10 border-status-optimal/20"
                  : "text-status-amber bg-status-amber/10 border-status-amber/20"
              }`}
            >
              <svg className="h-3.5 w-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {result.success ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
              <div>
                {result.success ? (
                  <p className="font-medium">
                    Backup downloaded — {result.recordCount} records ({formatBytes(result.byteSize)})
                  </p>
                ) : (
                  <p className="font-medium">
                    No dispatch records found for the selected interval
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="glow-line mb-5" />

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading || (selectedInterval === "custom" && (!customRange.start || !customRange.end))}
              className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {downloading ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download Backup
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
