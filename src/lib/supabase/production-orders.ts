export interface ProductionOrder {
  id: string;
  order_no: string;
  bom_id?: string;
  target_product_id: string;
  target_product_name: string;
  target_qty: number;
  actual_qty: number;
  scrap_qty: number;
  unit_of_measure: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  start_date: string;
  completion_date?: string;
  total_material_cost: number;
  unit_cost_pkr: number;
  output_lot_id?: string;
  operator_name: string;
  created_at: string;
  materials?: ProductionOrderMaterial[];
}

export interface ProductionOrderMaterial {
  id?: string;
  order_id?: string;
  product_id: string;
  product_name: string;
  lot_id?: string;
  lot_number?: string;
  planned_qty: number;
  actual_issued_qty: number;
  unit_cost_pkr: number;
  total_cost_pkr: number;
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

export async function fetchProductionOrders(): Promise<ProductionOrder[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/production_orders?select=*,materials:production_order_materials(*)&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/production_orders?order=created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Supabase Error [fetchProductionOrders]:", err);
    return [];
  }
}

export async function createProductionOrder(payload: {
  bom_id?: string;
  target_product_id: string;
  target_product_name: string;
  target_qty: number;
  unit_of_measure: string;
  start_date: string;
  operator_name: string;
  materials: Array<{
    product_id: string;
    product_name: string;
    planned_qty: number;
    unit_cost_pkr: number;
  }>;
}): Promise<{ success: boolean; order?: ProductionOrder; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    const year = new Date().getFullYear();
    const orderNo = `PO-${year}-${String(Date.now()).slice(-6)}`;

    const totalEstCost = payload.materials.reduce((sum, m) => sum + m.planned_qty * m.unit_cost_pkr, 0);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/production_orders`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        order_no: orderNo,
        bom_id: payload.bom_id || null,
        target_product_id: payload.target_product_id,
        target_product_name: payload.target_product_name,
        target_qty: payload.target_qty,
        actual_qty: 0,
        scrap_qty: 0,
        unit_of_measure: payload.unit_of_measure,
        status: "PLANNED",
        start_date: payload.start_date,
        total_material_cost: totalEstCost,
        unit_cost_pkr: payload.target_qty > 0 ? Math.round((totalEstCost / payload.target_qty) * 100) / 100 : 0,
        operator_name: payload.operator_name,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.message || "Failed to create order" };
    }

    const rows = await res.json();
    const createdOrder = Array.isArray(rows) ? rows[0] : rows;

    if (createdOrder?.id && payload.materials.length > 0) {
      const matRows = payload.materials.map((m) => ({
        order_id: createdOrder.id,
        product_id: m.product_id,
        product_name: m.product_name,
        planned_qty: m.planned_qty,
        actual_issued_qty: 0,
        unit_cost_pkr: m.unit_cost_pkr,
        total_cost_pkr: m.planned_qty * m.unit_cost_pkr,
      }));

      await fetch(`${SUPABASE_URL}/rest/v1/production_order_materials`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(matRows),
      });
    }

    return { success: true, order: createdOrder };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create production order";
    return { success: false, error: msg };
  }
}

export async function completeProductionOrder(payload: {
  order_id: string;
  order_no: string;
  target_product_id: string;
  target_product_name: string;
  actual_qty: number;
  scrap_qty: number;
  operator_name: string;
}): Promise<{ success: boolean; fg_lot_id?: string; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    // 1. Fetch finished goods warehouse WH-02
    let wh02Id: string | null = null;
    const whRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.WH-02&select=id`, {
      headers: headers(),
    });
    if (whRes.ok) {
      const whData = await whRes.json();
      if (whData[0]) wh02Id = whData[0].id;
    }

    const year = new Date().getFullYear();
    const fgLotNumber = `LOT-FG-${year}-${String(Date.now()).slice(-6)}`;
    const nowIso = new Date().toISOString();
    const expDate = new Date();
    expDate.setFullYear(expDate.getFullYear() + 2); // 2 years shelf life for finished sanitary goods

    // 2. Create Finished Good Lot in inventory_lots
    let fgLotId: string | null = null;
    if (wh02Id) {
      const lotRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({
          lot_number: fgLotNumber,
          product_id: payload.target_product_id,
          warehouse_id: wh02Id,
          vendor_lot_code: `PROD-${payload.order_no}`,
          manufacture_date: nowIso.split("T")[0],
          expiration_date: expDate.toISOString().split("T")[0],
          initial_qty: payload.actual_qty,
          remaining_qty: payload.actual_qty,
          unit_cost_pkr: 0,
          qc_status: "PASSED",
          status: "unrestricted",
        }),
      });

      if (lotRes.ok) {
        const lotData = await lotRes.json();
        fgLotId = Array.isArray(lotData) ? lotData[0]?.id : lotData?.id;
      }
    }

    // 3. Mark Production Order COMPLETED
    await fetch(`${SUPABASE_URL}/rest/v1/production_orders?id=eq.${payload.order_id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        status: "COMPLETED",
        actual_qty: payload.actual_qty,
        scrap_qty: payload.scrap_qty,
        completion_date: nowIso.split("T")[0],
        output_lot_id: fgLotId,
      }),
    });

    return { success: true, fg_lot_id: fgLotId ?? undefined };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to complete production order";
    return { success: false, error: msg };
  }
}

export interface UpdateProductionOrderData {
  bom_id?: string | null;
  target_product_id?: string;
  target_product_name?: string;
  target_qty?: number;
  unit_of_measure?: string;
  start_date?: string;
  operator_name?: string;
}

export async function updateProductionOrder(
  orderId: string,
  data: UpdateProductionOrderData,
  materials?: Array<{
    product_id: string;
    product_name: string;
    planned_qty: number;
    unit_cost_pkr: number;
  }>
): Promise<{ success: boolean; order?: ProductionOrder; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    const patch: Record<string, unknown> = {};
    if (data.bom_id !== undefined) patch.bom_id = data.bom_id || null;
    if (data.target_product_id !== undefined) patch.target_product_id = data.target_product_id;
    if (data.target_product_name !== undefined) patch.target_product_name = data.target_product_name;
    if (data.target_qty !== undefined) patch.target_qty = data.target_qty;
    if (data.unit_of_measure !== undefined) patch.unit_of_measure = data.unit_of_measure;
    if (data.start_date !== undefined) patch.start_date = data.start_date;
    if (data.operator_name !== undefined) patch.operator_name = data.operator_name;

    if (Object.keys(patch).length === 0) {
      return { success: false, error: "No fields to update." };
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/production_orders?id=eq.${orderId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.message || "Failed to update order" };
    }

    const rows = await res.json();
    const updated = Array.isArray(rows) ? rows[0] : rows;

    if (materials) {
      await fetch(`${SUPABASE_URL}/rest/v1/production_order_materials?order_id=eq.${orderId}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (materials.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/production_order_materials`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(
            materials.map((m) => ({
              order_id: orderId,
              product_id: m.product_id,
              product_name: m.product_name,
              planned_qty: m.planned_qty,
              actual_issued_qty: 0,
              unit_cost_pkr: m.unit_cost_pkr,
              total_cost_pkr: m.planned_qty * m.unit_cost_pkr,
            }))
          ),
        });
      }
      const totalEstCost = materials.reduce((sum, m) => sum + m.planned_qty * m.unit_cost_pkr, 0);
      const qty = data.target_qty ?? Number(updated?.target_qty || 0);
      await fetch(`${SUPABASE_URL}/rest/v1/production_orders?id=eq.${orderId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          total_material_cost: totalEstCost,
          unit_cost_pkr: qty > 0 ? Math.round((totalEstCost / qty) * 100) / 100 : 0,
        }),
      });
    }

    const refreshed = await fetch(
      `${SUPABASE_URL}/rest/v1/production_orders?id=eq.${orderId}&select=*,materials:production_order_materials(*)`,
      { headers: headers() }
    );
    const finalRows = refreshed.ok ? await refreshed.json() : [];
    const order = Array.isArray(finalRows) ? finalRows[0] : updated;

    return { success: true, order };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update production order";
    return { success: false, error: msg };
  }
}

export async function deleteProductionOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/production_order_materials?order_id=eq.${orderId}`, {
      method: "DELETE",
      headers: headers(),
    });

    const res = await fetch(`${SUPABASE_URL}/rest/v1/production_orders?id=eq.${orderId}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok && res.status !== 204) {
      const bodyText = await res.text().catch(() => "");
      let msg = bodyText || `HTTP ${res.status}`;
      try {
        msg = JSON.parse(bodyText).message ?? msg;
      } catch {
        /* keep raw */
      }
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete production order";
    return { success: false, error: msg };
  }
}
