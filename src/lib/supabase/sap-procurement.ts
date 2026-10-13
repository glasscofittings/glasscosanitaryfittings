// =============================================================================
// SAP-STYLE PROCUREMENT ENGINE (MM / AP Modules)
// Tables: suppliers, purchase_orders, goods_receipt_notes_sap, purchase_invoices_sap
// =============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  supplier_code: string;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  payment_terms_days: number;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  total_amount_pkr: number;
  status: "draft" | "approved" | "fulfilled" | "cancelled";
  created_at: string;
  suppliers?: Supplier;
}

export interface GoodsReceiptNoteSAP {
  id: string;
  grn_number: string;
  po_id: string;
  supplier_id: string;
  lot_id: string;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  unit_price_pkr: number;
  status: "draft" | "inspected" | "invoiced";
  created_at: string;
  purchase_orders?: PurchaseOrder;
  suppliers?: Supplier;
}

export interface PurchaseInvoiceSAP {
  id: string;
  invoice_number: string;
  grn_id: string;
  po_id: string;
  supplier_id: string;
  taxable_amount: number;
  tax_amount: number;
  total_payable: number;
  status: "draft" | "pending_approval" | "posted" | "blocked_variance" | "cancelled";
  variance_flag: boolean;
  variance_reason: string | null;
  created_at: string;
  goods_receipt_notes_sap?: GoodsReceiptNoteSAP;
  purchase_orders?: PurchaseOrder;
  suppliers?: Supplier;
}

export interface SAPResult<T> {
  data: T | null;
  error: string | null;
}

// ── Suppliers ────────────────────────────────────────────────────────────────

