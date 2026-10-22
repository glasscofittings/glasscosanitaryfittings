import { printPdfDocument } from "@/lib/tauri-bridge";
import { UR, URDU_HTML_STYLES, urSpan, urUnder } from "@/lib/pdf-urdu";
import {
  DEFAULT_COMPANY,
  getExportDocumentTitle,
  loadCompanyProfile,
} from "@/lib/company-settings";
import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";
import {
  deductProductStock,
  restoreProductStock,
} from "@/lib/supabase/catalog";
import {
  COMPANY_HEADER_FONT_SIZE_PX,
  COMPANY_LEGAL_NAME,
} from "@/lib/branding";
import { SANS_FONT_FACES_CSS, SANS_FONT_FAMILY_CSS } from "@/lib/pdf-font";

export interface SalesInvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_pkr: number;
  line_total_pkr: number;
  unit_of_measure: string;
  discount_percent?: number;
  discount_pkr?: number;
}

export interface Party {
  id: string;
  name: string;
  party_type: "SUPPLIER" | "CUSTOMER" | "BOTH";
  is_registered: boolean;
  ntn_strn?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface SalesInvoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  taxable_value_pkr: number;
  sales_tax_rate: number;
  sales_tax_amount_pkr: number;
  further_tax_rate: number;
  further_tax_amount_pkr: number;
  total_invoice_value_pkr: number;
  is_posted: boolean;
  /**
   * True once this invoice's units have actually been taken out of inventory.
   * Set only by `approve_dispatch` under the approval workflow; invoices that
   * predate the workflow are backfilled to true by migration
   * 20261107010000 (their stock moved at creation). Edit/delete use it to
   * decide whether stock adjustments are owed.
   */
  stock_deducted?: boolean;
  created_at: string;
  /** Invoice-level discount percentage applied to the gross line total (e.g. 5 = 5%). */
  discount_percent?: number;
  /** Invoice-level discount amount in PKR; taxable_value_pkr = gross − discount_pkr. */
  discount_pkr?: number;
  parties?: Party;
  items?: SalesInvoiceItem[];
}

export interface TaxBreakdown {
  taxable_value: number;
  sales_tax_rate: number;
  sales_tax_amount: number;
  further_tax_rate: number;
  further_tax_amount: number;
  total_payable: number;
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

export const REFERENCE_COMPANY_NAME = "Glassco Sanitary Fittings";
export const REFERENCE_TAGLINE =
  "QUALITY SANITARY FITTINGS | TRUSTED SUPPLY | LONG LASTING RELATIONSHIPS";
export const REFERENCE_ADDRESS = "Race Course GT Road, Gujranwala, Pakistan";
export const REFERENCE_PHONE = "+92 300 0656570";
export const REFERENCE_EMAIL = "glasscosanitaryfittings@gmail.com";
export const NAVY_BLUE = "#0aa32bff";
export const LIGHT_BLUE = "#DBEAFE";

/**
 * Pure, idempotent tax breakdown. Defaults every rate to 0 — a tax amount is
 * only produced when the caller explicitly supplies a non-zero rate. Calling it
 * repeatedly with the same inputs always yields the same result (no accumulation).
 *
 * @param taxableValue Net amount to tax (PKR).
 * @param options.salesTaxRate   Sales tax percent (default 0).
 * @param options.furtherTaxRate Further tax percent (default 0).
 */
export function calculateTax(
  taxableValue: number,
  options: { salesTaxRate?: number; furtherTaxRate?: number } = {},
): TaxBreakdown {
  const roundedTaxable = Math.round((Number(taxableValue) || 0) * 100) / 100;
  const salesTaxRate = Math.max(0, Number(options.salesTaxRate) || 0);
  const furtherTaxRate = Math.max(0, Number(options.furtherTaxRate) || 0);
  const salesTaxAmount = Math.round(roundedTaxable * salesTaxRate) / 100;
  const furtherTaxAmount = Math.round(roundedTaxable * furtherTaxRate) / 100;
  return {
    taxable_value: roundedTaxable,
    sales_tax_rate: salesTaxRate,
    sales_tax_amount: salesTaxAmount,
    further_tax_rate: furtherTaxRate,
    further_tax_amount: furtherTaxAmount,
    total_payable:
      Math.round((roundedTaxable + salesTaxAmount + furtherTaxAmount) * 100) /
      100,
  };
}

export async function fetchCustomers(): Promise<Party[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/parties?select=id,name,party_type,phone,email,address&party_type=in.(CUSTOMER,BOTH)&order=name.asc`,
      { headers: headers() },
    );
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, code, details, hint } = body as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      console.error("Supabase Error [parties customers]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return [];
    }
    const rows = (Array.isArray(body) ? body : []) as Array<
      Omit<Party, "is_registered" | "ntn_strn">
    >;
    return rows.map((r) => ({
      ...r,
      ntn_strn: undefined,
      is_registered: false,
    })) as Party[];
  } catch (err) {
    console.error(
      "Supabase Error [parties customers]:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function createCustomer(customer: {
  name: string;
  ntn_strn?: string;
  phone?: string;
  email?: string;
  address?: string;
}): Promise<Party | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/parties`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        name: customer.name,
        party_type: "CUSTOMER",
        phone: customer.phone || null,
        email: customer.email || null,
        address: customer.address || null,
      }),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, code, details, hint } = body as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      console.error("Supabase Error [parties create]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return null;
    }
    const row = (Array.isArray(body) ? body[0] : body) as Omit<
      Party,
      "is_registered" | "ntn_strn"
    >;
    return { ...row, ntn_strn: undefined, is_registered: false } as Party;
  } catch (err) {
    console.error(
      "Supabase Error [parties create]:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function fetchInvoices(): Promise<SalesInvoice[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?select=*,parties(id,name,party_type,address,phone,email,ntn_strn),items:sales_invoice_items(*)&order=created_at.desc`,
      { headers: headers() },
    );
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, code, details, hint } = body as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      console.error("Supabase Error [sales_invoices]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return [];
    }
    const rows = (Array.isArray(body) ? body : []) as Array<
      SalesInvoice & { parties?: Partial<Party> }
    >;
    return rows.map((r) => ({
      ...r,
      parties: r.parties
        ? ({
            ...r.parties,
            is_registered: Boolean(r.parties.ntn_strn),
          } as Party)
        : r.parties,
    })) as SalesInvoice[];
  } catch (err) {
    console.error(
      "Supabase Error [sales_invoices]:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Fetch a single sales invoice fresh from the database (with parties + items).
 * Used after posting so the PDF is rendered from the authoritative saved row
 * rather than stale component state. Returns null when not found or on error.
 */
export async function fetchInvoiceById(
  invoiceId: string,
): Promise<SalesInvoice | null> {
  if (!SUPABASE_URL || !invoiceId) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${encodeURIComponent(
        invoiceId,
      )}&select=*,parties(id,name,party_type,address,phone,email,ntn_strn),items:sales_invoice_items(*)&limit=1`,
      { headers: headers() },
    );
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok || !Array.isArray(body) || body.length === 0) {
      console.error("Supabase Error [fetchInvoiceById]:", {
        status: res.ok ? 200 : res.status,
        invoiceId,
        message: text.slice(0, 300),
      });
      return null;
    }
    const r = body[0] as SalesInvoice & { parties?: Partial<Party> };
    return {
      ...r,
      parties: r.parties
        ? ({
            ...r.parties,
            is_registered: Boolean(r.parties.ntn_strn),
          } as Party)
        : r.parties,
    } as SalesInvoice;
  } catch (err) {
    console.error(
      "Supabase Error [fetchInvoiceById]:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export interface CreateInvoiceResult {
  invoice: SalesInvoice | null;
  error?: string;
  stockWarning?: string;
}

/** Moves inventory for invoice line items. Returns one message per product that failed. */
async function applyStockMovement(
  items: Array<
    Pick<DispatchLineItem, "product_id" | "product_name" | "quantity">
  >,
  direction: "deduct" | "restore",
): Promise<string[]> {
  const nameMap = await resolveProductIdsByName(items);
  const errors: string[] = [];
  for (const item of items) {
    const productId = item.product_id || nameMap.get(item.product_name);
    if (!productId || !(item.quantity > 0)) continue;
    const result =
      direction === "deduct"
        ? await deductProductStock(productId, item.quantity)
        : await restoreProductStock(productId, item.quantity);
    if (!result.ok)
      errors.push(
        `${item.product_name || productId}: ${result.error ?? "failed"}`,
      );
  }
  return errors;
}

/**
 * sales_invoice_items.product_id can be dropped when its foreign key points at
 * products_master, so lines are matched back to inventory by product name.
 */
async function resolveProductIdsByName(
  items: Array<{ product_id?: string | null; product_name: string }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const needsLookup = items.some((i) => !i.product_id && i.product_name);
  if (!needsLookup || !SUPABASE_URL) return map;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sanitary_products?select=id,name`,
      {
        headers: headers(),
      },
    );
    if (!res.ok) return map;
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!map.has(row.name)) map.set(row.name, row.id);
    }
  } catch (err) {
    console.warn("Product name lookup failed:", err);
  }
  return map;
}

