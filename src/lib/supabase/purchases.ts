import { SanitaryProduct } from "@/types";
import { InventoryLot } from "@/lib/supabase/inventory";

export interface ProductPurchase {
  id: string;
  purchase_number: string;
  purchase_date: string;
  supplier_id: string | null;
  supplier_name: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_of_measure: string;
  purchase_rate: number;
  discount_percent: number;
  discount_pkr: number;
  tax_rate: number;
  tax_amount_pkr: number;
  additional_cost_pkr: number;
  purchase_subtotal_pkr: number;
  purchase_total_pkr: number;
  effective_unit_cost_pkr: number;
  status: "draft" | "confirmed" | "cancelled";
  inventory_lot_id: string | null;
  journal_entry_id: string | null;
  notes: string | null;
  operator_name: string | null;
  device_node: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordPurchaseInput {
  purchase_date: string;
  supplier_id?: string | null;
  supplier_name: string;
  product_id: string;
  quantity: number;
  unit_of_measure?: string;
  purchase_rate: number;
  discount_percent?: number;
  discount_pkr?: number;
  tax_rate?: number;
  additional_cost_pkr?: number;
  status?: "draft" | "confirmed";
  notes?: string;
  operator_name?: string;
  /** Optional display metadata so client-side fallbacks store real names. */
  product_name?: string;
  sku?: string;
  /**
   * Client-generated key that identifies one submission attempt-session.
   * Replays return the original purchase instead of moving stock or posting
   * the ledger a second time (unique index on product_purchases.idempotency_key).
   */
  idempotency_key?: string;
}

export interface SupplierPriceComparison {
  supplier_id: string | null;
  supplier_name: string;
  latest_rate: number;
  min_rate: number;
  max_rate: number;
  avg_rate: number;
  total_qty: number;
  purchase_count: number;
  last_purchased_date: string;
  is_best_price: boolean;
}

export interface ProductCostMarginSummary {
  product_id: string;
  product_name: string;
  sku: string;
  category: string;
  selling_price: number;
  latest_purchase_rate: number;
  latest_supplier_name: string | null;
  fifo_unit_cost: number;
  weighted_avg_unit_cost: number;
  effective_cost: number;
  gross_profit: number;
  gross_margin_percent: number;
  markup_percent: number;
  total_purchased_qty: number;
  total_spent_pkr: number;
  purchase_count: number;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

/**
 * Pure calculation helper for purchase subtotal, discount, taxes, and landed cost.
 */
export function calculatePurchaseLine(params: {
  quantity: number;
  purchase_rate: number;
  discount_percent?: number;
  discount_pkr?: number;
  tax_rate?: number;
  additional_cost_pkr?: number;
}): {
  subtotal: number;
  discountAmount: number;
  netSubtotal: number;
  taxAmount: number;
  total: number;
  effectiveUnitCost: number;
} {
  const qty = Number(params.quantity) || 0;
  const rate = Number(params.purchase_rate) || 0;
  const discPct = Number(params.discount_percent) || 0;
  let discFlat = Number(params.discount_pkr) || 0;
  const taxRate = Number(params.tax_rate) || 0;
  const addCost = Number(params.additional_cost_pkr) || 0;

  const subtotal = Math.round(qty * rate * 100) / 100;

  if (discFlat <= 0 && discPct > 0) {
    discFlat = Math.round(subtotal * (discPct / 100) * 100) / 100;
  }
  const discountAmount = Math.min(subtotal, Math.max(0, discFlat));
  const netSubtotal = Math.round((subtotal - discountAmount) * 100) / 100;

  const taxAmount = taxRate > 0 ? Math.round(netSubtotal * (taxRate / 100) * 100) / 100 : 0;
  const total = Math.round((netSubtotal + taxAmount + addCost) * 100) / 100;

  const effectiveUnitCost =
    qty > 0 ? Math.round(((netSubtotal + addCost) / qty) * 100) / 100 : rate;

  return {
    subtotal,
    discountAmount,
    netSubtotal,
    taxAmount,
    total,
    effectiveUnitCost,
  };
}

/**
 * Pure calculation helper for profit margin and markup.
 * Handled safely with zero denominators and missing cost data.
 *
 * Requirements:
 * - Gross profit = net sales (excl. sales tax) - cost of goods sold.
 * - Gross margin % = (gross profit / net sales) * 100.
 * - Markup % = (gross profit / unit cost) * 100.
 */
export function calculateProfitMargins(params: {
  sellingPrice: number;
  unitCost: number;
  quantity?: number;
}): {
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  markupPercent: number;
} {
  const qty = params.quantity && params.quantity > 0 ? params.quantity : 1;
  const sp = Number(params.sellingPrice) || 0;
  const cost = Number(params.unitCost) || 0;

  const netSales = Math.round(sp * qty * 100) / 100;
  const cogs = Math.round(cost * qty * 100) / 100;
  const grossProfit = Math.round((netSales - cogs) * 100) / 100;

  // Gross Margin: grossProfit / netSales * 100 (if netSales <= 0 => 0)
  const grossMarginPercent =
    netSales > 0 ? Math.round((grossProfit / netSales) * 10000) / 100 : 0;

  // Markup: grossProfit / cogs * 100 (if cogs <= 0 => 0)
  const markupPercent =
    cogs > 0 ? Math.round((grossProfit / cogs) * 10000) / 100 : 0;

  return {
    netSales,
    cogs,
    grossProfit,
    grossMarginPercent,
    markupPercent,
  };
}

/**
 * Fetch all purchases with optional filtering.
 */
export async function fetchProductPurchases(filter?: {
  productId?: string;
  supplierId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}): Promise<ProductPurchase[]> {
  if (!SUPABASE_URL) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/product_purchases?select=*&order=purchase_date.desc,created_at.desc`;

    if (filter?.productId) {
      url += `&product_id=eq.${filter.productId}`;
    }
    if (filter?.supplierId) {
      url += `&supplier_id=eq.${filter.supplierId}`;
    }
    if (filter?.startDate) {
      url += `&purchase_date=gte.${filter.startDate}`;
    }
    if (filter?.endDate) {
      url += `&purchase_date=lte.${filter.endDate}`;
    }
    if (filter?.status) {
      url += `&status=eq.${filter.status}`;
    }

    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      console.warn("Supabase Warning [product_purchases]:", res.status);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as ProductPurchase[]) : [];
  } catch (err) {
    console.error("Supabase Error [fetchProductPurchases]:", err);
    return [];
  }
}

/**
 * Compute supplier-wise price comparisons for a specific product.
 * Only CONFIRMED purchases count: a draft is not a real price commitment and
 * a cancelled one never happened, so neither may set latest/min/best rate.
 */
export function computeSupplierPriceComparisons(
  purchases: ProductPurchase[]
): SupplierPriceComparison[] {
  const activePurchases = purchases.filter((p) => p.status === "confirmed");
  const bySupplier = new Map<string, ProductPurchase[]>();

  for (const p of activePurchases) {
    const key = p.supplier_id || p.supplier_name;
    const existing = bySupplier.get(key) || [];
    existing.push(p);
    bySupplier.set(key, existing);
  }

  const results: SupplierPriceComparison[] = [];
  let minEverRate = Infinity;

  for (const [_, list] of bySupplier.entries()) {
    // Sort latest first
    list.sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));

    const supplierId = list[0].supplier_id;
    const supplierName = list[0].supplier_name;
    const latestRate = Number(list[0].purchase_rate) || 0;
    const lastPurchasedDate = list[0].purchase_date;

    let minRate = Infinity;
    let maxRate = -Infinity;
    let sumRate = 0;
    let totalQty = 0;

    for (const item of list) {
      const r = Number(item.purchase_rate) || 0;
      const q = Number(item.quantity) || 0;
      if (r < minRate) minRate = r;
      if (r > maxRate) maxRate = r;
      if (r < minEverRate) minEverRate = r;
      sumRate += r * q;
      totalQty += q;
    }

    const avgRate = totalQty > 0 ? Math.round((sumRate / totalQty) * 100) / 100 : latestRate;

    results.push({
      supplier_id: supplierId,
      supplier_name: supplierName,
      latest_rate: latestRate,
      min_rate: minRate === Infinity ? 0 : minRate,
      max_rate: maxRate === -Infinity ? 0 : maxRate,
      avg_rate: avgRate,
      total_qty: totalQty,
      purchase_count: list.length,
      last_purchased_date: lastPurchasedDate,
      is_best_price: false,
    });
  }

  // Set is_best_price
  for (const r of results) {
    if (r.latest_rate === minEverRate || r.min_rate === minEverRate) {
      r.is_best_price = true;
    }
  }

  return results.sort((a, b) => a.latest_rate - b.latest_rate);
}

/**
 * Compute product cost and margin summary across costing methods (FIFO, Moving Avg, Latest).
 */
export function computeProductCostAndMargin(
  product: SanitaryProduct,
  purchases: ProductPurchase[],
  lots: InventoryLot[] = []
): ProductCostMarginSummary {
  // Confirmed only: drafts never increased stock or landed cost, cancelled
  // purchases never happened. Costs still come from real lots first (FIFO/WAC).
  const activePurchases = purchases
    .filter((p) => p.product_id === product.id && p.status === "confirmed")
    .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));

  const latestPurchase = activePurchases[0] || null;
  const latestRate = latestPurchase ? Number(latestPurchase.purchase_rate) : 0;
  const latestSupplier = latestPurchase ? latestPurchase.supplier_name : null;

  // Active lots for this product (FIFO order by created_at)
  const productLots = lots
    .filter((l) => l.product_id === product.id && l.remaining_qty > 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // 1. FIFO Unit Cost: unit cost from oldest active inventory lot
  let fifoCost = 0;
  if (productLots.length > 0) {
    fifoCost = Number(productLots[0].unit_cost_pkr) || 0;
  } else if (latestPurchase) {
    fifoCost = Number(latestPurchase.effective_unit_cost_pkr) || latestRate;
  }

  // 2. Weighted Average Cost across remaining lots
  let totalLotQty = 0;
  let totalLotVal = 0;
  for (const l of productLots) {
    const q = Number(l.remaining_qty);
    const c = Number(l.unit_cost_pkr);
    totalLotQty += q;
    totalLotVal += q * c;
  }
  const weightedAvgCost =
    totalLotQty > 0 ? Math.round((totalLotVal / totalLotQty) * 100) / 100 : fifoCost;

  // 3. Effective Cost used for primary margins (uses FIFO if lots exist, else WAC or latest)
  const effectiveCost = fifoCost > 0 ? fifoCost : weightedAvgCost > 0 ? weightedAvgCost : latestRate;

  // 4. Margins & Markup
  const margins = calculateProfitMargins({
    sellingPrice: product.unit_price,
    unitCost: effectiveCost,
  });

  // Aggregated purchase volume
  let totalQty = 0;
  let totalSpent = 0;
  for (const p of activePurchases) {
    totalQty += Number(p.quantity) || 0;
    totalSpent += Number(p.purchase_total_pkr) || 0;
  }

  return {
    product_id: product.id,
    product_name: product.name,
    sku: product.sku,
    category: product.category,
    selling_price: product.unit_price,
    latest_purchase_rate: latestRate,
    latest_supplier_name: latestSupplier,
    fifo_unit_cost: fifoCost,
    weighted_avg_unit_cost: weightedAvgCost,
    effective_cost: effectiveCost,
    gross_profit: margins.grossProfit,
    gross_margin_percent: margins.grossMarginPercent,
    markup_percent: margins.markupPercent,
    total_purchased_qty: totalQty,
    total_spent_pkr: totalSpent,
    purchase_count: activePurchases.length,
  };
}

/* ─── Purchase reports (by product / supplier / date range) ───────────────── */

export interface PurchaseReportFilter {
  startDate?: string;
  endDate?: string;
  productId?: string;
  supplierId?: string;
  /** Defaults to including every status; use to isolate drafts or confirmed rows. */
  status?: ProductPurchase["status"];
}

export interface PurchaseReportRow {
  group_key: string;
  group_label: string;
  sku: string | null;
  purchase_count: number;
  draft_count: number;
  confirmed_count: number;
  cancelled_count: number;
  total_quantity: number;
  total_subtotal_pkr: number;
  total_discount_pkr: number;
  total_tax_pkr: number;
  total_additional_cost_pkr: number;
  total_purchase_pkr: number;
  avg_rate: number;
  min_rate: number;
  max_rate: number;
  latest_rate: number;
  latest_date: string;
}

export interface PurchaseReportTotals {
  purchase_count: number;
  total_quantity: number;
  total_subtotal_pkr: number;
  total_discount_pkr: number;
  total_tax_pkr: number;
  total_additional_cost_pkr: number;
  total_purchase_pkr: number;
  /**
   * Draft rows are deliberately included in the totals above (they are visible
   * commitments until cancelled); these fields let consumers state the draft
   * share explicitly so totals are never mistaken for posted-ledger figures.
   */
  draft_count: number;
  draft_total_pkr: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Pure filter: product, supplier, date range, and status. Date strings compare lexicographically (ISO). */
export function filterPurchases(
  purchases: ProductPurchase[],
  filter: PurchaseReportFilter = {}
): ProductPurchase[] {
  return purchases.filter((p) => {
    if (filter.productId && p.product_id !== filter.productId) return false;
    if (filter.supplierId && p.supplier_id !== filter.supplierId) return false;
    if (filter.status && p.status !== filter.status) return false;
    if (filter.startDate && p.purchase_date < filter.startDate) return false;
    if (filter.endDate && p.purchase_date > filter.endDate) return false;
    return true;
  });
}

function buildPurchaseReport(
  purchases: ProductPurchase[],
  selector: (p: ProductPurchase) => { key: string; label: string; sku: string | null }
): PurchaseReportRow[] {
  const groups = new Map<string, { label: string; sku: string | null; items: ProductPurchase[] }>();

  for (const p of purchases) {
    const { key, label, sku } = selector(p);
    const g = groups.get(key) ?? { label, sku, items: [] };
    g.items.push(p);
    groups.set(key, g);
  }

  const rows: PurchaseReportRow[] = [];
  for (const [key, g] of groups.entries()) {
    let draft = 0;
    let confirmed = 0;
    let cancelled = 0;
    let qty = 0;
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    let additional = 0;
    let total = 0;
    let weightedRate = 0;
    let rateQty = 0;
    let minRate = Infinity;
    let maxRate = -Infinity;
    let latestRate = 0;
    let latestDate = "";

    for (const p of g.items) {
      if (p.status === "draft") draft++;
      else if (p.status === "confirmed") confirmed++;
      else cancelled++;

      // Cancelled purchases never affect financial totals (they post nothing).
      if (p.status === "cancelled") continue;

      const rate = Number(p.purchase_rate) || 0;
      const q = Number(p.quantity) || 0;
      qty += q;
      subtotal += Number(p.purchase_subtotal_pkr) || 0;
      discount += Number(p.discount_pkr) || 0;
      tax += Number(p.tax_amount_pkr) || 0;
      additional += Number(p.additional_cost_pkr) || 0;
      total += Number(p.purchase_total_pkr) || 0;
      weightedRate += rate * q;
      rateQty += q;
      if (rate < minRate) minRate = rate;
      if (rate > maxRate) maxRate = rate;
      if (p.purchase_date >= latestDate) {
        latestDate = p.purchase_date;
        latestRate = rate;
      }
    }

    rows.push({
      group_key: key,
      group_label: g.label,
      sku: g.sku,
      purchase_count: g.items.length,
      draft_count: draft,
      confirmed_count: confirmed,
      cancelled_count: cancelled,
      total_quantity: round2(qty),
      total_subtotal_pkr: round2(subtotal),
      total_discount_pkr: round2(discount),
      total_tax_pkr: round2(tax),
      total_additional_cost_pkr: round2(additional),
      total_purchase_pkr: round2(total),
      avg_rate: rateQty > 0 ? round2(weightedRate / rateQty) : 0,
      min_rate: minRate === Infinity ? 0 : minRate,
      max_rate: maxRate === -Infinity ? 0 : maxRate,
      latest_rate: latestRate,
      latest_date: latestDate,
    });
  }

  // Largest spend first; stable alphabetical tiebreak for determinism.
  return rows.sort(
    (a, b) => b.total_purchase_pkr - a.total_purchase_pkr || a.group_label.localeCompare(b.group_label)
  );
}

/** Purchase report grouped by product (optionally filtered by supplier / date range). */
export function buildPurchaseReportByProduct(
  purchases: ProductPurchase[],
  filter?: PurchaseReportFilter
): PurchaseReportRow[] {
  return buildPurchaseReport(filterPurchases(purchases, filter), (p) => ({
    key: p.product_id,
    label: p.product_name,
    sku: p.sku || null,
  }));
}

/** Purchase report grouped by supplier (optionally filtered by product / date range). */
export function buildPurchaseReportBySupplier(
  purchases: ProductPurchase[],
  filter?: PurchaseReportFilter
): PurchaseReportRow[] {
  return buildPurchaseReport(filterPurchases(purchases, filter), (p) => ({
    key: p.supplier_id || p.supplier_name,
    label: p.supplier_name,
    sku: null,
  }));
}

/** Grand totals for the given (optionally filtered) purchase set. Cancelled rows are excluded. */
export function summarizePurchases(
  purchases: ProductPurchase[],
  filter?: PurchaseReportFilter
): PurchaseReportTotals {
  const list = filterPurchases(purchases, filter);
  let purchase_count = 0;
  let total_quantity = 0;
  let total_subtotal_pkr = 0;
  let total_discount_pkr = 0;
  let total_tax_pkr = 0;
  let total_additional_cost_pkr = 0;
  let total_purchase_pkr = 0;
  let draft_count = 0;
  let draft_total_pkr = 0;

  for (const p of list) {
    if (p.status === "cancelled") continue;
    purchase_count++;
    total_quantity += Number(p.quantity) || 0;
    total_subtotal_pkr += Number(p.purchase_subtotal_pkr) || 0;
    total_discount_pkr += Number(p.discount_pkr) || 0;
    total_tax_pkr += Number(p.tax_amount_pkr) || 0;
    total_additional_cost_pkr += Number(p.additional_cost_pkr) || 0;
    total_purchase_pkr += Number(p.purchase_total_pkr) || 0;
    if (p.status === "draft") {
      draft_count++;
      draft_total_pkr += Number(p.purchase_total_pkr) || 0;
    }
  }

  return {
    purchase_count,
    total_quantity: round2(total_quantity),
    total_subtotal_pkr: round2(total_subtotal_pkr),
    total_discount_pkr: round2(total_discount_pkr),
    total_tax_pkr: round2(total_tax_pkr),
    total_additional_cost_pkr: round2(total_additional_cost_pkr),
    total_purchase_pkr: round2(total_purchase_pkr),
    draft_count,
    draft_total_pkr: round2(draft_total_pkr),
  };
}

/**
 * Record a new product purchase.
 */
export async function recordProductPurchase(
  input: RecordPurchaseInput
): Promise<{ data: ProductPurchase | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };

  try {
    // Authoritative path: the RPC writes the purchase, the stock update, and
    // the balanced Dr Inventory / Cr AP entry in ONE transaction, and treats a
    // repeated idempotency_key as a replay instead of a second posting.
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_and_confirm_purchase`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_payload: input }),
    });

    if (rpcRes.ok) {
      const data = await rpcRes.json();
      return { data: data as ProductPurchase, error: null };
    }

    const rpcStatus = rpcRes.status;
    const rpcBody = await rpcRes.text().catch(() => "");
    let rpcCode: string | undefined;
    let rpcMessage = rpcBody;
    try {
      const parsed = JSON.parse(rpcBody);
      rpcCode = typeof parsed.code === "string" ? parsed.code : undefined;
      rpcMessage = parsed.message || parsed.error_description || rpcBody;
    } catch {
      /* non-JSON error body — keep the raw text */
    }

    // ONLY "the function does not exist" may fall back to a direct insert.
    const rpcMissing =
      rpcStatus === 404 || rpcStatus === 405 || rpcCode === "PGRST202" || rpcCode === "42883";

    if (!rpcMissing) {
      // Server-side validation / FK / ledger failure: surface it. Silently
      // falling back to a bare insert would bypass validation and record a
      // confirmed purchase without moving stock or posting the ledger.
      return { data: null, error: rpcMessage || `Purchase RPC failed (HTTP ${rpcStatus}).` };
    }

    if ((input.status || "confirmed") !== "draft") {
      // A confirmed purchase MUST move stock and post to the ledger; without
      // the RPC we cannot honour that, so fail loudly instead of corrupting data.
      return {
        data: null,
        error:
          "Purchase RPC 'record_and_confirm_purchase' is not installed. Apply supabase/migrations 20261103010000 and 20261104010000 before recording confirmed purchases.",
      };
    }

    // Migrations not applied yet: drafts never touch stock or the ledger, so a
    // direct insert is semantically complete for them.
    const metrics = calculatePurchaseLine({
      quantity: input.quantity,
      purchase_rate: input.purchase_rate,
      discount_percent: input.discount_percent,
      discount_pkr: input.discount_pkr,
      tax_rate: input.tax_rate,
      additional_cost_pkr: input.additional_cost_pkr,
    });

    const year = new Date().getFullYear();
    const purchaseNumber = `PUR-${year}-${Date.now().toString().slice(-5)}`;

    const row = {
      purchase_number: purchaseNumber,
      purchase_date: input.purchase_date,
      supplier_id: input.supplier_id || null,
      supplier_name: input.supplier_name,
      product_id: input.product_id,
      product_name: input.product_name || "Product",
      sku: input.sku || "SKU",
      quantity: input.quantity,
      unit_of_measure: input.unit_of_measure || "PCS",
      purchase_rate: input.purchase_rate,
      discount_percent: input.discount_percent || 0,
      discount_pkr: metrics.discountAmount,
      tax_rate: input.tax_rate || 0,
      tax_amount_pkr: metrics.taxAmount,
      additional_cost_pkr: input.additional_cost_pkr || 0,
      purchase_subtotal_pkr: metrics.subtotal,
      purchase_total_pkr: metrics.total,
      effective_unit_cost_pkr: metrics.effectiveUnitCost,
      status: "draft",
      notes: input.notes || null,
      operator_name: input.operator_name || "Purchasing Dept",
      idempotency_key: input.idempotency_key || null,
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/product_purchases`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(row),
    });

    if (!res.ok) {
      const body = await res.text();
      // HTTP 409 = unique violation (idempotency_key replayed or duplicate number).
      if (res.status === 409 && input.idempotency_key) {
        const existingRes = await fetch(
          `${SUPABASE_URL}/rest/v1/product_purchases?select=*&idempotency_key=eq.${encodeURIComponent(
            input.idempotency_key
          )}&limit=1`,
          { headers: headers() }
        );
        if (existingRes.ok) {
          const rows = await existingRes.json();
          if (Array.isArray(rows) && rows.length > 0) {
            return { data: rows[0] as ProductPurchase, error: null };
          }
        }
      }
      return { data: null, error: body };
    }

    const data = await res.json();
    return { data: data[0] as ProductPurchase, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