export async function fetchSuppliers(): Promise<Supplier[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/suppliers?order=company_name.asc`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function createSupplier(data: {
  supplier_code: string;
  company_name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  payment_terms_days?: number;
}): Promise<SAPResult<Supplier>> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/suppliers`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: body.message ?? `Insert failed (${res.status})` };
    }
    const rows = await res.json();
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Purchase Orders ──────────────────────────────────────────────────────────

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/purchase_orders?select=*,suppliers(*)}&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      // Fallback without expand
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/purchase_orders?order=created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchPurchaseOrderById(id: string): Promise<PurchaseOrder | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/purchase_orders?id=eq.${id}&select=*,suppliers(*)`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data[0] ?? null) : null;
  } catch {
    return null;
  }
}

export async function createPurchaseOrder(data: {
  po_number: string;
  supplier_id: string;
  total_amount_pkr: number;
  status?: "draft" | "approved";
}): Promise<SAPResult<PurchaseOrder>> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/purchase_orders`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: body.message ?? `Insert failed (${res.status})` };
    }
    const rows = await res.json();
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updatePurchaseOrderStatus(
  id: string,
  status: PurchaseOrder["status"]
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/purchase_orders?id=eq.${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Goods Receipt Notes (SAP) ────────────────────────────────────────────────

export async function fetchGoodsReceiptNotesSAP(): Promise<GoodsReceiptNoteSAP[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/goods_receipt_notes_sap?select=*,purchase_orders(*),suppliers(*)&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/goods_receipt_notes_sap?order=created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function createGoodsReceiptNoteSAP(data: {
  grn_number: string;
  po_id: string;
  supplier_id: string;
  lot_id: string;
  received_qty: number;
  accepted_qty: number;
  rejected_qty?: number;
  unit_price_pkr: number;
  status?: "draft" | "inspected";
}): Promise<SAPResult<GoodsReceiptNoteSAP>> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/goods_receipt_notes_sap`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: body.message ?? `Insert failed (${res.status})` };
    }
    const rows = await res.json();
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateGoodsReceiptNoteSAPStatus(
  id: string,
  status: GoodsReceiptNoteSAP["status"]
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/goods_receipt_notes_sap?id=eq.${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Purchase Invoices (SAP) with 3-Way Match ────────────────────────────────

export async function fetchPendingPurchaseInvoicesSAP(): Promise<PurchaseInvoiceSAP[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/purchase_invoices_sap?status=eq.pending_approval&select=*,goods_receipt_notes_sap(*),purchase_orders(*),suppliers(*)}&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/purchase_invoices_sap?status=eq.pending_approval&order=created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchAllPurchaseInvoicesSAP(): Promise<PurchaseInvoiceSAP[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/purchase_invoices_sap?select=*,suppliers(*)&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/purchase_invoices_sap?order=created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function createPurchaseInvoiceSAP(data: {
  invoice_number: string;
  grn_id: string;
  po_id: string;
  supplier_id: string;
  taxable_amount: number;
  tax_amount: number;
  total_payable: number;
  status?: "draft" | "pending_approval";
  variance_flag?: boolean;
  variance_reason?: string;
}): Promise<SAPResult<PurchaseInvoiceSAP>> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/purchase_invoices_sap`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: body.message ?? `Insert failed (${res.status})` };
    }
    const rows = await res.json();
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function approvePurchaseInvoiceSAP(
  invoiceId: string,
  operatorName: string
): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  // 1. Fetch invoice with related data
  const invRes = await fetch(
    `${SUPABASE_URL}/rest/v1/purchase_invoices_sap?id=eq.${invoiceId}&select=*,purchase_orders(*),suppliers(*)`,
    { headers: headers() }
  );
  if (!invRes.ok) return { success: false, error: "Failed to fetch invoice" };
  const invRows = await invRes.json();
  const invoice = invRows[0] as PurchaseInvoiceSAP | undefined;
  if (!invoice) return { success: false, error: "Invoice not found" };
  if (invoice.status !== "pending_approval") {
    return { success: false, error: `Invoice status is '${invoice.status}', expected 'pending_approval'` };
  }

  // 2. Resolve AP account (2001) and Raw Material account (1101)
  const acctsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gl_accounts?select=id,account_code&or=(account_code.eq."2001",account_code.eq."1101")`,
    { headers: headers() }
  );
  if (!acctsRes.ok) return { success: false, error: "Failed to resolve GL accounts" };
  const accts = await acctsRes.json();
  const apAcc = Array.isArray(accts) ? accts.find((a: { account_code: string }) => a.account_code === "2001") : null;
  const rawAcc = Array.isArray(accts) ? accts.find((a: { account_code: string }) => a.account_code === "1101") : null;
  if (!apAcc || !rawAcc) {
    return { success: false, error: "Could not resolve GL accounts 2001 (AP) or 1101 (Raw Material)" };
  }

  // 3. Post double-entry to gl_ledger_entries
  const txnRef = `PINV-${invoice.invoice_number}-${Date.now()}`;
  const ledgerRes = await fetch(`${SUPABASE_URL}/rest/v1/gl_ledger_entries`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify([
      {
        transaction_ref: txnRef,
        account_id: rawAcc.id,
        debit_pkr: invoice.total_payable,
        credit_pkr: 0.0,
        posted_by: operatorName,
      },
      {
        transaction_ref: txnRef,
        account_id: apAcc.id,
        debit_pkr: 0.0,
        credit_pkr: invoice.total_payable,
        posted_by: operatorName,
      },
    ]),
  });
  if (!ledgerRes.ok) {
    const body = await ledgerRes.json().catch(() => ({}));
    return { success: false, error: `Ledger posting failed: ${body.message ?? ledgerRes.statusText}` };
  }

  // 4. Mark invoice posted
  await fetch(`${SUPABASE_URL}/rest/v1/purchase_invoices_sap?id=eq.${invoiceId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ status: "posted" }),
  });

  // 5. Mark GRN invoiced
  if (invoice.grn_id) {
    await fetch(`${SUPABASE_URL}/rest/v1/goods_receipt_notes_sap?id=eq.${invoice.grn_id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status: "invoiced" }),
    });
  }

  // 6. Audit log
  fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      operator_name: operatorName,
      action_type: "SAP_PURCHASE_INVOICE_APPROVED",
      module: "SAP_FI",
      details: {
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        total_payable: invoice.total_payable,
        transaction_ref: txnRef,
      },
    }),
  }).catch(() => {});

  return { success: true };
}

export async function blockPurchaseInvoiceSAP(
  invoiceId: string,
  reason: string
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/purchase_invoices_sap?id=eq.${invoiceId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        status: "blocked_variance",
        variance_flag: true,
        variance_reason: reason,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