export async function createInvoice(invoice: {
  customer_id: string;
  taxable_value_pkr: number;
  sales_tax_amount_pkr: number;
  further_tax_amount_pkr: number;
  total_invoice_value_pkr: number;
  sales_tax_rate?: number;
  further_tax_rate?: number;
  discount_percent?: number;
  discount_pkr?: number;
  device_node: string;
  operator_name: string;
  items?: DispatchLineItem[];
  /**
   * Quotation this invoice was converted from. Written only when provided; the
   * unique partial index on sales_invoices.quotation_id (migration
   * 20261105010000) makes a second invoice for the same quotation impossible.
   */
  quotation_id?: string;
}): Promise<CreateInvoiceResult> {
  if (!SUPABASE_URL)
    return { invoice: null, error: "Server URL is not configured" };
  try {
    const items = invoice.items ?? [];

    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const payload: Record<string, unknown> = {
      invoice_number: invoiceNumber,
      customer_id: invoice.customer_id,
      taxable_value_pkr: invoice.taxable_value_pkr,
      sales_tax_rate: invoice.sales_tax_rate ?? 0,
      sales_tax_amount_pkr: invoice.sales_tax_amount_pkr,
      further_tax_rate: invoice.further_tax_rate ?? 0,
      further_tax_amount_pkr: invoice.further_tax_amount_pkr,
      total_invoice_value_pkr: invoice.total_invoice_value_pkr,
      is_posted: false,
    };
    if (invoice.quotation_id) {
      payload.quotation_id = invoice.quotation_id;
    }
    // Only sent when a discount applies so invoices still save before the
    // discount migration has been run against the database.
    if (
      (invoice.discount_pkr ?? 0) > 0 ||
      (invoice.discount_percent ?? 0) > 0
    ) {
      payload.discount_pkr = invoice.discount_pkr ?? 0;
      payload.discount_percent = invoice.discount_percent ?? 0;
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sales_invoices`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, code, details, hint } = body as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      console.error("Supabase Error [sales_invoices insert]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      const rawMessage = message ?? text.slice(0, 200);
      // Unique-violation messages for the conversion race ALSO contain
      // "quotation_id" (`duplicate key ... unique constraint
      // "uniq_sales_invoices_quotation_id"`), so they must be classified first:
      // convertQuotationToInvoice matches on "duplicate key" to re-probe and
      // recover. Keep that wording intact even if Postgres phrases it differently.
      if (
        code === "23505" ||
        /duplicate key|unique (constraint|violation)/i.test(rawMessage)
      ) {
        return {
          invoice: null,
          error: /duplicate key/i.test(rawMessage)
            ? rawMessage
            : `duplicate key: ${rawMessage}`,
        };
      }
      if (/quotation_id/.test(rawMessage)) {
        return {
          invoice: null,
          error:
            "The quotation link column is missing in the database. Run migration 20261105010000_quotation_management.sql in the database SQL editor, then retry.",
        };
      }
      if (/discount_(pkr|percent)/.test(rawMessage)) {
        return {
          invoice: null,
          error:
            "Discount columns are missing in the database. Run migration 20261019010000_sales_invoice_discount.sql in the database SQL editor, then retry.",
        };
      }
      return { invoice: null, error: rawMessage };
    }
    const data = Array.isArray(body) ? body : [body];
    const created = (data[0] as SalesInvoice | undefined) ?? null;
    if (!created)
      return { invoice: null, error: "Invoice created but no data returned." };

    if (items.length > 0) {
      const saved = await createInvoiceItems(created.id, items);
      if (saved.length !== items.length) {
        // Lines ARE the invoice. If they failed to save nothing may be
        // recorded, and the header has to go too — otherwise a retry creates
        // a second invoice and the quotation conversion probe could adopt a
        // line-less artifact.
        console.error(
          `[createInvoice] Only ${saved.length}/${items.length} line(s) saved for ${created.invoice_number} — rolling back the invoice header.`,
        );
        await fetch(
          `${SUPABASE_URL}/rest/v1/sales_invoice_items?invoice_id=eq.${created.id}`,
          { method: "DELETE", headers: headers() },
        );
        const delRes = await fetch(
          `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${created.id}`,
          { method: "DELETE", headers: headers() },
        );
        if (!delRes.ok) {
          return {
            invoice: null,
            error: `Invoice lines failed to save and the header could not be removed (invoice ${created.invoice_number}). Delete it before retrying.`,
          };
        }
        return {
          invoice: null,
          error:
            "Invoice lines could not be saved, so nothing was recorded. Please retry.",
        };
      }
      // Stock is deliberately NOT moved here: under the dispatch approval
      // workflow inventory only changes when approve_dispatch runs (the
      // "Approve" action in Dispatch History). Invoices that predate the
      // workflow carry stock_deducted=true (migration 20261107010000), so
      // their edit/delete paths still reverse stock correctly.
      return { invoice: { ...created, items: saved } };
    }
    return { invoice: created };
  } catch (err) {
    console.error(
      "Supabase Error [sales_invoices insert]:",
      err instanceof Error ? err.message : err,
    );
    return {
      invoice: null,
      error: "Network error. Please check your connection.",
    };
  }
}

