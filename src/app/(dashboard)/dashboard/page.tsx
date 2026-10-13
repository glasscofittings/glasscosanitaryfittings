"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDashboardKPIs,
  fetchAuditLogs,
  fetchWorkerCount,
  fetchDashboardStockValue,
  fetchNetProfitByPeriod,
  fetchProductionConsumption,
  type DashboardKPIs,
  type AuditLog,
  type PeriodNetProfit,
  type ProductionConsumptionPoint,
} from "@/lib/supabase/client";
import { useSupabaseCDC } from "@/lib/hooks/useSupabaseCDC";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { useNetworkStore } from "@/lib/store/useNetworkStore";
import { formatCompactPKR, formatPKR } from "@/lib/utils/formatters";
import NetProfitAreaChart from "@/components/modules/dashboard/NetProfitAreaChart";
import ProductHistogramChart from "@/components/modules/dashboard/ProductHistogramChart";
import AuditFeedTable from "@/components/modules/dashboard/AuditFeedTable";
import { fetchSanitaryProducts } from "@/lib/supabase/catalog";
import type { SanitaryProduct } from "@/types";
import AvailableFundsCard from "@/components/modules/ledger/AvailableFundsCard";
import FinancialReportsPanel from "@/components/modules/dashboard/FinancialReportsPanel";

type TimeRange = "day" | "week" | "month";

const MOCK_AUDIT: AuditLog[] = [
  { id: "1", device_node: "PC-01", operator_name: "Talha Ijaz", action_type: "CREATED_IGP", module: "PROCUREMENT", payload: {}, created_at: "2026-09-18T06:35:00.000Z" },
  { id: "2", device_node: "PC-02", operator_name: "Store Manager", action_type: "CONVERTED_IGP_TO_GRN", module: "PROCUREMENT", payload: {}, created_at: "2026-09-18T06:30:00.000Z" },
  { id: "3", device_node: "PC-01", operator_name: "Accounts Dept", action_type: "POSTED_INVOICE_INV-2026-0412", module: "INVOICING", payload: {}, created_at: "2026-09-18T06:20:00.000Z" },
  { id: "4", device_node: "PC-01", operator_name: "Warehouse Staff", action_type: "STOCK_ADJUSTMENT_WH-01", module: "INVENTORY", payload: {}, created_at: "2026-09-18T06:10:00.000Z" },
  { id: "5", device_node: "PC-02", operator_name: "Payroll Admin", action_type: "LOGGED_ATTENDANCE_SEPT-12", module: "LABOUR", payload: {}, created_at: "2026-09-18T06:00:00.000Z" },
  { id: "6", device_node: "PC-01", operator_name: "Accounts Dept", action_type: "JOURNAL_ENTRY_JE-2026-0087", module: "LEDGER", payload: {}, created_at: "2026-09-18T05:40:00.000Z" },
];

