export interface Warehouse {
  id: string;
  code: "WH-01" | "WH-02";
  name: string;
}

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

export interface InventoryBalance {
  id: string;
  warehouse_id: string;
  product_id: string;
  current_qty: number;
  updated_at: string;
  products_master?: Product;
}

export interface WarehouseStock extends Product {
  current_qty: number;
  is_low_stock: boolean;
  updated_at: string;
}

export interface InventoryLot {
  id: string;
  lot_number: string;
  product_id: string;
  warehouse_id: string;
  vendor_lot_code: string;
  manufacture_date: string;
  expiration_date: string;
  initial_qty: number;
  remaining_qty: number;
  unit_cost_pkr: number;
  qc_status: "PENDING" | "PASSED" | "FLAGGED_WARNING";
  created_at: string;
  product?: Product;
  warehouse?: Warehouse;
  days_until_expiry?: number;
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

export async function fetchWarehouseStock(warehouseCode: string): Promise<WarehouseStock[]> {
  if (!SUPABASE_URL) return [];
  try {
    const whRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.${warehouseCode}&select=id`,
      { headers: headers() }
    );
    if (!whRes.ok) {
      console.error("Supabase Error [inventory_warehouses]:", { status: whRes.status, body: await whRes.json() });
      return [];
    }
    const whData = await whRes.json();
    if (whData.length === 0) return [];
    const whId = whData[0].id;

    const balRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_balances?warehouse_id=eq.${whId}&select=*,products_master(*)`,
      { headers: headers() }
    );
    if (!balRes.ok) {
      console.error("Supabase Error [inventory_balances]:", { status: balRes.status, body: await balRes.json() });
      return [];
    }
    const balances: InventoryBalance[] = await balRes.json();

    return balances.map((b) => {
      const p = b.products_master!;
      return {
        ...p,
        current_qty: b.current_qty,
        is_low_stock: b.current_qty <= p.minimum_stock_alert,
        updated_at: b.updated_at,
      };
    });
  } catch (err) {
    console.error("Supabase Error [fetchWarehouseStock]:", err);
    return [];
  }
}

export async function fetchAllWarehouseStock(): Promise<Record<string, WarehouseStock[]>> {
  if (!SUPABASE_URL) return {};
  try {
    const [wh01, wh02] = await Promise.all([
      fetchWarehouseStock("WH-01"),
      fetchWarehouseStock("WH-02"),
    ]);
    return { "WH-01": wh01, "WH-02": wh02 };
  } catch (err) {
    console.error("Supabase Error [fetchAllWarehouseStock]:", err);
    return {};
  }
}

export async function fetchWarehouseLots(warehouseCode: string): Promise<InventoryLot[]> {
  if (!SUPABASE_URL) return [];
  try {
    const whRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.${warehouseCode}&select=id`,
      { headers: headers() }
    );
    if (!whRes.ok) {
      console.error("Supabase Error [inventory_warehouses]:", { status: whRes.status, body: await whRes.json() });
      return [];
    }
    const whData = await whRes.json();
    if (whData.length === 0) return [];
    const whId = whData[0].id;

    const lotRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots?warehouse_id=eq.${whId}&select=*,product:products_master(*),warehouse:inventory_warehouses(*)`,
      { headers: headers() }
    );
    if (!lotRes.ok) {
      console.error("Supabase Error [inventory_lots]:", { status: lotRes.status, body: await lotRes.json() });
      return [];
    }
    const lots: InventoryLot[] = await lotRes.json();

    return (Array.isArray(lots) ? lots : []).map((lot) => {
      const expDate = new Date(lot.expiration_date);
      const now = new Date();
      const diffMs = expDate.getTime() - now.getTime();
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return { ...lot, days_until_expiry: days };
    });
  } catch (err) {
    console.error("Supabase Error [fetchWarehouseLots]:", err);
    return [];
  }
}

export async function fetchProducts(itemType?: string): Promise<Product[]> {
  if (!SUPABASE_URL) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/products_master?select=*&order=name.asc`;
    if (itemType) url += `&item_type=eq.${itemType}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      console.error("Supabase Error [products_master]:", { status: res.status, body: await res.json() });
      return [];
    }
    const data = await res.json();
    return (Array.isArray(data) ? data : []) as Product[];
  } catch (err) {
    console.error("Supabase Error [fetchProducts]:", err);
    return [];
  }
}

export interface InsertLotPayload {
  lot_number: string;
  product_id: string;
  warehouse_id: string;
  vendor_lot_code: string;
  manufacture_date: string;
  expiration_date: string;
  initial_qty: number;
  remaining_qty: number;
  unit_cost_pkr: number;
  qc_status: "PENDING" | "PASSED";
}

export async function insertInventoryLot(payload: InsertLotPayload): Promise<InventoryLot | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        lot_number: payload.lot_number,
        product_id: payload.product_id,
        warehouse_id: payload.warehouse_id,
        vendor_lot_code: payload.vendor_lot_code,
        manufacture_date: payload.manufacture_date,
        expiration_date: payload.expiration_date,
        initial_qty: payload.initial_qty,
        remaining_qty: payload.remaining_qty,
        unit_cost_pkr: payload.unit_cost_pkr,
        qc_status: payload.qc_status,
      }),
    });
    if (!res.ok) {
      console.error("Supabase Error [inventory_lots insert]:", { status: res.status, body: await res.json() });
      return null;
    }
    const data = await res.json();
    return data[0] ?? null;
  } catch (err) {
    console.error("Supabase Error [insertInventoryLot]:", err);
    return null;
  }
}

export interface StockAdjustment {
  lot_id: string;
  adjustment_qty: number;
  adjustment_type: "DAMAGED" | "EXPIRED" | "AUDIT_CORRECTION";
  reason: string;
}

export async function adjustStock(adjustment: StockAdjustment): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const lotRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots?id=eq.${adjustment.lot_id}&select=remaining_qty`,
      { headers: headers() }
    );
    if (!lotRes.ok) return false;
    const lotData = await lotRes.json();
    if (lotData.length === 0) return false;

    const currentQty = Number(lotData[0].remaining_qty);
    const newQty = currentQty + adjustment.adjustment_qty;

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots?id=eq.${adjustment.lot_id}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({ remaining_qty: newQty }),
    });
    if (!updateRes.ok) {
      console.error("Supabase Error [inventory_lots update]:", { status: updateRes.status, body: await updateRes.json() });
      return false;
    }

    return true;
  } catch (err) {
    console.error("Supabase Error [adjustStock]:", err);
    return false;
  }
}

export async function fetchWarehouseId(code: string): Promise<string | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.${code}&select=id`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[0]?.id ?? null;
  } catch (err) {
    console.error("Supabase Error [fetchWarehouseId]:", err);
    return null;
  }
}