export async function updateInvoice(
  invoiceId: string,
  updates: {
    customer_id?: string;
    taxable_value_pkr?: number;
    sales_tax_rate?: number;
    sales_tax_amount_pkr?: number;
    further_tax_rate?: number;
    further_tax_amount_pkr?: number;
    total_invoice_value_pkr?: number;
    discount_percent?: number;
    discount_pkr?: number;
  },
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${invoiceId}`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=minimal" },
        body: JSON.stringify(updates),
      },
    );
    return res.ok;
  } catch (err) {
    console.error(
      "Supabase Error [updateInvoice]:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export async function updateInvoiceItems(
  invoiceId: string,
  items: DispatchLineItem[],
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    // Read the previous lines first so inventory can be moved by the difference.
    let previous: Array<{
      product_id: string | null;
      product_name: string;
      quantity: number;
    }> = [];
    try {
      const prevRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sales_invoice_items?invoice_id=eq.${invoiceId}&select=product_id,product_name,quantity`,
        { headers: headers() },
      );
      if (prevRes.ok) {
        const rows = (await prevRes.json()) as typeof previous;
        if (Array.isArray(rows)) previous = rows;
      }
    } catch (err) {
      console.warn(
        "Could not read previous invoice items for stock delta:",
        err,
      );
    }

    // Whether this invoice's units were ever taken out of stock decides if an
    // edit owes a stock delta: pending-approval invoices never moved stock,
    // legacy/approved invoices did (sales_invoices.stock_deducted).
    let stockSettled = false;
    try {
      const flagRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${invoiceId}&select=stock_deducted`,
        { headers: headers() },
      );
      if (flagRes.ok) {
        const rows = (await flagRes.json()) as Array<{ stock_deducted?: boolean | null }>;
        stockSettled = Array.isArray(rows) && rows[0]?.stock_deducted === true;
      }
    } catch (err) {
      console.warn("Could not read stock_deducted for stock delta:", err);
    }

    // Delete existing items
    await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoice_items?invoice_id=eq.${invoiceId}`,
      {
        method: "DELETE",
        headers: headers(),
      },
    );
    // Insert new items
    if (items.length > 0) {
      await createInvoiceItems(invoiceId, items);
    }

    if (stockSettled) {
      await applyInvoiceStockDelta(previous, items);
    }
    return true;
  } catch (err) {
    console.error(
      "Supabase Error [updateInvoiceItems]:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Reconciles inventory after an invoice's lines changed: extra units are deducted,
 * units no longer sold are returned to stock.
 */
async function applyInvoiceStockDelta(
  previous: Array<{
    product_id: string | null;
    product_name: string;
    quantity: number;
  }>,
  next: DispatchLineItem[],
): Promise<void> {
  const oldQty = new Map<string, number>();
  const newQty = new Map<string, number>();
  const names = new Map<string, string>();
  const nameMap = await resolveProductIdsByName([...previous, ...next]);

  for (const row of previous) {
    const productId = row.product_id || nameMap.get(row.product_name);
    if (!productId) continue;
    oldQty.set(productId, (oldQty.get(productId) ?? 0) + (row.quantity || 0));
    names.set(productId, row.product_name);
  }
  for (const item of next) {
    const productId = item.product_id || nameMap.get(item.product_name);
    if (!productId) continue;
    newQty.set(productId, (newQty.get(productId) ?? 0) + (item.quantity || 0));
    names.set(productId, item.product_name);
  }

  const errors: string[] = [];
  for (const productId of new Set([...oldQty.keys(), ...newQty.keys()])) {
    const delta = (newQty.get(productId) ?? 0) - (oldQty.get(productId) ?? 0);
    if (delta === 0) continue;
    const result =
      delta > 0
        ? await deductProductStock(productId, delta)
        : await restoreProductStock(productId, -delta);
    if (!result.ok) {
      errors.push(
        `${names.get(productId) ?? productId}: ${result.error ?? "failed"}`,
      );
    }
  }
  if (errors.length > 0) {
    console.warn("Invoice stock delta not fully applied:", errors.join("; "));
  }
}

/**
 * Removes the posted sales ledger entry (`Sales invoice <number> posted`,
 * journal_lines cascade with it). Shared by invoice delete and dispatch
 * delete/reversal so every path matches the same narration probe.
 * Returns true when an entry existed and is now gone.
 */
async function removeSalesInvoiceJournal(
  invoiceNumber: string,
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const pattern = encodeURIComponent(`*${invoiceNumber}*`);
    const jeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?status=eq.POSTED&narration=ilike.${pattern}&select=id`,
      { headers: headers() },
    );
    if (!jeRes.ok) {
      console.warn(
        "Supabase Error [invoice journal lookup]:",
        jeRes.status,
        (await jeRes.text()).slice(0, 300),
      );
      return false;
    }
    const rows = (await jeRes.json()) as Array<{ id?: string }>;
    const ids = (Array.isArray(rows) ? rows : [])
      .map((r) => r.id)
      .filter(Boolean) as string[];
    if (ids.length === 0) return false;
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?id=in.(${ids.join(",")})`,
      { method: "DELETE", headers: headers() },
    );
    if (!delRes.ok) {
      console.warn(
        "Supabase Error [invoice journal cleanup]:",
        delRes.status,
        (await delRes.text()).slice(0, 300),
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Could not remove invoice journal entry:", err);
    return false;
  }
}

/**
 * Reads sales_invoices.stock_deducted (migration 20261107010000). Missing
 * column or failed reads report false, so nothing is ever reversed twice.
 */
async function readStockSettled(
  invoiceId: string,
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${invoiceId}&select=stock_deducted`,
      { headers: headers() },
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as Array<{ stock_deducted?: boolean | null }>;
    return Array.isArray(rows) && rows[0]?.stock_deducted === true;
  } catch (err) {
    console.warn("Could not read stock_deducted:", err);
    return false;
  }
}

/**
 * Deletes a sales invoice from the database.
 * `sales_invoice_items` and `dispatch_records` rows disappear automatically
 * (ON DELETE CASCADE). When the invoice was already posted, the ledger entry
 * created for it (`Sales invoice <number> posted`) is removed as well, so the
 * books stay balanced after the delete. Stock is returned only when the
 * invoice's units were actually taken out of stock (`stock_deducted`) —
 * pending-approval invoices never moved stock, so deleting them must not
 * inflate inventory.
 */
export async function deleteInvoice(invoice: {
  id: string;
  invoice_number: string;
  is_posted: boolean;
  items?: SalesInvoiceItem[];
}): Promise<{
  success: boolean;
  error?: string;
  ledgerRemoved: boolean;
  stockRestored: boolean;
}> {
  if (!SUPABASE_URL) {
    return {
      success: false,
      error: "Server URL is not configured",
      ledgerRemoved: false,
      stockRestored: false,
    };
  }

  try {
    // Capture line items before the cascade removes them so stock can go back.
    let items: SalesInvoiceItem[] = invoice.items ?? [];
    if (items.length === 0) {
      try {
        const itemRes = await fetch(
          `${SUPABASE_URL}/rest/v1/sales_invoice_items?invoice_id=eq.${invoice.id}&select=product_id,product_name,quantity`,
          { headers: headers() },
        );
        if (itemRes.ok) {
          const rows = (await itemRes.json()) as SalesInvoiceItem[];
          if (Array.isArray(rows)) items = rows;
        }
      } catch (err) {
        console.warn("Could not read invoice items before delete:", err);
      }
    }

    // Only invoices whose stock was really deducted may return units.
    const stockSettled = await readStockSettled(invoice.id);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${invoice.id}`,
      {
        method: "DELETE",
        headers: { ...headers(), Prefer: "return=representation" },
      },
    );
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }

    if (!res.ok) {
      const err = (body ?? {}) as { message?: string };
      console.error("Supabase Error [sales_invoices delete]:", {
        status: res.status,
        message: err.message ?? text.slice(0, 300),
      });
      return {
        success: false,
        error: err.message ?? `Delete failed (HTTP ${res.status})`,
        ledgerRemoved: false,
        stockRestored: false,
      };
    }

    const deleted = Array.isArray(body) ? body : [];
    if (deleted.length === 0) {
      return {
        success: false,
        error: "Invoice not found (already deleted?)",
        ledgerRemoved: false,
        stockRestored: false,
      };
    }

    // Posted invoice → remove its ledger entry too (journal_lines cascade with it).
    const ledgerRemoved = invoice.is_posted
      ? await removeSalesInvoiceJournal(invoice.invoice_number)
      : false;

    // Return the invoice's units to inventory — but only when they were
    // actually deducted (pre-approval deletes must not touch stock).
    const stockErrors =
      stockSettled && items.length > 0
        ? await applyStockMovement(items, "restore")
        : [];
    if (stockErrors.length > 0) {
      console.warn(
        "Stock not returned on invoice delete:",
        stockErrors.join("; "),
      );
    }

    return {
      success: true,
      ledgerRemoved,
      stockRestored: stockSettled && items.length > 0 && stockErrors.length === 0,
    };
  } catch (err) {
    console.error(
      "Supabase Error [deleteInvoice]:",
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
      ledgerRemoved: false,
      stockRestored: false,
    };
  }
}

/**
 * Persists line items for an invoice. sales_invoice_items.product_id references products_master,
 * while the invoice form sells sanitary_products, so when the FK rejects the ids we store the
 * lines without the product link rather than losing them.
 */
export async function createInvoiceItems(
  invoiceId: string,
  items: DispatchLineItem[],
): Promise<SalesInvoiceItem[]> {
  if (!SUPABASE_URL || items.length === 0) return [];

  const toRow = (item: DispatchLineItem, keepProductId: boolean) => ({
    invoice_id: invoiceId,
    product_id: keepProductId && item.product_id ? item.product_id : null,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price_pkr: item.unit_price_pkr,
    line_total_pkr: item.line_total_pkr,
    unit_of_measure: item.unit_of_measure || "PCS",
    discount_percent: item.discount_percent ?? 0,
    discount_pkr: item.discount_pkr ?? 0,
  });

  async function insert(keepProductId: boolean): Promise<{
    ok: boolean;
    code?: string;
    rows: SalesInvoiceItem[];
    message?: string;
  }> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sales_invoice_items`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(items.map((item) => toRow(item, keepProductId))),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const err = (body ?? {}) as { code?: string; message?: string };
      return {
        ok: false,
        code: err.code,
        message: err.message ?? text.slice(0, 300),
        rows: [],
      };
    }
    return {
      ok: true,
      rows: (Array.isArray(body) ? body : []) as SalesInvoiceItem[],
    };
  }

  try {
    let result = await insert(true);
    if (!result.ok && result.code === "23503") {
      // Foreign-key violation on product_id: keep the lines, drop the link.
      result = await insert(false);
    }
    if (!result.ok) {
      console.error("Supabase Error [sales_invoice_items insert]:", {
        code: result.code ?? null,
        message: result.message,
      });
      return [];
    }
    return result.rows;
  } catch (err) {
    console.error(
      "Supabase Error [sales_invoice_items insert]:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function postGSTPaintsInvoice(payload: {
  invoice_id: string;
  customer_id: string;
  taxable_value_pkr: number;
  apply_further_tax: boolean;
  operator_name: string;
  device_node: string;
  line_items: {
    product_id: string;
    lot_id?: string;
    qty_buckets: number;
    unit_price_pkr: number;
    product_name?: string;
    unit_of_measure?: string;
  }[];
}): Promise<{
  data: { invoice_number: string; total_payable: number } | null;
  error: string | null;
}> {
  if (!SUPABASE_URL)
    return { data: null, error: "Server URL is not configured" };
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/post_gst_paints_invoice`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(payload),
        },
      );
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }

      if (!res.ok) {
        // Retry only on unique_violation (duplicate entry_number race)
        if (
          res.status === 409 &&
          (body?.code === "23505" || body?.code === "23P01") &&
          attempt < maxRetries - 1
        ) {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          continue;
        }
        const message =
          (body.message as string | undefined) ??
          (body.error as string | undefined) ??
          (text.length > 0 ? text.slice(0, 500) : `HTTP ${res.status}`);
        const hint = (body.hint as string | undefined) ?? "";
        const detail =
          (body.details as string | undefined) ??
          (body.detail as string | undefined) ??
          "";
        const userMsg = [message, hint, detail].filter(Boolean).join(" — ");
        console.error("Supabase Error [post_gst_paints_invoice RPC]:", {
          status: res.status,
          code: body.code ?? null,
          message,
          hint,
          detail,
          raw: text.slice(0, 300),
        });
        return { data: null, error: userMsg };
      }
      return {
        data: body as { invoice_number: string; total_payable: number },
        error: null,
      };
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error("Supabase Error [post_gst_paints_invoice RPC]:", message);
      return { data: null, error: message };
    }
  }
  return { data: null, error: "RPC failed after maximum retries" };
}

