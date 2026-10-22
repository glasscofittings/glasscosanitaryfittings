"use client";

import { useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchSanitaryProducts,
  createSanitaryProduct,
  computeStockAlerts,
  deleteSanitaryProduct,
} from "@/lib/supabase/catalog";
import type { SanitaryProduct } from "@/types";
import {
  SANITARY_CATEGORY_OPTIONS,
  SANITARY_SUBCATEGORY_OPTIONS,
  PRODUCT_FINISH_OPTIONS,
} from "@/types";
import { mergeProductOptions } from "@/lib/product-options";
import { exportProductsToPDF, exportProductToPDF } from "@/lib/pdf-exporter";
import EditProductModal from "@/components/modules/catalog/EditProductModal";
import ProductOptionCombobox from "@/components/ui/ProductOptionCombobox";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { capitalizeFirst } from "@/lib/utils";

type FilterMode = "ALL" | "LOW_STOCK";

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [products, setProducts] = useState<SanitaryProduct[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editProduct, setEditProduct] = useState<SanitaryProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SanitaryProduct | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const p = await fetchSanitaryProducts();
      if (cancelled) return;
      if (p.length > 0) {
        setProducts(p);
        setIsLive(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function handleRefresh() {
    const p = await fetchSanitaryProducts();
    if (p.length > 0) setProducts(p);
    await queryClient.invalidateQueries({ queryKey: ["sanitary_products"] });
    await queryClient.invalidateQueries({ queryKey: ["inventory"] });
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
  const searchFiltered = useMemo(() => {
    if (!searchLower) return products;
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(searchLower) ||
        p.name.toLowerCase().includes(searchLower) ||
        p.category.toLowerCase().includes(searchLower) ||
        (p.subcategory ?? "").toLowerCase().includes(searchLower)
    );
  }, [products, searchLower]);

  const alerts = useMemo(() => computeStockAlerts(products), [products]);

  const totalItems = products.length;
  const inStock = products.filter((p) => p.available_stock > p.reorder_level).length;
  const lowStock = products.filter(
    (p) => p.available_stock > 0 && p.available_stock <= p.reorder_level
  ).length;
  const outOfStock = products.filter((p) => p.available_stock === 0).length;

  const filteredProducts = useMemo(() => {
    const base = searchFiltered;
    if (filterMode === "LOW_STOCK") {
      return base.filter((p) => p.available_stock <= p.reorder_level);
    }
    return base;
  }, [searchFiltered, filterMode]);
  // Derive dropdown options from the product list so that custom values
  // entered via "+ Add Custom" appear in future opens without a page refresh.
  const categoryOptions = useMemo(
    () => mergeProductOptions(SANITARY_CATEGORY_OPTIONS, products.map((p) => p.category)),
    [products]
  );
  const subcategoryOptions = useMemo(
    () => mergeProductOptions(SANITARY_SUBCATEGORY_OPTIONS, products.map((p) => p.subcategory)),
    [products]
  );
  const finishOptions = useMemo(
    () => mergeProductOptions(PRODUCT_FINISH_OPTIONS, products.map((p) => p.finish)),
    [products]
  );

  useEscapeToClose(showAddModal, () => setShowAddModal(false));
  useEscapeToClose(!!deleteTarget, () => {
    setDeleteTarget(null);
    setDeleteError("");
  });

  async function handleExportPDF() {
    if (filteredProducts.length === 0) return;
    await exportProductsToPDF(filteredProducts, {
      subtitle: searchLower ? `Filtered by "${searchQuery.trim()}"` : "All products",
      operatorName: "Inventory Manager",
    });
  }

  async function handlePrintProduct(product: SanitaryProduct) {
    if (exportingId !== null) return;
    setExportingId(product.id);
    try {
      await exportProductToPDF(product, { operatorName: "Inventory Manager" });
    } finally {
      setExportingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-tight">Inventory</h1>
          <p className="text-body text-secondary mt-1">Real-Time Stock Control &amp; Low-Stock Alerts</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}
          <button
            onClick={handleRefresh}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted hover:text-foreground transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden xs:inline">Refresh</span>
          </button>
          <button
            onClick={handleExportPDF}
            disabled={filteredProducts.length === 0}
            title={filteredProducts.length === 0 ? "No products to export" : "Export the product table as a PDF"}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden xs:inline">Export PDF</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Product
          </button>
        </div>
      </div>

      <div className="glow-line" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={totalItems.toString()} accent="crimson" />
        <StatCard label="In Stock" value={inStock.toString()} accent="green" />
        <StatCard label="Low Stock" value={lowStock.toString()} accent={lowStock > 0 ? "amber" : "green"} />
        <StatCard label="Out of Stock" value={outOfStock.toString()} accent={outOfStock > 0 ? "red" : "green"} />
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
          placeholder="Search by SKU, name, category..."
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

      <div className="flex items-center gap-3">
        <button
          onClick={() => setFilterMode(filterMode === "LOW_STOCK" ? "ALL" : "LOW_STOCK")}
          className={`h-9 px-4 rounded-lg font-medium text-body transition-colors flex items-center gap-2 ${
            filterMode === "LOW_STOCK"
              ? "bg-status-alert text-white"
              : "bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted hover:text-foreground"
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {filterMode === "LOW_STOCK" ? "Show All" : "Low Stock Alerts"}
          {filterMode !== "LOW_STOCK" && lowStock > 0 && (
            <span className="ml-1 h-5 w-5 rounded-full bg-status-alert text-white text-caption font-bold flex items-center justify-center">
              {lowStock}
            </span>
          )}
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h2 font-semibold">
              {filterMode === "LOW_STOCK" ? "Low Stock Alerts" : "All Products"}
            </h2>
            <span className="badge">{filteredProducts.length} items</span>
          </div>
          <div className="glow-line mb-4" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[760px]" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28">SKU</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider">Product Name</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32">Category</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">QOH</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-28 text-right">Reorder Lvl</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-32 text-center">Alert</th>
                <th className="text-caption text-muted font-medium px-5 py-3 uppercase tracking-wider w-44 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    {filterMode === "LOW_STOCK"
                      ? "No low stock items. All products are adequately stocked."
                      : "No products found."}
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const alert = alerts.find((a) => a.product_id === product.id);
                  const level = alert?.alert_level ?? "IN_STOCK";
                  return (
                    <tr
                      key={product.id}
                      className={`border-b border-border-subtle transition-colors ${
                        level === "CRITICAL_LOW"
                          ? "bg-status-alert/[0.04] hover:bg-status-alert/[0.08]"
                          : level === "REORDER_SOON"
                          ? "bg-status-amber/[0.03] hover:bg-status-amber/[0.06]"
                          : "hover:bg-bg-subtle"
                      }`}
                    >
                      <td className="px-5 py-3">
                        <span className="font-mono text-num-code text-secondary">{product.sku}</span>
                      </td>
                      <td className="px-5 py-3 text-body text-foreground truncate">{product.name}</td>
                      <td className="px-5 py-3">
                        <span className="text-caption text-muted bg-bg-muted px-2 py-0.5 rounded border border-border-subtle">
                          {product.category}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={`font-mono text-num-table font-medium ${
                            level === "CRITICAL_LOW"
                              ? "text-status-alert"
                              : level === "REORDER_SOON"
                              ? "text-status-amber"
                              : "text-foreground"
                          }`}
                        >
                          {product.available_stock}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="font-mono text-num-table text-secondary">{product.reorder_level}</span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        {level === "CRITICAL_LOW" && (
                          <span className="inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded border bg-status-alert/15 text-status-alert border-status-alert/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-status-alert animate-pulse" />
                            CRITICAL LOW
                          </span>
                        )}
                        {level === "REORDER_SOON" && (
                          <span className="inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded border bg-status-amber/15 text-status-amber border-status-amber/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-status-amber animate-pulse" />
                            REORDER SOON
                          </span>
                        )}
                        {level === "IN_STOCK" && (
                          <span className="inline-block text-caption font-medium px-2 py-0.5 rounded border bg-status-optimal/15 text-status-optimal border-status-optimal/20">
                            OK
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setEditProduct(product)}
                            title="Edit product"
                            className="h-7 px-2.5 rounded-md bg-bg-muted text-secondary border border-border-default hover:text-foreground hover:bg-bg-subtle transition-colors inline-flex items-center gap-1 text-caption font-medium"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={() => void handlePrintProduct(product)}
                            disabled={exportingId !== null}
                            title="Print this item's stock card as a PDF"
                            className="h-7 px-2.5 rounded-md bg-bg-muted text-secondary border border-border-default hover:text-foreground hover:bg-bg-subtle disabled:text-disabled disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1 text-caption font-medium"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-12 0v4h12v-4" />
                            </svg>
                            {exportingId === product.id ? "..." : "PDF"}
                          </button>
                          <button
                            onClick={() => { setDeleteTarget(product); setDeleteError(""); }}
                            title="Delete product"
                            className="h-7 w-7 rounded-md flex items-center justify-center text-secondary hover:text-status-error hover:bg-status-error/10 border border-border-default transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <AddSanitaryProductModal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          onCreated={() => { handleRefresh(); setShowAddModal(false); }}
          categoryOptions={categoryOptions}
          subcategoryOptions={subcategoryOptions}
          finishOptions={finishOptions}
        />
      )}

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
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: "crimson" | "green" | "amber" | "red" }) {
  const accentMap = {
    crimson: { dot: "bg-crimson-primary", text: "text-crimson-primary" },
    green: { dot: "bg-status-optimal", text: "text-status-optimal" },
    amber: { dot: "bg-status-amber", text: "text-status-amber" },
    red: { dot: "bg-status-alert", text: "text-status-alert" },
  };
  return (
    <div className="glass-card p-4 flex items-center justify-between">
      <div>
        <p className="text-caption text-muted uppercase tracking-wider font-medium">{label}</p>
        <p className={`text-num-kpi font-mono font-bold mt-1 ${accentMap[accent].text}`}>{value}</p>
      </div>
      <span className={`h-2.5 w-2.5 rounded-full ${accentMap[accent].dot}`} />
    </div>
  );
}

/* ─── Add Product Modal ──────────────────────────────────────────────────── */

function AddSanitaryProductModal({
  open,
  onClose,
  onCreated,
  categoryOptions,
  subcategoryOptions,
  finishOptions,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  categoryOptions?: readonly string[];
  subcategoryOptions?: readonly string[];
  finishOptions?: readonly string[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<string>(SANITARY_CATEGORY_OPTIONS[0]);
  const [subcategory, setSubcategory] = useState("");
  const [finish, setFinish] = useState<string>(PRODUCT_FINISH_OPTIONS[0]);
  const [unitPrice, setUnitPrice] = useState("");
  const [reorderLevel, setReorderLevel] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const isValid = name.trim() && sku.trim() && category && parseFloat(unitPrice) >= 0;

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");
    const { data, error: createError } = await createSanitaryProduct({
      sku: sku.trim(),
      name: name.trim(),
      category: category.trim(),
      subcategory: subcategory.trim() || undefined,
      finish: finish.trim() || undefined,
      unit_price: parseFloat(unitPrice) || 0,
      reorder_level: parseInt(reorderLevel) || 10,
    });
    setSubmitting(false);
    if (data) {
      await queryClient.invalidateQueries({ queryKey: ["sanitary_products"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onCreated();
    } else {
      setError(createError ?? "Failed to create product. Please try again.");
    }
  }

  const inputCls =
    "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-2";

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Add Sanitary Product</h2>
              <p className="text-caption text-muted mt-0.5">New inventory entry</p>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Product Name</label>
                <input type="text" value={name} onChange={(e) => setName(capitalizeFirst(e.target.value))} className={inputCls} placeholder="e.g. Single Lever Basin Mixer" />
              </div>
              <div>
                <label className={labelCls}>SKU Code</label>
                <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} className={`${inputCls} font-mono`} placeholder="e.g. SNT-FAU-001" />
              </div>
              <div>
                <label className={labelCls} htmlFor="add-product-category">Category</label>
                <ProductOptionCombobox
                  id="add-product-category"
                  aria-label="Category"
                  value={category}
                  onChange={setCategory}
                  options={categoryOptions ?? SANITARY_CATEGORY_OPTIONS}
                  placeholder="Bath Set Deluxe"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="add-product-subcategory">Subcategory</label>
                <ProductOptionCombobox
                  id="add-product-subcategory"
                  aria-label="Subcategory"
                  value={subcategory}
                  onChange={setSubcategory}
                  options={subcategoryOptions ?? SANITARY_SUBCATEGORY_OPTIONS}
                  placeholder="Lever Set Complete"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="add-product-finish">Finish</label>
                <ProductOptionCombobox
                  id="add-product-finish"
                  aria-label="Finish"
                  value={finish}
                  onChange={setFinish}
                  options={finishOptions ?? PRODUCT_FINISH_OPTIONS}
                  placeholder="Chrome"
                />
              </div>
              <div>
                <label className={labelCls}>Unit Price (PKR)</label>
                <input type="number" step="0.01" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={`${inputCls} font-mono`} placeholder="0.00" />
              </div>
              <div>
                <label className={labelCls}>Reorder Level</label>
                <input type="number" step="1" min="0" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className={`${inputCls} font-mono`} placeholder="10" />
              </div>
            </div>

            {error && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>

          <div className="p-5 border-t border-border-subtle shrink-0">
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={submitting || !isValid} className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors">
                {submitting ? "Creating..." : "Add Product"}
              </button>
              <button onClick={onClose} className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Delete Product Modal ──────────────────────────────────────────────── */

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
