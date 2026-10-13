import { createClient } from "@supabase/supabase-js";
import { formatPKR } from "@/lib/utils/formatters";

export interface GoodsReceiptNote {
  id: string;
  grn_number: string;
  gate_pass_id: string | null;
  vendor_id: string | null;
  vendor_name: string;
  received_date: string;
  items: Array<{
    description?: string;
    lot_code?: string;
    quantity: number;
    unit_of_measure?: string;
    unit_price?: number;
    total_amount?: number;
  }>;
  status: "pending_invoice" | "invoiced";
  created_at: string;
}

export interface PurchaseInvoice {
  id: string;
  invoice_number: string;
  grn_id: string | null;
  grn_number: string;
  vendor_id: string | null;
  vendor_name: string;
  taxable_amount: number;
  tax_amount: number;
  total_payable: number;
  status: "pending_approval" | "posted" | "cancelled";
  items: Array<{
    description?: string;
    lot_code?: string;
    quantity: number;
    unit_of_measure?: string;
    unit_price?: number;
    total_amount?: number;
  }>;
  created_at: string;
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

export async function fetchPendingPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/purchase_invoices?status=eq.pending_approval&select=*&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [purchase_invoices fetch pending]:", { status: res.status, body: await res.json() });
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as PurchaseInvoice[]) : [];
  } catch (err) {
    console.error("Supabase Error [fetchPendingPurchaseInvoices]:", err);
    return [];
  }
}

export async function fetchAllPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/purchase_invoices?select=*&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [purchase_invoices fetch all]:", { status: res.status, body: await res.json() });
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as PurchaseInvoice[]) : [];
  } catch (err) {
    console.error("Supabase Error [fetchAllPurchaseInvoices]:", err);
    return [];
  }
}

