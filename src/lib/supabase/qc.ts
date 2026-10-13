export interface QCTestResults {
  copper_pct?: number;
  zinc_pct?: number;
  impurity_pct?: number;
  hardness_bhn?: number;
  pressure_test_pass?: boolean;
  thread_integrity_pass?: boolean;
  porosity_inspection?: "Clean" | "Porous";
  plating_thickness_microns?: number;
  surface_finish_pass?: boolean;
  surface_finish_status?: "PASS" | "FAIL" | "FLAGGED";
}

export interface QCRecord {
  id: string;
  qc_stage: "INTAKE" | "IN_PROCESS" | "PACKAGING";
  lot_id: string;
  batch_order_id: string | null;
  viscosity_cp: number | null;
  specific_gravity: number | null;
  opacity_percentage: number | null;
  shade_match_pass: boolean;
  seal_integrity_pass: boolean;
  net_weight_kg: number | null;
  test_results: QCTestResults | null;
  inspector_name: string;
  notes: string;
  created_at: string;
  lot?: { lot_number: string; product?: { name: string } };
  batch_order?: { batch_number: string };
}

export interface SubmitQCPayload {
  qc_stage: "INTAKE" | "IN_PROCESS" | "PACKAGING";
  lot_id: string;
  batch_order_id: string | null;
  test_results: QCTestResults;
  inspector_name: string;
  notes: string;
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

export async function fetchQCRecords(stage?: string): Promise<QCRecord[]> {
  if (!SUPABASE_URL) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/qc_records?select=*,lot:inventory_lots(lot_number,product:products_master(name)),batch_order:batch_orders(batch_number)&order=created_at.desc`;
    if (stage) url += `&qc_stage=eq.${stage}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      console.error("Supabase Error [qc_records]:", { status: res.status, body: await res.json() });
      return [];
    }
    const json = await res.json();
    return (Array.isArray(json) ? json : []) as QCRecord[];
  } catch (err) {
    console.error("Supabase Error [qc_records]:", err);
    return [];
  }
}

export interface LotOption {
  lot_id: string;
  lot_number: string;
  product_name: string;
  batch_number: string | null;
}

export async function fetchLotOptions(stage: string = "INTAKE"): Promise<LotOption[]> {
  if (!SUPABASE_URL) return [];

  try {
    if (stage === "INTAKE") {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/inward_gate_passes?status=eq.PENDING_INSPECTION&select=id,material_description,vendor_lot_number,status&order=created_at.desc&limit=50`,
        { headers: headers() }
      );
      if (!res2.ok) {
        console.error("Supabase Error [inward_gate_passes]:", { status: res2.status, body: await res2.json() });
        return [];
      }
      const igps = await res2.json();
      return (Array.isArray(igps) ? igps : []).map((igp: Record<string, unknown>) => ({
        lot_id: igp.id as string,
        lot_number: (igp.vendor_lot_number as string) || (igp.id as string).slice(0, 8),
        product_name: (igp.material_description as string) || "—",
        batch_number: null,
      }));
    }

    // IN_PROCESS or PACKAGING — fetch active batch_orders
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/batch_orders?status=eq.ACTIVE&select=id,batch_number,product:products_master(name)&order=created_at.desc&limit=50`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.error("Supabase Error [batch_orders]:", { status: res.status, body: await res.json() });
      return [];
    }
    const batches = await res.json();
    return (Array.isArray(batches) ? batches : []).map((b: Record<string, unknown>) => ({
      lot_id: b.id as string,
      lot_number: b.batch_number as string,
      product_name: (b.product as { name: string } | undefined)?.name ?? "—",
      batch_number: b.batch_number as string,
    }));
  } catch (err) {
    console.error("Supabase Error [fetchLotOptions]:", err);
    return [];
  }
}

