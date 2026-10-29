"use client";

import React, { useState, useMemo } from "react";
import {
  X,
  TrendingUp,
  DollarSign,
  Layers,
  Award,
  History,
  Calculator,
  ArrowUpDown,
  Tag,
} from "lucide-react";
import { formatPKR } from "@/lib/utils/formatters";
import { type SanitaryProduct } from "@/types";
import { type InventoryLot } from "@/lib/supabase/inventory";
import {
  type ProductPurchase,
  computeSupplierPriceComparisons,
  calculateProfitMargins,
} from "@/lib/supabase/purchases";

interface ProductCostMarginModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: SanitaryProduct;
  purchases: ProductPurchase[];
  lots: InventoryLot[];
  onOpenRecordPurchase?: () => void;
}

type CostingMethod = "FIFO" | "WAC" | "LATEST";

export default function ProductCostMarginModal({
  isOpen,
  onClose,
  product,
  purchases,
  lots,
  onOpenRecordPurchase,
}: ProductCostMarginModalProps) {
  const [costingMethod, setCostingMethod] = useState<CostingMethod>("FIFO");
  const [simulatedSellingPrice, setSimulatedSellingPrice] = useState(product.unit_price.toString());

  // Filter purchases for this product
  const productPurchases = useMemo(() => {
    return purchases
      .filter((p) => p.product_id === product.id)
      .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));
  }, [purchases, product.id]);

  // Supplier price comparisons
  const supplierComparisons = useMemo(() => {
    return computeSupplierPriceComparisons(productPurchases);
  }, [productPurchases]);

  // Product lots for FIFO and WAC
  const productLots = useMemo(() => {
    return lots
      .filter((l) => l.product_id === product.id && l.remaining_qty > 0)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [lots, product.id]);

  // Compute unit costs under each costing method
  const costingBreakdown = useMemo(() => {
    const latestPurchase = productPurchases.find((p) => p.status !== "cancelled");
    const latestRate = latestPurchase ? Number(latestPurchase.purchase_rate) : 0;
    const latestLandedCost = latestPurchase ? Number(latestPurchase.effective_unit_cost_pkr) : latestRate;

    // FIFO: unit cost of oldest available lot
    let fifoCost = productLots.length > 0 ? Number(productLots[0].unit_cost_pkr) : latestLandedCost;

    // Weighted Average Cost (WAC)
    let totalQty = 0;
    let totalVal = 0;
    for (const lot of productLots) {
      const q = Number(lot.remaining_qty);
      const c = Number(lot.unit_cost_pkr);
      totalQty += q;
      totalVal += q * c;
    }
    const wacCost = totalQty > 0 ? Math.round((totalVal / totalQty) * 100) / 100 : fifoCost;

    return {
      FIFO: fifoCost,
      WAC: wacCost,
      LATEST: latestLandedCost,
      latestRate,
      latestSupplier: latestPurchase?.supplier_name || null,
      totalLotsCount: productLots.length,
      availableStockQty: totalQty > 0 ? totalQty : product.available_stock,
    };
  }, [productPurchases, productLots, product.available_stock]);

  // Selected unit cost
  const activeUnitCost = costingBreakdown[costingMethod];

  // Actual margins based on product selling price
  const actualMargins = useMemo(() => {
    return calculateProfitMargins({
      sellingPrice: product.unit_price,
      unitCost: activeUnitCost,
    });
  }, [product.unit_price, activeUnitCost]);

  // Simulated margins
  const simPriceNum = parseFloat(simulatedSellingPrice) || 0;
  const simulatedMargins = useMemo(() => {
    return calculateProfitMargins({
      sellingPrice: simPriceNum,
      unitCost: activeUnitCost,
    });
  }, [simPriceNum, activeUnitCost]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-card border border-border-subtle rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-neutral-900/40">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-foreground">{product.name}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-800 text-muted border border-border-subtle">
                {product.sku}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-foreground">
                {product.category}
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Purchase Cost, Landed Valuation, and Gross Profit Margin Analysis
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto text-xs">
          {/* Top KPI Cards: Costing, Profit & Margins */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {/* Selling Price */}
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle">
              <span className="text-[10px] text-muted uppercase font-medium">Selling Price</span>
              <div className="text-base font-bold text-foreground mt-0.5 font-mono">
                {formatPKR(product.unit_price)}
              </div>
              <span className="text-[10px] text-muted">Net sales per unit</span>
            </div>

            {/* Selected Unit Cost */}
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle">
              <span className="text-[10px] text-muted uppercase font-medium">
                Unit Cost ({costingMethod})
              </span>
              <div className="text-base font-bold text-foreground mt-0.5 font-mono">
                {formatPKR(activeUnitCost)}
              </div>
              <span className="text-[10px] text-muted">
                {costingMethod === "FIFO"
                  ? "Oldest lot"
                  : costingMethod === "WAC"
                  ? "Weighted average"
                  : "Latest purchase"}
              </span>
            </div>

            {/* Gross Profit */}
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle">
              <span className="text-[10px] text-muted uppercase font-medium">Gross Profit</span>
              <div
                className={`text-base font-bold mt-0.5 font-mono ${
                  actualMargins.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatPKR(actualMargins.grossProfit)}
              </div>
              <span className="text-[10px] text-muted">Per unit profit</span>
            </div>

            {/* Gross Margin % */}
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle">
              <span className="text-[10px] text-muted uppercase font-medium">Gross Margin %</span>
              <div
                className={`text-base font-bold mt-0.5 ${
                  actualMargins.grossMarginPercent >= 25
                    ? "text-emerald-400"
                    : actualMargins.grossMarginPercent > 0
                    ? "text-amber-400"
                    : "text-red-400"
                }`}
              >
                {actualMargins.grossMarginPercent}%
              </div>
              <span className="text-[10px] text-muted">Profit ÷ Selling Price</span>
            </div>

            {/* Markup % */}
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle">
              <span className="text-[10px] text-muted uppercase font-medium">Markup %</span>
              <div className="text-base font-bold text-blue-400 mt-0.5">
                {actualMargins.markupPercent}%
              </div>
              <span className="text-[10px] text-muted">Profit ÷ Unit Cost</span>
            </div>
          </div>

          {/* Costing Method Selector & What-If Sandbox */}
          <div className="p-4 rounded-lg bg-neutral-900/60 border border-border-subtle space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-crimson-primary" />
                  Inventory Costing Method
                </span>
                <p className="text-[11px] text-muted mt-0.5">
                  Select valuation method to recalculate gross profit, margin, and markup
                </p>
              </div>

              {/* Costing Method Pills */}
              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-surface-subtle border border-border-subtle">
                {(
                  [
                    { key: "FIFO", label: "FIFO Lot Cost", cost: costingBreakdown.FIFO },
                    { key: "WAC", label: "Weighted Avg (WAC)", cost: costingBreakdown.WAC },
                    { key: "LATEST", label: "Latest Landed", cost: costingBreakdown.LATEST },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setCostingMethod(m.key)}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                      costingMethod === m.key
                        ? "bg-crimson-primary text-white shadow-sm"
                        : "text-muted hover:text-foreground hover:bg-neutral-800/40"
                    }`}
                  >
                    <span>{m.label}</span>
                    <span className="font-mono text-[10px] opacity-80 block">{formatPKR(m.cost)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Margin Simulator Slider / Input */}
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-blue-400" />
                  Profit Margin Sandbox & Pricing Simulator
                </span>
                <span className="text-[10px] text-muted">Simulate adjustments to selling price</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
                <div>
                  <label className="block text-[10px] text-muted mb-1">Simulated Selling Price (PKR)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={simulatedSellingPrice}
                    onChange={(e) => setSimulatedSellingPrice(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded bg-neutral-900 border border-border-subtle text-foreground focus:outline-none focus:border-crimson-primary"
                  />
                </div>

                <div className="p-2 rounded bg-neutral-900 border border-border-subtle text-center">
                  <span className="text-[10px] text-muted block">Simulated Profit</span>
                  <span
                    className={`font-mono font-bold text-xs mt-0.5 ${
                      simulatedMargins.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {formatPKR(simulatedMargins.grossProfit)}
                  </span>
                </div>

                <div className="p-2 rounded bg-neutral-900 border border-border-subtle text-center">
                  <span className="text-[10px] text-muted block">Simulated Margin %</span>
                  <span
                    className={`font-bold text-xs mt-0.5 ${
                      simulatedMargins.grossMarginPercent >= 25
                        ? "text-emerald-400"
                        : simulatedMargins.grossMarginPercent > 0
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {simulatedMargins.grossMarginPercent}%
                  </span>
                </div>

                <div className="p-2 rounded bg-neutral-900 border border-border-subtle text-center">
                  <span className="text-[10px] text-muted block">Simulated Markup %</span>
                  <span className="font-bold text-xs text-blue-400 mt-0.5">
                    {simulatedMargins.markupPercent}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Supplier-Wise Price Comparisons Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-400" />
                Supplier Price Comparison & Rate History
              </span>
              <span className="text-[10px] text-muted font-mono">
                {supplierComparisons.length} supplier(s) supplied
              </span>
            </div>

            {supplierComparisons.length === 0 ? (
              <div className="p-6 text-center text-muted border border-border-subtle rounded-lg">
                No past supplier purchases recorded for this product yet.
              </div>
            ) : (
              <div className="overflow-x-auto border border-border-subtle rounded-lg">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-900/60 border-b border-border-subtle text-muted text-[10px] uppercase tracking-wider">
                      <th className="py-2.5 px-3">Supplier Name</th>
                      <th className="py-2.5 px-3 text-right">Latest Rate</th>
                      <th className="py-2.5 px-3 text-right">Min Rate</th>
                      <th className="py-2.5 px-3 text-right">Max Rate</th>
                      <th className="py-2.5 px-3 text-right">Avg Rate</th>
                      <th className="py-2.5 px-3 text-right">Total Units</th>
                      <th className="py-2.5 px-3 text-center">Last Purchase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/50">
                    {supplierComparisons.map((s, idx) => (
                      <tr key={idx} className="hover:bg-neutral-800/20">
                        <td className="py-2.5 px-3 font-medium text-foreground flex items-center gap-1.5">
                          <a
                            href={s.supplier_id ? '/crm?id=' + s.supplier_id : '/crm?search=' + encodeURIComponent(s.supplier_name)}
                            title="View Supplier Account Profile & Ledger"
                            className="hover:text-crimson-primary hover:underline transition-colors cursor-pointer"
                          >
                            {s.supplier_name}
                          </a>
                          {s.is_best_price && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              Best Price
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-foreground">
                          {formatPKR(s.latest_rate)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-400">
                          {formatPKR(s.min_rate)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted">
                          {formatPKR(s.max_rate)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-foreground">
                          {formatPKR(s.avg_rate)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted">
                          {s.total_qty} PCS
                        </td>
                        <td className="py-2.5 px-3 text-center text-muted">
                          {new Date(s.last_purchased_date).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Complete Purchase History Timeline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <History className="w-4 h-4 text-blue-400" />
                Product Purchase History Timeline
              </span>
              <span className="text-[10px] text-muted font-mono">
                {productPurchases.length} record(s)
              </span>
            </div>

            {productPurchases.length === 0 ? (
              <div className="p-6 text-center text-muted border border-border-subtle rounded-lg">
                No purchase records found. Record a purchase to build rate history.
              </div>
            ) : (
              <div className="overflow-x-auto border border-border-subtle rounded-lg max-h-56">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-900/60 border-b border-border-subtle text-muted text-[10px] uppercase tracking-wider sticky top-0">
                      <th className="py-2.5 px-3">Purchase #</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Supplier</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Purchase Rate</th>
                      <th className="py-2.5 px-3 text-right">Discount</th>
                      <th className="py-2.5 px-3 text-right">Landed Cost / Unit</th>
                      <th className="py-2.5 px-3 text-right">Total (PKR)</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/50">
                    {productPurchases.map((p) => (
                      <tr key={p.id} className="hover:bg-neutral-800/20">
                        <td className="py-2 px-3 font-mono font-semibold text-foreground">
                          {p.purchase_number}
                        </td>
                        <td className="py-2 px-3 text-muted">
                          {new Date(p.purchase_date).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3 text-foreground truncate max-w-[140px]">
                          <a
                            href={p.supplier_id ? '/crm?id=' + p.supplier_id : '/crm?search=' + encodeURIComponent(p.supplier_name)}
                            title="View Supplier Account Profile & Ledger"
                            className="hover:text-crimson-primary hover:underline transition-colors"
                          >
                            {p.supplier_name}
                          </a>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {p.quantity} {p.unit_of_measure}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-medium text-foreground">
                          {formatPKR(p.purchase_rate)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-amber-400">
                          {p.discount_pkr > 0 ? `- ${formatPKR(p.discount_pkr)}` : "—"}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                          {formatPKR(p.effective_unit_cost_pkr)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-foreground">
                          {formatPKR(p.purchase_total_pkr)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              p.status === "confirmed"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : p.status === "draft"
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-red-500/15 text-red-400"
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle bg-neutral-900/30">
          {onOpenRecordPurchase && (
            <button
              onClick={() => {
                onClose();
                onOpenRecordPurchase();
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-crimson-primary text-white hover:bg-crimson-dark transition-colors"
            >
              + Record Purchase for this Product
            </button>
          )}

          <div className="flex justify-end gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium rounded-lg text-muted hover:text-foreground hover:bg-neutral-800/40 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