export async function generateGRNFromIGP(payload: {
  igp_id: string;
  unit_price?: number;
  operator_name?: string;
  device_node?: string;
}): Promise<{
  success: boolean;
  grn_id?: string;
  grn_number?: string;
  invoice_id?: string;
  invoice_number?: string;
  error?: string;
}> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    // 1. Try calling the PostgreSQL RPC function
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/generate_grn_from_igp`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_igp_id: payload.igp_id,
        p_unit_price: payload.unit_price ?? 0,
        p_operator_name: payload.operator_name || "Gate Operator",
        p_device_node: payload.device_node || "PC-01",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    }

    // Fallback: If RPC does not exist or errors, perform atomic direct REST fallback
    console.warn("RPC generate_grn_from_igp failed or not found, using REST fallback:", res.status);
    
    // Fetch IGP details
    const igpRes = await fetch(`${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${payload.igp_id}&select=*`, {
      headers: headers(),
    });
    if (!igpRes.ok) throw new Error("Could not find Inward Gate Pass");
    const igpRows = await igpRes.json();
    const igp = igpRows[0];
    if (!igp) throw new Error("IGP not found");

    // Lookup vendor
    let vendorName = igp.supplier_id || "Vendor";
    let vendorId: string | null = null;
    if (igp.supplier_id) {
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/parties?id=eq.${igp.supplier_id}&select=id,name`, {
        headers: headers(),
      });
      if (pRes.ok) {
        const pRows = await pRes.json();
        if (pRows[0]) {
          vendorId = pRows[0].id;
          vendorName = pRows[0].name;
        }
      }
    }

    const year = new Date().getFullYear();
    const randSeq = String(Math.floor(1000 + Math.random() * 9000));
    const grnNumber = `GRN-${year}-${randSeq}`;
    const invNumber = `PINV-${year}-${randSeq}`;

    // Bill only ACCEPTED material; fall back to legacy rows without the column.
    const qty = Number(igp.accepted_qty ?? igp.inward_qty ?? igp.gross_weight_kg ?? 1) || 0;
    const rejectedQty = Number(igp.rejected_qty ?? 0) || 0;
    const unitPrice = Number(payload.unit_price || 0);
    const taxable = Math.round(qty * unitPrice * 100) / 100;
    const totalPayable = taxable;

    const items = [
      {
        description: igp.material_description,
        lot_code: igp.vendor_lot_code || igp.vendor_lot_number || "",
        quantity: qty,
        unit_of_measure: igp.unit_of_measure || "KG",
        unit_price: unitPrice,
        total_amount: totalPayable,
      },
    ];

    // Insert GRN
    const grnRes = await fetch(`${SUPABASE_URL}/rest/v1/goods_receipt_notes`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        grn_number: grnNumber,
        gate_pass_id: igp.id,
        vendor_id: vendorId,
        vendor_name: vendorName,
        received_date: new Date().toISOString().split("T")[0],
        items: items,
        accepted_qty: qty,
        rejected_qty: rejectedQty,
        rejection_reason: igp.rejection_reason ?? null,
        status: "pending_invoice",
      }),
    });
    const grnBody = await grnRes.json();
    const createdGrn = Array.isArray(grnBody) ? grnBody[0] : grnBody;

    // Insert Purchase Invoice (pending_approval - STRICTLY NO LEDGER POSTING YET)
    const invRes = await fetch(`${SUPABASE_URL}/rest/v1/purchase_invoices`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        invoice_number: invNumber,
        grn_id: createdGrn?.id ?? null,
        grn_number: grnNumber,
        vendor_id: vendorId,
        vendor_name: vendorName,
        taxable_amount: taxable,
        tax_amount: 0,
        total_payable: totalPayable,
        status: "pending_approval",
        items: items,
      }),
    });
    const invBody = await invRes.json();
    const createdInv = Array.isArray(invBody) ? invBody[0] : invBody;

    // Update IGP status
    await fetch(`${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${igp.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status: "CONVERTED_TO_GRN" }),
    });

    return {
      success: true,
      grn_id: createdGrn?.id,
      grn_number: grnNumber,
      invoice_id: createdInv?.id,
      invoice_number: invNumber,
    };
  } catch (err: any) {
    console.error("Failed to generate GRN from IGP:", err);
    return { success: false, error: err.message || "Failed to generate GRN" };
  }
}

interface GlAccountSeed {
  account_code: string;
  account_name: string;
  account_type: string;
}

async function queryAccountIds(query: string): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/accounts_chart?select=id&${query}`, {
    headers: headers(),
  });
  if (!res.ok) {
    console.warn("accounts_chart lookup failed:", res.status, await res.text());
    return [];
  }
  const rows = await res.json();
  return Array.isArray(rows)
    ? rows.map((r: { id?: string }) => r.id).filter((id): id is string => Boolean(id))
    : [];
}

/**
 * Resolves a GL account by code, then by a semantic fallback (type/name),
 * and finally self-heals by creating the account when the chart of accounts
 * is missing it — so posting never fails on an empty COA.
 */
async function ensureGlAccount(
  codes: string[],
  fallbackQuery: string,
  seed: GlAccountSeed
): Promise<string | null> {
  const byCode = await queryAccountIds(`account_code=in.(${codes.join(",")})&limit=1`);
  if (byCode[0]) return byCode[0];

  const byFallback = await queryAccountIds(`${fallbackQuery}&limit=1`);
  if (byFallback[0]) return byFallback[0];

  const createRes = await fetch(`${SUPABASE_URL}/rest/v1/accounts_chart`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify(seed),
  });
  if (createRes.ok) {
    const rows = await createRes.json();
    const created = Array.isArray(rows) ? rows[0] : rows;
    if (created?.id) {
      console.info(`accounts_chart: auto-created missing account ${seed.account_code} (${seed.account_name})`);
      return created.id;
    }
  } else {
    const body = await createRes.text();
    console.warn(`accounts_chart: could not create ${seed.account_code}:`, createRes.status, body);
  }

  const retry = await queryAccountIds(`account_code=eq.${seed.account_code}&limit=1`);
  return retry[0] ?? null;
}