export async function postInvoice(invoiceId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${invoiceId}`,
      {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ is_posted: true }),
      },
    );
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, code, details, hint } = body as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      console.error("Supabase Error [sales_invoices post]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return false;
    }

    await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        node_id: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
        operator_name: "Accounts Dept",
        action_type: "POSTED_INVOICE",
        details: { module: "INVOICING", invoice_id: invoiceId },
      }),
    });
    return true;
  } catch (err) {
    console.error("Supabase Error [postInvoice]:", err);
    return false;
  }
}

export async function checkDuplicateInvoice(
  customerId: string,
  taxableValue: number,
  date: string,
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const startOfDay = date;
    const endOfDay = date + "T23:59:59Z";
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_invoices?customer_id=eq.${customerId}&taxable_value_pkr=eq.${taxableValue}&created_at=gte.${startOfDay}&created_at=lte.${endOfDay}&select=id`,
      { headers: headers() },
    );
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, code, details, hint } = body as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      console.error("Supabase Error [sales_invoices duplicate check]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return false;
    }
    return Array.isArray(body) && body.length > 0;
  } catch (err) {
    console.error(
      "Supabase Error [sales_invoices duplicate check]:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export async function createJournalEntry(data: {
  entry_date: string;
  narration: string;
  lines: {
    account_code: string;
    debit_pkr: number;
    credit_pkr: number;
    party_id?: string;
  }[];
  device_node: string;
  operator_name: string;
  customer_name?: string;
  customer_id?: string;
}): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const totalDebit = data.lines.reduce((a, l) => a + l.debit_pkr, 0);
      const totalCredit = data.lines.reduce((a, l) => a + l.credit_pkr, 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) return false;

      const now = new Date();
      const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const entryNumber = `JE-${datePart}-${String(Date.now()).slice(-5)}-${Math.floor(Math.random() * 900 + 100)}`;

      const baseBody: Record<string, unknown> = {
        entry_number: entryNumber,
        entry_date: data.entry_date,
        narration: data.narration,
        is_balanced: true,
        status: "POSTED",
      };

      let entryRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(
          data.customer_name
            ? { ...baseBody, customer_name: data.customer_name }
            : baseBody,
        ),
      });

      let entryText = await entryRes.text();

      // If customer_name column does not exist in schema, retry with baseBody
      if (!entryRes.ok && entryText.toLowerCase().includes("customer_name")) {
        entryRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
          method: "POST",
          headers: { ...headers(), Prefer: "return=representation" },
          body: JSON.stringify(baseBody),
        });
        entryText = await entryRes.text();
      }

      let entryBody: Record<string, unknown> = {};
      try {
        entryBody = JSON.parse(entryText);
      } catch {
        /* non-JSON response */
      }

      if (!entryRes.ok) {
        const { message, code, details, hint } = entryBody as {
          message?: string;
          code?: string;
          details?: string;
          hint?: string;
        };
        if (
          entryRes.status === 409 &&
          code === "23505" &&
          attempt < maxRetries - 1
        ) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        console.error(
          "Supabase Error [journal_entries insert from invoicing]:",
          {
            status: entryRes.status,
            statusText: entryRes.statusText,
            message:
              message ||
              (typeof entryBody === "object"
                ? JSON.stringify(entryBody)
                : entryText),
            raw: entryText.slice(0, 300),
            code: code ?? null,
            details: details ?? null,
            hint: hint ?? null,
          },
        );
        return false;
      }

      const entryRows = Array.isArray(entryBody) ? entryBody : [entryBody];
      const entryId = entryRows[0]?.id as string | undefined;
      if (!entryId) return false;

      for (const line of data.lines) {
        let accountId: string | undefined;
        const accRes = await fetch(
          `${SUPABASE_URL}/rest/v1/accounts_chart?account_code=eq.${line.account_code}&select=id`,
          {
            headers: headers(),
          },
        );
        if (accRes.ok) {
          const accRows = await accRes.json();
          accountId = accRows[0]?.id;
        }

        // Fallback for sales revenue: 5100 (legacy) → 4001 (canonical)
        if (!accountId && line.account_code === "5100") {
          const revRes = await fetch(
            `${SUPABASE_URL}/rest/v1/accounts_chart?account_code=eq.4001&select=id&limit=1`,
            {
              headers: headers(),
            },
          );
          if (revRes.ok) {
            const revRows = await revRes.json();
            accountId = revRows[0]?.id;
          }
        }

        // Missing account is a hard error — silently skipping would create an
        // unbalanced journal entry (debits ≠ credits) with no visible failure.
        if (!accountId) {
          console.error(
            `[createJournalEntry] Account not found for code "${line.account_code}" — aborting journal entry ${entryId}`,
          );
          return false;
        }

        const linePartyId = line.party_id || data.customer_id || null;

        const lineRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            journal_entry_id: entryId,
            account_id: accountId,
            party_id: linePartyId,
            debit_pkr: line.debit_pkr,
            credit_pkr: line.credit_pkr,
          }),
        });

        if (!lineRes.ok) {
          const lineErrText = await lineRes.text().catch(() => "");
          let lineErrBody: Record<string, unknown> = {};
          try {
            lineErrBody = JSON.parse(lineErrText);
          } catch {
            /* non-JSON */
          }
          const lineMsg =
            (lineErrBody as { message?: string }).message ||
            lineErrText ||
            `HTTP ${lineRes.status}`;
          console.error(
            `[createJournalEntry] journal_lines insert failed for account ${line.account_code}:`,
            lineMsg,
          );
          return false;
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          node_id: data.device_node,
          operator_name: data.operator_name,
          action_type: "JOURNAL_ENTRY_CREATED",
          details: {
            module: "LEDGER",
            entry_id: entryId,
            narration: data.narration,
            source: "INVOICING",
          },
        }),
      });
      return true;
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }
      console.error("Supabase Error [createJournalEntry from invoicing]:", err);
      return false;
    }
  }
  return false;
}

/**
 * Narration written when a sales invoice is posted. `journal_entries` has no
 * source-reference column, so this narration is the durable link that lets us
 * detect an entry already created for a given invoice.
 */
function salesInvoiceNarration(invoice: SalesInvoice): string {
  return `Sales invoice ${invoice.invoice_number} posted — ${invoice.parties?.name ?? "Customer"}`;
}