async function updateIGPStatus(igpId: string, status: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${igpId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch (err) {
    console.error("Supabase Error [updateIGPStatus]:", err);
    return false;
  }
}

async function createInventoryLotFromIGP(igpId: string): Promise<string | null> {
  if (!SUPABASE_URL) return null;
  try {
    const igpRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${igpId}&select=*`,
      { headers: headers() }
    );
    if (!igpRes.ok) {
      console.error("[createInventoryLotFromIGP] Failed to fetch IGP:", igpRes.status, await igpRes.json());
      return null;
    }
    const igps = await igpRes.json();
    if (igps.length === 0) {
      console.error("[createInventoryLotFromIGP] IGP not found for id:", igpId);
      return null;
    }
    const igp = igps[0];

    let warehouseId: string;

    const whRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.WH-01&select=id`,
      { headers: headers() }
    );
    if (whRes.ok) {
      const whData = await whRes.json();
      if (whData.length > 0) {
        warehouseId = whData[0].id;
      } else {
        // Auto-create warehouse
        const createWhRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_warehouses`, {
          method: "POST",
          headers: { ...headers(), Prefer: "return=representation" },
          body: JSON.stringify({ code: "WH-01", name: "Main Warehouse" }),
        });
        if (!createWhRes.ok) {
          console.error("[createInventoryLotFromIGP] Failed to auto-create warehouse:", createWhRes.status, await createWhRes.json());
          return null;
        }
        const whCreated = await createWhRes.json();
        warehouseId = whCreated[0].id;
      }
    } else {
      console.error("[createInventoryLotFromIGP] Failed to fetch warehouses:", whRes.status, await whRes.json());
      return null;
    }

    let productId: string;

    // Try exact match first
    const prodRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products_master?name=eq.${encodeURIComponent(igp.material_description)}&select=id&limit=1`,
      { headers: headers() }
    );
    if (prodRes.ok) {
      const prods = await prodRes.json();
      if (prods.length > 0) {
        productId = prods[0].id;
      } else {
        // Auto-create product from IGP material_description
        const createRes = await fetch(`${SUPABASE_URL}/rest/v1/products_master`, {
          method: "POST",
          headers: { ...headers(), Prefer: "return=representation" },
          body: JSON.stringify({ name: igp.material_description, category: "RAW_MATERIAL" }),
        });
        if (!createRes.ok) {
          console.error("[createInventoryLotFromIGP] Failed to auto-create product:", createRes.status, await createRes.json());
          return null;
        }
        const created = await createRes.json();
        productId = created[0].id;
      }
    } else {
      console.error("[createInventoryLotFromIGP] Failed to fetch product:", prodRes.status, await prodRes.json());
      return null;
    }

    const lotNumber = igp.vendor_lot_number || `LOT-${Date.now()}`;
    // Book only ACCEPTED quantity into stock (rejected material never lands).
    const qty = Number(igp.accepted_qty ?? igp.inward_qty ?? igp.gross_weight_kg ?? igp.net_weight_kg ?? 0) || 0;

    const lotRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        lot_number: lotNumber,
        product_id: productId,
        warehouse_id: warehouseId,
        vendor_lot_code: igp.vendor_lot_number || "",
        initial_qty: qty,
        remaining_qty: qty,
        unit_cost_pkr: 0,
        qc_status: "PASSED",
      }),
    });
    if (!lotRes.ok) {
      const body = await lotRes.json();
      console.error("[createInventoryLotFromIGP] Failed to insert lot:", lotRes.status, body);
      return null;
    }
    const lotData = await lotRes.json();
    return lotData[0]?.id ?? null;
  } catch (err) {
    console.error("[createInventoryLotFromIGP] Exception:", err);
    return null;
  }
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isQCFailed(stage: string, testResults: QCTestResults): boolean {
  switch (stage) {
    case "INTAKE":
      return testResults.hardness_bhn != null && (testResults.hardness_bhn < 50 || testResults.hardness_bhn > 200);
    case "IN_PROCESS":
      return testResults.pressure_test_pass === false || testResults.thread_integrity_pass === false || testResults.porosity_inspection === "Porous";
    case "PACKAGING":
      return testResults.surface_finish_pass === false || testResults.surface_finish_status === "FAIL";
    default:
      return false;
  }
}

