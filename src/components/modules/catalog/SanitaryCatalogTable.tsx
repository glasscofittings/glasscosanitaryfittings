"use client";

import { useState, useRef, useEffect } from "react";
import type { SanitaryProduct, StockAlert } from "@/types";
import { computeStockAlert } from "@/lib/supabase/catalog";

function stockBadge(alert: StockAlert["alert_level"]) {
  switch (alert) {
    case "CRITICAL_LOW":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded border bg-status-alert/15 text-status-alert border-status-alert/20">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          CRITICAL LOW
        </span>
      );
    case "REORDER_SOON":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded border bg-status-amber/15 text-status-amber border-status-amber/20">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          REORDER SOON
        </span>
      );
    default:
      return (
        <span className="inline-block text-caption font-medium px-2 py-0.5 rounded border bg-status-optimal/15 text-status-optimal border-status-optimal/20">
          In Stock
        </span>
      );
  }
}

import type { ProductCostMarginSummary } from "@/lib/supabase/purchases";

function finishBadge(finish?: string) {
  if (!finish) return <span className="text-caption text-muted">—</span>;
  const colorMap: Record<string, string> = {
    Chrome: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    "Matte Black": "bg-neutral-500/15 text-neutral-300 border-neutral-500/20",
    "Brushed Nickel": "bg-purple-500/15 text-purple-400 border-purple-500/20",
    Brass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    Ceramic: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    White: "bg-white/15 text-white/80 border-white/20",
  };
  return (
    <span className={`inline-block text-caption font-medium px-1.5 py-0.5 rounded border ${colorMap[finish] ?? "bg-bg-muted text-secondary border-border-default"}`}>
      {finish}
    </span>
  );
}

interface ActionMenuProps {
  onEdit: () => void;
  onDelete: () => void;
  onViewCostMargin?: () => void;
  onRecordPurchase?: () => void;
}

function ActionMenu({ onEdit, onDelete, onViewCostMargin, onRecordPurchase }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
        title="Actions"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 glass-card border border-border-default rounded-lg shadow-xl w-48 py-1">
          {onViewCostMargin && (
            <button
              onClick={() => { setOpen(false); onViewCostMargin(); }}
              className="w-full text-left px-3 py-2 text-body text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Cost &amp; Profit Margins
            </button>
          )}
          {onRecordPurchase && (
            <button
              onClick={() => { setOpen(false); onRecordPurchase(); }}
              className="w-full text-left px-3 py-2 text-body text-foreground hover:bg-bg-subtle transition-colors flex items-center gap-2"
            >
              <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Record Purchase
            </button>
          )}
          <button
            onClick={() => { setOpen(false); onEdit(); }}
            className="w-full text-left px-3 py-2 text-body text-foreground hover:bg-bg-subtle transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
          <button
            onClick={() => { setOpen(false); onDelete(); }}
            className="w-full text-left px-3 py-2 text-body text-status-alert hover:bg-status-alert/10 transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  products: SanitaryProduct[];
  searchQuery: string;
  viewMode?: "standard" | "cost_margin";
  costSummaries?: Map<string, ProductCostMarginSummary>;
  onEdit: (product: SanitaryProduct) => void;
  onDelete: (product: SanitaryProduct) => void;
  onViewCostMargin?: (product: SanitaryProduct) => void;
  onRecordPurchase?: (product: SanitaryProduct) => void;
}

