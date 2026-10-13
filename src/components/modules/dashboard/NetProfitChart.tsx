"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { PeriodNetProfit } from "@/lib/supabase/client";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type TimeRange = "day" | "week" | "month";

interface Props {
  data: PeriodNetProfit[];
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
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

export default function NetProfitChart({ data, range, onRangeChange }: Props) {
  const labels = data.map((d) => formatPeriodLabel(d.period, range));
  const values = data.map((d) => d.net_profit);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Net Profit (PKR)",
        data: values,
        backgroundColor: values.map((v) =>
          v >= 0 ? "rgba(0, 78, 114, 0.75)" : "rgba(244, 63, 94, 0.75)"
        ),
        borderColor: values.map((v) =>
          v >= 0 ? "#004e72" : "#F43F5E"
        ),
        borderWidth: 1,
        borderRadius: 4,
        hoverBackgroundColor: values.map((v) =>
          v >= 0 ? "#004e72" : "#F43F5E"
        ),
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(9, 38, 52, 0.92)",
        titleColor: "#F9FAFB",
        bodyColor: "#CBD5E1",
        borderColor: "rgba(0, 78, 114, 0.3)",
        borderWidth: 1,
        titleFont: { family: "Inter", size: 12 },
        bodyFont: { family: "JetBrains Mono", size: 11 },
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          label: (ctx: any) => {
            const v = ctx.parsed.y;
            return `PKR ${v >= 0 ? "" : "-"}${Math.abs(v).toLocaleString("en-PK")}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: "#64748B",
          font: { family: "JetBrains Mono", size: 10 },
          maxRotation: 45,
        },
      },
      y: {
        grid: { color: "rgba(0, 0, 0, 0.04)" },
        ticks: {
          color: "#64748B",
          font: { family: "JetBrains Mono", size: 10 },
          callback: (v: string | number) => {
            const n = typeof v === "string" ? parseFloat(v) : v;
            if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
            return v;
          },
        },
      },
    },
  };

  const ranges: { key: TimeRange; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
  ];

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-h2 font-semibold text-brand-navy dark:text-white">
          Net Profit Histogram
        </h2>
        <div className="flex items-center gap-1 bg-brand-canvas dark:bg-white/5 rounded-lg p-0.5">
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
      <div className="h-56">
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}