export async function submitQCRecord(payload: SubmitQCPayload): Promise<QCRecord | null> {
  if (!SUPABASE_URL) return null;
  if (!payload.lot_id) {
    console.error("[qc_records] Validation error: lot_id is required");
    return null;
  }
  if (!payload.inspector_name?.trim()) {
    console.error("[qc_records] Validation error: inspector_name is required");
    return null;
  }
  try {
    let resolvedLotId = payload.lot_id;

    if (payload.qc_stage === "INTAKE") {
      const newLotId = await createInventoryLotFromIGP(payload.lot_id);
      if (!newLotId) {
        console.error("[qc_records] Failed to create inventory lot from IGP:", payload.lot_id);
        return null;
      }
      resolvedLotId = newLotId;
    } else {
      // For IN_PROCESS/PACKAGING, payload.lot_id is a batch_order.id
      // Find the inventory lot linked to this batch order
      const lotRes = await fetch(
        `${SUPABASE_URL}/rest/v1/inventory_lots?batch_order_id=eq.${payload.lot_id}&select=id&limit=1`,
        { headers: headers() }
      );
      if (lotRes.ok) {
        const lots = await lotRes.json();
        if (lots.length > 0) {
          resolvedLotId = lots[0].id;
        }
      }

      // If no lot found, fetch batch order details and create one
      if (resolvedLotId === payload.lot_id) {
        const boRes = await fetch(
          `${SUPABASE_URL}/rest/v1/batch_orders?id=eq.${payload.lot_id}&select=id,batch_number,product_id&limit=1`,
          { headers: headers() }
        );
        if (boRes.ok) {
          const batches = await boRes.json();
          if (batches.length > 0) {
            const bo = batches[0];
            // Find or create warehouse
            let warehouseId: string | null = null;
            const whRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_warehouses?code=eq.WH-01&select=id`, { headers: headers() });
            if (whRes.ok) {
              const whData = await whRes.json();
              if (whData.length > 0) warehouseId = whData[0].id;
            }
            if (!warehouseId) {
              const createWhRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_warehouses`, {
                method: "POST",
                headers: { ...headers(), Prefer: "return=representation" },
                body: JSON.stringify({ code: "WH-01", name: "Main Warehouse" }),
              });
              if (createWhRes.ok) {
                const whCreated = await createWhRes.json();
                warehouseId = whCreated[0]?.id;
              }
            }

            if (bo.product_id && warehouseId) {
              const lotNumber = bo.batch_number || `LOT-${Date.now()}`;
              const createLotRes = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots`, {
                method: "POST",
                headers: { ...headers(), Prefer: "return=representation" },
                body: JSON.stringify({
                  lot_number: lotNumber,
                  product_id: bo.product_id,
                  warehouse_id: warehouseId,
                  vendor_lot_code: "",
                  initial_qty: 0,
                  remaining_qty: 0,
                  unit_cost_pkr: 0,
                  qc_status: "PENDING",
                  batch_order_id: payload.lot_id,
                }),
              });
              if (createLotRes.ok) {
                const newLot = await createLotRes.json();
                if (newLot[0]?.id) resolvedLotId = newLot[0].id;
              }
            }
          }
        }
      }
    }

    const failed = isQCFailed(payload.qc_stage, payload.test_results);

    const insertBody: Record<string, unknown> = {
      qc_stage: payload.qc_stage,
      lot_id: resolvedLotId,
      batch_order_id: payload.batch_order_id ?? null,
      test_results: payload.test_results,
      shade_match_pass: !failed,
      seal_integrity_pass: !failed,
      inspector_name: payload.inspector_name.trim(),
      notes: payload.notes?.trim() ?? "",
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/qc_records`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(insertBody),
    });
    if (!res.ok) {
      const body = await res.json();
      console.error("[qc_records] Insert failed:", {
        status: res.status,
        code: body.code ?? null,
        message: body.message ?? body.msg ?? String(body),
        details: body.details ?? null,
        hint: body.hint ?? null,
      });
      return null;
    }
    const data = await res.json();
    const record = data[0] ?? null;

    if (payload.qc_stage === "INTAKE") {
      await updateIGPStatus(payload.lot_id, failed ? "QC_FAILED" : "QC_PASSED");
    }

    if (failed) {
      await flagLotStatus(resolvedLotId, payload.device_node, payload.operator_name);
    }

    await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        node_id: payload.device_node,
        operator_name: payload.operator_name,
        action_type: failed ? "QC_RECORD_FAILED" : "QC_RECORD_PASSED",
        details: {
          module: "QC",
          qc_stage: payload.qc_stage,
          lot_id: resolvedLotId,
          failed,
          test_results: payload.test_results,
        },
      }),
    });

    return record;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[qc_records] Exception:", { message: msg, stack: err instanceof Error ? err.stack : null });
    return null;
  }
}

export async function flagLotStatus(
  lotId: string,
  deviceNode: string,
  operatorName: string
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/flag_lot_qc_status`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_lot_id: lotId,
        p_status: "FLAGGED_WARNING",
      }),
    });

    await fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        node_id: deviceNode,
        operator_name: operatorName,
        action_type: "LOT_QC_FLAGGED",
        details: { module: "QC", lot_id: lotId },
      }),
    });

    return res.ok;
  } catch (err) {
    console.error("Supabase Error [flagLotStatus]:", err);
    return false;
  }
}
