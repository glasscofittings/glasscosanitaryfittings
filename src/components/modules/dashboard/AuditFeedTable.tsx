"use client";

import { useEffect, useState } from "react";
import { AuditLog } from "@/lib/supabase/client";

function useFormattedTimestamp(iso: string): string {
  const [formatted, setFormatted] = useState(iso);
  useEffect(() => {
    try {
      const d = new Date(iso);
      setFormatted(
        d.toLocaleString("en-US", {
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    } catch {
      // keep raw iso
    }
  }, [iso]);
  return formatted;
}

function moduleBadgeColor(mod: string): string {
  const m = mod.toUpperCase();
  if (m === "PROCUREMENT") return "bg-brand-ocean/15 text-brand-ocean border-brand-ocean/20";
  if (m === "INVENTORY") return "bg-status-optimal/15 text-status-optimal border-status-optimal/20";
  if (m === "INVOICING") return "bg-brand-coral/15 text-brand-coral border-brand-coral/20";
  if (m === "LEDGER") return "bg-brand-ocean-light/15 text-brand-ocean-light border-brand-ocean-light/20";
  if (m === "LABOUR") return "bg-purple-500/15 text-purple-400 border-purple-500/20";
  if (m === "BOM") return "bg-status-amber/15 text-status-amber border-status-amber/20";
  if (m === "CATALOG") return "bg-brand-coral-light/15 text-brand-coral-light border-brand-coral-light/20";
  if (m === "QC") return "bg-blue-500/15 text-blue-400 border-blue-500/20";
  return "bg-bg-muted text-secondary border-border-default";
}

function TimestampCell({ iso }: { iso: string }) {
  const formatted = useFormattedTimestamp(iso);
  return (
    <td className="px-5 py-3 text-right">
      <span className="font-mono text-num-code text-muted" suppressHydrationWarning>{formatted}</span>
    </td>
  );
}

interface Props {
  logs: AuditLog[];
  newIds?: Set<string>;
}

export default function AuditFeedTable({ logs, newIds = new Set() }: Props) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 font-semibold text-brand-navy dark:text-white">
            Device Activity &amp; Audit Feed
          </h2>
          <div className="flex items-center gap-2">
            {newIds.size > 0 && (
              <span className="flex items-center gap-1 text-caption text-status-optimal">
                <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
                {newIds.size} new
              </span>
            )}
            <span className="badge">{logs.length} entries</span>
          </div>
        </div>
        <p className="text-caption text-muted mb-4">
          kis kis device user na kaya kiya
        </p>
        <div className="glow-line mb-4" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[640px]" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28">
                Terminal Node
              </th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-36">
                Operator
              </th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-24">
                Module
              </th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider">
                Action
              </th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-40 text-right">
                Timestamp
              </th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                  No audit entries found yet — activity will appear here as it happens.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  className={`border-b border-border-subtle transition-colors ${
                    newIds.has(log.id)
                      ? "bg-brand-ocean/5 hover:bg-brand-ocean/10"
                      : "hover:bg-bg-subtle"
                  }`}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-num-code text-secondary">
                        {log.device_node}
                      </span>
                      {newIds.has(log.id) && (
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-ocean animate-pulse shrink-0" />
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-body text-foreground">
                    {log.operator_name}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-block text-caption font-medium px-2 py-0.5 rounded border ${moduleBadgeColor(
                        log.module
                      )}`}
                    >
                      {log.module}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-body text-secondary truncate">
                    {log.action_type}
                  </td>
                  <TimestampCell iso={log.created_at} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
