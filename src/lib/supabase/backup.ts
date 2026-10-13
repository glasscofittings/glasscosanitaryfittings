import { exportBackupData, formatBytes } from "@/lib/backup-exporter";
import type { DispatchRecord } from "@/lib/supabase/invoicing";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

export type BackupInterval = "1_day" | "1_week" | "1_month" | "custom";

export interface CustomDateRange {
  start: string;
  end: string;
}

function getIntervalDateRange(interval: BackupInterval, customRange?: CustomDateRange): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();

  if (interval === "custom" && customRange) {
    return {
      from: new Date(customRange.start).toISOString(),
      to: new Date(customRange.end + "T23:59:59").toISOString(),
    };
  }

  let from: Date;
  switch (interval) {
    case "1_day":
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "1_week":
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "1_month":
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  return { from: from.toISOString(), to };
}

export async function fetchDispatchRecordsForBackup(
  interval: BackupInterval,
  customRange?: CustomDateRange
): Promise<DispatchRecord[]> {
  if (!SUPABASE_URL) return [];

  const { from, to } = getIntervalDateRange(interval, customRange);

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dispatch_records?posted_at=gte.${from}&posted_at=lte.${to}&select=*&order=posted_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [dispatch_records backup fetch]:", {
        status: res.status,
        body: await res.json(),
      });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as DispatchRecord[];
  } catch (err) {
    console.error("Supabase Error [dispatch_records backup fetch]:", err);
    return [];
  }
}

function formatIntervalLabel(interval: BackupInterval, customRange?: CustomDateRange): string {
  switch (interval) {
    case "1_day":
      return "Last 24 Hours";
    case "1_week":
      return "Last 7 Days";
    case "1_month":
      return "Last 30 Days";
    case "custom":
      return customRange
        ? `${customRange.start} to ${customRange.end}`
        : "Custom Range";
  }
}

function generateFilename(interval: BackupInterval): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5).replace(":", "");
  return `dispatch-backup-${interval}-${dateStr}_${timeStr}.json`;
}

export async function downloadBackup(
  interval: BackupInterval,
  customRange?: CustomDateRange
): Promise<{ success: boolean; recordCount: number; byteSize: number }> {
  const records = await fetchDispatchRecordsForBackup(interval, customRange);

  if (records.length === 0) {
    return { success: false, recordCount: 0, byteSize: 0 };
  }

  const snapshot = {
    exportDate: new Date().toISOString(),
    interval: formatIntervalLabel(interval, customRange),
    recordCount: records.length,
    records,
  };

  const filename = generateFilename(interval);
  const result = await exportBackupData(filename, snapshot);

  return {
    success: result.success,
    recordCount: records.length,
    byteSize: result.byteSize,
  };
}

// Auto-backup localStorage helpers
const AUTO_BACKUP_KEY = "glassco_auto_backup_enabled";
const AUTO_BACKUP_LAST_RUN_KEY = "glassco_auto_backup_last_run";

export function isAutoBackupEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AUTO_BACKUP_KEY) === "true";
  } catch {
    return false;
  }
}

export function setAutoBackupEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_BACKUP_KEY, String(enabled));
  } catch {
    // localStorage unavailable
  }
}

export function getLastAutoBackupDate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(AUTO_BACKUP_LAST_RUN_KEY);
  } catch {
    return null;
  }
}

export function setLastAutoBackupDate(dateStr: string): void {
  try {
    localStorage.setItem(AUTO_BACKUP_LAST_RUN_KEY, dateStr);
  } catch {
    // localStorage unavailable
  }
}

export function hasAutoBackupRunToday(): boolean {
  const lastRun = getLastAutoBackupDate();
  if (!lastRun) return false;
  const today = new Date().toISOString().slice(0, 10);
  return lastRun === today;
}

export async function runAutoBackupIfNeeded(): Promise<{
  triggered: boolean;
  result?: { success: boolean; recordCount: number; byteSize: number };
}> {
  if (!isAutoBackupEnabled()) {
    return { triggered: false };
  }
  if (hasAutoBackupRunToday()) {
    return { triggered: false };
  }

  const result = await downloadBackup("1_day");
  setLastAutoBackupDate(new Date().toISOString().slice(0, 10));

  return { triggered: true, result };
}
