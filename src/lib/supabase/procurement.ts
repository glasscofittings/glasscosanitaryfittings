export const UOM_OPTIONS = ["KG", "LTR", "PCS", "METERS", "BAGS", "TONS"] as const;
export type UOM = (typeof UOM_OPTIONS)[number];

/** Maps legacy `unit_of_measure` values (pre-UOM refactor) to a current UOM. */
const LEGACY_UOM_MAP: Record<string, UOM> = {
  L: "LTR", LTR: "LTR", LITRE: "LTR", LITRES: "LTR", LITER: "LTR", LITERS: "LTR",
  M: "METERS", METRE: "METERS", METRES: "METERS", METER: "METERS",
  TON: "TONS", TONNE: "TONS", TONNES: "TONS",
  BAG: "BAGS",
  SET: "PCS", NOS: "PCS", NO: "PCS", EA: "PCS", UNIT: "PCS",
};

export function normalizeUom(value?: string | null): UOM {
  const v = (value ?? "").trim().toUpperCase();
  if ((UOM_OPTIONS as readonly string[]).includes(v)) return v as UOM;
  return LEGACY_UOM_MAP[v] ?? "KG";
}

export interface Party {
  id: string;
  name: string;
  party_type: "SUPPLIER" | "CUSTOMER" | "BOTH";
  phone: string | null;
  address: string | null;
  created_at: string;
}

export interface InwardGatePass {
  id: string;
  igp_code: string;
  supplier_id: string;
  material_description: string;
  inward_qty: number;
  /** Display unit of measure (normalized from `unit_of_measure`). */
  uom: UOM;
  /** Raw DB column; prefer `uom` for rendering. */
  unit_of_measure?: string | null;
  gross_weight_kg?: number | null;
  net_weight_kg?: number | null;
  accepted_qty?: number | null;
  rejected_qty?: number | null;
  rejection_reason?: string | null;
  vendor_lot_code: string;
  coa_code: string;
  status: "PENDING_INSPECTION" | "CONVERTED_TO_GRN" | "REJECTED";
  created_at: string;
  parties?: Party;
  product_id?: string;
}

/** Quantity that should be billed / booked (never counts rejected material). */
export function effectiveAcceptedQty(igp: {
  accepted_qty?: number | null;
  net_weight_kg?: number | null;
  inward_qty: number;
}): number {
  if (igp.accepted_qty != null) return igp.accepted_qty;
  if (igp.net_weight_kg != null && igp.net_weight_kg > 0) return igp.net_weight_kg;
  return igp.inward_qty;
}

export interface GoodsReceivedNote {
  id: string;
  grn_code: string;
  igp_id: string;
  accepted_qty: number;
  rejected_qty: number;
  rejection_reason: string | null;
  unit_price_pkr: number;
  total_value_pkr: number;
  created_at: string;
}

