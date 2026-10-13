/**
 * Quotation Management — client library.
 *
 * A quotation is a commercial offer, NOT a sale: creating, editing, issuing,
 * accepting, printing or cancelling one never writes to the general ledger,
 * never changes customer balances and never moves stock. The only bridge to the
 * sales workflow is `convertQuotationToInvoice`, which delegates to the existing
 * invoice creation workflow (`createInvoice`) exactly once — guarded by the
 * unique index on `sales_invoices.quotation_id` (migration 20261105010000).
 *
 * Calculation rules mirror `quotation_compute_totals()` in the migration:
 *   line gross    = quantity × unit_price
 *   line discount = flat amount when set, otherwise percent of gross (≤ gross)
 *   line net      = gross − discount
 *   line tax      = net × tax_rate%      line total = net + tax
 *   subtotal      = Σ gross             discount = Σ line discounts
 *   taxable net   = subtotal − discount
 *   grand total   = taxable net + Σ tax + additional charges
 *   margin%       = (net − estimated cost) / net × 100   (0 when net ≤ 0)
 */

import {
  createCustomer,
  createInvoice,
  type DispatchLineItem,
  type Party,
  type SalesInvoice,
} from "@/lib/supabase/invoicing";
import { fetchProductPurchases } from "@/lib/supabase/purchases";
import type { UserRole } from "@/lib/supabase/auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/* ─── Statuses ─────────────────────────────────────────────────────────────── */

export type QuotationStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export const QUOTATION_STATUSES: QuotationStatus[] = [
  "DRAFT",
  "ISSUED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued / Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

/**
 * Valid status transitions — mirrors `quotation_transition_allowed()` in the
 * migration (tests assert both stay in sync).
 *
 *   DRAFT     → ISSUED, CANCELLED
 *   ISSUED    → ACCEPTED, REJECTED, EXPIRED, CANCELLED
 *   ACCEPTED  → CANCELLED
 *   REJECTED  → DRAFT (revise), CANCELLED
 *   EXPIRED   → DRAFT (revise), CANCELLED
 *   CANCELLED → (terminal)
 * A converted quotation is locked entirely.
 */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["CANCELLED"],
  REJECTED: ["DRAFT", "CANCELLED"],
  EXPIRED: ["DRAFT", "CANCELLED"],
  CANCELLED: [],
};

export function canTransitionQuotation(
  from: QuotationStatus,
  to: QuotationStatus,
): boolean {
  return (QUOTATION_TRANSITIONS[from] ?? []).includes(to);
}

/** DRAFT and ISSUED quotations may be revised; decided ones are locked. */
export function isQuotationEditable(status: QuotationStatus): boolean {
  return status === "DRAFT" || status === "ISSUED";
}

export function isQuotationConverted(
  q: Pick<Quotation, "converted_invoice_id">,
): boolean {
  return Boolean(q.converted_invoice_id);
}

/**
 * Display status: an ISSUED quotation past its validity date reads EXPIRED
 * even before anyone flips the stored status.
 */
export function effectiveQuotationStatus(
  q: Pick<Quotation, "status" | "valid_until">,
  today: string = new Date().toISOString().slice(0, 10),
): QuotationStatus {
  if (
    q.status === "ISSUED" &&
    q.valid_until &&
    q.valid_until.length >= 10 &&
    q.valid_until.slice(0, 10) < today
  ) {
    return "EXPIRED";
  }
  return q.status;
}

/* ─── Types ────────────────────────────────────────────────────────────────── */

export interface QuotationItem {
  id?: string;
  quotation_id?: string;
  product_id?: string | null;
  product_code?: string | null;
  product_name: string;
  description?: string | null;
  unit?: string | null;
  quantity: number;
  unit_price_pkr: number;
  discount_percent?: number;
  discount_pkr?: number;
  tax_rate?: number;
  tax_amount_pkr?: number;
  line_total_pkr?: number;
  estimated_unit_cost_pkr?: number;
  sort_order?: number;
}

export interface Quotation {
  id: string;
  quotation_number: string;
  quotation_date: string;
  valid_until?: string | null;
  customer_id?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  status: QuotationStatus;
  subtotal_pkr: number;
  discount_pkr: number;
  tax_amount_pkr: number;
  additional_charges_pkr: number;
  grand_total_pkr: number;
  terms?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  /** Internal estimates — OWNER only, never printed on customer documents. */
  estimated_cost_pkr: number;
  estimated_profit_pkr: number;
  margin_percent: number;
  converted_invoice_id?: string | null;
  converted_at?: string | null;
  issued_at?: string | null;
  operator_name?: string | null;
  device_node?: string | null;
  created_at: string;
  updated_at: string;
  items?: QuotationItem[];
  customer?: Partial<Party> | null;
  invoice?: { id: string; invoice_number: string; is_posted?: boolean } | null;
}

export interface QuotationDraftInput {
  quotation_date?: string;
  valid_until?: string | null;
  customer_id?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  additional_charges_pkr?: number;
  terms?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  operator_name?: string | null;
  device_node?: string | null;
  items: QuotationItem[];
}

