"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ProductionConsumptionPoint } from "@/lib/supabase/client";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface Props {
  data: ProductionConsumptionPoint[];
}

function formatPeriodLabel(period: string): string {
  if (period.includes("-W")) return period.replace("-", " ");
  if (period.length === 7) {
    const [y, m] = period.split("-");
    const d = new Date(Number(y), Number(m) - 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  const d = new Date(period);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ProductionConsumptionChart({ data }: Props) {
  const labels = data.map((d) => formatPeriodLabel(d.period));

  const chartData = {
    labels,
    datasets: [
      {
        label: "Stock Dispatched (Qty)",
        borderColor: "#ff6e42",
        backgroundColor: "rgba(255, 110, 66, 0.08)",
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: "#ff6e42",
        pointBorderColor: "#ff6e42",
        borderWidth: 2,
        data: data.map((d) => d.dispatched_qty),
      },
      {
        label: "Stock Received (Qty)",
        borderColor: "#004e72",
        backgroundColor: "transparent",
        borderDash: [5, 5],
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: "#004e72",
        pointBorderColor: "#004e72",
        borderWidth: 2,
        data: data.map((d) => d.received_qty),
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        labels: {
          color: "#64748B",
          font: { family: "Inter", size: 11 },
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
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
            if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
            return v;
          },
        },
      },
    },
  };

  return (
    <div className="glass-card p-5">
      <h2 className="text-h2 font-semibold mb-4 text-brand-navy dark:text-white">
        Production vs Consumption
      </h2>
      <div className="glow-line mb-4" />
      <div className="h-64">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