/** True when a journal entry already exists for this invoice's narration. */
async function findSalesInvoiceJournal(
  invoiceNumber: string,
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/journal_entries?narration=ilike.${encodeURIComponent(
        `*${invoiceNumber}*`,
      )}&select=id&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Post an invoice to the sales ledger exactly once.
 *
 * Order matters: the ledger entry is created FIRST and the `is_posted` flag is
 * only set afterwards, so a failed journal leaves the invoice visibly unposted
 * (the Post button stays available) instead of silently losing the entry. The
 * narration probe makes retries, double clicks and repeated calls idempotent —
 * at most one journal entry ever exists per invoice.
 */
export async function postInvoiceWithLedger(
  invoice: SalesInvoice,
): Promise<boolean> {
  try {
    const narration = salesInvoiceNarration(invoice);
    const alreadyPosted = await findSalesInvoiceJournal(invoice.invoice_number);

    // Fully posted already: make the retry a complete no-op.
    if (alreadyPosted && invoice.is_posted) return true;

    if (!alreadyPosted) {
      const taxable = invoice.taxable_value_pkr;
      const salesTax = invoice.sales_tax_amount_pkr;
      const furtherTax = invoice.further_tax_amount_pkr;

      const lines: {
        account_code: string;
        debit_pkr: number;
        credit_pkr: number;
        party_id?: string;
      }[] = [
        {
          account_code: ACCOUNT_CODES.AR,
          debit_pkr: taxable + salesTax + furtherTax,
          credit_pkr: 0,
          party_id: invoice.customer_id,
        },
        {
          account_code: ACCOUNT_CODES.REVENUE,
          debit_pkr: 0,
          credit_pkr: taxable,
          party_id: invoice.customer_id,
        },
      ];
      if (salesTax > 0) {
        lines.push({
          account_code: ACCOUNT_CODES.SALES_TAX,
          debit_pkr: 0,
          credit_pkr: salesTax,
          party_id: invoice.customer_id,
        });
      }
      if (furtherTax > 0) {
        lines.push({
          account_code: ACCOUNT_CODES.FURTHER_TAX,
          debit_pkr: 0,
          credit_pkr: furtherTax,
          party_id: invoice.customer_id,
        });
      }

      const journalOk = await createJournalEntry({
        entry_date: new Date().toISOString().slice(0, 10),
        narration,
        customer_name: invoice.parties?.name || undefined,
        customer_id: invoice.customer_id,
        lines,
        device_node: process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "PC-01",
        operator_name: "Accounts Dept",
      });

      if (!journalOk) {
        console.error(
          `[postInvoiceWithLedger] Journal entry failed for invoice ${invoice.invoice_number}. Invoice left unposted — retry posting.`,
        );
        return false;
      }
    }

    // Safe to repeat: PATCHing is_posted=true is a no-op when already set.
    const posted = await postInvoice(invoice.id);
    if (!posted) {
      console.error(
        `[postInvoiceWithLedger] Ledger is ready for invoice ${invoice.invoice_number} but the posted flag could not be set — retry posting.`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[postInvoiceWithLedger] unexpected error:`, err);
    return false;
  }
}

export interface InvoiceHtmlOptions {
  /** Urdu translations aligned with `invoice.items` order; missing or identity entries render English only. */
  urduItemNames?: Array<string | undefined>;
  /** Brand / Category label aligned with `invoice.items` order (see `resolveInvoiceItemBrands`). */
  itemBrands?: Array<string | undefined>;
  /** Sales person shown in the right-hand meta card. */
  salesPerson?: string;
  /** Payment method (Cash / Bank) shown in the right-hand meta card. */
  paymentMethod?: string;
  /** External reference (PO / voucher) shown in the right-hand meta card. */
  referenceNo?: string;
}

/**
 * Resolves the Brand / Category label for each invoice line from the retail
 * catalog. The returned array is aligned with `items`; unmatched lines yield `undefined`.
 */
export async function resolveInvoiceItemBrands(
  items: SalesInvoiceItem[],
): Promise<Array<string | undefined>> {
  const empty: Array<string | undefined> = items.map(() => undefined);
  if (!SUPABASE_URL || items.length === 0) return empty;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sanitary_products?select=name,category,subcategory`,
      { headers: headers() },
    );
    if (!res.ok) return empty;
    const rows = (await res.json()) as Array<{
      name: string;
      category?: string | null;
      subcategory?: string | null;
    }>;
    const byName = new Map(
      (Array.isArray(rows) ? rows : []).map((r) => [r.name, r]),
    );
    return items.map((item) => {
      const row = byName.get(item.product_name);
      if (!row) return undefined;
      const cat = String(row.category ?? "").trim();
      const sub = String(row.subcategory ?? "").trim();
      if (cat && sub) return `${cat} / ${sub}`;
      return cat || sub || undefined;
    });
  } catch (err) {
    console.warn("Brand / category lookup failed:", err);
    return empty;
  }
}

/**
 * Per-line discount amount in PKR for a STORED row: discount_pkr holds the
 * authoritative TOTAL line discount (its percent part plus any fixed Rs. part
 * were combined at entry time), otherwise fall back to discount_percent of the
 * gross line value (qty × unit price) for legacy rows. Capped at the gross
 * line and floored at zero, so missing/legacy fields read as 0 (never NaN).
 */
export function calcLineDiscountAmount(item: SalesInvoiceItem): number {
  const gross = Number(item.quantity ?? 0) * Number(item.unit_price_pkr ?? 0);
  const disc =
    Number(item.discount_pkr) > 0
      ? Number(item.discount_pkr)
      : (gross * (Number(item.discount_percent) || 0)) / 100;
  return Math.min(gross, Math.max(0, Math.round(disc * 100) / 100));
}

/**
 * Entry-side line discount used by the invoice form (New Tax Invoice): BOTH
 * discount kinds combine —
 *
 *   Line Item Discount = (qty × price × Disc% / 100) + fixed Rs. amount
 *   Item Subtotal      = gross − Line Item Discount   (before tax)
 *
 * Capped at the gross line and floored at zero; missing / invalid inputs
 * read as 0 so the result is never NaN or negative.
 */
export function calcEntryLineDiscount(
  gross: number,
  discountPercent: number | undefined,
  fixedAmount: number | undefined,
): number {
  const g = Math.max(0, Number(gross) || 0);
  const pctPart = g * ((Number(discountPercent) || 0) / 100);
  const fixedPart = Math.max(0, Number(fixedAmount) || 0);
  const disc = pctPart + fixedPart;
  return Math.min(g, Math.max(0, Math.round(disc * 100) / 100));
}

export function generateInvoiceHTML(
  invoice: SalesInvoice,
  options: InvoiceHtmlOptions = {},
): string {
  const fmt = (n: number | null | undefined) =>
    (n ?? 0).toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const esc = (v: string | null | undefined) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

  const profile = loadCompanyProfile();
  const customized = (value: string | undefined, fallback: string) =>
    Boolean(value && value.trim() && value.trim() !== fallback);
  const docTitle = getExportDocumentTitle();
  const contactPhone = customized(profile.phone, DEFAULT_COMPANY.phone)
    ? profile.phone.trim()
    : REFERENCE_PHONE;
  const contactTel = profile.telephone?.trim() || DEFAULT_COMPANY.telephone;
  const contactEmail = customized(profile.email, DEFAULT_COMPANY.email)
    ? profile.email.trim()
    : REFERENCE_EMAIL;
  const contactWebsite = profile.website?.trim() || "www.glassco.pk";
  const socialFacebook = profile.facebook?.trim() || "";
  const socialInstagram = profile.instagram?.trim() || "";
  const socialWhatsapp = profile.whatsapp?.trim() || "";
  const socialParts = [
    socialFacebook ? `FB: ${esc(socialFacebook)}` : "",
    socialInstagram ? `IG: ${esc(socialInstagram)}` : "",
    socialWhatsapp ? `WhatsApp: ${esc(socialWhatsapp)}` : "",
  ].filter(Boolean);
  const footerBrand = COMPANY_LEGAL_NAME;

  const billDate = new Date(invoice.created_at);
  const dateStr = billDate.toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = billDate
    .toLocaleTimeString("en-PK", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const billDateTime = `${dateStr} , ${timeStr}`;

  const items = invoice.items ?? [];
  // line_total_pkr is stored NET of the per-line discount, so the table's
  // "Total" row (gross) and the summary "Discount" row must reconstruct the
  // per-line discounts instead of trusting line_total alone.
  const netLinesTotal = r2(
    items.reduce((sum, item) => sum + Number(item.line_total_pkr ?? 0), 0),
  );
  const totalLineDiscounts = r2(
    items.reduce((sum, item) => sum + calcLineDiscountAmount(item), 0),
  );
  const grossTotal = r2(netLinesTotal + totalLineDiscounts);
  const storedDiscount = Math.max(0, r2(Number(invoice.discount_pkr ?? 0)));
  const extraDiscount =
    storedDiscount > 0
      ? storedDiscount
      : Math.max(0, r2(netLinesTotal - Number(invoice.taxable_value_pkr ?? 0)));
  /** Everything the customer was let off: line discounts + invoice-level XD. */
  const totalDiscount = r2(totalLineDiscounts + extraDiscount);
  // Sales tax defaults to 0. We coerce to a number and treat any non-finite /
  // negative value as 0 so the PDF never invents a GST amount.
  const salesTaxAmt = Math.max(
    0,
    r2(Number(invoice.sales_tax_amount_pkr ?? 0)),
  );
  const furtherTaxRate = invoice.further_tax_rate ?? 0;
  const furtherTaxAmt = r2(Number(invoice.further_tax_amount_pkr ?? 0));
  const totalQty = r2(
    items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
  );
  const qtyFmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString("en-PK") : fmt(n);
  const titleSize = Math.min(COMPANY_HEADER_FONT_SIZE_PX, 30);

  const party = invoice.parties;
  const partyContact = [party?.phone, party?.email].filter((v): v is string =>
    Boolean(v && String(v).trim()),
  );

  const th = (en: string, ur: string, cls = "") =>
    `<th${cls ? ` class="${cls}"` : ""}>${urUnder(en, ur)}</th>`;
  const metaRow = (label: string, labelUr: string, value: string) =>
    `<div class="kv"><span class="k">${label}${urSpan(labelUr, "margin-left:5px;")}</span><span class="v">${value}</span></div>`;

  const itemRows =
    items.length > 0
      ? items
          .map((item, index) => {
            const urduName = options.urduItemNames?.[index];
            // Each row shows its OWN line discount (saved per item on
            // sales_invoice_items) as a percent of the gross line value.
            const lineGross = r2(
              Number(item.quantity ?? 0) * Number(item.unit_price_pkr ?? 0),
            );
            const lineDiscPct =
              lineGross > 0
                ? r2((calcLineDiscountAmount(item) / lineGross) * 100)
                : 0;
            return `
      <tr>
        <td class="ctr mono">${index + 1}</td>
        <td>
          <div class="prod" dir="auto">${esc(item.product_name)}</div>
          ${urduName ? `<div class="ur" lang="ur" dir="rtl">${esc(urduName)}</div>` : ""}
        </td>
        <td class="ctr">${esc(item.unit_of_measure || "PCS")}</td>
        <td class="ctr mono">${qtyFmt(r2(Number(item.quantity ?? 0)))}</td>
        <td class="num">${fmt(item.unit_price_pkr)}</td>
        <td class="num">${fmt(lineDiscPct)}</td>
        <td class="num">${fmt(item.line_total_pkr)}</td>
      </tr>`;
          })
          .join("")
      : `<tr><td class="empty" colspan="7">${urUnder("No line items recorded for this invoice", UR.noLineItemsRecorded)}</td></tr>`;

  const totalRow =
    items.length > 0
      ? `<tr class="total-row">
        <td colspan="3">${urUnder("Total", UR.totalRow)}</td>
        <td class="ctr">${qtyFmt(totalQty)}</td>
        <td></td>
        <td></td>
        <td class="num">${fmt(grossTotal)}</td>
      </tr>`
      : "";

  const summaryRows = [
    `<tr><td>${urUnder("Discount / Extra Discount (XD)", UR.discountXd)}</td><td class="amt">PKR ${fmt(totalDiscount)}</td></tr>`,
    // Only render the Sales Tax (GST) row when there is an actual GST amount.
    // At the 0% default the row is omitted and Total Amount equals the taxable
    // value — no phantom 18% GST is ever printed.
    ...(salesTaxAmt > 0
      ? [
          `<tr><td>${urUnder("Sales Tax (GST)", UR.salesTax)}</td><td class="amt">PKR ${fmt(salesTaxAmt)}</td></tr>`,
        ]
      : []),
    ...(furtherTaxAmt > 0
      ? [
          `<tr><td>${urUnder(`Further Tax (${furtherTaxRate}%)`, UR.furtherTax)}</td><td class="amt">PKR ${fmt(furtherTaxAmt)}</td></tr>`,
        ]
      : []),
  ].join("");

  const grandTotalRow = `<tr class="grand"><td><span class="grand-en">Total Amount</span>${urSpan(UR.totalAmount, "margin-left:8px;font-size:9.5pt;")}</td><td class="amt">PKR ${fmt(invoice.total_invoice_value_pkr)}</td></tr>`;

  return `
    <!DOCTYPE html>
    <html lang="en"><head><meta charset="utf-8">
    <title>${esc(invoice.invoice_number)}</title>
    <style>
      ${URDU_HTML_STYLES}
      ${SANS_FONT_FACES_CSS}
      *{box-sizing:border-box;}
      html,body{margin:0;padding:0;background:#eef1f5;}
      body{font-family:${SANS_FONT_FAMILY_CSS};color:#09090b;font-size:11px;font-weight:400;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .ur,[lang="ur"]{font-family:'Amiri','Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;}
      .sheet{position:relative;width:210mm;min-height:297mm;margin:10px auto;background:#fff;padding:11mm 12mm 9mm;display:flex;flex-direction:column;box-shadow:0 6px 26px rgba(15,23,42,.18);}
      .head{text-align:center;}
      .brand-name{font-size:${titleSize}px;line-height:1.15;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#09090b;}
      .rule{border-top:1px solid #1b55a5ff;margin:8px 0;}
      .subtitle{display:block;background:#d8e2f4;color:#09090b;font-size:13.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:3px;}
      .subtitle .ur{text-transform:none;letter-spacing:normal;font-size:11px;color:#09090b;}
      .meta{display:flex;justify-content:space-between;gap:10mm;margin-top:6mm;page-break-inside:avoid;}
      .meta-l{flex:1 1 auto;min-width:0;}
      .to{font-size:10.5px;font-weight:600;color:#09090b;}
      .cust-name{font-size:12.5px;font-weight:600;color:#09090b;margin-top:3px;}
      .cust-addr{margin-top:2px;color:#18181b;}
      .cust-contact{margin-top:2px;color:#18181b;}
      .meta-r{flex:0 0 auto;min-width:78mm;}
      .kv{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:1.5px 0;font-size:10.5px;page-break-inside:avoid;}
      .kv .k{color:#18181b;white-space:nowrap;}
      .kv .v{font-weight:600;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:#09090b;}
      table.items{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6mm;}
      table.items th,table.items td{border:2px solid #3c3f42ff;padding:5px 6px;vertical-align:middle;}
      table.items thead th{background:#d8e2f4; color:#09090b;font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;text-align:left;}
      table.items thead th .ur{text-align:inherit;text-transform:none;letter-spacing:normal;font-weight:600;font-size:9px;color:#09090b;}
      table.items tbody td{font-size:10.5px;color:#09090b;}
      table.items .ctr{text-align:center;}
      table.items .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
      .mono{font-variant-numeric:tabular-nums;}
      .prod{font-weight:600;color:#09090b;}
      .empty{text-align:center;color:#09090b;padding:14px 6px;}
      tr{page-break-inside:avoid;}
      thead{display:table-header-group;}
      tr.total-row td{background:#d8e2f4; font-weight:600;color:#09090b;}
      .lower{display:flex;justify-content:flex-end;margin-top:5mm;}
      /*------------------------------------------------------------- Summary Box -------------------------------------------------*/
      .summary-col{display:flex;flex-direction:column;gap:3px;width:38%;min-width:60mm;max-width:96mm;page-break-inside:avoid;}
      .summary{width:100%;border-collapse:collapse;page-break-inside:avoid;}
      .summary td{padding:4px 8px;font-size:9pt;}
      .summary td.amt{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;color:#09090b;}
      .summary tr.grand td{font-size:10pt;font-weight:700;padding-top:5px;padding-bottom:5px;color:#09090b;}
      .summary.grand-box{border:1px solid #212121ff;background:#d8e2f4;page-break-inside:avoid;}
      .summary.grand-box td{background:#d8e2f4;}
      /* Page foot = signatures + footer as one atomic block: bottom-anchored via
         the flex auto-margin (dynamic spacing - it collapses so the block snaps
         right below the totals when the page can't pin it), never orphaned onto
         a fresh page while any room is left (break-before: avoid), never split
         mid-block (break-inside: avoid). */
      .page-foot{margin-top:auto;break-inside:avoid;page-break-inside:avoid;break-before:avoid;page-break-before:avoid;}
      .signatures{display:flex;justify-content:space-between;gap:30px;padding-top:16px;border-top:1px solid #0f172a;page-break-inside:avoid;}
      .sig{width:46%;text-align:center;font-size:10.5px;font-weight:600;color:#09090b;}
      .sig .ur{text-align:center;font-weight:600;}
      /*------------------------------------------------------------- Footer -------------------------------------------------*/
      .footer{margin-top:12px;text-align:center;page-break-inside:avoid;}
      .footer .legal{font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#18181b;}
      .footer .contact-line{font-size:9.5px;font-weight:400;color:#09090b;margin-top:2px;}
      .footer .social-line{margin-top:1px;}
      @page{size:A4 portrait;margin:0;}
      @media print{
        html,body{background:#fff;}
        /* Reserve the REAL page area (100vh in print = paper minus @page
           margins), not a hard 297mm: on Letter or with dialog/printer margins
           a rigid 297mm sheet overflows the page and orphans the footer. */
        .sheet{margin:0;box-shadow:none;min-height:100vh;}
        *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
        a[href]:after{content:none!important;}
      }
    </style></head><body>
    <div class="sheet">
      <div class="head">
        <div class="brand-name">${esc(docTitle)}</div>
        <div class="rule"></div>
        <div class="subtitle">S A L E&nbsp;&nbsp;I N V O I C E&nbsp;&nbsp;/&nbsp;${urSpan(UR.saleInvoice, "margin-left:4px;font-size:11px;letter-spacing:normal;")}</div>
      </div>

      <div class="meta">
        <div class="meta-l">
          <div class="to"><span>TO:</span>${urSpan(UR.billTo, "margin-left:6px;")}</div>
          <div class="cust-name">${esc(party?.name) || "&mdash;"}</div>
          ${party?.address?.trim() ? `<div class="cust-addr">${esc(party.address.trim())}</div>` : ""}
          ${partyContact.length ? `<div class="cust-contact">${partyContact.map((v) => esc(v)).join(" &bull; ")}</div>` : ""}
        </div>
        <div class="meta-r">
          ${metaRow("Mob", UR.phone, esc(contactPhone))}
          ${metaRow("Tel", UR.tel, esc(contactTel))}
          ${metaRow("Bill No", "نمبر بل", esc(invoice.invoice_number))}
          ${metaRow("Bill Date", UR.date, esc(billDateTime))}
          ${metaRow("Page", UR.pageOf, "1 of 1")}
        </div>
      </div>

      <table class="items">
        <colgroup>
          <col style="width:6%"><col style="width:33%"><col style="width:9%"><col style="width:9%"><col style="width:14%"><col style="width:10%"><col style="width:19%">
        </colgroup>
        <thead>
          <tr>
            ${th("Sr.#", UR.srNo, "ctr")}
            ${th("Product Name", UR.productDetail)}
            ${th("Unit", UR.unit, "ctr")}
            ${th("Qty", UR.qty, "ctr")}
            ${th("Price", UR.price, "num")}
            ${th("Disc%", UR.discPercent, "num")}
            ${th("Total Price", UR.totalPrice, "num")}
          </tr>
        </thead>
        <tbody>${itemRows}${totalRow}</tbody>
      </table>

      <div class="lower">
        <div class="summary-col">
          <table class="summary">
            ${summaryRows}
          </table>
          <table class="summary grand-box">
            ${grandTotalRow}
          </table>
        </div>
      </div>

      <div class="page-foot">
        <div class="signatures">
          <div class="sig">${urUnder("Received By (Customer)", UR.receivedByCustomer)}</div>
          <div class="sig">${urUnder("Authorised Signatory", UR.authorisedSignatory)}</div>
        </div>

        <div class="footer">
          <div class="legal">${esc(footerBrand)}</div>
          <div class="contact-line">${esc(contactEmail)} | ${esc(contactWebsite)} | ${esc(contactPhone)}</div>
          ${socialParts.length > 0 ? `<div class="contact-line social-line">${socialParts.join(" | ")}</div>` : ""}
        </div>
      </div>
    </div>
    </body></html>`;
}

export async function triggerPrint(
  invoice: SalesInvoice,
): Promise<{ success: boolean; message: string }> {
  const itemBrands = await resolveInvoiceItemBrands(invoice.items ?? []);
  const html = generateInvoiceHTML(invoice, { itemBrands });

  // Try Tauri native print first
  const invoke =
    (typeof window !== "undefined" &&
      (
        window as {
          __TAURI__?: {
            invoke?: (
              cmd: string,
              args?: Record<string, unknown>,
            ) => Promise<Record<string, unknown>>;
          };
        }
      ).__TAURI__?.invoke) ??
    null;
  if (invoke) {
    try {
      const base64 = btoa(unescape(encodeURIComponent(html)));
      const result = await invoke("print_html_document", {
        html_base64: base64,
        printer_name: "default",
      });
      if (result?.success)
        return { success: true, message: "Print job sent to printer" };
    } catch {
      // fall through to browser print
    }
  }

  // Browser fallback: inject HTML into a hidden iframe and trigger print
  return new Promise((resolve) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:none;";
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (!doc) {
        document.body.removeChild(iframe);
        resolve({ success: false, message: "Could not open print frame" });
        return;
      }
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            /* already removed */
          }
          resolve({ success: true, message: "Print dialog opened" });
        }, 1000);
      }, 500);
    } catch (err) {
      resolve({
        success: false,
        message: err instanceof Error ? err.message : "Print failed",
      });
    }
  });
}