/* ─── Calculations (mirror quotation_compute_totals) ───────────────────────── */

export interface QuotationLineCalculation {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  lineTotal: number;
  estimatedCost: number;
  estimatedProfit: number;
}

export function calculateQuotationLine(item: QuotationItem): QuotationLineCalculation {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unit_price_pkr) || 0;
  const gross = round2(qty * price);
  const pct = Number(item.discount_percent) || 0;
  const flat = Number(item.discount_pkr) || 0;
  const discount = Math.min(
    gross,
    flat > 0 ? round2(flat) : round2((gross * pct) / 100),
  );
  const net = round2(gross - discount);
  const rate = Number(item.tax_rate) || 0;
  const tax = round2((net * rate) / 100);
  const lineTotal = round2(net + tax);
  const estimatedCost = round2(qty * (Number(item.estimated_unit_cost_pkr) || 0));
  return {
    gross,
    discount,
    net,
    tax,
    lineTotal,
    estimatedCost,
    estimatedProfit: round2(net - estimatedCost),
  };
}

export interface QuotationTotals {
  subtotal_pkr: number;
  discount_pkr: number;
  taxable_net_pkr: number;
  tax_amount_pkr: number;
  additional_charges_pkr: number;
  grand_total_pkr: number;
  estimated_cost_pkr: number;
  estimated_profit_pkr: number;
  margin_percent: number;
  markup_percent: number;
}

export function calculateQuotationTotals(
  items: QuotationItem[],
  additionalChargesPkr = 0,
): QuotationTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let cost = 0;
  for (const item of items ?? []) {
    const line = calculateQuotationLine(item);
    subtotal += line.gross;
    discount += line.discount;
    tax += line.tax;
    cost += line.estimatedCost;
  }
  subtotal = round2(subtotal);
  discount = round2(discount);
  tax = round2(tax);
  cost = round2(cost);
  const charges = Math.max(0, round2(Number(additionalChargesPkr) || 0));
  const net = round2(subtotal - discount);
  const grand = round2(net + tax + charges);
  const profit = round2(net - cost);
  return {
    subtotal_pkr: subtotal,
    discount_pkr: discount,
    taxable_net_pkr: net,
    tax_amount_pkr: tax,
    additional_charges_pkr: charges,
    grand_total_pkr: grand,
    estimated_cost_pkr: cost,
    estimated_profit_pkr: profit,
    // Zero-denominator safe: no profit is ever "100%" off an empty base.
    margin_percent: net > 0 ? round2((profit / net) * 100) : 0,
    markup_percent: cost > 0 ? round2((profit / cost) * 100) : 0,
  };
}

/* ─── Validation (client mirror of the RPC's server-side checks) ───────────── */

export function validateQuotationDraft(draft: QuotationDraftInput): string[] {
  const errors: string[] = [];
  if (!draft.customer_name || !draft.customer_name.trim()) {
    errors.push("Customer name is required.");
  }
  const date = (draft.quotation_date ?? "").slice(0, 10);
  const valid = (draft.valid_until ?? "").slice(0, 10);
  if (date && valid && valid < date) {
    errors.push("Valid-until date cannot be before the quotation date.");
  }
  if (!draft.items || draft.items.length === 0) {
    errors.push("Add at least one line item.");
  }
  (draft.items ?? []).forEach((item, i) => {
    const label = `Line ${i + 1}`;
    if (!item.product_name || !item.product_name.trim()) {
      errors.push(`${label}: product name is required.`);
    }
    if (!(Number(item.quantity) > 0)) {
      errors.push(`${label}: quantity must be greater than zero.`);
    }
    if ((Number(item.unit_price_pkr) || 0) < 0) {
      errors.push(`${label}: unit price cannot be negative.`);
    }
    const pct = Number(item.discount_percent) || 0;
    if (pct < 0 || pct > 100) {
      errors.push(`${label}: discount percent must be between 0 and 100.`);
    }
    if ((Number(item.discount_pkr) || 0) < 0) {
      errors.push(`${label}: discount amount cannot be negative.`);
    }
    const rate = Number(item.tax_rate) || 0;
    if (rate < 0 || rate > 100) {
      errors.push(`${label}: tax rate must be between 0 and 100.`);
    }
    if ((Number(item.estimated_unit_cost_pkr) || 0) < 0) {
      errors.push(`${label}: estimated cost cannot be negative.`);
    }
  });
  if ((Number(draft.additional_charges_pkr) || 0) < 0) {
    errors.push("Additional charges cannot be negative.");
  }
  return errors;
}

/* ─── Permissions ───────────────────────────────────────────────────────────── */

type RoleLike = UserRole | null | undefined;

export function canCreateQuotation(role: RoleLike): boolean {
  return role === "OWNER" || role === "TERMINAL";
}

export function canEditQuotation(role: RoleLike): boolean {
  return role === "OWNER" || role === "TERMINAL";
}

/** DRAFT → ISSUED (sending the offer) is routine for both roles. */
export function canIssueQuotation(role: RoleLike): boolean {
  return role === "OWNER" || role === "TERMINAL";
}