export default function SanitaryCatalogTable({
  products,
  searchQuery,
  viewMode = "standard",
  costSummaries,
  onEdit,
  onDelete,
  onViewCostMargin,
  onRecordPurchase,
}: Props) {
  const isCostMarginMode = viewMode === "cost_margin";

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[750px] text-left" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28">SKU</th>
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider">Product Name</th>
              {isCostMarginMode ? (
                <>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32 text-right">Latest Rate</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Unit Cost</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Selling Price</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32 text-right">Est. Profit</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-24 text-right">Margin %</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-24 text-right">Markup %</th>
                </>
              ) : (
                <>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32">Subcategory</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-24 text-center">Finish</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Unit Price</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-24 text-right">Stock</th>
                  <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32 text-center">Status</th>
                </>
              )}
              <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-16 text-center" />
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={isCostMarginMode ? 9 : 8} className="px-5 py-8 text-center text-sm text-muted">
                  {searchQuery ? `No products matching "${searchQuery}"` : "No products in this category."}
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const alert = computeStockAlert(product);
                const summary = costSummaries?.get(product.id);
                const unitCost = summary?.effective_cost ?? 0;
                const sellingPrice = summary?.selling_price || product.unit_price;
                const grossProfit = summary?.gross_profit ?? (sellingPrice - unitCost);
                const marginPct = summary?.gross_margin_percent ?? (sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0);
                const markupPct = summary?.markup_percent ?? (unitCost > 0 ? (grossProfit / unitCost) * 100 : 0);

                return (
                  <tr
                    key={product.id}
                    className={`border-b border-border-subtle transition-colors ${
                      alert.alert_level === "CRITICAL_LOW" && !isCostMarginMode
                        ? "bg-status-alert/[0.04] hover:bg-status-alert/[0.08]"
                        : alert.alert_level === "REORDER_SOON" && !isCostMarginMode
                        ? "bg-status-amber/[0.03] hover:bg-status-amber/[0.06]"
                        : "hover:bg-bg-subtle"
                    }`}
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-num-code text-secondary">{product.sku}</span>
                    </td>
                    <td className="px-5 py-3 text-body text-foreground truncate">
                      <div className="flex items-center gap-2">
                        <span>{product.name}</span>
                        {isCostMarginMode && summary?.latest_supplier_name && (
                          <span className="text-[10px] text-muted bg-bg-muted px-1.5 py-0.5 rounded truncate max-w-[120px]">
                            {summary.latest_supplier_name}
                          </span>
                        )}
                      </div>
                    </td>
                    {isCostMarginMode ? (
                      <>
                        <td className="px-5 py-3 text-right">
                          <span className="font-mono text-num-table text-secondary">
                            {summary && summary.latest_purchase_rate > 0
                              ? `PKR ${summary.latest_purchase_rate.toLocaleString()}`
                              : "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-mono text-num-table text-foreground">
                            {unitCost > 0 ? `PKR ${unitCost.toLocaleString()}` : "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-mono text-num-table text-foreground">
                            PKR {sellingPrice.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`font-mono text-num-table font-medium ${grossProfit >= 0 ? "text-emerald-400" : "text-status-alert"}`}>
                            {grossProfit >= 0 ? "+" : ""}PKR {grossProfit.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-caption font-mono ${marginPct >= 20 ? "bg-emerald-500/10 text-emerald-400" : marginPct > 0 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-status-alert"}`}>
                            {marginPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-mono text-num-table text-secondary">
                            {unitCost > 0 ? `${markupPct.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-5 py-3">
                          <span className="text-caption text-muted bg-bg-muted px-2 py-0.5 rounded border border-border-subtle">
                            {product.subcategory ?? "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">{finishBadge(product.finish)}</td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-mono text-num-table text-foreground">
                            PKR {product.unit_price.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`font-mono text-num-table ${alert.alert_level === "CRITICAL_LOW" ? "text-status-alert" : "text-foreground"}`}>
                            {product.available_stock}
                          </span>
                          <span className="text-caption text-muted ml-1">/ {product.reorder_level}</span>
                        </td>
                        <td className="px-5 py-3 text-center">{stockBadge(alert.alert_level)}</td>
                      </>
                    )}
                    <td className="px-5 py-3 text-center">
                      <ActionMenu
                        onEdit={() => onEdit(product)}
                        onDelete={() => onDelete(product)}
                        onViewCostMargin={onViewCostMargin ? () => onViewCostMargin(product) : undefined}
                        onRecordPurchase={onRecordPurchase ? () => onRecordPurchase(product) : undefined}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
