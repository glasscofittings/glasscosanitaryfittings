"use client";

import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { searchSanitaryProducts, deliverProduct } from "@/lib/supabase/catalog";
import type { SanitaryProduct } from "@/types";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onDelivered: () => void;
}

const inputCls =
  "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-2";

export default function DeliverProductModal({ open, onClose, onDelivered }: Props) {
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SanitaryProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<SanitaryProduct | null>(null);
  const [quantity, setQuantity] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [destination, setDestination] = useState("");
  const [chalan, setChalan] = useState("");
  const [remarks, setRemarks] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => searchRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setSelectedProduct(null);
    setError("");

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchSanitaryProducts(value);
      setSearchResults(results);
      setShowDropdown(results.length > 0);
      setSearching(false);
    }, 250);
  }

  useEscapeToClose(open, () => { handleReset(); onClose(); });

  if (!open) return null;

  const qty = parseInt(quantity) || 0;

  const isValid =
    selectedProduct &&
    qty > 0 &&
    customerName.trim();

  function handleSelectProduct(product: SanitaryProduct) {
    setSelectedProduct(product);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
    setQuantity("");
    setError("");
  }

  function handleClearProduct() {
    setSelectedProduct(null);
    setQuantity("");
    setError("");
  }

  async function handleSubmit() {
    if (!isValid || !selectedProduct) return;
    setSubmitting(true);
    setError("");

    const result = await deliverProduct({
      product_id: selectedProduct.id,
      quantity_delivered: qty,
      customer_name: customerName.trim(),
      delivery_destination: destination.trim() || undefined,
      delivery_chalan: chalan.trim() || undefined,
      remarks: remarks.trim() || undefined,
    });

    setSubmitting(false);
    if (result) {
      setSuccess(true);
      await queryClient.invalidateQueries({ queryKey: ["sanitary_products"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onDelivered();
      setTimeout(() => {
        setSuccess(false);
        handleReset();
        onClose();
      }, 1200);
    } else {
      setError("Delivery failed. Check stock availability and try again.");
    }
  }

  function handleReset() {
    setSearchQuery("");
    setSelectedProduct(null);
    setQuantity("");
    setCustomerName("");
    setDestination("");
    setChalan("");
    setRemarks("");
    setError("");
  }

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" onClick={() => { handleReset(); onClose(); }} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border-subtle shrink-0">
            <div>
              <h2 className="text-h2 font-semibold">Dispatch / Deliver Product</h2>
              <p className="text-caption text-muted mt-0.5">Search, select, and deduct stock</p>
            </div>
            <button onClick={() => { handleReset(); onClose(); }} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* Search */}
            <div className="relative">
              <label className={labelCls}>Search Product (SKU or Name)</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={selectedProduct ? selectedProduct.sku : searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  disabled={!!selectedProduct}
                  className={`${inputCls} pl-10 ${selectedProduct ? "bg-bg-muted" : ""}`}
                  placeholder={selectedProduct ? "" : "e.g. SNT-FAU-001 or Basin Mixer"}
                />
                {selectedProduct && (
                  <button
                    onClick={handleClearProduct}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {showDropdown && searchResults.length > 0 && !selectedProduct && (
                <div className="absolute z-50 left-0 right-0 mt-1 glass-card border border-border-default rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectProduct(p)}
                      className="w-full text-left px-4 py-3 hover:bg-bg-subtle transition-colors border-b border-border-subtle last:border-0"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono text-num-code text-secondary text-caption">{p.sku}</span>
                          <span className="text-body text-foreground ml-2">{p.name}</span>
                        </div>
                        <span className={`text-caption font-medium ${p.available_stock > p.reorder_level ? "text-status-optimal" : "text-status-alert"}`}>
                          {p.available_stock} pcs
                        </span>
                      </div>
                      <div className="text-caption text-muted mt-0.5">
                        {p.category}{p.subcategory ? ` / ${p.subcategory}` : ""} &middot; PKR {p.unit_price.toLocaleString()}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searching && (
                <p className="text-caption text-muted mt-1">Searching...</p>
              )}
            </div>

            {/* Selected Product Summary */}
            {selectedProduct && (
              <div className="glass-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-body font-semibold text-foreground">{selectedProduct.name}</h3>
                    <span className="font-mono text-caption text-secondary">{selectedProduct.sku}</span>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded border ${
                    selectedProduct.available_stock > selectedProduct.reorder_level
                      ? "bg-status-optimal/15 text-status-optimal border-status-optimal/20"
                      : "bg-status-alert/15 text-status-alert border-status-alert/20"
                  }`}>
                    Available: {selectedProduct.available_stock} pcs
                  </span>
                </div>
                <div className="flex gap-4 text-caption text-muted">
                  <span>Category: <span className="text-foreground">{selectedProduct.category}</span></span>
                  <span>Price: <span className="text-foreground font-mono">PKR {selectedProduct.unit_price.toLocaleString()}</span></span>
                  {selectedProduct.finish && <span>Finish: <span className="text-foreground">{selectedProduct.finish}</span></span>}
                </div>
              </div>
            )}

            {/* Delivery Form */}
            {selectedProduct && (
              <>
                <div className="glow-line" />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Quantity to Deliver *</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={quantity}
                      onChange={(e) => { setQuantity(e.target.value); setError(""); }}
                      className={`${inputCls} font-mono`}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Customer / Destination *</label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(capitalizeFirst(e.target.value))}
                      className={inputCls}
                      placeholder="e.g. ABC Contractors"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Delivery Address</label>
                    <input
                      type="text"
                      value={destination}
                      onChange={(e) => setDestination(capitalizeFirst(e.target.value))}
                      className={inputCls}
                      placeholder="Site address"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Chalan #</label>
                    <input
                      type="text"
                      value={chalan}
                      onChange={(e) => setChalan(e.target.value)}
                      className={`${inputCls} font-mono`}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Remarks</label>
                    <input
                      type="text"
                      value={remarks}
                      onChange={(e) => setRemarks(capitalizeFirst(e.target.value))}
                      className={inputCls}
                      placeholder="Any additional notes"
                    />
                  </div>
                </div>

                {/* Line Total */}
                {qty > 0 && (
                  <div className="glass-card p-3 flex items-center justify-between">
                    <span className="text-caption text-muted">Line Total</span>
                    <span className="font-mono text-body font-semibold text-foreground">
                      PKR {(qty * selectedProduct.unit_price).toLocaleString()}
                    </span>
                  </div>
                )}
              </>
            )}

            {success && (
              <div className="bg-status-optimal/10 border border-status-optimal/20 rounded-lg p-3 text-caption text-status-optimal font-medium">
                Delivery recorded and stock deducted successfully.
              </div>
            )}

            {error && (
              <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
            )}
          </div>

          <div className="p-5 border-t border-border-subtle shrink-0">
            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting || !isValid || success}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Processing..." : success ? "Delivered" : "Confirm Dispatch"}
              </button>
              <button onClick={() => { handleReset(); onClose(); }} className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