/**
 * Changing a quoted rate below the catalog default requires OWNER. The product
 * default selling price is never modified either way — quote rates live only
 * on the quotation line.
 */
export function canAdjustQuotedRate(role: RoleLike): boolean {
  return role === "OWNER";
}

/** Accept / reject / expire / cancel decisions. */
export function canDecideQuotation(role: RoleLike): boolean {
  return role === "OWNER";
}

/** Reverting a decided quotation back to DRAFT for revision. */
export function canRevertQuotation(role: RoleLike): boolean {
  return role === "OWNER";
}

/** Converting creates a real invoice + stock movement — OWNER only. */
export function canConvertQuotation(role: RoleLike): boolean {
  return role === "OWNER";
}

/** Internal cost / profit / margin panel. */
export function canViewQuotationMargins(role: RoleLike): boolean {
  return role === "OWNER";
}

/** Which role is allowed to move a quotation to `next`. */
export function canSetQuotationStatus(
  role: RoleLike,
  next: QuotationStatus,
): boolean {
  if (next === "ISSUED") return canIssueQuotation(role);
  if (next === "DRAFT") return canRevertQuotation(role);
  return canDecideQuotation(role);
}

/* ─── Conversion eligibility ───────────────────────────────────────────────── */

export interface ConvertCheck {
  ok: boolean;
  reason?: string;
  alreadyConverted?: boolean;
}

export function checkQuotationConvertible(
  q: Quotation,
  role: RoleLike,
): ConvertCheck {
  if (!canConvertQuotation(role)) {
    return {
      ok: false,
      reason: "Only an OWNER account can convert quotations to invoices.",
    };
  }
  if (q.converted_invoice_id) {
    return {
      ok: false,
      reason: `Quotation ${q.quotation_number} is already converted to an invoice.`,
      alreadyConverted: true,
    };
  }
  const status = effectiveQuotationStatus(q);
  if (status === "REJECTED" || status === "EXPIRED" || status === "CANCELLED") {
    return {
      ok: false,
      reason: `A ${QUOTATION_STATUS_LABELS[status].toLowerCase()} quotation cannot be converted to an invoice.`,
    };
  }
  if (!q.items || q.items.length === 0) {
    return { ok: false, reason: "The quotation has no line items." };
  }
  if (!q.customer_name || !q.customer_name.trim()) {
    return { ok: false, reason: "The quotation has no customer." };
  }
  return { ok: true };
}

/** Name of the synthetic invoice line that carries quotation extra charges. */
export const ADDITIONAL_CHARGES_LINE_NAME = "Additional Charges";

/**
 * Maps a quotation onto the existing invoice creation contract:
 *   taxable value       = Σ line nets (+ additional charges as an untaxed line)
 *   sales tax           = Σ quotation line taxes (effective rate derived)
 *   further tax         = 0
 *   total               = taxable + sales tax === quotation grand total
 * Invoice line totals are stored net of their line discount — the same
 * convention `InvoiceGenerator.toDispatchItems()` uses.
 */
export function mapQuotationToInvoicePayload(
  q: Quotation,
): {
  taxable_value_pkr: number;
  sales_tax_rate: number;
  sales_tax_amount_pkr: number;
  further_tax_rate: number;
  further_tax_amount_pkr: number;
  total_invoice_value_pkr: number;
  discount_pkr: number;
  discount_percent: number;
  items: DispatchLineItem[];
} {
  const items: DispatchLineItem[] = (q.items ?? []).map((item) => {
    const line = calculateQuotationLine(item);
    return {
      product_id: item.product_id ?? "",
      product_name: item.product_name,
      quantity: Number(item.quantity) || 0,
      unit_price_pkr: Number(item.unit_price_pkr) || 0,
      line_total_pkr: line.net,
      unit_of_measure: item.unit || "PCS",
      discount_percent: Number(item.discount_percent) || 0,
      discount_pkr: line.discount,
    };
  });

  const charges = Math.max(0, round2(Number(q.additional_charges_pkr) || 0));
  if (charges > 0) {
    // Quotation extra charges are untaxed and travel as their own line so the
    // invoice total matches the quoted grand total exactly.
    items.push({
      product_id: "",
      product_name: ADDITIONAL_CHARGES_LINE_NAME,
      quantity: 1,
      unit_price_pkr: charges,
      line_total_pkr: charges,
      unit_of_measure: "LOT",
      discount_percent: 0,
      discount_pkr: 0,
    });
  }

  const taxable = round2(
    items.reduce((sum, item) => sum + (Number(item.line_total_pkr) || 0), 0),
  );
  const tax = Math.max(0, round2(Number(q.tax_amount_pkr) || 0));
  const rate = taxable > 0 ? round2((tax / taxable) * 100) : 0;

  return {
    taxable_value_pkr: taxable,
    sales_tax_rate: rate,
    sales_tax_amount_pkr: tax,
    further_tax_rate: 0,
    further_tax_amount_pkr: 0,
    total_invoice_value_pkr: round2(taxable + tax),
    discount_pkr: 0,
    discount_percent: 0,
    items,
  };
}