// ============================================================================
// DISPATCH RECORDS
// ============================================================================

export interface DispatchLineItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_pkr: number;
  line_total_pkr: number;
  unit_of_measure: string;
  discount_percent?: number;
  discount_pkr?: number;
}

/** Dispatch workflow states: printed → approved (stock + ledger moved) → dispatched. */
export type DispatchStatus = "pending_approval" | "approved" | "dispatched";

export interface DispatchRecord {
  id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  taxable_value_pkr: number;
  sales_tax_rate: number;
  sales_tax_amount_pkr: number;
  further_tax_rate: number;
  further_tax_amount_pkr: number;
  total_invoice_value_pkr: number;
  line_items: DispatchLineItem[];
  operator_name: string;
  device_node: string;
  posted_at: string;
  created_at: string;
  /**
   * Optional in the type because a database missing migration
   * 20261107010000 does not return the column yet — UI treats an absent
   * status as 'dispatched' (all pre-workflow records are completed).
   */
  status?: DispatchStatus;
  /** Date the goods physically leave (editable in the dispatch edit modal). */
  dispatch_date?: string;
  /** Free-text transport details (vehicle / transporter / remarks). */
  transport_details?: string;
  /** Operator remarks captured on the dispatch. */
  operator_notes?: string;
  /** Joined from parties via customer_id — fallback when the denormalized customer_name is empty. */
  parties?: Party;
}

