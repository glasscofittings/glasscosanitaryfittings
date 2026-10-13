"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import type { SanitaryProduct } from "@/types";

interface Props {
  products: SanitaryProduct[];
  loading?: boolean;
}

function formatPKR(value: number): string {
  if (value >= 1_000_000) return `₨${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `₨${(value / 1_000).toFixed(1)}K`;
  return `₨${value.toLocaleString("en-PK")}`;
}

function ChartSkeleton() {
  const pairs = [
    [45, 30], [55, 40], [35, 50], [65, 35],
    [40, 55], [60, 25], [50, 45], [30, 60],
  ];
  return (
    <div className="h-[300px] w-full animate-pulse">
      <div className="flex items-end gap-3 h-full px-2 pb-6">
        {pairs.map(([h1, h2], i) => (
          <div key={i} className="flex-1 flex gap-1 items-end">
            <div className="flex-1 rounded-t bg-emerald-500/20" style={{ height: `${h1}%` }} />
            <div className="flex-1 rounded-t bg-cyan-500/20" style={{ height: `${h2}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-[300px] w-full flex flex-col items-center justify-center text-muted">
      <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
      <p className="text-caption">No products in catalog yet</p>
    </div>
  );
}

interface TooltipPayload {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    dataKey: string;
    color: string;
    payload: { name: string; unit_price: number; total_stock: number; sku: string };
  }>;
}

function CustomTooltip({ active, payload }: TooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;

  return (
    <div
      style={{
        backgroundColor: "rgba(9, 38, 52, 0.94)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "12px 16px",
        backdropFilter: "blur(8px)",
      }}
    >
      <p style={{ color: "#F9FAFB", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {item.name}
      </p>
      <p style={{ color: "#94A3B8", fontSize: 11, fontFamily: "JetBrains Mono, monospace", marginBottom: 2 }}>
        SKU: {item.sku}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: "#10B981", display: "inline-block" }} />
          <span style={{ color: "#CBD5E1", fontSize: 12 }}>
            Stock: <span style={{ color: "#F9FAFB", fontFamily: "JetBrains Mono, monospace" }}>{item.total_stock.toLocaleString()}</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: "#06B6D4", display: "inline-block" }} />
          <span style={{ color: "#CBD5E1", fontSize: 12 }}>
            Price: <span style={{ color: "#F9FAFB", fontFamily: "JetBrains Mono, monospace" }}>{formatPKR(item.unit_price)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

const STOCK_COLORS = ["#10B981", "#059669", "#34D399", "#6EE7B7", "#A7F3D0", "#047857", "#065F46", "#0D9488"];
const PRICE_COLORS = ["#06B6D4", "#0891B2", "#22D3EE", "#67E8F9", "#A5F3FC", "#0E7490", "#155E75", "#083344"];

export default function ProductHistogramChart({ products, loading }: Props) {
  const chartData = useMemo(
    () =>
      products
        .filter((p) => p.total_stock > 0 || p.unit_price > 0)
        .sort((a, b) => b.total_stock - a.total_stock)
        .slice(0, 12)
        .map((p) => ({
          name: p.name.length > 18 ? p.name.slice(0, 16) + "..." : p.name,
          fullName: p.name,
          sku: p.sku,
          total_stock: p.total_stock,
          unit_price: p.unit_price,
        })),
    [products],
  );

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-h2 font-semibold text-brand-navy dark:text-white">
            Product Catalog &amp; Pricing
          </h2>
          {products.length > 0 && (
            <p className="text-caption text-muted mt-0.5">
              {products.length} products &middot; top {chartData.length} by stock displayed
            </p>
          )}
        </div>
      </div>
      <div className="glow-line mb-4" />

      {loading ? (
        <ChartSkeleton />
      ) : chartData.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: "#64748B", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
              axisLine={false}
              tickLine={false}
              dy={6}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={60}
            />
            <YAxis
              yAxisId="stock"
              tick={{ fill: "#64748B", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              axisLine={false}
              tickLine={false}
              label={{ value: "Stock Qty", angle: -90, position: "insideLeft", offset: 16, style: { fill: "#64748B", fontSize: 10 } }}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tick={{ fill: "#64748B", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatPKR(v)}
              label={{ value: "Unit Price", angle: 90, position: "insideRight", offset: 16, style: { fill: "#64748B", fontSize: 10 } }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Legend
              wrapperStyle={{ fontSize: 11, fontFamily: "Inter, sans-serif", paddingTop: 8 }}
              iconType="rect"
              iconSize={10}
            />
            <Bar
              yAxisId="stock"
              dataKey="total_stock"
              name="Total Stock"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={STOCK_COLORS[i % STOCK_COLORS.length]} fillOpacity={0.85} />
              ))}
            </Bar>
            <Bar
              yAxisId="price"
              dataKey="unit_price"
              name="Unit Price (PKR)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={PRICE_COLORS[i % PRICE_COLORS.length]} fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
