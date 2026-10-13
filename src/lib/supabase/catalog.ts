import type { SanitaryProduct, StockAlert, StockAlertLevel, ProductDelivery } from "@/types";
import { getCompanyLogoHtml, getExportCompanyName } from "@/lib/company-settings";
import { COMPANY_HEADER, COMPANY_LEGAL_NAME, SERIF_FONT_FAMILY_CSS } from "@/lib/branding";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

async function parseResponse(res: Response): Promise<{ data: unknown; text: string }> {
  const text = await res.text();
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null, text };
  }
}

export async function fetchSanitaryProducts(): Promise<SanitaryProduct[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sanitary_products?select=*&order=category.asc,name.asc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [sanitary_products]:", { status: res.status, body: await res.json() });
      return [];
    }
    const data = await res.json();
    return (Array.isArray(data) ? data : []) as SanitaryProduct[];
  } catch (err) {
    console.error("Supabase Error [fetchSanitaryProducts]:", err);
    return [];
  }
}

export async function fetchSanitaryProductsByCategory(category: string): Promise<SanitaryProduct[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sanitary_products?category=eq.${encodeURIComponent(category)}&select=*&order=name.asc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [sanitary_products by category]:", { status: res.status, body: await res.json() });
      return [];
    }
    const data = await res.json();
    return (Array.isArray(data) ? data : []) as SanitaryProduct[];
  } catch (err) {
    console.error("Supabase Error [fetchSanitaryProductsByCategory]:", err);
    return [];
  }
}

export async function searchSanitaryProducts(query: string): Promise<SanitaryProduct[]> {
  if (!SUPABASE_URL || !query.trim()) return [];
  const q = query.trim();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sanitary_products?or=(sku.ilike.*${encodeURIComponent(q)}*,name.ilike.*${encodeURIComponent(q)}*)&select=*&order=name.asc&limit=20`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [sanitary_products search]:", { status: res.status, body: await res.json() });
      return [];
    }
    const data = await res.json();
    return (Array.isArray(data) ? data : []) as SanitaryProduct[];
  } catch (err) {
    console.error("Supabase Error [searchSanitaryProducts]:", err);
    return [];
  }
}

export async function createSanitaryProduct(
  product: Omit<SanitaryProduct, "id" | "total_stock" | "available_stock" | "created_at">
): Promise<{ data: SanitaryProduct | null; error?: string }> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sanitary_products`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        sku: product.sku,
        name: product.name,
        category: product.category,
        subcategory: product.subcategory ?? null,
        finish: product.finish ?? null,
        material: product.material ?? null,
        unit_price: product.unit_price,
        reorder_level: product.reorder_level,
      }),
    });
    if (!res.ok) {
      const body = await res.json();
      if (res.status === 409 && body?.code === "23505") {
        return { data: null, error: `SKU "${product.sku}" already exists. Please use a unique SKU code.` };
      }
      console.error("Supabase Error [sanitary_products insert]:", { status: res.status, body });
      return { data: null, error: body?.message ?? `Insert failed (status ${res.status})` };
    }
    const data = await res.json();
    return { data: data[0] ?? null };
  } catch (err) {
    console.error("Supabase Error [createSanitaryProduct]:", err);
    return { data: null, error: err instanceof Error ? err.message : "Network error. Please check your connection." };
  }
}

export async function updateSanitaryProduct(
  id: string,
  updates: Partial<Pick<SanitaryProduct, "sku" | "name" | "category" | "subcategory" | "finish" | "material" | "unit_price" | "reorder_level" | "available_stock" | "total_stock">>
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sanitary_products?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(updates),
    });
    return res.ok;
  } catch (err) {
    console.error("Supabase Error [updateSanitaryProduct]:", err);
    return false;
  }
}

export interface DeleteProductResult {
  ok: boolean;
  error?: string;
}