/** Resolve a party's display name by id; returns "" when unavailable. */
async function fetchPartyNameById(customerId: string): Promise<string> {
  if (!SUPABASE_URL || !customerId) return "";
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/parties?id=eq.${encodeURIComponent(customerId)}&select=name&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return "";
    const data = await res.json();
    const name = Array.isArray(data) ? data[0]?.name : undefined;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

export async function createDispatchRecord(record: {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  taxable_value_pkr: number;
  sales_tax_rate: number;
  sales_tax_amount_pkr: number;
  further_tax_rate: number;
  further_tax_amount_pkr: number;
  total_invoice_value_pkr: number;
  line_items: DispatchLineItem[];
  operator_name: string;
  device_node: string;
  /**
   * Status at dispatch record creation. Auto-approved on creation so that
   * the customer ledger is posted immediately and no manual "Approve"
   * step is required in the Dispatch History interface. Callers that need a
   * different initial state can pass `status` explicitly.
   */
  status?: DispatchStatus;
  dispatch_date?: string;
  transport_details?: string;
  operator_notes?: string;
}): Promise<DispatchRecord | null> {
  if (!SUPABASE_URL) return null;
  // Never persist an empty customer_name: callers may not have the party loaded,
  // so fall back to looking the name up via customer_id before the insert.
  const customerName =
    record.customer_name?.trim() ||
    (await fetchPartyNameById(record.customer_id));

  // Auto-approved on creation — no pending/approval step needed.
  const effectiveStatus = record.status ?? "approved";

  const base: Record<string, unknown> = {
    invoice_id: record.invoice_id,
    invoice_number: record.invoice_number,
    customer_id: record.customer_id,
    customer_name: customerName,
    taxable_value_pkr: record.taxable_value_pkr,
    sales_tax_rate: record.sales_tax_rate,
    sales_tax_amount_pkr: record.sales_tax_amount_pkr,
    further_tax_rate: record.further_tax_rate,
    further_tax_amount_pkr: record.further_tax_amount_pkr,
    total_invoice_value_pkr: record.total_invoice_value_pkr,
    line_items: record.line_items,
    operator_name: record.operator_name,
    device_node: record.device_node,
  };
  // Workflow columns only exist after migration 20261107010000 — include them
  // when provided, and drop them on a column error so printing still works
  // against a not-yet-migrated database.
  const workflow: Record<string, unknown> = {};
  if (effectiveStatus !== undefined) workflow.status = effectiveStatus;
  if (record.dispatch_date !== undefined)
    workflow.dispatch_date = record.dispatch_date;
  if (record.transport_details !== undefined)
    workflow.transport_details = record.transport_details;
  if (record.operator_notes !== undefined)
    workflow.operator_notes = record.operator_notes;

  const insert = async (
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; row: DispatchRecord | null } | { ok: false; status: number; message: string }> => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/dispatch_records`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message } = body as { message?: string };
      const fullMessage = message ?? text.slice(0, 300);
      console.error("Supabase Error [dispatch_records insert]:", {
        status: res.status,
        message: fullMessage,
        body,
      });
      return { ok: false, status: res.status, message: fullMessage };
    }
    const data = Array.isArray(body) ? body : [body];
    const row = (data[0] as DispatchRecord) ?? null;
    if (row) row.line_items = parseLineItems(row.line_items);
    return { ok: true, row };
  };

  try {
    const first = await insert({ ...base, ...workflow });
    if (first.ok) return first.row;

    // Missing workflow columns (database predates 20261107010000): retry with
    // the legacy column set so the print flow never loses its dispatch record.
    const missingColumn =
      first.status === 400 &&
      /does not exist|schema cache/i.test(first.message) &&
      Object.keys(workflow).some((key) => first.message.includes(key));
    if (missingColumn && Object.keys(workflow).length > 0) {
      console.warn(
        "[dispatch_records] Workflow columns missing — run migration 20261107010000_dispatch_approval_workflow.sql. Retrying without them.",
      );
      const legacy = await insert(base);
      return legacy.ok ? legacy.row : null;
    }
    return null;
  } catch (err) {
    console.error(
      "Supabase Error [dispatch_records insert]:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Returns the dispatch record already stored for an invoice, if any. Used by
 * the print flow so re-prints never create a second (duplicate) record for
 * the same invoice.
 */
export async function findDispatchRecordByInvoice(
  invoiceId: string,
): Promise<DispatchRecord | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dispatch_records?invoice_id=eq.${encodeURIComponent(invoiceId)}&select=*,parties:customer_id(id,name)&order=created_at.asc&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const row = Array.isArray(data) ? (data[0] as DispatchRecord) : undefined;
    if (!row) return null;
    row.line_items = parseLineItems(row.line_items);
    return row;
  } catch (err) {
    console.warn("Could not look up dispatch record for invoice:", err);
    return null;
  }
}

/**
 * Approves a pending dispatch in a single RPC (`approve_dispatch`):
 * flips status → 'approved', deducts stock, and posts the customer's ledger
 * debit (journal entry) — all in one database transaction. Each effect is
 * guarded by sales_invoices state, so retrying is safe and nothing runs
 * before approval.
 */
export async function approveDispatch(
  dispatchId: string,
  operatorName: string,
  deviceNode: string,
): Promise<{
  success: boolean;
  status?: DispatchStatus;
  alreadyApproved?: boolean;
  invoiceNumber?: string;
  totalPayable?: number;
  error?: string;
}> {
  if (!SUPABASE_URL)
    return { success: false, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/approve_dispatch`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_dispatch_id: dispatchId,
        p_operator_name: operatorName,
        p_device_node: deviceNode,
      }),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, hint } = body as { message?: string; hint?: string };
      console.error("Supabase Error [approve_dispatch RPC]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        hint: hint ?? null,
      });
      if (/schema cache|not find function/i.test(message ?? "")) {
        return {
          success: false,
          error:
            "The approve_dispatch function is missing — run migration 20261107010000_dispatch_approval_workflow.sql in the database SQL editor, then retry.",
        };
      }
      return { success: false, error: message ?? `Approval failed (HTTP ${res.status})` };
    }
    const data = body as {
      status?: string;
      already_approved?: boolean;
      invoice_number?: string;
      total_payable?: number;
    };
    return {
      success: true,
      status: (data.status as DispatchStatus) ?? "approved",
      alreadyApproved: data.already_approved === true,
      invoiceNumber: data.invoice_number,
      totalPayable: typeof data.total_payable === "number" ? data.total_payable : undefined,
    };
  } catch (err) {
    console.error(
      "Supabase Error [approve_dispatch RPC]:",
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

export type DispatchRecordPatch = Partial<
  Pick<
    DispatchRecord,
    | "status"
    | "dispatch_date"
    | "transport_details"
    | "operator_notes"
    | "line_items"
    | "taxable_value_pkr"
    | "sales_tax_rate"
    | "sales_tax_amount_pkr"
    | "further_tax_rate"
    | "further_tax_amount_pkr"
    | "total_invoice_value_pkr"
    | "operator_name"
  >
>;

/**
 * Updates dispatch parameters (items and their recalculated totals, date,
 * transport details, notes, or the approved → dispatched transition).
 * Returns the fresh row, or null on failure.
 */
export async function updateDispatchRecord(
  dispatchId: string,
  patch: DispatchRecordPatch,
): Promise<DispatchRecord | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dispatch_records?id=eq.${encodeURIComponent(dispatchId)}`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
    );
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const err = (body ?? {}) as { message?: string };
      console.error("Supabase Error [dispatch_records update]:", {
        status: res.status,
        message: err.message ?? text.slice(0, 300),
      });
      return null;
    }
    const rows = Array.isArray(body) ? body : [];
    const row = (rows[0] as DispatchRecord) ?? null;
    if (row) row.line_items = parseLineItems(row.line_items);
    return row;
  } catch (err) {
    console.error(
      "Supabase Error [dispatch_records update]:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Deletes a dispatch entry from Dispatch History.
 *
 * Effects are gated per component so every status is safe:
 *  - pending_approval → only the dispatch row is removed (no stock or ledger
 *    adjustments were ever made for it);
 *  - approved/dispatched → the posted journal entry is removed and stock is
 *    returned, but only where those effects actually happened
 *    (sales_invoices.is_posted / stock_deducted), and the invoice is flipped
 *    back to draft so books and inventory stay consistent.
 */
export async function deleteDispatchRecord(record: DispatchRecord): Promise<{
  success: boolean;
  error?: string;
  stockRestored: boolean;
  ledgerReversed: boolean;
}> {
  if (!SUPABASE_URL)
    return {
      success: false,
      error: "Server URL is not configured",
      stockRestored: false,
      ledgerReversed: false,
    };
  try {
    // ── 1. Read invoice state before anything disappears ────────────────────
    let isPosted = false;
    let stockSettled = false;
    try {
      const headRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${record.invoice_id}&select=is_posted,stock_deducted`,
        { headers: headers() },
      );
      if (headRes.ok) {
        const rows = (await headRes.json()) as Array<{
          is_posted?: boolean;
          stock_deducted?: boolean | null;
        }>;
        const head = Array.isArray(rows) ? rows[0] : undefined;
        isPosted = head?.is_posted === true;
        stockSettled = head?.stock_deducted === true;
      }
    } catch (err) {
      console.warn("Could not read invoice state before dispatch delete:", err);
    }

    // ── 2. Remove the dispatch row (the primary operation) ──────────────────
    // If any later reversal step fails, the invoice still carries is_posted /
    // stock_deducted, so the regular invoice delete remains a complete,
    // idempotent way to finish the reversal.
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/dispatch_records?id=eq.${encodeURIComponent(record.id)}`,
      { method: "DELETE", headers: headers() },
    );
    if (!delRes.ok) {
      const text = await delRes.text();
      console.error("Supabase Error [dispatch_records delete]:", {
        status: delRes.status,
        message: text.slice(0, 300),
      });
      return {
        success: false,
        error: `Delete failed (HTTP ${delRes.status})`,
        stockRestored: false,
        ledgerReversed: false,
      };
    }

    // ── 3. Reverse inventory (only when units were deducted) ────────────────
    let stockRestored = false;
    if (stockSettled) {
      let lines: Array<
        Pick<DispatchLineItem, "product_id" | "product_name" | "quantity">
      > = record.line_items.length > 0 ? record.line_items : [];
      if (lines.length === 0) {
        // Older snapshots may keep products only on the invoice side.
        try {
          const itemRes = await fetch(
            `${SUPABASE_URL}/rest/v1/sales_invoice_items?invoice_id=eq.${record.invoice_id}&select=product_id,product_name,quantity`,
            { headers: headers() },
          );
          if (itemRes.ok) {
            const rows = await itemRes.json();
            if (Array.isArray(rows)) lines = rows;
          }
        } catch {
          /* no fallback available */
        }
      }
      if (lines.length > 0) {
        const errors = await applyStockMovement(lines, "restore");
        stockRestored = errors.length === 0;
        if (errors.length > 0) {
          console.warn(
            "Stock not returned on dispatch delete:",
            errors.join("; "),
          );
        }
      } else {
        stockRestored = true; // nothing to return
      }
    }

    // ── 4. Reverse the ledger (only when a posted entry exists) ─────────────
    const ledgerReversed = isPosted
      ? await removeSalesInvoiceJournal(record.invoice_number)
      : false;

    // ── 5. Bring the invoice back to draft in line with what was reversed ───
    const patch: Record<string, unknown> = {};
    if (stockSettled && stockRestored) patch.stock_deducted = false;
    if (isPosted && ledgerReversed) patch.is_posted = false;
    if (Object.keys(patch).length > 0) {
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sales_invoices?id=eq.${record.invoice_id}`,
        {
          method: "PATCH",
          headers: { ...headers(), Prefer: "return=minimal" },
          body: JSON.stringify(patch),
        },
      );
      if (!patchRes.ok) {
        console.warn(
          "Supabase Error [invoice draft reset after dispatch delete]:",
          patchRes.status,
          (await patchRes.text()).slice(0, 300),
        );
      }
    }

    return { success: true, stockRestored, ledgerReversed };
  } catch (err) {
    console.error(
      "Supabase Error [deleteDispatchRecord]:",
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
      stockRestored: false,
      ledgerReversed: false,
    };
  }
}

