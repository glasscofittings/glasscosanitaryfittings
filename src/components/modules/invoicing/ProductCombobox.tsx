"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatPKR } from "@/lib/utils/formatters";

/** Row shape returned by the sanitary_products fetch used by invoice forms. */
export interface ProductOption {
  id: string;
  name: string;
  sku: string;
  category: string;
  available_stock: number;
  unit_price: number;
}

interface Props {
  products: ProductOption[];
  /** Currently selected product id ("" when nothing selected). */
  value: string;
  /** Fallback label for rows saved before the product exists in inventory. */
  productName?: string;
  /** Fired when a product is picked, or null when the selection is cleared. */
  onSelect: (product: ProductOption | null) => void;
  placeholder?: string;
}

const MAX_RESULTS = 50;

/**
 * Searchable product combobox for invoice line items.
 *
 * Layout-safe: the input fills its grid cell (`w-full min-w-0` on the wrapper)
 * and the result list is absolutely positioned, so it overlays neighboring
 * fields (Qty, Price, ...) instead of widening the row.
 */
export default function ProductCombobox({
  products,
  value,
  productName,
  onSelect,
  placeholder = "Search product name or SKU...",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = useMemo(() => products.find((p) => p.id === value) ?? null, [products, value]);

  // While the dropdown is open show the live query; otherwise show the picked
  // product's name (or the stored name for legacy rows).
  const displayValue = open ? query : (selected?.name ?? productName ?? "");

  /** Live search-filter across name, SKU and category. */
  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return products.slice(0, MAX_RESULTS);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q)
      )
      .slice(0, MAX_RESULTS);
  }, [products, query]);

  // Keep the highlighted option visible while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  // Close when clicking outside the combobox.
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  function commit(product: ProductOption | null) {
    onSelect(product);
    setOpen(false);
    setQuery("");
    setHighlight(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && results[highlight]) {
        e.preventDefault();
        commit(results[highlight]);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        title={selected ? `${selected.name} — ${formatPKR(selected.unit_price)} — ${selected.available_stock} in stock` : placeholder}
        className="w-full h-8 pl-2 pr-7 rounded bg-obsidian-bg border border-border-default text-foreground text-caption focus:border-crimson-primary focus:outline-none truncate"
      />

      {value && (
        <button
          type="button"
          onClick={() => commit(null)}
          title="Clear product"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center text-muted hover:text-foreground transition-colors"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-50 left-0 mt-1 w-full max-w-[440px] max-h-64 overflow-y-auto rounded-lg bg-obsidian-bg border border-border-default shadow-xl"
        >
          {results.length > 0 ? (
            results.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === value}
                data-idx={i}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(p)}
                className={`w-full text-left px-3 py-2 text-caption border-b border-border-subtle last:border-0 transition-colors ${
                  i === highlight ? "bg-crimson-primary/10" : "hover:bg-bg-subtle"
                } ${p.id === value ? "text-crimson-primary" : "text-foreground"}`}
              >
                {/* Full product name — wraps naturally, never clipped or line-clamped */}
                <div className="font-medium leading-snug whitespace-normal break-words">{p.name}</div>
                {/* Metadata row — wraps so nothing is hidden */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                  {p.sku && <span className="font-mono text-muted whitespace-nowrap">SKU: {p.sku}</span>}
                  <span className="text-muted whitespace-nowrap">Unit: PCS</span>
                  {p.category && <span className="text-muted">{p.category}</span>}
                  <span
                    className={
                      p.available_stock <= 0
                        ? "text-status-alert whitespace-nowrap"
                        : p.available_stock <= 5
                          ? "text-status-amber whitespace-nowrap"
                          : "text-muted whitespace-nowrap"
                    }
                  >
                    {p.available_stock <= 0 ? "Out of stock" : `${p.available_stock} in stock`}
                  </span>
                  <span className="font-mono text-foreground ml-auto whitespace-nowrap">{formatPKR(p.unit_price)}</span>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-center text-caption text-muted">No product matches &quot;{query}&quot;</div>
          )}
        </div>
      )}
    </div>
  );
}