export interface InspectionPayload {
  igp_id: string;
  accepted_qty: number;
  rejected_qty: number;
  rejection_reason: string;
  unit_price_pkr: number;
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

const IGP_COLUMNS =
  "id,igp_code,material_description,supplier_id,vendor_lot_code,inward_qty,unit_of_measure," +
  "gross_weight_kg,net_weight_kg,accepted_qty,rejected_qty,rejection_reason,status,created_at,coa_code";
/** Pre-migration fallback when accepted/rejected columns are not yet added. */
const IGP_COLUMNS_LEGACY =
  "id,igp_code,material_description,supplier_id,vendor_lot_code,inward_qty,unit_of_measure," +
  "gross_weight_kg,net_weight_kg,status,created_at,coa_code";

type IgpRow = Omit<InwardGatePass, "uom">;

function mapIgpRow(row: IgpRow): InwardGatePass {
  let rej = 0;
  if (row.rejected_qty !== undefined && row.rejected_qty !== null && !isNaN(Number(row.rejected_qty))) {
    rej = Number(row.rejected_qty);
  } else if (row.vendor_lot_code && !isNaN(Number(row.vendor_lot_code))) {
    rej = Number(row.vendor_lot_code);
  } else if (typeof row.vendor_lot_code === "string" && row.vendor_lot_code.startsWith("REJ:")) {
    rej = Number(row.vendor_lot_code.replace("REJ:", "").trim()) || 0;
  } else if (typeof row.coa_code === "string" && row.coa_code.startsWith("REJ:")) {
    rej = Number(row.coa_code.replace("REJ:", "").trim()) || 0;
  }

  const accepted = Number(row.accepted_qty ?? row.net_weight_kg ?? row.inward_qty ?? 0);

  return {
    ...row,
    accepted_qty: accepted,
    rejected_qty: rej,
    uom: normalizeUom(row.unit_of_measure),
  };
}

export async function fetchIGPs(): Promise<InwardGatePass[]> {
  if (!SUPABASE_URL) {
    console.warn("fetchIGPs: NEXT_PUBLIC_SUPABASE_URL is not set — returning empty array");
    return [];
  }
  try {
    let res = await fetch(
      `${SUPABASE_URL}/rest/v1/inward_gate_passes?select=${IGP_COLUMNS}&order=created_at.desc`,
      { headers: headers() }
    );
    let json: unknown = await res.json();
    if (!res.ok) {
      // Migration not applied yet → retry without accepted/rejected columns.
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/inward_gate_passes?select=${IGP_COLUMNS_LEGACY}&order=created_at.desc`,
        { headers: headers() }
      );
      json = await res.json();
    }
    if (!res.ok) {
      console.error("Supabase Error [inward_gate_passes]:", { status: res.status, body: json });
      return [];
    }
    return (Array.isArray(json) ? json : []).map((row: IgpRow) => mapIgpRow(row));
  } catch (err) {
    console.error("Supabase Error [inward_gate_passes]:", err);
    return [];
  }
}

export async function fetchIGPsWithParties(): Promise<InwardGatePass[]> {
  const [igps, parties] = await Promise.all([fetchIGPs(), fetchParties()]);
  const partyMap = new Map(parties.map((p) => [p.id, p]));
  return igps.map((igp) => ({
    ...igp,
    parties: partyMap.get(igp.supplier_id) ?? undefined,
  }));
}

export async function fetchParties(): Promise<Party[]> {
  if (!SUPABASE_URL) {
    console.warn("fetchParties: NEXT_PUBLIC_SUPABASE_URL is not set — returning empty array");
    return [];
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/parties?select=id,name,party_type,phone,address,created_at&party_type=in.(SUPPLIER,BOTH)&order=name.asc`,
      { headers: headers() }
    );
    const json = await res.json();
    if (!res.ok) {
      console.error("Supabase Error [parties]:", { status: res.status, body: json });
      return [];
    }
    return (Array.isArray(json) ? json : []) as Party[];
  } catch (err) {
    console.error("Supabase Error [parties]:", err);
    return [];
  }
}

export async function createSupplier(payload: {
  name: string;
  contact_person?: string;
  phone?: string;
}): Promise<Party | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/parties`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        name: payload.name,
        party_type: "SUPPLIER",
        phone: payload.phone || null,
        address: payload.contact_person ? `Contact: ${payload.contact_person}` : null,
      }),
    });
    if (!res.ok) {
      console.error("Supabase Error [parties insert]:", { status: res.status, body: await res.json() });
      return null;
    }
    const data = await res.json();
    return data[0] ?? null;
  } catch (err) {
    console.error("Supabase Error [parties insert]:", err);
    return null;
  }
}

export async function submitIGP(payload: {
  supplier_id: string;
  material_description: string;
  inward_qty: number;
  uom: UOM;
  gross_weight_kg?: number;
  net_weight_kg?: number;
  accepted_qty?: number;
  rejected_qty?: number;
  rejection_reason?: string | null;
  vendor_lot_code: string;
  coa_code: string;
  product_id?: string;
  device_node: string;
  operator_name: string;
}): Promise<InwardGatePass | null> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();

    const accepted = payload.accepted_qty ?? payload.net_weight_kg ?? payload.inward_qty;
    const rejected = payload.rejected_qty ?? 0;
    const net = accepted;
    const gross = payload.gross_weight_kg ?? (accepted + rejected);

    const vendorLot = rejected > 0 ? `REJ:${rejected}` : (payload.vendor_lot_code || `LOT-${Date.now()}`);
    const coaCode = rejected > 0 ? `REJ:${rejected}` : (payload.coa_code || "");

    const basePayload = {
      igp_code: `IGP-${Date.now()}`,
      supplier_id: payload.supplier_id,
      material_description: payload.material_description,
      inward_qty: net,
      gross_weight_kg: gross,
      net_weight_kg: net,
      unit_of_measure: payload.uom,
      vendor_lot_code: vendorLot,
      vendor_lot_number: vendorLot,
      coa_code: coaCode,
      status: "PENDING_INSPECTION",
    };
    const insertPayload = {
      ...basePayload,
      accepted_qty: accepted,
      rejected_qty: rejected,
      rejection_reason: payload.rejection_reason || null,
    };

    let { data, error } = await supabase
      .from("inward_gate_passes")
      .insert([insertPayload])
      .select("*")
      .single();

    if (error?.code === "PGRST204") {
      // accepted/rejected columns missing in the schema cache → retry legacy shape.
      ({ data, error } = await supabase
        .from("inward_gate_passes")
        .insert([basePayload])
        .select("*")
        .single());
    }

    if (error) {
      console.error("Supabase Error [inward_gate_passes insert]:", error);
      throw new Error(error.message || "Database insert failed");
    }

    if (!data) {
      console.error("Supabase Error [inward_gate_passes insert]: Data is null (Check RLS SELECT policy)");
      throw new Error("Server returned null row record (Check RLS SELECT policy)");
    }

    return mapIgpRow(data as IgpRow);
  } catch (err) {
    console.error("Supabase Error [inward_gate_passes insert]:", err);
    throw err;
  }
}

export async function convertIGPToGRN(payload: InspectionPayload): Promise<GoodsReceivedNote> {
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!payload.igp_id || !uuidRegex.test(payload.igp_id)) {
    const errorMsg = `Invalid IGP ID "${payload.igp_id}". Expected a valid 36-character UUID string.`;
    console.error("Supabase Error [convert_igp_to_grn]:", errorMsg);
    throw new Error(errorMsg);
  }

  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();

  const { data: existingIGP, error: fetchErr } = await supabase
    .from('inward_gate_passes')
    .select('id, status')
    .eq('id', payload.igp_id)
    .maybeSingle();

  if (fetchErr) {
    console.error("Supabase Error [inward_gate_passes check]:", fetchErr);
    throw new Error(`Failed to verify IGP record: ${fetchErr.message}`);
  }

  if (!existingIGP) {
    throw new Error(`IGP not found in database for ID: ${payload.igp_id}`);
  }

  const rpcParams = {
    p_igp_id: payload.igp_id,
    p_accepted_qty: Number(payload.accepted_qty),
    p_rejected_qty: Number(payload.rejected_qty),
    p_rejection_reason: payload.rejection_reason || "Passed Inspection",
    p_unit_price_pkr: Number(payload.unit_price_pkr),
    p_device_node: payload.device_node || "PC-01",
    p_operator_name: payload.operator_name || "QC Staff",
  };

  if (!SUPABASE_URL) throw new Error("SUPABASE_URL not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/convert_igp_to_grn`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(rpcParams),
  });

  const resText = await res.text();
  let resJson: any;
  try { resJson = JSON.parse(resText); } catch { resJson = null; }

  if (!res.ok) {
    const errMsg = resJson?.message || resJson?.hint || resJson?.details || resJson?.code || resText || `HTTP ${res.status}`;
    console.error("Supabase Error [convert_igp_to_grn RPC]:", { status: res.status, body: resJson ?? resText });
    throw new Error(`RPC convert_igp_to_grn failed: ${errMsg}`);
  }

  if (!resJson) {
    throw new Error("RPC convert_igp_to_grn returned empty response");
  }

  return resJson as GoodsReceivedNote;
}