export async function deleteSanitaryProduct(id: string): Promise<DeleteProductResult> {
  if (!SUPABASE_URL) return { ok: false, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sanitary_products?id=eq.${id}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { /* non-JSON */ }

      const code = body?.code as string | undefined;
      if (code === "23503") {
        return {
          ok: false,
          error: "Cannot delete product because it has active dispatches or sales entries.",
        };
      }

      const { message, details, hint } = body as { message?: string; details?: string; hint?: string };
      console.error("Supabase Error [deleteSanitaryProduct]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return { ok: false, error: message ?? `Delete failed (status ${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    console.error("Supabase Error [deleteSanitaryProduct]:", err);
    return { ok: false, error: "Network error. Please check your connection." };
  }
}

export async function deductProductStock(productId: string, quantity: number): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL) return { ok: false, error: "Server URL is not configured" };

  // 1. Try RPC first
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/deduct_product_stock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_product_id: productId, p_quantity: quantity }),
    });

    const rpcBody = await rpcRes.text();

    if (rpcRes.ok) {
      return { ok: true };
    }

    console.warn("RPC deduct_product_stock failed, attempting fallback UPDATE...", {
      status: rpcRes.status,
      body: rpcBody,
    });
  } catch (err) {
    console.warn("RPC call failed, attempting fallback UPDATE...", err);
  }

  // 2. Fallback: direct UPDATE with stock validation
  try {
    const { data: rows, text: readText } = await parseResponse(
      await fetch(
        `${SUPABASE_URL}/rest/v1/sanitary_products?id=eq.${productId}&select=available_stock`,
        { headers: headers() }
      )
    );
    if (!Array.isArray(rows)) {
      return { ok: false, error: `Failed to read product stock: ${readText}` };
    }

    const currentStock: number = rows[0]?.available_stock;

    if (currentStock == null) return { ok: false, error: "Product not found" };
    if (currentStock < quantity) {
      return { ok: false, error: `Insufficient stock. Required: ${quantity}, Available: ${currentStock}` };
    }

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/sanitary_products?id=eq.${productId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=minimal" },
      body: JSON.stringify({ available_stock: currentStock - quantity }),
    });

    if (!updateRes.ok) {
      const { text: updateText } = await parseResponse(updateRes);
      console.error("Fallback UPDATE failed:", updateText);
      return { ok: false, error: `Stock update failed: ${updateText}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("Fallback UPDATE error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Stock deduction failed" };
  }
}

export async function restoreProductStock(productId: string, quantity: number): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL) return { ok: false, error: "Server URL is not configured" };
  if (!(quantity > 0)) return { ok: true };
  try {
    const { data: rows, text: readText } = await parseResponse(
      await fetch(
        `${SUPABASE_URL}/rest/v1/sanitary_products?id=eq.${productId}&select=available_stock`,
        { headers: headers() }
      )
    );
    if (!Array.isArray(rows)) {
      return { ok: false, error: `Failed to read product stock: ${readText}` };
    }
    const currentStock: number = rows[0]?.available_stock;
    if (currentStock == null) return { ok: false, error: "Product not found" };

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/sanitary_products?id=eq.${productId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=minimal" },
      body: JSON.stringify({ available_stock: currentStock + quantity }),
    });
    if (!updateRes.ok) {
      const { text: updateText } = await parseResponse(updateRes);
      return { ok: false, error: `Stock update failed: ${updateText}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("restoreProductStock error:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Stock restore failed" };
  }
}

export async function deliverProduct(payload: {
  product_id: string;
  quantity_delivered: number;
  customer_name: string;
  delivery_destination?: string;
  delivery_chalan?: string;
  remarks?: string;
}): Promise<ProductDelivery | null> {
  if (!SUPABASE_URL) return null;

  try {
    // Deduct stock (RPC with fallback)
    const stockResult = await deductProductStock(payload.product_id, payload.quantity_delivered);
    if (!stockResult.ok) {
      console.error("Stock deduction failed:", stockResult.error);
      return null;
    }

    // Insert delivery record
    const { data: deliveryData, text: deliveryText } = await parseResponse(
      await fetch(`${SUPABASE_URL}/rest/v1/product_deliveries`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({
          product_id: payload.product_id,
          quantity_delivered: payload.quantity_delivered,
          customer_name: payload.customer_name,
          delivery_destination: payload.delivery_destination ?? null,
          delivery_chalan: payload.delivery_chalan ?? null,
          remarks: payload.remarks ?? null,
        }),
      })
    );
    if (!deliveryData) {
      console.error("Supabase Error [product_deliveries insert]:", deliveryText);
      return null;
    }
    const rows = Array.isArray(deliveryData) ? deliveryData : [deliveryData];
    return rows[0] ?? null;
  } catch (err) {
    console.error("Supabase Error [deliverProduct]:", err);
    return null;
  }
}

