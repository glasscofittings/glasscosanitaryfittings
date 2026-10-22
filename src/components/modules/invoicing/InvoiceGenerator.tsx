"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { type Party, type SalesInvoice, type DispatchLineItem, createInvoice, checkDuplicateInvoice, calcEntryLineDiscount } from "@/lib/supabase/invoicing";
import { formatPKR } from "@/lib/utils/formatters";
import ProductCombobox, { type ProductOption } from "./ProductCombobox";
import AddCustomerModal from "./AddCustomerModal";

interface LineItem {
  key: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_of_measure: string;
  /** Line discount percentage input (Disc%), 0–100. */
  discount_percent?: number;
  /**
   * Fixed line discount amount in Rs. (the "Disc (Rs.)" input). Form-state
   * only: the persisted sales_invoice_items.discount_pkr stores the COMBINED
   * total (% part + Rs. part) so stored-row readers/print stay authoritative.
   */
  discount_pkr?: number;
  /** Latest known stock for the picked product (display aid only). */
  stock?: number;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface Props {
  customers: Party[];
  onCreated: () => void;
  onPost: (invoice: SalesInvoice, lineItems: DispatchLineItem[]) => void;
  onClose: () => void;
  onCustomerCreated?: (customer: Party) => void;
}

/** Screen-space anchor for the portalled customer dropdown (fixed positioning). */
interface DropdownPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const CUSTOMER_DROPDOWN_GAP = 4;
const CUSTOMER_DROPDOWN_MAX_H = 240;
const CUSTOMER_DROPDOWN_FLIP_THRESHOLD = 160;

export default function InvoiceGenerator({ customers, onCreated, onPost, onClose, onCustomerCreated }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [touched, setTouched] = useState(false);
  const customerRef = useRef<HTMLDivElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);
  const [items, setItems] = useState<LineItem[]>([
    { key: "1", product_id: "", product_name: "", quantity: 1, unit_price: 0, unit_of_measure: "", discount_percent: 0, discount_pkr: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [applyFurtherTax, setApplyFurtherTax] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [salesTaxRate, setSalesTaxRate] = useState(0);
  const [furtherTaxRate, setFurtherTaxRate] = useState(0);
  const [additionalTaxRate, setAdditionalTaxRate] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountFlat, setDiscountFlat] = useState(0);

  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/rest/v1/sanitary_products?select=id,name,sku,category,available_stock,unit_price&order=name.asc`, {
      headers: {
        apikey: SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
      },
    })
      .then((res) => {
        if (!res.ok) {
          console.error("Supabase Error [products_master fetch]:", { status: res.status });
          return [];
        }
        return res.json();
      })
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        console.log("InvoiceGenerator products loaded:", list.length, list);
        setProducts(list);
      })
      .catch((err) => {
        console.error("Supabase Error [products_master fetch]:", err);
        setProducts([]);
      });
  }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.ntn_strn ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  /**
   * Measures the search input and anchors the portalled dropdown to its screen
   * rect, flipping upward when the viewport bottom has no room. Fixed
   * positioning escapes both the drawer's overflow clip and every stacking
   * context below (glass-card backdrop blurs), which is what used to render
   * the list behind the Tax Configuration / Discount cards.
   */
  function measureCustomerDropdown(): DropdownPos | null {
    const el = customerInputRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - CUSTOMER_DROPDOWN_GAP - 8;
    const spaceAbove = rect.top - CUSTOMER_DROPDOWN_GAP - 8;
    const flipUp = spaceBelow < CUSTOMER_DROPDOWN_FLIP_THRESHOLD && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, Math.min(CUSTOMER_DROPDOWN_MAX_H, flipUp ? spaceAbove : spaceBelow));
    return {
      top: flipUp ? rect.top - CUSTOMER_DROPDOWN_GAP - maxHeight : rect.bottom + CUSTOMER_DROPDOWN_GAP,
      left: rect.left,
      width: rect.width,
      maxHeight,
    };
  }

  /** Opens the list with its position measured in the same batched update, so
   *  the portal renders on the very first frame (no flicker). */
  function openCustomerDropdown() {
    setDropdownPos(measureCustomerDropdown());
    setShowCustomerDropdown(true);
    setCustomerError("");
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      // The list is portalled onto document.body, outside customerRef — clicks
      // inside it must not close the dropdown before its own onClick runs.
      if (customerRef.current?.contains(target) || customerDropdownRef.current?.contains(target)) return;
      setShowCustomerDropdown(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the portalled list glued to the input while open (drawer scroll /
  // window resize). capture:true catches scroll events from the scrolling
  // drawer ancestor, which never bubble.
  useEffect(() => {
    if (!showCustomerDropdown) {
      setDropdownPos(null);
      return;
    }
    const update = () => setDropdownPos(measureCustomerDropdown());
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [showCustomerDropdown]);

  function selectCustomer(customer: Party) {
    setCustomerId(customer.id);
    setCustomerSearch("");
    setShowCustomerDropdown(false);
    setCustomerError("");
    setTouched(true);
  }

  function clearCustomer() {
    setCustomerId("");
    setCustomerSearch("");
    setCustomerError("");
    setTouched(true);
  }

  const lineGross = (item: LineItem) => (item.quantity || 0) * (item.unit_price || 0);
  // Line discount = (qty × price × Disc% / 100) + fixed Rs. amount — both
  // combine when set (capped at the gross line), subtracted before tax.
  const lineDiscountAmount = (item: LineItem) =>
    calcEntryLineDiscount(lineGross(item), item.discount_percent, item.discount_pkr);
  const lineNet = (item: LineItem) => Math.max(0, Math.round((lineGross(item) - lineDiscountAmount(item)) * 100) / 100);

  const rawGrossTotal = items.reduce((a, item) => a + lineGross(item), 0);
  const itemDiscountsTotal = items.reduce((a, item) => a + lineDiscountAmount(item), 0);
  const grossValue = items.reduce((a, item) => a + lineNet(item), 0);

  // Invoice-level discount = % of net lines + flat Rs., capped at grossValue
  const discountAmount = Math.min(
    grossValue,
    Math.max(0, Math.round((grossValue * (discountPercent / 100) + discountFlat) * 100) / 100)
  );
  const taxableValue = Math.round((grossValue - discountAmount) * 100) / 100;
  const salesTaxAmount = taxableValue * (salesTaxRate / 100);
  const furtherTaxAmount = taxableValue * (furtherTaxRate / 100);
  const additionalTaxAmount = taxableValue * (additionalTaxRate / 100);
  const totalPayable = taxableValue + salesTaxAmount + furtherTaxAmount + additionalTaxAmount;

  const isValid = !!customerId && items.some((item) => item.product_id && item.quantity > 0 && item.unit_price > 0);

  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  /** Applies a combobox pick to the row: id, name, rate, UOM and stock. */
  function selectProduct(index: number, product: ProductOption | null) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (!product) {
          return { ...item, product_id: "", product_name: "", stock: undefined };
        }
        return {
          ...item,
          product_id: product.id,
          product_name: product.name,
          unit_price: product.unit_price,
          unit_of_measure: item.unit_of_measure || "PCS",
          stock: product.available_stock,
        };
      })
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: String(Date.now()), product_id: "", product_name: "", quantity: 1, unit_price: 0, unit_of_measure: "", discount_percent: 0, discount_pkr: 0 },
    ]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function toDispatchItems(): DispatchLineItem[] {
    return items.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price_pkr: item.unit_price,
      line_total_pkr: lineNet(item),
      unit_of_measure: item.unit_of_measure,
      discount_percent: item.discount_percent || 0, // raw Disc% input
      // Persist the COMBINED line discount (% part + fixed Rs. part) — the
      // stored-row reader (calcLineDiscountAmount) and invoice print treat
      // discount_pkr as the authoritative total line discount.
      discount_pkr: lineDiscountAmount(item),
    }));
  }

  async function handleSaveDraft() {
    if (!customerId) {
      setCustomerError("Please select an existing CRM customer.");
      setTouched(true);
      customerInputRef.current?.focus();
      return;
    }
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    const today = new Date().toISOString().slice(0, 10);
    const isDup = await checkDuplicateInvoice(customerId, taxableValue, today);
    if (isDup) {
      setDuplicateWarning("Possible duplicate: same customer, value, and date.");
      setSubmitting(false);
      return;
    }

    const { invoice, error: createError, stockWarning } = await createInvoice({
      customer_id: customerId,
      taxable_value_pkr: taxableValue,
      sales_tax_amount_pkr: salesTaxAmount,
      further_tax_amount_pkr: furtherTaxAmount,
      total_invoice_value_pkr: totalPayable,
      sales_tax_rate: salesTaxRate,
      further_tax_rate: furtherTaxAmount > 0 ? furtherTaxRate : 0,
      discount_percent: discountAmount > 0 ? discountPercent : 0,
      discount_pkr: discountAmount,
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: "Accounts Dept",
      items: toDispatchItems(),
    });

    setSubmitting(false);
    if (invoice) {
      if (stockWarning) toast.warning(stockWarning);
      onCreated();
      onClose();
    } else {
      setError(createError ?? "Failed to save draft. Check connection.");
    }
  }

  async function handlePostInvoice() {
    if (!customerId) {
      setCustomerError("Please select an existing CRM customer.");
      setTouched(true);
      customerInputRef.current?.focus();
      return;
    }
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    const dispatchItems = toDispatchItems();
    const { invoice, error: createError, stockWarning } = await createInvoice({
      customer_id: customerId,
      taxable_value_pkr: taxableValue,
      sales_tax_amount_pkr: salesTaxAmount,
      further_tax_amount_pkr: furtherTaxAmount,
      total_invoice_value_pkr: totalPayable,
      sales_tax_rate: salesTaxRate,
      further_tax_rate: furtherTaxAmount > 0 ? furtherTaxRate : 0,
      discount_percent: discountAmount > 0 ? discountPercent : 0,
      discount_pkr: discountAmount,
      device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: "Accounts Dept",
      items: dispatchItems,
    });

    setSubmitting(false);
    if (invoice) {
      if (stockWarning) toast.warning(stockWarning);
      onCreated();
      onPost(invoice, dispatchItems);
      onClose();
    } else {
      setError(createError ?? "Failed to create invoice. Check connection.");
    }
  }

  const inputCls = "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Customer Section */}
      <div ref={customerRef} className="glass-card p-4 w-full relative">
        <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-2">
          Customer <span className="text-crimson-primary">*</span>
        </label>

        {/* Selected customer chip */}
        {selectedCustomer && !showCustomerDropdown && (
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-crimson-primary/10 border border-crimson-primary/20 text-body text-crimson-primary font-medium">
              {selectedCustomer.name}
              {selectedCustomer.ntn_strn && (
                <span className="text-caption text-crimson-primary/60 font-normal">STRN: {selectedCustomer.ntn_strn}</span>
              )}
              <button
                type="button"
                onClick={clearCustomer}
                className="ml-1 h-4 w-4 rounded-full flex items-center justify-center hover:bg-crimson-primary/20 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          </div>
        )}

        {/* Search input */}
        <input
          ref={customerInputRef}
          type="text"
          value={showCustomerDropdown ? customerSearch : selectedCustomer ? "" : customerSearch}
          onChange={(e) => {
            setCustomerSearch(e.target.value);
            openCustomerDropdown();
          }}
          onFocus={openCustomerDropdown}
          placeholder={selectedCustomer ? "Change customer..." : "Search by name, STRN, phone..."}
          disabled={false}
          className={`w-full h-9 px-3 rounded-lg bg-obsidian-bg border text-foreground text-body focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors ${
            customerError && touched
              ? "border-status-error focus:border-status-error"
              : "border-border-default focus:border-crimson-primary"
          }`}
        />

        {/* Dropdown — portalled to document.body so it renders above the Tax
            Configuration / Discount cards (backdrop-filter stacking contexts)
            and is never clipped by the drawer's overflow-y-auto. Anchored to
            the input's screen rect; z-index 100 > drawer z-[80] > overlay 60. */}
        {showCustomerDropdown && dropdownPos && createPortal(
          <div
            ref={customerDropdownRef}
            className="overflow-y-auto rounded-lg bg-obsidian-bg border border-border-default shadow-xl"
            style={{
              position: "fixed",
              zIndex: 100,
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              maxHeight: dropdownPos.maxHeight,
            }}
          >
            {filteredCustomers.length > 0 ? (
              filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCustomer(c)}
                  className={`w-full text-left px-3 py-2.5 text-body hover:bg-bg-subtle transition-colors border-b border-border-subtle last:border-0 ${
                    c.id === customerId ? "bg-crimson-primary/10 text-crimson-primary" : "text-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.name}</span>
                    {c.id === customerId && (
                      <svg className="h-4 w-4 text-crimson-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {c.ntn_strn && <span className="text-caption text-muted">STRN: {c.ntn_strn}</span>}
                    {c.phone && <span className="text-caption text-muted">{c.phone}</span>}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center">
                <p className="text-caption text-muted mb-2">No customer found in CRM.</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomerDropdown(false);
                    setAddCustomerOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-crimson-primary/10 border border-crimson-primary/20 text-caption font-medium text-crimson-primary hover:bg-crimson-primary/20 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add New Customer to CRM
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}

        {/* Validation error */}
        {customerError && touched && (
          <p className="text-caption text-status-error mt-1.5 flex items-center gap-1">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {customerError}
          </p>
        )}
      </div>

      {selectedCustomer && !selectedCustomer.is_registered && (
        <div className="flex items-center gap-2 text-caption text-status-amber bg-status-amber/10 px-3 py-2 rounded-lg border border-status-amber/20">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          Unregistered buyer — Further Tax will apply automatically
        </div>
      )}

      {selectedCustomer && selectedCustomer.is_registered && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-border-subtle bg-bg-subtle">
          <div className="flex items-center gap-2">
            <span className="text-caption text-secondary">Apply Further Tax (registered buyer optional)</span>
          </div>
          <button
            type="button"
            onClick={() => setApplyFurtherTax(!applyFurtherTax)}
            className={`relative h-5 w-9 rounded-full transition-colors ${applyFurtherTax ? "bg-crimson-primary" : "bg-bg-muted border border-border-default"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${applyFurtherTax ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </div>
      )}

      {/* Tax Configuration */}
      <div className="glass-card p-4 w-full">
        <div className="flex items-center justify-between mb-3">
          <label className="text-caption text-secondary uppercase tracking-wider font-medium">Tax Configuration</label>
        </div>
        <div className="grid grid-cols-3 gap-4 w-full">
          <div>
            <label className="block text-[10px] text-muted uppercase mb-1">Sales Tax %</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={salesTaxRate}
              onChange={(e) => setSalesTaxRate(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted uppercase mb-1">Further Tax %</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={furtherTaxRate}
              onChange={(e) => setFurtherTaxRate(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted uppercase mb-1">Additional Tax %</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={additionalTaxRate}
              onChange={(e) => setAdditionalTaxRate(parseFloat(e.target.value) || 0)}
              className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Discount */}
      <div className="glass-card p-4 w-full">
        <div className="flex items-center justify-between mb-3">
          <label className="text-caption text-secondary uppercase tracking-wider font-medium">Discount</label>
          {discountAmount > 0 && (
            <span className="text-caption font-mono text-status-amber whitespace-nowrap">− {formatPKR(discountAmount)}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 w-full">
          <div>
            <label className="block text-[10px] text-muted uppercase mb-1">Discount %</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(Math.min(100, parseFloat(e.target.value) || 0))}
              className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted uppercase mb-1">Discount (Rs.)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={discountFlat}
              onChange={(e) => setDiscountFlat(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted mt-2">Applied to the line-item total before tax. % and Rs. combine when both are set.</p>
      </div>

      {/* Line Items */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-2">
          <label className="text-caption text-secondary uppercase tracking-wider font-medium">Line Items</label>
          <button onClick={addItem} className="text-caption text-crimson-light hover:text-crimson-primary transition-colors">+ Add Item</button>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={item.key} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg bg-bg-subtle border border-border-subtle">
              <div className="col-span-12 sm:col-span-3 min-w-0">
                <ProductCombobox
                  products={products}
                  value={item.product_id}
                  productName={item.product_name}
                  onSelect={(product) => selectProduct(idx, product)}
                />
              </div>
              <div className="col-span-4 sm:col-span-1 min-w-0">
                <input
                  type="number"
                  value={item.quantity || ""}
                  onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                  className="h-8 w-full px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                  placeholder="Qty"
                  min={1}
                />
              </div>
              <span
                className="col-span-3 sm:col-span-1 h-8 flex items-center text-caption text-muted font-mono truncate"
                title={item.unit_of_measure}
              >
                {item.unit_of_measure}
              </span>
              <div className="col-span-5 sm:col-span-2 min-w-0">
                <input
                  type="number"
                  value={item.unit_price || ""}
                  onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
                  className="h-8 w-full px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-right focus:border-crimson-primary focus:outline-none"
                  placeholder="Price"
                  min="0"
                />
              </div>
              <div className="col-span-3 sm:col-span-1 min-w-0">
                <input
                  type="number"
                  value={item.discount_percent || ""}
                  onChange={(e) => updateItem(idx, "discount_percent", Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className="h-8 w-full px-1 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                  placeholder="Disc%"
                  title="Line item discount %"
                  aria-label="Line item discount percent"
                  min="0"
                  max="100"
                />
              </div>
              <div className="col-span-3 sm:col-span-1 min-w-0">
                <input
                  type="number"
                  value={item.discount_pkr || ""}
                  onChange={(e) => updateItem(idx, "discount_pkr", Math.max(0, parseFloat(e.target.value) || 0))}
                  className="h-8 w-full px-1 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                  placeholder="Rs."
                  title="Line item discount amount (Rs.)"
                  aria-label="Line item discount amount in rupees"
                  min="0"
                  step="0.01"
                />
              </div>
              <span
                className="col-span-4 sm:col-span-2 h-8 flex items-center justify-end text-caption text-muted font-mono whitespace-nowrap"
                title={item.stock !== undefined ? `${item.stock} in stock` : undefined}
              >
                {item.quantity > 0 && item.unit_price > 0 ? formatPKR(lineNet(item)) : "—"}
              </span>
              {items.length > 1 && (
                <button
                  onClick={() => removeItem(idx)}
                  className="col-span-2 sm:col-span-1 h-8 w-full sm:w-8 ml-auto flex items-center justify-center text-muted hover:text-status-alert transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted mt-2">
          Disc% and Disc (Rs.) combine per line: Discount = (Qty × Price × Disc% ÷ 100) + Rs. amount, subtracted before tax.
        </p>
      </div>

      {duplicateWarning && (
        <div className="flex items-center gap-2 text-caption text-status-amber bg-status-amber/10 px-3 py-2 rounded-lg border border-status-amber/20">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {duplicateWarning}
        </div>
      )}

      {grossValue > 0 && (
        <div className="glass-card p-4 space-y-2">
          {/* Show raw gross total if any line discounts were applied */}
          {itemDiscountsTotal > 0 && (
            <>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Gross Total (before line discounts)</span>
                <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(rawGrossTotal)}</span>
              </div>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Line Item Discounts</span>
                <span className="font-mono text-num-table text-status-amber whitespace-nowrap">− {formatPKR(itemDiscountsTotal)}</span>
              </div>
              <div className="flex justify-between text-body">
                <span className="text-secondary">Net Line Total</span>
                <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(grossValue)}</span>
              </div>
            </>
          )}
          {/* Invoice-level discount */}
          {discountAmount > 0 && (
            <>
              {itemDiscountsTotal === 0 && (
                <div className="flex justify-between text-body">
                  <span className="text-secondary">Sub Total</span>
                  <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(grossValue)}</span>
                </div>
              )}
              <div className="flex justify-between text-body">
                <span className="text-secondary">
                  Invoice Discount{discountPercent > 0 ? ` (${discountPercent}%)` : ""}
                </span>
                <span className="font-mono text-num-table text-status-amber whitespace-nowrap">− {formatPKR(discountAmount)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-body">
            <span className="text-secondary">Taxable Value</span>
            <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(taxableValue)}</span>
          </div>
          {salesTaxAmount > 0 && (
            <div className="flex justify-between text-body">
              <span className="text-secondary">Sales Tax ({salesTaxRate}%)</span>
              <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(salesTaxAmount)}</span>
            </div>
          )}
          {furtherTaxAmount > 0 && (
            <div className="flex justify-between text-body">
              <span className="text-secondary">Further Tax ({furtherTaxRate}%)</span>
              <span className="font-mono text-num-table text-status-amber whitespace-nowrap">{formatPKR(furtherTaxAmount)}</span>
            </div>
          )}
          {additionalTaxAmount > 0 && (
            <div className="flex justify-between text-body">
              <span className="text-secondary">Additional Tax ({additionalTaxRate}%)</span>
              <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(additionalTaxAmount)}</span>
            </div>
          )}
          <div className="glow-line my-2" />
          <div className="flex justify-between text-body font-semibold">
            <span className="text-foreground">Total Payable</span>
            <span className="font-mono text-num-kpi text-crimson-primary whitespace-nowrap">{formatPKR(totalPayable)}</span>
          </div>
        </div>
      )}


      {error && (
        <p className="text-caption text-status-alert bg-status-alert/10 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSaveDraft}
          disabled={submitting || !isValid}
          className="flex-1 h-9 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-subtle disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Saving..." : "Save Draft"}
        </button>
        <button
          onClick={handlePostInvoice}
          disabled={submitting || !isValid}
          className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:bg-bg-muted disabled:text-disabled disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Creating..." : "Post Invoice"}
        </button>
        <button
          onClick={onClose}
          className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
        >
          Cancel
        </button>
      </div>

      <AddCustomerModal
        open={addCustomerOpen}
        onClose={() => setAddCustomerOpen(false)}
        onCreated={(customer) => {
          setCustomerId(customer.id);
          setCustomerSearch("");
          setCustomerError("");
          onCustomerCreated?.(customer);
          setAddCustomerOpen(false);
        }}
      />
    </div>
  );
}