export async function rejectIGP(
  igpId: string,
  rejectionReason: string
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${igpId}`,
      {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          status: "REJECTED",
        }),
      }
    );
    if (!res.ok) {
      console.error("Supabase Error [inward_gate_passes reject]:", { status: res.status, body: await res.json() });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [inward_gate_passes reject]:", err);
    return false;
  }
}

export interface UpdateIGPPayload {
  material_description?: string;
  supplier_id?: string;
  inward_qty?: number;
  net_weight_kg?: number | null;
  accepted_qty?: number | null;
  rejected_qty?: number | null;
  rejection_reason?: string | null;
  vendor_lot_code?: string;
  coa_code?: string;
}

export async function updateIGP(
  igpId: string,
  payload: UpdateIGPPayload
): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const accepted = payload.accepted_qty ?? payload.net_weight_kg ?? payload.inward_qty;
    const rejected = payload.rejected_qty;
    const body: Record<string, unknown> = { ...payload };

    if (accepted !== undefined) {
      body.net_weight_kg = accepted;
      body.inward_qty = accepted;
    }
    if (rejected != null && rejected > 0) {
      body.vendor_lot_code = `REJ:${rejected}`;
      body.coa_code = `REJ:${rejected}`;
    }

    let res = await fetch(
      `${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${igpId}`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=minimal" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      // If error is due to unmigrated columns, remove them and retry
      delete body.accepted_qty;
      delete body.rejected_qty;
      delete body.rejection_reason;
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${igpId}`,
        {
          method: "PATCH",
          headers: { ...headers(), Prefer: "return=minimal" },
          body: JSON.stringify(body),
        }
      );
    }

    if (!res.ok) {
      console.error("Supabase Error [inward_gate_passes update]:", {
        status: res.status,
        body: await res.json(),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [inward_gate_passes update]:", err);
    return false;
  }
}

export async function deleteIGP(igpId: string): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inward_gate_passes?id=eq.${igpId}`,
      {
        method: "DELETE",
        headers: headers(),
      }
    );
    if (!res.ok) {
      console.error("Supabase Error [inward_gate_passes delete]:", {
        status: res.status,
        body: await res.json(),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase Error [inward_gate_passes delete]:", err);
    return false;
  }
}