export async function fetchRecentDeliveries(limit = 20): Promise<ProductDelivery[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/product_deliveries?select=*&order=created_at.desc&limit=${limit}`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [product_deliveries]:", { status: res.status, body: await res.json() });
      return [];
    }
    const data = await res.json();
    return (Array.isArray(data) ? data : []) as ProductDelivery[];
  } catch (err) {
    console.error("Supabase Error [fetchRecentDeliveries]:", err);
    return [];
  }
}

export function computeStockAlert(product: SanitaryProduct): StockAlert {
  let alert_level: StockAlertLevel = "IN_STOCK";
  if (product.available_stock <= product.reorder_level) {
    alert_level = "CRITICAL_LOW";
  } else if (product.available_stock <= product.reorder_level * 1.5) {
    alert_level = "REORDER_SOON";
  }
  return {
    product_id: product.id,
    product_name: product.name,
    sku: product.sku,
    available_stock: product.available_stock,
    reorder_level: product.reorder_level,
    alert_level,
  };
}

export function computeStockAlerts(products: SanitaryProduct[]): StockAlert[] {
  return products.map(computeStockAlert);
}

// ============================================================================
// DISPATCH & INVOICE (Dispatch-to-Invoice workflow)
// ============================================================================

export interface Dispatch {
  id: string;
  product_id: string;
  quantity: number;
  dispatch_date: string;
  status: "DISPATCHED" | "PENDING";
  customer_id: string | null;
  customer_name: string;
  unit_price: number;
  remarks: string | null;
  created_at: string;
  product?: SanitaryProduct;
  parties?: { id: string; name: string };
}

export interface DispatchInvoice {
  id: string;
  invoice_no: string;
  dispatch_id: string;
  product_id: string;
  quantity_dispatched: number;
  unit_price: number;
  total_amount: number;
  status: "DISPATCHED_INVOICED" | "PAID";
  created_at: string;
  taxable_value_pkr?: number;
  sales_tax_rate?: number;
  sales_tax_amount_pkr?: number;
  further_tax_rate?: number;
  further_tax_amount_pkr?: number;
  additional_tax_rate?: number;
  additional_tax_amount_pkr?: number;
  product?: SanitaryProduct;
  dispatch?: Dispatch;
}

export interface DispatchTax {
  taxable_value_pkr: number;
  sales_tax_rate: number;
  sales_tax_amount_pkr: number;
  further_tax_rate: number;
  further_tax_amount_pkr: number;
  additional_tax_rate: number;
  additional_tax_amount_pkr: number;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getInvoiceTaxLines(
  invoice: DispatchInvoice
): Array<{ label: string; amount: number }> {
  const taxable = Number(invoice.taxable_value_pkr ?? 0);
  if (!(taxable > 0)) return [];
  const withRate = (label: string, rate?: number) =>
    typeof rate === "number" && rate > 0 ? `${label} (${rate}%)` : label;
  const lines: Array<{ label: string; amount: number }> = [
    { label: "Taxable Value", amount: taxable },
  ];
  const sales = Number(invoice.sales_tax_amount_pkr ?? 0);
  const further = Number(invoice.further_tax_amount_pkr ?? 0);
  const additional = Number(invoice.additional_tax_amount_pkr ?? 0);
  if (sales > 0) lines.push({ label: withRate("Sales Tax", invoice.sales_tax_rate), amount: sales });
  if (further > 0) lines.push({ label: withRate("Further Tax", invoice.further_tax_rate), amount: further });
  if (additional > 0)
    lines.push({ label: withRate("Additional Tax", invoice.additional_tax_rate), amount: additional });
  return lines;
}

export async function createDispatch(payload: {
  product_id: string;
  quantity: number;
  dispatch_date?: string;
  status?: "DISPATCHED" | "PENDING";
  customer_id?: string | null;
  customer_name?: string;
  unit_price: number;
  remarks?: string;
  tax?: DispatchTax;
}): Promise<{ dispatch: Dispatch | null; invoice: DispatchInvoice | null; error?: string }> {
  if (!SUPABASE_URL) return { dispatch: null, invoice: null, error: "Server URL is not configured" };

  // 1. Deduct stock
  const stockResult = await deductProductStock(payload.product_id, payload.quantity);
  if (!stockResult.ok) {
    return { dispatch: null, invoice: null, error: stockResult.error ?? "Stock deduction failed" };
  }

  // 2. Insert dispatch record
  const dispatchBody = {
    product_id: payload.product_id,
    quantity: payload.quantity,
    dispatch_date: payload.dispatch_date ?? new Date().toISOString().slice(0, 10),
    status: payload.status ?? "DISPATCHED",
    customer_id: payload.customer_id ?? null,
    customer_name: payload.customer_name ?? "",
    unit_price: payload.unit_price,
    remarks: payload.remarks ?? null,
  };

  const { data: dispatchData, text: dispatchText } = await parseResponse(
    await fetch(`${SUPABASE_URL}/rest/v1/dispatches`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(dispatchBody),
    })
  );
  if (!dispatchData) {
    return { dispatch: null, invoice: null, error: `Dispatch insert failed: ${dispatchText}` };
  }
  const dispatch = (Array.isArray(dispatchData) ? dispatchData[0] : dispatchData) as Dispatch;

  // 3. Create corresponding invoice
  const invoiceNo = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
  const tax = payload.tax;
  const subtotal = roundMoney(payload.quantity * payload.unit_price);
  const totalAmount = tax
    ? roundMoney(
        tax.taxable_value_pkr +
          tax.sales_tax_amount_pkr +
          tax.further_tax_amount_pkr +
          tax.additional_tax_amount_pkr
      )
    : subtotal;

  const invoiceBaseBody: Record<string, unknown> = {
    invoice_no: invoiceNo,
    dispatch_id: dispatch.id,
    product_id: payload.product_id,
    quantity_dispatched: payload.quantity,
    unit_price: payload.unit_price,
    total_amount: totalAmount,
    status: "DISPATCHED_INVOICED",
  };

  const invoiceTaxBody: Record<string, unknown> = tax
    ? {
        taxable_value_pkr: roundMoney(tax.taxable_value_pkr),
        sales_tax_rate: tax.sales_tax_rate,
        sales_tax_amount_pkr: roundMoney(tax.sales_tax_amount_pkr),
        further_tax_rate: tax.further_tax_rate,
        further_tax_amount_pkr: roundMoney(tax.further_tax_amount_pkr),
        additional_tax_rate: tax.additional_tax_rate,
        additional_tax_amount_pkr: roundMoney(tax.additional_tax_amount_pkr),
      }
    : {};

  async function insertInvoice(body: Record<string, unknown>) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    const { data, text } = await parseResponse(res);
    if (!res.ok || !data || !Array.isArray(data) || data.length === 0) {
      return { ok: false as const, text: text || `HTTP ${res.status}` };
    }
    return { ok: true as const, invoice: data[0] as DispatchInvoice, text };
  }

  let invoiceResult = await insertInvoice({ ...invoiceBaseBody, ...invoiceTaxBody });
  if (!invoiceResult.ok && tax && /column|PGRST204/i.test(invoiceResult.text)) {
    // Tax columns not migrated yet — persist the dispatch invoice without them.
    console.warn("invoices tax columns unavailable, saving invoice without tax breakdown:", invoiceResult.text);
    invoiceResult = await insertInvoice(invoiceBaseBody);
  }
  if (!invoiceResult.ok) {
    console.error("Invoice insert failed (dispatch already created):", invoiceResult.text);
    return { dispatch, invoice: null, error: `Dispatch saved but invoice failed: ${invoiceResult.text}` };
  }
  const invoice = invoiceResult.invoice;

  // 4. Audit log
  fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      node_id: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
      operator_name: "Inventory Dept",
      action_type: "DISPATCH_CREATED",
      details: {
        module: "INVENTORY",
        dispatch_id: dispatch.id,
        invoice_no: invoiceNo,
        product_id: payload.product_id,
        quantity: payload.quantity,
        ...(tax
          ? {
              taxable_value_pkr: tax.taxable_value_pkr,
              sales_tax_amount_pkr: tax.sales_tax_amount_pkr,
              further_tax_amount_pkr: tax.further_tax_amount_pkr,
              additional_tax_amount_pkr: tax.additional_tax_amount_pkr,
              total_amount: totalAmount,
            }
          : {}),
      },
    }),
  }).catch(() => {});

  return { dispatch, invoice };
}

export async function fetchDispatches(): Promise<Dispatch[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dispatches?select=*,product:sanitary_products(*),parties:customer_id(id,name)&order=created_at.desc&limit=200`,
      { headers: headers() }
    );
    const { data, text } = await parseResponse(res);
    if (!data) {
      console.error("Supabase Error [dispatches fetch]:", text);
      return [];
    }
    return (Array.isArray(data) ? data : []) as Dispatch[];
  } catch (err) {
    console.error("Supabase Error [fetchDispatches]:", err);
    return [];
  }
}