export default function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKPIs>({
    raw_material_value_pkr: 0,
    finished_goods_value_pkr: 0,
    active_batch_orders_count: 0,
    qc_warning_lots_count: 0,
    trial_balance_status: "BALANCED",
  });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(MOCK_AUDIT);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [isLive, setIsLive] = useState(false);
  const [workerCount, setWorkerCount] = useState(0);
  const [stockValue, setStockValue] = useState({ raw_material_value_pkr: 0, finished_goods_value_pkr: 0 });
  const [netProfit, setNetProfit] = useState(0);
  const [profitData, setProfitData] = useState<PeriodNetProfit[]>([]);
  const [pcData, setPcData] = useState<ProductionConsumptionPoint[]>([]);
  const [products, setProducts] = useState<SanitaryProduct[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>("day");
  const [fundsRefreshKey, setFundsRefreshKey] = useState(0);
  const nodeId = useDeviceStore((s) => s.nodeId);
  const realtimeStatus = useNetworkStore((s) => s.realtimeStatus);
  const isBrowserOnline = useNetworkStore((s) => s.isBrowserOnline);
  const newIdsRef = useRef(new Set<string>());

  const totalNodes = 4;
  const devicesOnline = (isLive || (isBrowserOnline && realtimeStatus === "SUBSCRIBED")) ? 1 : 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [k, a, wc, sv, np, pc, prods] = await Promise.all([
        fetchDashboardKPIs(),
        fetchAuditLogs(),
        fetchWorkerCount(),
        fetchDashboardStockValue(),
        fetchNetProfitByPeriod(timeRange),
        fetchProductionConsumption(timeRange),
        fetchSanitaryProducts(),
      ]);
      if (cancelled) return;
      if (k) { setKpis(k); }
      if (a.length > 0) setAuditLogs(a);
      setWorkerCount(wc);
      setStockValue(sv);
      setProfitData(np);
      setNetProfit(np.reduce((sum, p) => sum + p.net_profit, 0));
      setPcData(pc);
      setProducts(prods);
      setIsLive(true);
      setFundsRefreshKey((k) => k + 1);
    }
    load();
    return () => { cancelled = true; };
  }, [timeRange]);

  const handleCDCInsert = useCallback((record: AuditLog) => {
    newIdsRef.current = new Set([record.id, ...newIdsRef.current]);
    setNewIds(new Set(newIdsRef.current));
    setAuditLogs((prev) => [record, ...prev.filter((l) => l.id !== record.id)].slice(0, 100));

    setTimeout(() => {
      newIdsRef.current.delete(record.id);
      setNewIds(new Set(newIdsRef.current));
    }, 5000);

    // Refresh KPI data when procurement/inventory/ledger events arrive
    const actionType = record.action_type?.toUpperCase() || '';
    const evtModule = record.module?.toUpperCase() || '';
    const isKPIRefreshEvent =
      actionType.includes('GRN') ||
      actionType.includes('INVOICE') ||
      actionType.includes('JOURNAL') ||
      actionType.includes('STOCK') ||
      actionType.includes('DELIVERY') ||
      actionType.includes('LOAN') ||
      evtModule === 'PROCUREMENT' ||
      evtModule === 'INVENTORY' ||
      evtModule === 'INVOICING' ||
      evtModule === 'LEDGER';

    if (isKPIRefreshEvent) {
      Promise.all([
        fetchDashboardStockValue(),
        fetchNetProfitByPeriod(timeRange),
        fetchWorkerCount(),
      ]).then(([sv, np, wc]) => {
        setStockValue(sv);
        if (np.length > 0) {
          setProfitData(np);
          setNetProfit(np.reduce((sum, p) => sum + p.net_profit, 0));
        }
        setWorkerCount(wc);
        setFundsRefreshKey((k) => k + 1);
      }).catch(() => {});
    }
  }, [timeRange]);

  useSupabaseCDC(handleCDCInsert);

  const totalInventoryValue = stockValue.raw_material_value_pkr + stockValue.finished_goods_value_pkr;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display font-bold tracking-tight text-brand-navy dark:text-white">
            Dashboard
          </h1>
          <p className="text-body text-secondary mt-1">Executive overview &amp; live activity</p>
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}
          <span className="badge">{nodeId}</span>
        </div>
      </div>

      <div className="glow-line" />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AvailableFundsCard refreshKey={fundsRefreshKey} variant="dashboard" />
        <KPICard
          label="Total Inventory Stock Value"
          value={formatCompactPKR(totalInventoryValue)}
          sub={`Raw: ${formatCompactPKR(stockValue.raw_material_value_pkr)} / Finished: ${formatCompactPKR(stockValue.finished_goods_value_pkr)}`}
          accent="ocean"
          icon="stock"
        />
        <KPICard
          label="Total Employees"
          value={workerCount.toString()}
          sub="Active workers on payroll"
          accent="coral"
          icon="workers"
        />
        <KPICard
          label="Active Live Devices"
          value={`${devicesOnline} / ${totalNodes}`}
          sub="Nodes Online"
          accent={devicesOnline > 0 ? "green" : "red"}
          icon="devices"
        />
        <KPICard
          label="Net Profit Balance"
          value={formatPKR(netProfit)}
          sub={netProfit >= 0 ? "Positive cash flow" : "Negative cash flow"}
          accent={netProfit >= 0 ? "green" : "red"}
          icon="profit"
        />
      </div>

      {/* Financial Reports — expenses, purchases, sales/COGS, suppliers, quotations */}
      <FinancialReportsPanel />

      {/* Charts Grid — side-by-side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NetProfitAreaChart data={profitData} range={timeRange} onRangeChange={setTimeRange} loading={!isLive} />
        <ProductHistogramChart products={products} loading={!isLive} />
      </div>

      {/* Audit Feed */}
      <AuditFeedTable logs={auditLogs} newIds={newIds} />
    </div>
  );
}

function KPICard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "ocean" | "coral" | "green" | "red";
  icon: "stock" | "workers" | "devices" | "profit";
}) {
  const accentStyles = {
    ocean: {
      iconBg: "bg-brand-ocean/10",
      iconColor: "text-brand-ocean",
      valueColor: "text-brand-ocean",
      dotColor: "bg-brand-ocean",
    },
    coral: {
      iconBg: "bg-brand-coral/10",
      iconColor: "text-brand-coral",
      valueColor: "text-brand-coral",
      dotColor: "bg-brand-coral",
    },
    green: {
      iconBg: "bg-status-optimal/10",
      iconColor: "text-status-optimal",
      valueColor: "text-status-optimal",
      dotColor: "bg-status-optimal",
    },
    red: {
      iconBg: "bg-status-alert/10",
      iconColor: "text-status-alert",
      valueColor: "text-status-alert",
      dotColor: "bg-status-alert",
    },
  };

  const s = accentStyles[accent];

  const iconSvgs: Record<string, React.ReactNode> = {
    stock: (
      <svg className={`w-4 h-4 ${s.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    workers: (
      <svg className={`w-4 h-4 ${s.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    devices: (
      <svg className={`w-4 h-4 ${s.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
      </svg>
    ),
    profit: (
      <svg className={`w-4 h-4 ${s.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      </svg>
    ),
  };

  return (
    <div className="glass-card p-5 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <p className="text-caption text-muted uppercase tracking-wider font-medium min-w-0 truncate">
          {label}
        </p>
        <div className={`h-8 w-8 rounded-lg ${s.iconBg} flex items-center justify-center shrink-0`}>
          {iconSvgs[icon]}
        </div>
      </div>
      <p
        className="font-bold font-mono tracking-tight whitespace-nowrap overflow-hidden text-ellipsis"
        style={{ fontSize: "1.1rem", lineHeight: "1.5rem", color: `var(--brand-${accent === "green" ? "ocean" : accent === "red" ? "coral" : accent})` }}
        title={value}
      >
        {value}
      </p>
      <div className="flex items-center gap-2 mt-2 min-w-0">
        <span className={`h-1.5 w-1.5 rounded-full ${s.dotColor} shrink-0`} />
        <p className="text-caption text-muted truncate">{sub}</p>
      </div>
    </div>
  );
}
