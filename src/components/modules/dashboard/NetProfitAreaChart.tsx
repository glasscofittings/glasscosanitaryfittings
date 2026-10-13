"use client";

import { useId, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PeriodNetProfit } from "@/lib/supabase/client";

type TimeRange = "day" | "week" | "month";

interface Props {
  data: PeriodNetProfit[];
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  loading?: boolean;
}

function formatPeriodLabel(period: string, range: TimeRange): string {
  if (range === "day") {
    const d = new Date(period);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (range === "week") {
    return period.replace("-", " ");
  }
  const [y, m] = period.split("-");
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatPKR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}₨${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}₨${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₨${abs.toLocaleString("en-PK")}`;
}

function ChartSkeleton() {
  const heights = [45, 60, 35, 70, 50, 40, 55, 65, 30, 48, 58, 42];
  return (
    <div className="h-[300px] w-full animate-pulse">
      <div className="flex items-end gap-2 h-full px-2 pb-6">
        {heights.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-white/5"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-[300px] w-full flex flex-col items-center justify-center text-muted">
      <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
      <p className="text-caption">No profit data available for this period</p>
    </div>
  );
}

export default function NetProfitAreaChart({ data, range, onRangeChange, loading }: Props) {
  const gradientId = useId();

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        label: formatPeriodLabel(d.period, range),
        value: d.net_profit,
      })),
    [data, range],
  );

  const ranges: { key: TimeRange; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
  ];

  const totalProfit = useMemo(() => data.reduce((s, d) => s + d.net_profit, 0), [data]);

  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-h2 font-semibold text-brand-navy dark:text-white">
            Net Profit Growth
          </h2>
          {data.length > 0 && (
            <p className="text-caption text-muted mt-0.5">
              {range === "day" ? "Today" : range === "week" ? "This week" : "This month"}&apos;s net:{" "}
              <span className={`font-mono font-medium ${totalProfit >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                {formatPKR(totalProfit)}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 bg-brand-canvas dark:bg-white/5 rounded-lg p-0.5 self-start sm:self-auto">
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => onRangeChange(r.key)}
              className={`px-3 py-1.5 text-caption font-medium rounded-md transition-all ${
                range === r.key
                  ? "bg-brand-ocean text-white shadow-sm"
                  : "text-muted hover:text-foreground hover:bg-bg-subtle"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="glow-line mb-4" />

      {loading ? (
        <ChartSkeleton />
      ) : chartData.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#64748B", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              axisLine={false}
              tickLine={false}
              dy={6}
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatPKR(v)}
              width={72}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(9, 38, 52, 0.94)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "Inter, sans-serif",
                color: "#F9FAFB",
                padding: "10px 14px",
                backdropFilter: "blur(8px)",
              }}
              labelStyle={{ color: "#94A3B8", fontSize: 11, marginBottom: 4 }}
              itemStyle={{ color: "#F9FAFB", fontFamily: "JetBrains Mono, monospace" }}
              formatter={(value) => [formatPKR(Number(value)), "Net Profit"]}
              labelFormatter={(label) => `Period: ${label}`}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#10B981"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{
                r: 5,
                stroke: "#10B981",
                strokeWidth: 2,
                fill: "#092634",
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