/* ─── Low-level REST / RPC plumbing ────────────────────────────────────────── */

interface ApiFailure {
  ok: false;
  error: string;
  /** True when the migration's RPC is missing/not applied yet. */
  missing?: boolean;
}
interface ApiOk<T> {
  ok: true;
  data: T;
}
type ApiResult<T> = ApiOk<T> | ApiFailure;

function extractError(body: unknown, text: string, fallback: string): string {
  const b = (body ?? {}) as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
    error?: string;
  };
  return (
    b.message ||
    b.error ||
    [b.details, b.hint].filter(Boolean).join(" — ") ||
    (text ? text.slice(0, 300) : fallback)
  );
}

function isMissingRpc(status: number, body: unknown): boolean {
  const code = (body as { code?: string })?.code ?? "";
  return (
    status === 404 ||
    status === 405 ||
    code === "PGRST202" ||
    code === "42883"
  );
}

async function rpcCall<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<ApiResult<T>> {
  if (!SUPABASE_URL) return { ok: false, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(args),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      if (isMissingRpc(res.status, body)) {
        return {
          ok: false,
          error: `Database function ${fn}() is missing — run migration 20261105010000_quotation_management.sql.`,
          missing: true,
        };
      }
      return { ok: false, error: extractError(body, text, `${fn} failed`) };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

async function restRequest<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<ApiResult<T>> {
  if (!SUPABASE_URL) return { ok: false, error: "Server URL is not configured" };
  try {
    const { body, method } = init;
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: { ...headers(), Prefer: "return=representation" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      return { ok: false, error: extractError(parsed, text, "Request failed") };
    }
    return { ok: true, data: parsed as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/* ─── Payload builders ─────────────────────────────────────────────────────── */

function buildPayload(
  draft: QuotationDraftInput,
): Record<string, unknown> {
  return {
    quotation_date: (draft.quotation_date ?? "").slice(0, 10) || undefined,
    valid_until: draft.valid_until ? draft.valid_until.slice(0, 10) : null,
    customer_id: draft.customer_id ?? null,
    customer_name: draft.customer_name?.trim() ?? "",
    customer_phone: draft.customer_phone ?? null,
    customer_address: draft.customer_address ?? null,
    additional_charges_pkr: Number(draft.additional_charges_pkr) || 0,
    terms: draft.terms ?? null,
    notes: draft.notes ?? null,
    internal_notes: draft.internal_notes ?? null,
    operator_name: draft.operator_name ?? null,
    device_node: draft.device_node ?? null,
    items: (draft.items ?? []).map((item) => ({
      product_id: item.product_id ?? null,
      product_code: item.product_code ?? null,
      product_name: item.product_name?.trim() ?? "",
      description: item.description ?? null,
      unit: item.unit || "PCS",
      quantity: Number(item.quantity) || 0,
      unit_price_pkr: Number(item.unit_price_pkr) || 0,
      discount_percent: Number(item.discount_percent) || 0,
      discount_pkr: Number(item.discount_pkr) || 0,
      tax_rate: Number(item.tax_rate) || 0,
      estimated_unit_cost_pkr: Number(item.estimated_unit_cost_pkr) || 0,
    })),
  };
}

/** Client-side computation used by the REST fallback (identical to the RPC). */
function computeTotalsLocally(draft: QuotationDraftInput) {
  const totals = calculateQuotationTotals(
    draft.items ?? [],
    draft.additional_charges_pkr ?? 0,
  );
  const items = (draft.items ?? []).map((item, index) => {
    const line = calculateQuotationLine(item);
    return {
      product_id: item.product_id ?? null,
      product_code: item.product_code ?? null,
      product_name: item.product_name.trim(),
      description: item.description ?? null,
      unit: item.unit || "PCS",
      quantity: Number(item.quantity) || 0,
      unit_price_pkr: round2(Number(item.unit_price_pkr) || 0),
      discount_percent: Number(item.discount_percent) || 0,
      discount_pkr: line.discount,
      tax_rate: Number(item.tax_rate) || 0,
      tax_amount_pkr: line.tax,
      line_total_pkr: line.lineTotal,
      estimated_unit_cost_pkr: round2(Number(item.estimated_unit_cost_pkr) || 0),
      sort_order: index,
    };
  });
  return { totals, items };
}

function restNumber(): string {
  // Same PREFIX-YYYY-<digits> convention as invoices (INV-2026-1234).
  return `QTN-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
}

/* ─── Fetching ─────────────────────────────────────────────────────────────── */

const QUOTATION_SELECT_FULL =
  "*,customer:customer_id(id,name,phone,email,address,ntn_strn),invoice:converted_invoice_id(id,invoice_number,is_posted),items:quotation_items(*)";

export async function fetchQuotations(): Promise<Quotation[]> {
  if (!SUPABASE_URL) return [];
  try {
    let res = await fetch(
      `${SUPABASE_URL}/rest/v1/quotations?select=${encodeURIComponent(QUOTATION_SELECT_FULL)}&order=created_at.desc`,
      { headers: headers() },
    );
    if (!res.ok) {
      // Older schemas: fall back to header + items embed, then plain header.
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/quotations?select=*,items:quotation_items(*)&order=created_at.desc`,
        { headers: headers() },
      );
      if (!res.ok) {
        res = await fetch(
          `${SUPABASE_URL}/rest/v1/quotations?select=*&order=created_at.desc`,
          { headers: headers() },
        );
      }
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      console.error("Supabase Error [quotations fetch]:", {
        status: res.status,
        body: extractError(body, text, "fetch failed"),
      });
      return [];
    }
    const rows = (Array.isArray(body) ? body : []) as Quotation[];
    return rows.map((row) => ({
      ...row,
      items: Array.isArray(row.items)
        ? [...row.items].sort(
            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
          )
        : [],
    }));
  } catch (err) {
    console.error(
      "Supabase Error [quotations fetch]:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function fetchQuotationById(
  id: string,
): Promise<Quotation | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/quotations?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(QUOTATION_SELECT_FULL)}&limit=1`,
      { headers: headers() },
    );
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      console.error("Supabase Error [quotation by id]:", {
        status: res.status,
        body: extractError(body, text, "fetch failed"),
      });
      return null;
    }
    const rows = Array.isArray(body) ? (body as Quotation[]) : [];
    const row = rows[0];
    if (!row) return null;
    row.items = Array.isArray(row.items)
      ? [...row.items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : [];
    return row;
  } catch (err) {
    console.error(
      "Supabase Error [quotation by id]:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Recovery probe: an invoice created for this quotation in an earlier attempt. */
export async function fetchInvoiceByQuotationId(
  quotationId: string,
): Promise<SalesInvoice | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?quotation_id=eq.${encodeURIComponent(quotationId)}&select=*,parties(id,name,party_type,address,phone,email,ntn_strn)&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as SalesInvoice[];
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

/* ─── Create / update ──────────────────────────────────────────────────────── */

export interface QuotationMutationResult {
  quotation: Quotation | null;
  error?: string;
}

export async function createQuotation(
  draft: QuotationDraftInput,
): Promise<QuotationMutationResult> {
  const errors = validateQuotationDraft(draft);
  if (errors.length > 0) return { quotation: null, error: errors[0] };

  const payload = buildPayload(draft);
  const result = await rpcCall<Quotation>("create_quotation", {
    p_payload: payload,
  });
  if (result.ok) {
    return { quotation: { ...result.data, items: result.data.items ?? [] } };
  }
  if (!result.missing) return { quotation: null, error: result.error };

  // Degraded mode: RPC missing → insert header + lines directly (same math).
  const { totals, items } = computeTotalsLocally(draft);
  const header = await restRequest<Quotation[]>("/rest/v1/quotations", {
    method: "POST",
    body: {
      quotation_number: restNumber(),
      quotation_date:
        (draft.quotation_date ?? "").slice(0, 10) ||
        new Date().toISOString().slice(0, 10),
      valid_until: draft.valid_until ? draft.valid_until.slice(0, 10) : null,
      customer_id: draft.customer_id ?? null,
      customer_name: draft.customer_name.trim(),
      customer_phone: draft.customer_phone ?? null,
      customer_address: draft.customer_address ?? null,
      status: "DRAFT",
      subtotal_pkr: totals.subtotal_pkr,
      discount_pkr: totals.discount_pkr,
      tax_amount_pkr: totals.tax_amount_pkr,
      additional_charges_pkr: totals.additional_charges_pkr,
      grand_total_pkr: totals.grand_total_pkr,
      terms: draft.terms ?? null,
      notes: draft.notes ?? null,
      internal_notes: draft.internal_notes ?? null,
      estimated_cost_pkr: totals.estimated_cost_pkr,
      estimated_profit_pkr: totals.estimated_profit_pkr,
      margin_percent: totals.margin_percent,
      operator_name: draft.operator_name ?? null,
      device_node: draft.device_node ?? null,
    },
  });
  if (!header.ok || !header.data?.[0]) {
    return {
      quotation: null,
      error: header.ok ? "Quotation created but no data returned." : header.error,
    };
  }
  const created = header.data[0];
  const lines = await restRequest<QuotationItem[]>("/rest/v1/quotation_items", {
    method: "POST",
    body: items.map((item) => ({ ...item, quotation_id: created.id })),
  });
  if (!lines.ok) {
    // Roll back the orphan header so numbering gaps are the only trace.
    await restRequest(`/rest/v1/quotation_items?quotation_id=eq.${created.id}`, {
      method: "DELETE",
    });
    await restRequest(`/rest/v1/quotations?id=eq.${created.id}`, {
      method: "DELETE",
    });
    return { quotation: null, error: lines.error };
  }
  return {
    quotation: { ...created, items: lines.data ?? [] },
  };
}

export async function updateQuotation(
  quotationId: string,
  draft: QuotationDraftInput,
): Promise<QuotationMutationResult> {
  const errors = validateQuotationDraft(draft);
  if (errors.length > 0) return { quotation: null, error: errors[0] };

  const payload = buildPayload(draft);
  const result = await rpcCall<Quotation>("update_quotation", {
    p_quotation_id: quotationId,
    p_payload: payload,
  });
  if (result.ok) {
    return { quotation: { ...result.data, items: result.data.items ?? [] } };
  }
  if (!result.missing) return { quotation: null, error: result.error };

  // Degraded mode: header PATCH + line rebuild (DB triggers still validate).
  const { totals, items } = computeTotalsLocally(draft);
  const header = await restRequest<Quotation[]>(
    `/rest/v1/quotations?id=eq.${quotationId}`,
    {
      method: "PATCH",
      body: {
        quotation_date:
          (draft.quotation_date ?? "").slice(0, 10) ||
          new Date().toISOString().slice(0, 10),
        valid_until: draft.valid_until ? draft.valid_until.slice(0, 10) : null,
        customer_id: draft.customer_id ?? null,
        customer_name: draft.customer_name.trim(),
        customer_phone: draft.customer_phone ?? null,
        customer_address: draft.customer_address ?? null,
        subtotal_pkr: totals.subtotal_pkr,
        discount_pkr: totals.discount_pkr,
        tax_amount_pkr: totals.tax_amount_pkr,
        additional_charges_pkr: totals.additional_charges_pkr,
        grand_total_pkr: totals.grand_total_pkr,
        terms: draft.terms ?? null,
        notes: draft.notes ?? null,
        internal_notes: draft.internal_notes ?? null,
        estimated_cost_pkr: totals.estimated_cost_pkr,
        estimated_profit_pkr: totals.estimated_profit_pkr,
        margin_percent: totals.margin_percent,
      },
    },
  );
  if (!header.ok || !header.data?.[0]) {
    return {
      quotation: null,
      error: header.ok ? "Quotation not found." : header.error,
    };
  }
  await restRequest(`/rest/v1/quotation_items?quotation_id=eq.${quotationId}`, {
    method: "DELETE",
  });
  if (items.length > 0) {
    const lines = await restRequest<QuotationItem[]>("/rest/v1/quotation_items", {
      method: "POST",
      body: items.map((item) => ({ ...item, quotation_id: quotationId })),
    });
    if (!lines.ok) return { quotation: null, error: lines.error };
    return { quotation: { ...header.data[0], items: lines.data ?? [] } };
  }
  return { quotation: { ...header.data[0], items: [] } };
}

/* ─── Status changes ───────────────────────────────────────────────────────── */

export interface QuotationStatusResult {
  quotation: Quotation | null;
  error?: string;
}

export async function setQuotationStatus(
  quotationId: string,
  next: QuotationStatus,
  opts: {
    role?: RoleLike;
    reason?: string;
    operator_name?: string;
    current?: Quotation;
  } = {},
): Promise<QuotationStatusResult> {
  if (!canSetQuotationStatus(opts.role ?? null, next)) {
    return {
      quotation: null,
      error: "You do not have permission to change quotations to this status.",
    };
  }
  if (
    opts.current &&
    !isQuotationConverted(opts.current) &&
    !canTransitionQuotation(opts.current.status, next) &&
    opts.current.status !== next
  ) {
    return {
      quotation: null,
      error: `Invalid status change: ${opts.current.status} → ${next}.`,
    };
  }

  const result = await rpcCall<Quotation>("set_quotation_status", {
    p_quotation_id: quotationId,
    p_new_status: next,
    p_operator_name: opts.operator_name ?? "System Operator",
    p_reason: opts.reason ?? "",
  });
  if (result.ok) return { quotation: result.data };
  if (result.missing) {
    // Degraded mode: the DB trigger still validates every transition.
    const patched = await restRequest<Quotation[]>(
      `/rest/v1/quotations?id=eq.${quotationId}`,
      { method: "PATCH", body: { status: next } },
    );
    if (patched.ok && patched.data?.[0]) return { quotation: patched.data[0] };
    return { quotation: null, error: patched.ok ? "Quotation not found." : patched.error };
  }
  return { quotation: null, error: result.error };
}

/* ─── Conversion to invoice ────────────────────────────────────────────────── */

async function linkQuotationInvoice(
  quotationId: string,
  invoiceId: string,
  operatorName?: string,
): Promise<string | null> {
  const result = await rpcCall<Quotation>("link_quotation_invoice", {
    p_quotation_id: quotationId,
    p_invoice_id: invoiceId,
    p_operator_name: operatorName ?? "System Operator",
  });
  if (result.ok) return null;
  if (result.missing) {
    const patched = await restRequest<Quotation[]>(
      `/rest/v1/quotations?id=eq.${quotationId}`,
      {
        method: "PATCH",
        body: { converted_invoice_id: invoiceId, converted_at: new Date().toISOString() },
      },
    );
    if (patched.ok) return null;
    return patched.ok ? "Quotation not found." : patched.error;
  }
  return result.error;
}

export interface ConvertQuotationResult {
  invoice: SalesInvoice | null;
  error?: string;
  /** True when an invoice from a previous/partial attempt was reused. */
  alreadyConverted?: boolean;
  /** Invoice was created but the quotation row could not be updated (self-heals on retry). */
  linkWarning?: string;
}

/**
 * Converts a quotation into a sales invoice using the existing invoice
 * creation workflow exactly once. The unique index on
 * `sales_invoices.quotation_id` makes a duplicate conversion impossible even
 * under concurrency; failures are probed and recovered.
 *
 * Side effects happen ONLY here (never on quotation CRUD): `createInvoice`
 * writes the invoice, saves its lines and applies the standard stock movement.
 * The sales ledger is posted later by the existing invoice posting workflow.
 */
export async function convertQuotationToInvoice(
  quotation: Quotation,
  opts: {
    role?: RoleLike;
    operator_name?: string;
    device_node?: string;
  } = {},
): Promise<ConvertQuotationResult> {
  if (!SUPABASE_URL) return { invoice: null, error: "Server URL is not configured" };

  const check = checkQuotationConvertible(quotation, opts.role ?? null);
  if (!check.ok) {
    return {
      invoice: null,
      error: check.reason,
      alreadyConverted: check.alreadyConverted,
    };
  }

  // 1. Recovery: a previous attempt may have created the invoice already.
  const existing = await fetchInvoiceByQuotationId(quotation.id);
  if (existing) {
    // A line-less header can only be a crash artifact (header inserted, lines
    // failed). Adopting it would lock the quotation to an unusable invoice,
    // so refuse and let the operator delete the broken invoice first.
    const itemsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoice_items?invoice_id=eq.${encodeURIComponent(
        existing.id,
      )}&select=id&limit=1`,
      { headers: headers() },
    );
    if (itemsRes.ok) {
      const itemRows = await itemsRes.json().catch(() => null);
      if (Array.isArray(itemRows) && itemRows.length === 0) {
        return {
          invoice: null,
          error: `Invoice ${existing.invoice_number} exists but has no line items. Delete that incomplete invoice, then convert again.`,
        };
      }
    }
    const linkErr = await linkQuotationInvoice(
      quotation.id,
      existing.id,
      opts.operator_name,
    );
    return {
      invoice: existing,
      alreadyConverted: true,
      linkWarning: linkErr ?? undefined,
    };
  }

  // 2. Walk-in customer: create (or reuse) the parties row first so the
  //    invoice has a real customer_id — reusing the existing customer module.
  let customerId = quotation.customer_id ?? "";
  if (!customerId) {
    const party = await createCustomer({
      name: quotation.customer_name,
      phone: quotation.customer_phone ?? undefined,
      address: quotation.customer_address ?? undefined,
    });
    if (!party) {
      return {
        invoice: null,
        error:
          "The walk-in customer could not be saved as a CRM party. Create the customer in CRM, then retry.",
      };
    }
    customerId = party.id;
    const patched = await restRequest<Quotation[]>(
      `/rest/v1/quotations?id=eq.${quotation.id}`,
      { method: "PATCH", body: { customer_id: party.id } },
    );
    if (!patched.ok) {
      return { invoice: null, error: patched.error };
    }
  }

  // 3. Existing invoice workflow (draft creation + standard stock movement).
  const mapping = mapQuotationToInvoicePayload(quotation);
  const { invoice, error } = await createInvoice({
    customer_id: customerId,
    taxable_value_pkr: mapping.taxable_value_pkr,
    sales_tax_rate: mapping.sales_tax_rate,
    sales_tax_amount_pkr: mapping.sales_tax_amount_pkr,
    further_tax_rate: mapping.further_tax_rate,
    further_tax_amount_pkr: mapping.further_tax_amount_pkr,
    total_invoice_value_pkr: mapping.total_invoice_value_pkr,
    discount_percent: mapping.discount_percent,
    discount_pkr: mapping.discount_pkr,
    device_node: opts.device_node ?? process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
    operator_name: opts.operator_name ?? "Accounts Dept",
    items: mapping.items,
    quotation_id: quotation.id,
  });

  if (!invoice) {
    // Unique violation means another session converted it a moment ago.
    if (error && /uniq_sales_invoices_quotation_id|duplicate key/i.test(error)) {
      const raced = await fetchInvoiceByQuotationId(quotation.id);
      if (raced) {
        await linkQuotationInvoice(quotation.id, raced.id, opts.operator_name);
        return { invoice: raced, alreadyConverted: true };
      }
    }
    return { invoice: null, error: error ?? "Failed to create the invoice." };
  }

  // 4. Link the quotation back to the invoice (idempotent).
  const linkErr = await linkQuotationInvoice(
    quotation.id,
    invoice.id,
    opts.operator_name,
  );
  if (linkErr) {
    return { invoice, linkWarning: linkErr };
  }
  return { invoice };
}

