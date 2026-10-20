"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchSanitaryProducts,
  deleteSanitaryProduct,
} from "@/lib/supabase/catalog";
import type { SanitaryProduct, SanitaryCategory } from "@/types";
import { SANITARY_CATEGORY_OPTIONS } from "@/types";
import { exportProductsToPDF, exportProductCostMarginReportPDF } from "@/lib/pdf-exporter";
import SanitaryCatalogTable from "@/components/modules/catalog/SanitaryCatalogTable";
import EditProductModal from "@/components/modules/catalog/EditProductModal";
import RecordPurchaseModal from "@/components/modules/catalog/RecordPurchaseModal";
import ProductCostMarginModal from "@/components/modules/catalog/ProductCostMarginModal";
import PurchaseReportModal from "@/components/modules/catalog/PurchaseReportModal";
import {
  fetchProductPurchases,
  computeProductCostAndMargin,
  type ProductPurchase,
  type ProductCostMarginSummary,
} from "@/lib/supabase/purchases";
import type { InventoryLot } from "@/lib/supabase/inventory";
import { formatPKR } from "@/lib/utils/formatters";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

type CategoryFilter = "ALL" | SanitaryCategory;

export default function CatalogPage() {
  const queryClient = useQueryClient();
  const [products, setProducts] = useState<SanitaryProduct[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");
  const [editProduct, setEditProduct] = useState<SanitaryProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SanitaryProduct | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [viewTab, setViewTab] = useState<"standard" | "cost_margin">("standard");
  const [costMarginSummaries, setCostMarginSummaries] = useState<Map<string, ProductCostMarginSummary>>(new Map());
  const [selectedProductForCost, setSelectedProductForCost] = useState<SanitaryProduct | null>(null);
  const [selectedProductForPurchase, setSelectedProductForPurchase] = useState<SanitaryProduct | null>(null);
  const [recordPurchaseOpen, setRecordPurchaseOpen] = useState(false);
  const [purchaseReportOpen, setPurchaseReportOpen] = useState(false);
  // Purchase history + lots passed into ProductCostMarginModal
  const [allPurchases, setAllPurchases] = useState<ProductPurchase[]>([]);
  const [allLots, setAllLots] = useState<InventoryLot[]>([]);

  async function loadData() {
    const p = await fetchSanitaryProducts();
    if (p.length > 0) {
      setProducts(p);
      setIsLive(true);
      // Build per-product cost summaries from purchase history + inventory lots
      try {
        const purchases = await fetchProductPurchases();
        setAllPurchases(purchases);
        const map = new Map<string, ProductCostMarginSummary>();
        p.forEach((prod) => {
          const summary = computeProductCostAndMargin(prod, purchases, []);
          map.set(prod.id, summary);
        });
        setCostMarginSummaries(map);
      } catch (err) {
        console.warn("Could not load cost summaries:", err);
      }
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleRefresh() {
    await loadData();
    await queryClient.invalidateQueries({ queryKey: ["sanitary_products"] });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    const result = await deleteSanitaryProduct(deleteTarget.id);
    setDeleting(false);
    if (result.ok) {
      setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } else {
      setDeleteError(result.error ?? "Failed to delete product.");
    }
  }

  const searchLower = searchQuery.toLowerCase().trim();
  const filteredProducts = useMemo(() => {
    let base = products;
    if (categoryFilter !== "ALL") {
      base = base.filter((p) => p.category === categoryFilter);
    }
    if (!searchLower) return base;
    return base.filter(
      (p) =>
        p.sku.toLowerCase().includes(searchLower) ||
        p.name.toLowerCase().includes(searchLower) ||
        p.category.toLowerCase().includes(searchLower) ||
        (p.subcategory ?? "").toLowerCase().includes(searchLower) ||
        (p.finish ?? "").toLowerCase().includes(searchLower)
    );
  }, [products, categoryFilter, searchLower]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach((p) => {
      map.set(p.category, (map.get(p.category) ?? 0) + 1);
    });
    return map;
  }, [products]);

  useEscapeToClose(!!deleteTarget, () => {
    setDeleteTarget(null);
    setDeleteError("");
  });

  const costMarginStats = useMemo(() => {
    let totalStockCost = 0;
    let totalStockRetail = 0;
    let totalEstProfit = 0;
    let productsWithCost = 0;

    filteredProducts.forEach((p) => {
      const summary = costMarginSummaries.get(p.id);
      const unitCost = summary?.effective_cost ?? 0;
      const stock = p.available_stock || 0;
      const retail = p.unit_price || 0;

      if (unitCost > 0) {
        productsWithCost++;
      }
      totalStockCost += unitCost * stock;
      totalStockRetail += retail * stock;
      totalEstProfit += (retail - unitCost) * stock;
    });

    const overallMargin = totalStockRetail > 0 ? (totalEstProfit / totalStockRetail) * 100 : 0;
    const overallMarkup = totalStockCost > 0 ? (totalEstProfit / totalStockCost) * 100 : 0;

    return {
      totalStockCost,
      totalStockRetail,
      totalEstProfit,
      overallMargin,
      overallMarkup,
      productsWithCost,
    };
  }, [filteredProducts, costMarginSummaries]);

  async function handleExportPDF() {
    if (filteredProducts.length === 0) return;
    if (viewTab === "cost_margin") {
      const summariesList: ProductCostMarginSummary[] = filteredProducts.map((p) => {
        const existing = costMarginSummaries.get(p.id);
        if (existing) return existing;
        return {
          product_id: p.id,
          product_name: p.name,
          sku: p.sku,
          category: p.category,
          selling_price: p.unit_price,
          latest_purchase_rate: 0,
          latest_supplier_name: null,
          fifo_unit_cost: 0,
          weighted_avg_unit_cost: 0,
          effective_cost: 0,
          gross_profit: p.unit_price,
          gross_margin_percent: 100,
          markup_percent: 0,
          total_purchased_qty: 0,
          total_spent_pkr: 0,
          purchase_count: 0,
        };
      });
      await exportProductCostMarginReportPDF(summariesList, {
        subtitle:
          searchLower || categoryFilter !== "ALL"
            ? `Filtered margin analysis (${filteredProducts.length} items)`
            : "Full product margin analysis",
        operatorName: "Cost & Margin Analysis",
      });
    } else {
      await exportProductsToPDF(filteredProducts, {
        subtitle:
          searchLower || categoryFilter !== "ALL"
            ? `Filtered catalog view`
            : "Full product catalog",
        operatorName: "Product Catalog",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-tight">Product Catalog &amp; Costs</h1>
          <p className="text-body text-secondary mt-1">
            Browse products, track purchase landed costs, profit margins &amp; supplier pricing
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}

          {/* View Tab Switch */}
          <div className="flex bg-bg-muted p-0.5 rounded-lg border border-border-default">
            <button
              onClick={() => setViewTab("standard")}
              className={`h-8 px-3 rounded-md text-caption font-medium transition-colors ${
                viewTab === "standard"
                  ? "bg-bg-subtle text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Catalog
            </button>
            <button
              onClick={() => setViewTab("cost_margin")}
              className={`h-8 px-3 rounded-md text-caption font-medium transition-colors ${
                viewTab === "cost_margin"
                  ? "bg-emerald-500/20 text-emerald-400 shadow-sm border border-emerald-500/30"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Cost &amp; Profit Margins
            </button>
          </div>

          <button
            onClick={() => {
              setSelectedProductForPurchase(null);
              setRecordPurchaseOpen(true);
            }}
            className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-hover transition-colors flex items-center gap-2 shadow-sm"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Record Purchase
          </button>

          <button
            onClick={() => setPurchaseReportOpen(true)}
            disabled={allPurchases.length === 0}
            title={
              allPurchases.length === 0
                ? "No purchase history yet"
                : "Purchase report by product / supplier & date range"
            }
            className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6m4 6V7m4 10v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Purchase Report
          </button>

          <button
            onClick={handleRefresh}
            className="h-9 px-3 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle hover:text-foreground transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          <button
            onClick={handleExportPDF}
            disabled={filteredProducts.length === 0}
            title={filteredProducts.length === 0 ? "No products to export" : "Export view as PDF"}
            className="h-9 px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {viewTab === "cost_margin" ? "Export Margins PDF" : "Export PDF"}
          </button>
        </div>
      </div>

      <div className="glow-line" />

      {/* Cost & Margin KPI Summary Cards when in cost_margin view */}
      {viewTab === "cost_margin" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-4">
            <p className="text-caption text-secondary uppercase tracking-wider font-medium">Inventory Cost Value</p>
            <p className="text-display font-bold font-mono text-foreground mt-1">
              {formatPKR(costMarginStats.totalStockCost)}
            </p>
            <p className="text-caption text-muted mt-1">
              Based on FIFO / landed purchase costs
            </p>
          </div>

          <div className="glass-card p-4">
            <p className="text-caption text-secondary uppercase tracking-wider font-medium">Retail Valuation</p>
            <p className="text-display font-bold font-mono text-foreground mt-1">
              {formatPKR(costMarginStats.totalStockRetail)}
            </p>
            <p className="text-caption text-muted mt-1">
              Current selling price &times; on-hand stock
            </p>
          </div>

          <div className="glass-card p-4">
            <p className="text-caption text-secondary uppercase tracking-wider font-medium">Estimated Gross Profit</p>
            <p className={`text-display font-bold font-mono mt-1 ${costMarginStats.totalEstProfit >= 0 ? "text-emerald-400" : "text-status-alert"}`}>
              {costMarginStats.totalEstProfit >= 0 ? "+" : ""}{formatPKR(costMarginStats.totalEstProfit)}
            </p>
            <p className="text-caption text-muted mt-1">
              Potential gross profit on inventory
            </p>
          </div>

          <div className="glass-card p-4">
            <p className="text-caption text-secondary uppercase tracking-wider font-medium">Margin &amp; Markup</p>
            <p className="text-display font-bold font-mono text-emerald-400 mt-1">
              {costMarginStats.overallMargin.toFixed(1)}% <span className="text-body font-normal text-secondary">/ {costMarginStats.overallMarkup.toFixed(1)}%</span>
            </p>
            <p className="text-caption text-muted mt-1">
              Avg Gross Margin % / Markup %
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategoryFilter("ALL")}
          className={`h-8 px-3 rounded-lg text-caption font-medium transition-colors ${
            categoryFilter === "ALL"
              ? "bg-crimson-primary text-white"
              : "bg-bg-muted text-secondary border border-border-default hover:text-foreground"
          }`}
        >
          All ({products.length})
        </button>
        {SANITARY_CATEGORY_OPTIONS.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`h-8 px-3 rounded-lg text-caption font-medium transition-colors ${
              categoryFilter === cat
                ? "bg-crimson-primary text-white"
                : "bg-bg-muted text-secondary border border-border-default hover:text-foreground"
            }`}
          >
            {cat} ({categoryCounts.get(cat) ?? 0})
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 pl-10 pr-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
          placeholder="Search by SKU, name, category, finish..."
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {searchQuery && (
        <p className="text-caption text-muted">
          {filteredProducts.length} result{filteredProducts.length !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
        </p>
      )}

      <div className="glass-card p-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-h2 font-semibold">
              {categoryFilter === "ALL" ? "All Products" : categoryFilter}
            </h2>
            {viewTab === "cost_margin" && (
              <span className="text-caption text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Purchase Cost &amp; Margin Analysis
              </span>
            )}
          </div>
          <span className="badge">{filteredProducts.length} items</span>
        </div>
        <div className="glow-line mb-4" />
      </div>

      <SanitaryCatalogTable
        products={filteredProducts}
        searchQuery={searchQuery}
        viewMode={viewTab}
        costSummaries={costMarginSummaries}
        onEdit={(p) => setEditProduct(p)}
        onDelete={(p) => {
          setDeleteTarget(p);
          setDeleteError("");
        }}
        onViewCostMargin={(p) => setSelectedProductForCost(p)}
        onRecordPurchase={(p) => {
          setSelectedProductForPurchase(p);
          setRecordPurchaseOpen(true);
        }}
      />

      {editProduct && (
        <EditProductModal
          product={editProduct}
          open={!!editProduct}
          onClose={() => setEditProduct(null)}
          onSaved={handleRefresh}
        />
      )}

      {deleteTarget && (
        <DeleteProductModal
          product={deleteTarget}
          error={deleteError}
          deleting={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(""); }}
        />
      )}

      {/* Record Purchase Modal */}
      {recordPurchaseOpen && (
        <RecordPurchaseModal
          isOpen={recordPurchaseOpen}
          products={products}
          selectedProduct={selectedProductForPurchase}
          onClose={() => {
            setRecordPurchaseOpen(false);
            setSelectedProductForPurchase(null);
          }}
          onSuccess={() => {
            handleRefresh();
          }}
        />
      )}

      {/* Cost & Profit Margin Analysis Modal */}
      {selectedProductForCost && (
        <ProductCostMarginModal
          isOpen={!!selectedProductForCost}
          product={selectedProductForCost}
          purchases={allPurchases}
          lots={allLots}
          onClose={() => setSelectedProductForCost(null)}
          onOpenRecordPurchase={() => {
            const p = selectedProductForCost;
            setSelectedProductForCost(null);
            setSelectedProductForPurchase(p);
            setRecordPurchaseOpen(true);
          }}
        />
      )}

      {/* Purchase Report (by product / supplier & date range) */}
      <PurchaseReportModal
        isOpen={purchaseReportOpen}
        purchases={allPurchases}
        onClose={() => setPurchaseReportOpen(false)}
      />
    </div>
  );
}

function DeleteProductModal({
  product,
  error,
  deleting,
  onConfirm,
  onCancel,
}: {
  product: SanitaryProduct;
  error: string;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-md p-6 border border-border-default shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-4 mb-5">
            <div className="h-10 w-10 rounded-full bg-status-error/10 flex items-center justify-center shrink-0">
              <svg className="h-5 w-5 text-status-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-h2 font-semibold text-foreground">Delete Product</h2>
              <p className="text-body text-secondary mt-1">
                Are you sure you want to delete <span className="font-semibold text-foreground">{product.name}</span>{" "}
                <span className="font-mono text-caption text-muted">(SKU: {product.sku})</span>? This action cannot be undone.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-caption text-status-error bg-status-error/10 px-3 py-2 rounded-lg border border-status-error/20 mb-4">
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={deleting}
              className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="flex-1 h-9 rounded-lg bg-status-error text-white font-medium text-body hover:bg-status-error/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? "Deleting..." : "Delete Item"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
