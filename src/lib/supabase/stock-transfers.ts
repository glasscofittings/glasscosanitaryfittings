export interface StockTransfer {
  id: string;
  transfer_no: string;
  source_warehouse_code: string;
  target_warehouse_code: string;
  transfer_date: string;
  status: "DISPATCHED" | "RECEIVED" | "CANCELLED";
  dispatched_by: string;
  received_by?: string;
  remarks?: string;
  created_at: string;
  items?: StockTransferItem[];
}

export interface StockTransferItem {
  id?: string;
  transfer_id?: string;
  source_lot_id: string;
  lot_number: string;
  product_id: string;
  product_name: string;
  transfer_qty: number;
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

export async function fetchStockTransfers(): Promise<StockTransfer[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/stock_transfers?select=*,items:stock_transfer_items(*)&order=transfer_date.desc,created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/stock_transfers?order=transfer_date.desc,created_at.desc`,
        { headers: headers() }
      );
      if (!res2.ok) return [];
      const data = await res2.json();
      return Array.isArray(data) ? data : [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Supabase Error [fetchStockTransfers]:", err);
    return [];
  }
}

export async function executeStockTransfer(payload: {
  source_warehouse_code: string;
  target_warehouse_code: string;
  transfer_date: string;
  dispatched_by: string;
  remarks?: string;
  items: Array<{
    source_lot_id: string;
    lot_number: string;
    product_id: string;
    product_name: string;
    transfer_qty: number;
  }>;
}): Promise<{ success: boolean; transfer?: StockTransfer; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  try {
    const year = new Date().getFullYear();
    const transferNo = `STO-${year}-${String(Date.now()).slice(-6)}`;

    // 1. Resolve Target Warehouse ID
    let targetWhId: string | null = null;
    const targetWhRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.${payload.target_warehouse_code}&select=id`,
      { headers: headers() }
    );
    if (targetWhRes.ok) {
      const targetWhData = await targetWhRes.json();
      if (targetWhData[0]) targetWhId = targetWhData[0].id;
    }

    if (!targetWhId) {
      return { success: false, error: `Target warehouse ${payload.target_warehouse_code} not found` };
    }

    // 2. Insert Transfer Header
    const transRes = await fetch(`${SUPABASE_URL}/rest/v1/stock_transfers`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        transfer_no: transferNo,
        source_warehouse_code: payload.source_warehouse_code,
        target_warehouse_code: payload.target_warehouse_code,
        transfer_date: payload.transfer_date,
        status: "RECEIVED",
        dispatched_by: payload.dispatched_by,
        received_by: payload.dispatched_by,
        remarks: payload.remarks || null,
      }),
    });

    if (!transRes.ok) {
      const err = await transRes.json().catch(() => ({}));
      return { success: false, error: err.message || "Failed to create transfer header" };
    }

    const createdRows = await transRes.json();
    const createdTransfer = Array.isArray(createdRows) ? createdRows[0] : createdRows;

    // 3. Process each item: Deduct from source lot & increment/create target lot
    for (const item of payload.items) {
      // Check fresh source lot
      const sLotRes = await fetch(
        `${SUPABASE_URL}/rest/v1/inventory_lots?id=eq.${item.source_lot_id}&select=*`,
        { headers: headers() }
      );
      if (sLotRes.ok) {
        const sLotRows = await sLotRes.json();
        const sourceLot = sLotRows[0];
        if (sourceLot) {
          const currentQty = Number(sourceLot.remaining_qty) || 0;
          if (currentQty >= item.transfer_qty) {
            // Deduct source lot
            await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots?id=eq.${item.source_lot_id}`, {
              method: "PATCH",
              headers: headers(),
              body: JSON.stringify({ remaining_qty: Math.max(0, currentQty - item.transfer_qty) }),
            });

            // Create target lot in target warehouse
            await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots`, {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({
                lot_number: `${sourceLot.lot_number}-T`,
                product_id: sourceLot.product_id,
                warehouse_id: targetWhId,
                vendor_lot_code: sourceLot.vendor_lot_code || "",
                manufacture_date: sourceLot.manufacture_date,
                expiration_date: sourceLot.expiration_date,
                initial_qty: item.transfer_qty,
                remaining_qty: item.transfer_qty,
                unit_cost_pkr: sourceLot.unit_cost_pkr || 0,
                qc_status: "PASSED",
                status: "unrestricted",
              }),
            });
          }
        }
      }

      // Record transfer line item
      if (createdTransfer?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/stock_transfer_items`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            transfer_id: createdTransfer.id,
            source_lot_id: item.source_lot_id,
            lot_number: item.lot_number,
            product_id: item.product_id,
            product_name: item.product_name,
            transfer_qty: item.transfer_qty,
          }),
        });
      }
    }

    return { success: true, transfer: createdTransfer };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to execute stock transfer" };
  }
}