/* ─── Delete quotation ──────────────────────────────────────────────────── */
export async function deleteQuotation(
  quotationId: string,
  role?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };
  try {
    const qRes = await fetch(
      `${SUPABASE_URL}/rest/v1/quotations?id=eq.${quotationId}&select=converted_invoice_id`,
      { headers: headers() },
    );
    if (!qRes.ok) return { success: false, error: "Failed to fetch quotation" };
    const data = await qRes.json();
    const q = Array.isArray(data) ? data[0] : {};
    if (q.converted_invoice_id) {
      return {
        success: false,
        error: "Quotation cannot be deleted because it has already been converted to an invoice.",
      };
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/quotations?id=eq.${quotationId}`,
      { method: "DELETE", headers: headers() },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: body || "Failed to delete quotation" };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/* ─── Internal estimated cost lookup (reuses lots + purchases modules) ─────── */

/**
 * Effective FIFO-style estimated unit cost per product:
 * oldest open inventory lot first, latest confirmed purchase rate as fallback.
 * Used for the OWNER-only cost / margin panel — never for customer documents.
 */
export async function fetchEstimatedCosts(
  productIds: string[],
): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  const wanted = [...new Set((productIds ?? []).filter(Boolean))];
  if (wanted.length === 0 || !SUPABASE_URL) return costs;

  // 1. Open lots, oldest first (FIFO unit cost wins).
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots?product_id=in.(${wanted.join(",")})&remaining_qty=gt.0&select=product_id,unit_cost_pkr&order=created_at.asc&limit=2000`,
      { headers: headers() },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        product_id: string;
        unit_cost_pkr: number;
      }>;
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!costs.has(row.product_id)) {
          costs.set(row.product_id, round2(Number(row.unit_cost_pkr) || 0));
        }
      }
    }
  } catch {
    /* fall through to purchase rates */
  }

  // 2. Latest non-cancelled purchase rate for products without open lots.
  const missing = wanted.filter((id) => !costs.has(id));
  if (missing.length > 0) {
    const purchases = await fetchProductPurchases();
    const missingSet = new Set(missing);
    for (const p of purchases) {
      if (
        p.status !== "cancelled" &&
        p.product_id &&
        missingSet.has(p.product_id) &&
        !costs.has(p.product_id)
      ) {
        costs.set(
          p.product_id,
          round2(Number(p.effective_unit_cost_pkr) || Number(p.purchase_rate) || 0),
        );
      }
    }
  }

  return costs;
}