export async function fetchDispatchRecords(): Promise<DispatchRecord[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dispatch_records?select=*,parties:customer_id(id,name)&order=posted_at.desc&limit=100`,
      { headers: headers() },
    );
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const { message, code, details, hint } = body as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      console.error("Supabase Error [dispatch_records fetch]:", {
        status: res.status,
        message: message ?? text.slice(0, 300),
        code: code ?? null,
        details: details ?? null,
        hint: hint ?? null,
      });
      return [];
    }
    const records = (Array.isArray(body) ? body : []) as DispatchRecord[];
    return records.map((r) => ({
      ...r,
      line_items: parseLineItems(r.line_items),
    }));
  } catch (err) {
    console.error(
      "Supabase Error [dispatch_records fetch]:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** line_items is a JSONB column that has been written both as an array and as a JSON string. */
function parseLineItems(raw: unknown): DispatchLineItem[] {
  if (Array.isArray(raw)) return raw as DispatchLineItem[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DispatchLineItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function dispatchItemsToInvoiceItems(
  invoiceId: string,
  items: DispatchLineItem[],
): SalesInvoiceItem[] {
  return items.map((item, index) => ({
    id: `${invoiceId}-line-${index}`,
    invoice_id: invoiceId,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price_pkr: item.unit_price_pkr,
    line_total_pkr: item.line_total_pkr,
    unit_of_measure: item.unit_of_measure,
    discount_percent: item.discount_percent,
    discount_pkr: item.discount_pkr,
  }));
}

/**
 * Invoices posted through the dispatch flow keep their products only on the dispatch record,
 * so fill in `items` from there whenever sales_invoice_items is empty.
 */
export function attachDispatchLineItems(
  invoices: SalesInvoice[],
  records: DispatchRecord[],
): SalesInvoice[] {
  const byInvoice = new Map<string, DispatchRecord>();
  records.forEach((r) => {
    if (r.invoice_id && !byInvoice.has(r.invoice_id))
      byInvoice.set(r.invoice_id, r);
    if (r.invoice_number && !byInvoice.has(r.invoice_number))
      byInvoice.set(r.invoice_number, r);
  });
  return invoices.map((inv) => {
    if (inv.items && inv.items.length > 0) return inv;
    const record = byInvoice.get(inv.id) ?? byInvoice.get(inv.invoice_number);
    if (!record || record.line_items.length === 0) return inv;
    return {
      ...inv,
      items: dispatchItemsToInvoiceItems(inv.id, record.line_items),
    };
  });
}
