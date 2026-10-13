"use client";

import { useRef } from "react";
import { useTheme } from "next-themes";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  labels: string[];
  values: number[];
  title: string;
}

const DARK_PALETTE = ["#DC2626", "#991B1B", "#F59E0B", "#374151", "#10B981", "#6366F1"];
const LIGHT_PALETTE = ["#DC2626", "#991B1B", "#D97706", "#6B7280", "#059669", "#4F46E5"];

export default function WarehouseDonutChart({ labels, values, title }: Props) {
  const chartRef = useRef<ChartJS<"doughnut">>(null);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  const total = values.reduce((a, b) => a + b, 0);

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: palette.slice(0, labels.length),
        borderWidth: 1,
        borderColor: isDark ? "#090B10" : "#F8FAFC",
        hoverBorderColor: isDark ? "#F9FAFB" : "#0F172A",
        hoverBorderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "75%",
    plugins: {
      legend: {
        position: "right" as const,
        labels: {
          color: isDark ? "#F9FAFB" : "#0F172A",
          font: { family: "Inter", size: 12 },
          padding: 12,
          usePointStyle: true,
          pointStyleWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: isDark ? "rgba(24, 22, 31, 0.9)" : "rgba(255, 255, 255, 0.95)",
        titleColor: isDark ? "#F9FAFB" : "#0F172A",
        bodyColor: isDark ? "#9CA3AF" : "#475569",
        borderColor: isDark ? "rgba(220, 38, 38, 0.2)" : "rgba(185, 28, 28, 0.15)",
        borderWidth: 1,
        titleFont: { family: "Inter", size: 12 },
        bodyFont: { family: "JetBrains Mono", size: 11 },
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          label: (ctx: { parsed: number; label?: string }) => {
            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : "0";
            return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} units (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-h2 font-semibold">{title}</h2>
        <span className="badge font-mono">{total.toLocaleString()} units</span>
      </div>
      <div className="glow-line mb-4" />
      <div className="h-64">
        {total > 0 ? (
          <Doughnut ref={chartRef} data={data} options={options} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted">
            No stock data available
          </div>
        )}
      </div>
    </div>
  );
}
