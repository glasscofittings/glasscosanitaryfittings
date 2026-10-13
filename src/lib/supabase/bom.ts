export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  item_type: "RAW_MATERIAL" | "FINISHED_GOOD";
  unit_of_measure: string;
  minimum_stock_alert: number;
  created_at: string;
}

export interface CreateProductPayload {
  name: string;
  sku: string;
  category: string;
  item_type: "RAW_MATERIAL" | "FINISHED_GOOD";
  unit_of_measure: string;
}

export interface WH01Lot {
  lot_id: string;
  lot_number: string;
  product_id: string;
  remaining_qty: number;
  vendor_lot_code: string;
  expiration_date: string;
}

export interface BillOfMaterial {
  id: string;
  finished_good_id: string;
  version: string;
  is_active: boolean;
  created_at: string;
}

export interface BOMItem {
  id: string;
  bom_id: string;
  raw_material_id: string;
  quantity_required: number;
}

export interface BOMItemWithProduct extends BOMItem {
  products_master?: Product;
}

export interface BOMWithItems extends BillOfMaterial {
  bom_items?: BOMItemWithProduct[];
  finished_good?: Product;
}

export interface SaveBOMPayload {
  finished_good_id: string;
  version: string;
  items: { raw_material_id: string; quantity_required: number }[];
  device_node: string;
  operator_name: string;
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

export async function fetchProducts(): Promise<Product[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products_master?order=name.asc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [products_master]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as Product[];
  } catch (err) {
    console.error("Supabase Error [products_master]:", err);
    return [];
  }
}

const MIGRATION_HINT =
  " Database schema is out of date — run migration 20261013010000_products_master_materials_fix.sql in the database SQL editor.";

export interface CreateProductResult {
  product: Product | null;
  error: string | null;
}

export async function createProduct(payload: CreateProductPayload): Promise<CreateProductResult> {
  if (!SUPABASE_URL) return { product: null, error: "Server URL is not configured." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products_master`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        name: payload.name,
        sku: payload.sku,
        category: payload.category,
        item_type: payload.item_type,
        unit_of_measure: payload.unit_of_measure,
        minimum_stock_alert: 0,
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.message ?? body?.error_description ?? JSON.stringify(body);
      } catch {
        detail = `HTTP ${res.status}`;
      }
      console.error("Supabase Error [products_master insert]:", { status: res.status, body: detail });
      const hint = /does not exist|42703/i.test(detail) ? MIGRATION_HINT : "";
      return { product: null, error: `${detail}${hint}` };
    }
    const data = await res.json();
    return { product: data[0] ?? null, error: null };
  } catch (err) {
    console.error("Supabase Error [createProduct]:", err);
    return { product: null, error: err instanceof Error ? err.message : "Network error." };
  }
}

export async function fetchBOMs(): Promise<BOMWithItems[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bill_of_materials?select=*,bom_items(*,products_master(*)),finished_good:products_master!finished_good_id(*)&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [bill_of_materials]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as BOMWithItems[];
  } catch (err) {
    console.error("Supabase Error [bill_of_materials]:", err);
    return [];
  }
}

export async function fetchBOMByVersion(finishedGoodId: string, version: string): Promise<BOMWithItems | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bill_of_materials?finished_good_id=eq.${finishedGoodId}&version=eq.${version}&select=*,bom_items(*,products_master(*)),finished_good:products_master!finished_good_id(*)`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [bill_of_materials version]:", { status: res.status, body: await res.json() });
      return null;
    }
    const rows = await res.json();
    return rows[0] ?? null;
  } catch (err) {
    console.error("Supabase Error [bill_of_materials version]:", err);
    return null;
  }
}

export async function saveBOM(payload: SaveBOMPayload): Promise<BillOfMaterial | null> {
  if (!SUPABASE_URL) return null;
  try {
    const bomRes = await fetch(`${SUPABASE_URL}/rest/v1/bill_of_materials`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        finished_good_id: payload.finished_good_id,
        version: payload.version,
        is_active: true,
      }),
    });
    if (!bomRes.ok) {
      console.error("Supabase Error [bill_of_materials insert]:", { status: bomRes.status, body: await bomRes.json() });
      return null;
    }
    const bomData = await bomRes.json();
    const bom: BillOfMaterial = bomData[0];

    if (payload.items.length > 0) {
      const items = payload.items.map((item) => ({
        bom_id: bom.id,
        raw_material_id: item.raw_material_id,
        quantity_required: item.quantity_required,
      }));

      const itemsRes = await fetch(`${SUPABASE_URL}/rest/v1/bom_items`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(items),
      });
      if (!itemsRes.ok) {
        console.error("Supabase Error [bom_items insert]:", { status: itemsRes.status, body: await itemsRes.json() });
      }
    }

    await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        node_id: payload.device_node,
        operator_name: payload.operator_name,
        action_type: "BOM_SAVED",
        details: { module: "BOM", bom_id: bom.id, version: payload.version, item_count: payload.items.length },
      }),
    });

    return bom;
  } catch (err) {
    console.error("Supabase Error [saveBOM]:", err);
    return null;
  }
}

export async function deactivateBOM(bomId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bill_of_materials?id=eq.${bomId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ is_active: false }),
    });
    if (!res.ok) {
      console.error("Supabase Error [bill_of_materials deactivate]:", { status: res.status, body: await res.json() });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [bill_of_materials deactivate]:", err);
    return false;
  }
}

export async function fetchWH01Lots(): Promise<WH01Lot[]> {
  if (!SUPABASE_URL) return [];
  try {
    const whRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.WH-01&select=id`,
      { headers: headers() }
    );
    if (!whRes.ok) {
      console.error("Supabase Error [inventory_warehouses WH-01]:", { status: whRes.status, body: await whRes.json() });
      return [];
    }
    const whData = await whRes.json();
    if (whData.length === 0) return [];
    const whId = whData[0].id;

    const lotRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots?warehouse_id=eq.${whId}&select=id,lot_number,product_id,remaining_qty,vendor_lot_code,expiration_date&remaining_qty=gt.0`,
      { headers: headers() }
    );
    if (!lotRes.ok) {
      console.error("Supabase Error [inventory_lots WH-01]:", { status: lotRes.status, body: await lotRes.json() });
      return [];
    }
    const lots = await lotRes.json();
    interface InventoryLotRow {
      id: string;
      lot_number: string;
      product_id: string;
      remaining_qty: number;
      vendor_lot_code: string;
      expiration_date: string;
    }
    return (Array.isArray(lots) ? lots : []).map((l: InventoryLotRow) => ({
      lot_id: l.id,
      lot_number: l.lot_number,
      product_id: l.product_id,
      remaining_qty: l.remaining_qty,
      vendor_lot_code: l.vendor_lot_code,
      expiration_date: l.expiration_date,
    })) as WH01Lot[];
  } catch (err) {
    console.error("Supabase Error [fetchWH01Lots]:", err);
    return [];
  }
}

export interface BatchExecutionPayload {
  formula_id: string;
  target_volume_liters: number;
  operator_name: string;
  device_node: string;
  lot_deductions: { lot_id: string; deduct_qty_kg: number }[];
}

export interface BatchExecutionResult {
  batch_number: string;
  generated_finished_lot_number: string;
}

export async function executeBatchOrder(payload: BatchExecutionPayload): Promise<BatchExecutionResult | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_batch_order`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("Supabase Error [execute_batch_order RPC]:", { status: res.status, body: await res.json() });
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("Supabase Error [execute_batch_order RPC]:", err);
    return null;
  }
}
