"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { type Party, type SalesInvoice, type DispatchLineItem, createInvoice, checkDuplicateInvoice } from "@/lib/supabase/invoicing";
import { formatPKR } from "@/lib/utils/formatters";
import AddCustomerModal from "./AddCustomerModal";

interface LineItem {
  key: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_of_measure: string;
  discount_percent?: number;
  discount_pkr?: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  available_stock: number;
  unit_price: number;
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

export default function InvoiceGenerator({ customers, onCreated, onPost, onClose, onCustomerCreated }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [touched, setTouched] = useState(false);
  const customerRef = useRef<HTMLDivElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<LineItem[]>([
    { key: "1", product_id: "", product_name: "", quantity: 1, unit_price: 0, unit_of_measure: "", discount_percent: 0, discount_pkr: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [applyFurtherTax, setApplyFurtherTax] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
  const lineDiscountAmount = (item: LineItem) => {
    const gross = lineGross(item);
    const pct = item.discount_percent || 0;
    const flat = item.discount_pkr || 0;
    const disc = flat > 0 ? flat : (gross * pct) / 100;
    return Math.min(gross, Math.max(0, Math.round(disc * 100) / 100));
  };
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
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        if (field === "product_id") {
          const product = products.find((p) => p.id === value);
          if (product) {
            updated.product_name = product.name;
            updated.unit_price = product.unit_price;
          }
        }
        return updated;
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
      discount_percent: item.discount_percent || 0,
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
    <div className="space-y-5">
      <div ref={customerRef} className="relative">
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
            setShowCustomerDropdown(true);
            setCustomerError("");
          }}
          onFocus={() => {
            setShowCustomerDropdown(true);
            setCustomerError("");
          }}
          placeholder={selectedCustomer ? "Change customer..." : "Search by name, STRN, phone..."}
          disabled={false}
          className={`w-full h-9 px-3 rounded-lg bg-obsidian-bg border text-foreground text-body focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors ${
            customerError && touched
              ? "border-status-error focus:border-status-error"
              : "border-border-default focus:border-crimson-primary"
          }`}
        />

        {/* Dropdown */}
        {showCustomerDropdown && (
          <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg bg-obsidian-bg border border-border-default shadow-xl">
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
          </div>
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

      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-caption text-secondary uppercase tracking-wider font-medium">Tax Configuration</label>
        </div>
        <div className="grid grid-cols-3 gap-3">
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

      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-caption text-secondary uppercase tracking-wider font-medium">Discount</label>
          {discountAmount > 0 && (
            <span className="text-caption font-mono text-status-amber whitespace-nowrap">− {formatPKR(discountAmount)}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
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

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-caption text-secondary uppercase tracking-wider font-medium">Line Items</label>
          <button onClick={addItem} className="text-caption text-crimson-light hover:text-crimson-primary transition-colors">+ Add Item</button>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={item.key} className="flex gap-2 items-start p-2 rounded-lg bg-bg-subtle border border-border-subtle">
              <select
                value={item.product_id}
                onChange={(e) => updateItem(idx, "product_id", e.target.value)}
                className="h-8 px-2 rounded bg-obsidian-bg border border-border-default text-foreground text-caption flex-1 focus:border-crimson-primary focus:outline-none"
              >
                <option value="">Product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="flex flex-col items-center">
                <input
                  type="number"
                  value={item.quantity || ""}
                  onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                  className="h-8 w-16 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                  placeholder="Qty"
                  min={1}
                />
              </div>
              <span className="h-8 flex items-center text-caption text-muted font-mono">{item.unit_of_measure}</span>
              <input
                type="number"
                value={item.unit_price || ""}
                onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
                className="h-8 w-24 px-2 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-right focus:border-crimson-primary focus:outline-none"
                placeholder="Price"
                min="0"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={item.discount_percent || ""}
                  onChange={(e) => updateItem(idx, "discount_percent", Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className="h-8 w-16 px-1 rounded bg-obsidian-bg border border-border-default text-foreground font-mono text-caption text-center focus:border-crimson-primary focus:outline-none"
                  placeholder="Disc%"
                  title="Line item discount %"
                  min="0"
                  max="100"
                />
              </div>
              <span className="h-8 flex items-center text-caption text-muted font-mono whitespace-nowrap min-w-[70px] justify-end">
                {item.quantity > 0 && item.unit_price > 0 ? formatPKR(lineNet(item)) : "—"}
              </span>
              {items.length > 1 && (
                <button onClick={() => removeItem(idx)} className="h-8 w-8 flex items-center justify-center text-muted hover:text-status-alert transition-colors">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
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