/* ─── Summary (for the module's KPI strip) ─────────────────────────────────── */

export interface QuotationSummary {
  total_count: number;
  draft_count: number;
  issued_count: number;
  accepted_count: number;
  rejected_count: number;
  expired_count: number;
  cancelled_count: number;
  converted_count: number;
  active_count: number;
  total_value_pkr: number;
  accepted_value_pkr: number;
}

export function summarizeQuotations(quotations: Quotation[]): QuotationSummary {
  const summary: QuotationSummary = {
    total_count: quotations.length,
    draft_count: 0,
    issued_count: 0,
    accepted_count: 0,
    rejected_count: 0,
    expired_count: 0,
    cancelled_count: 0,
    converted_count: 0,
    active_count: 0,
    total_value_pkr: 0,
    accepted_value_pkr: 0,
  };
  for (const q of quotations) {
    switch (q.status) {
      case "DRAFT":
        summary.draft_count += 1;
        break;
      case "ISSUED":
        summary.issued_count += 1;
        break;
      case "ACCEPTED":
        summary.accepted_count += 1;
        break;
      case "REJECTED":
        summary.rejected_count += 1;
        break;
      case "EXPIRED":
        summary.expired_count += 1;
        break;
      case "CANCELLED":
        summary.cancelled_count += 1;
        break;
    }
    if (q.converted_invoice_id) summary.converted_count += 1;
    if (q.status !== "CANCELLED") {
      summary.active_count += 1;
      summary.total_value_pkr = round2(
        summary.total_value_pkr + (Number(q.grand_total_pkr) || 0),
      );
      if (q.status === "ACCEPTED") {
        summary.accepted_value_pkr = round2(
          summary.accepted_value_pkr + (Number(q.grand_total_pkr) || 0),
        );
      }
    }
  }
  return summary;
}

/* ─── Search / filter helpers (pure — used by the page and tests) ──────────── */

export interface QuotationFilter {
  search?: string;
  status?: QuotationStatus | "ALL";
  startDate?: string;
  endDate?: string;
}

export function filterQuotations(
  quotations: Quotation[],
  filter: QuotationFilter = {},
): Quotation[] {
  const search = (filter.search ?? "").trim().toLowerCase();
  const start = filter.startDate ?? "";
  const end = filter.endDate ?? "";
  return quotations.filter((q) => {
    if (filter.status && filter.status !== "ALL" && q.status !== filter.status) {
      return false;
    }
    const date = (q.quotation_date ?? "").slice(0, 10);
    if (start && date < start) return false;
    if (end && date > end) return false;
    if (search) {
      const haystack = [
        q.quotation_number,
        q.customer_name,
        ...(q.items ?? []).map((i) => i.product_name),
        ...(q.items ?? []).map((i) => i.product_code ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}
