// =============================================================================
// SAP-STYLE INVENTORY ENGINE (QM / MM Modules)
// Table: inventory_lots_sap
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

export type LotStatus = "quality_inspection" | "unrestricted" | "blocked";

export interface InventoryLotSAP {
  id: string;
  lot_number: string;
  material_name: string;
  initial_qty: number;
  current_qty: number;
  unit_of_measure: string;
  unit_price_pkr: number;
  status: LotStatus;
  created_at: string;
}

export interface SAPInventoryResult<T> {
  data: T | null;
  error: string | null;
}

// ── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchInventoryLotsSAP(): Promise<InventoryLotSAP[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots_sap?order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchInventoryLotsByStatusSAP(
  status: LotStatus
): Promise<InventoryLotSAP[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots_sap?status=eq.${status}&order=created_at.desc`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchInventoryLotByIdSAP(
  id: string
): Promise<InventoryLotSAP | null> {
  if (!SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/inventory_lots_sap?id=eq.${id}`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data[0] ?? null) : null;
  } catch {
    return null;
  }
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createInventoryLotSAP(data: {
  lot_number: string;
  material_name: string;
  initial_qty: number;
  current_qty: number;
  unit_of_measure?: string;
  unit_price_pkr: number;
  status?: LotStatus;
}): Promise<SAPInventoryResult<InventoryLotSAP>> {
  if (!SUPABASE_URL) return { data: null, error: "Server URL is not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots_sap`, {
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

// ── Status Transitions (QM Module) ───────────────────────────────────────────

/**
 * Transitions a lot from `quality_inspection` to `unrestricted` (QC pass)
 * or `blocked` (QC reject). Only qc_inspector, plant_manager, or admin
 * can perform this action (enforced by RLS).
 */
export async function transitionLotStatusSAP(
  lotId: string,
  newStatus: LotStatus
): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };

  // 1. Fetch current lot
  const lot = await fetchInventoryLotByIdSAP(lotId);
  if (!lot) return { success: false, error: "Lot not found" };

  // 2. Validate transition
  const validTransitions: Record<LotStatus, LotStatus[]> = {
    quality_inspection: ["unrestricted", "blocked"],
    unrestricted: ["blocked"],
    blocked: [],
  };

  if (!validTransitions[lot.status].includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition lot from '${lot.status}' to '${newStatus}'`,
    };
  }

  // 3. Update status
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots_sap?id=eq.${lotId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { success: false, error: body.message ?? "Update failed" };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Deducts stock from a lot. Enforces:
 * - Lot must be in `unrestricted` status
 * - Requested qty must not exceed current_qty
 */
export async function deductLotStockSAP(
  lotId: string,
  deductQty: number
): Promise<{ success: boolean; error?: string }> {
  if (!SUPABASE_URL) return { success: false, error: "Server URL is not configured" };
  if (deductQty <= 0) return { success: false, error: "Deduction quantity must be > 0" };

  const lot = await fetchInventoryLotByIdSAP(lotId);
  if (!lot) return { success: false, error: "Lot not found" };
  if (lot.status !== "unrestricted") {
    return {
      success: false,
      error: `Lot is '${lot.status}'. Only unrestricted lots can be consumed.`,
    };
  }
  if (lot.current_qty < deductQty) {
    return {
      success: false,
      error: `Insufficient stock. Available: ${lot.current_qty}, requested: ${deductQty}`,
    };
  }

  const newQty = Math.round((lot.current_qty - deductQty) * 10000) / 10000;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory_lots_sap?id=eq.${lotId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ current_qty: newQty }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { success: false, error: body.message ?? "Deduction failed" };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