export async function fetchInvoicesWithDispatch(): Promise<DispatchInvoice[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?select=*,product:sanitary_products(*),dispatch:dispatches(*,parties:customer_id(id,name))&not.dispatch_id.is.null&order=created_at.desc&limit=200`,
      { headers: headers() }
    );
    const { data, text } = await parseResponse(res);
    if (!data) {
      console.error("Supabase Error [invoices fetch]:", text);
      return [];
    }
    return (Array.isArray(data) ? data : []) as DispatchInvoice[];
  } catch (err) {
    console.error("Supabase Error [fetchInvoicesWithDispatch]:", err);
    return [];
  }
}

export async function updateInvoiceStatus(
  invoiceId: string,
  status: "DISPATCHED_INVOICED" | "PAID"
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/invoices?id=eq.${invoiceId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=minimal" },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch (err) {
    console.error("Supabase Error [updateInvoiceStatus]:", err);
    return false;
  }
}

export function generateSlipInvoiceHTML(invoice: DispatchInvoice): string {
  const product = invoice.product;
  const dispatch = invoice.dispatch;
  const customerName = dispatch?.customer_name ?? dispatch?.parties?.name ?? "—";
  const dispatchDate = dispatch?.dispatch_date ?? invoice.created_at?.slice(0, 10) ?? "—";

  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8">
    <title>Slip Invoice ${invoice.invoice_no}</title>
    <style>
      @page { size: 80mm auto; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family:${SERIF_FONT_FAMILY_CSS};
        width: 80mm;
        padding: 4mm 3mm;
        color: #000;
        font-size: 11px;
        line-height: 1.4;
      }
      @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Regular.ttf') format('truetype');font-style:normal;font-weight:400;font-display:swap;}
      @font-face{font-family:'PT Serif';src:url('/fonts/PT_Serif-Web-Bold.ttf') format('truetype');font-style:normal;font-weight:700;font-display:swap;}
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .header { border-bottom: 2px dashed #000; padding-bottom: 4px; margin-bottom: 6px; }
      .company { font-size:27px;font-weight:700;letter-spacing:1px; }
      .company-logo { display: block; margin: 0 auto 2px auto; max-width: 40px; max-height: 40px; }
      .divider { border-top: 1px dashed #999; margin: 5px 0; }
      .row { display: flex; justify-content: space-between; padding: 1px 0; }
      .label { color: #555; }
      .total-row { border-top: 2px solid #000; margin-top: 4px; padding-top: 4px; font-size: 13px; }
      .footer { border-top: 2px dashed #000; margin-top: 8px; padding-top: 4px; font-size: 9px; text-align: center; color: #666; }
    </style></head><body>
    <div class="header center">
      ${getCompanyLogoHtml({ width: 40, height: 40, style: "display:block;margin:0 auto 2px auto;" })}
      <div class="company">${COMPANY_HEADER}</div>
      <div style="font-size:9px;color:#555;margin-top:2px;">SLIP INVOICE</div>
    </div>

    <div class="row"><span class="label">Invoice No:</span><span class="bold">${invoice.invoice_no}</span></div>
    <div class="row"><span class="label">Date:</span><span>${dispatchDate}</span></div>
    <div class="row"><span class="label">Customer:</span><span>${customerName}</span></div>

    <div class="divider"></div>

    <div class="row"><span class="label">Product:</span><span class="bold">${product?.name ?? "—"}</span></div>
    <div class="row"><span class="label">SKU:</span><span>${product?.sku ?? "—"}</span></div>
    <div class="row"><span class="label">Category:</span><span>${product?.category ?? "—"}</span></div>

    <div class="divider"></div>

    <div class="row"><span class="label">Quantity:</span><span class="bold">${invoice.quantity_dispatched}</span></div>
    <div class="row"><span class="label">Unit Price:</span><span>PKR ${invoice.unit_price.toLocaleString()}</span></div>
${
  getInvoiceTaxLines(invoice).length > 0
    ? `\n    <div class="divider"></div>\n` +
      getInvoiceTaxLines(invoice)
        .map((line) => `<div class="row"><span class="label">${line.label}:</span><span>PKR ${line.amount.toLocaleString()}</span></div>`)
        .join("\n    ")
    : ""
}

    <div class="total-row row">
      <span class="bold">TOTAL</span>
      <span class="bold">PKR ${invoice.total_amount.toLocaleString()}</span>
    </div>

    <div class="footer">
      <div>Thank you for your business!</div>
      <div style="margin-top:2px;">Generated by Glassco Sanitary Fittings</div>
      <div style="margin-top:14px;font-size:11px;text-align:center;color:#555;">${COMPANY_LEGAL_NAME}</div>
      <div>${new Date().toLocaleString("en-PK")}</div>
    </div>
    </body></html>`;
}

export async function triggerSlipPrint(invoice: DispatchInvoice): Promise<{ success: boolean; message: string }> {
  const html = generateSlipInvoiceHTML(invoice);
  const base64 = btoa(unescape(encodeURIComponent(html)));
  try {
    const { printPdfDocument } = await import("@/lib/tauri-bridge");
    return printPdfDocument("POS-80-Thermal", base64);
  } catch {
    return { success: false, message: "Print function not available in this environment." };
  }
}