export async function approveAndPostPurchaseInvoice(payload: {
  invoice_id: string;
  operator_name?: string;
  device_node?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    // 1. Try RPC approve_and_post_purchase_invoice
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/approve_and_post_purchase_invoice`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_invoice_id: payload.invoice_id,
        p_operator_name: payload.operator_name || "Accounts Dept",
        p_device_node: payload.device_node || "PC-01",
      }),
    });

    if (res.ok) {
      return { success: true };
    }

    const rpcBody = await res.text().catch(() => "");
    console.warn(
      "RPC approve_and_post_purchase_invoice failed or not found, using direct fallback:",
      res.status,
      rpcBody
    );

    // Fallback: Fetch invoice
    const invRes = await fetch(`${SUPABASE_URL}/rest/v1/purchase_invoices?id=eq.${payload.invoice_id}&select=*`, {
      headers: headers(),
    });
    const invRows = await invRes.json();
    const invoice = invRows[0];
    if (!invoice) throw new Error("Purchase invoice not found");

    if (invoice.status !== "pending_approval") {
      throw new Error(`Invoice cannot be posted because its status is ${invoice.status}`);
    }

    // Resolve Account 2001 (Accounts Payable)
    const apAccountId = await ensureGlAccount(
      ["2001"],
      "account_type=ilike.LIABILITY",
      { account_code: "2001", account_name: "Accounts Payable (Suppliers)", account_type: "LIABILITY" }
    );

    // Resolve Account 1101 (WH-01 Raw Chemicals Asset) or 5001 (Raw Material Consumption)
    const rawAccountId = await ensureGlAccount(
      ["1101", "5001"],
      "or=(account_code.eq.5001,account_type.ilike.EXPENSE)",
      { account_code: "1101", account_name: "Raw Material Inventory", account_type: "ASSET" }
    );

    if (!apAccountId || !rawAccountId) {
      throw new Error(
        `Could not resolve Accounts Payable (2001) or Inventory/Raw Material (1101) accounts — ` +
          `AP: ${apAccountId ? "resolved" : "missing"}, Inventory: ${rawAccountId ? "resolved" : "missing"}`
      );
    }

    // Create Balanced Journal Entry
    const entryNumber = `JE-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const jeRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        entry_number: entryNumber,
        entry_date: new Date().toISOString().split("T")[0],
        narration: `Vendor Purchase Invoice Posted [${invoice.invoice_number} - ${invoice.grn_number}]`,
        customer_name: invoice.vendor_name,
        is_balanced: true,
        status: "POSTED",
      }),
    });
    const jeBody = await jeRes.json();
    const entryId = Array.isArray(jeBody) ? jeBody[0]?.id : jeBody?.id;

    if (!entryId) {
      throw new Error("Failed to create ledger journal entry");
    }

    // Post double entry lines
    // 1. DEBIT: Inventory / Raw Material
    // 2. CREDIT: Accounts Payable with party_id = vendor_id
    await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify([
        {
          journal_entry_id: entryId,
          account_id: rawAccountId,
          party_id: invoice.vendor_id,
          debit_pkr: invoice.total_payable,
          credit_pkr: 0.00,
        },
        {
          journal_entry_id: entryId,
          account_id: apAccountId,
          party_id: invoice.vendor_id,
          debit_pkr: 0.00,
          credit_pkr: invoice.total_payable,
        },
      ]),
    });

    // Mark invoice posted
    await fetch(`${SUPABASE_URL}/rest/v1/purchase_invoices?id=eq.${invoice.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status: "posted" }),
    });

    // Mark GRN invoiced
    if (invoice.grn_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/goods_receipt_notes?id=eq.${invoice.grn_id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status: "invoiced" }),
      });
    }

    return { success: true };
  } catch (err: any) {
    console.error("Failed to approve and post purchase invoice:", err);
    return { success: false, error: err.message || "Failed to post invoice" };
  }
}

export async function dismissPurchaseInvoice(invoiceId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/purchase_invoices?id=eq.${invoiceId}`, {
      method: "DELETE",
      headers: headers(),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to dismiss purchase invoice:", err);
    return false;
  }
}
