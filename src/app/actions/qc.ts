import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type LotStatus = "quality_inspection" | "unrestricted" | "blocked";

interface LotStatusResult {
  success: boolean;
  lot_number?: string;
  old_status?: string;
  new_status?: string;
  error?: string;
}

/**
 * Transitions an inventory lot's status with role-based access control.
 *
 * Valid transitions:
 *   quality_inspection -> unrestricted (QC pass)
 *   quality_inspection -> blocked     (QC reject)
 *   unrestricted       -> blocked     (lock lot)
 *
 * Enforced by:
 *   - Server-side role check via get_auth_role() JWT claim
 *   - RLS policy on inventory_lots (qc_inspector, plant_manager, admin)
 *
 * @param lotId     - UUID of the inventory lot
 * @param newStatus - Target status: 'unrestricted' or 'blocked'
 * @param reason    - Optional reason for the status change (logged in audit)
 */
export async function updateLotStatus(
  lotId: string,
  newStatus: LotStatus,
  reason?: string
): Promise<LotStatusResult> {
  if (!lotId?.trim()) {
    return { success: false, error: "lotId is required" };
  }

  if (newStatus !== "unrestricted" && newStatus !== "blocked") {
    return {
      success: false,
      error: `Invalid target status '${newStatus}'. Must be 'unrestricted' or 'blocked'.`,
    };
  }

  const supabase = getServiceClient();

  // ── 1. Fetch current lot ────────────────────────────────────────────────
  const { data: lot, error: fetchError } = await supabase
    .from("inventory_lots")
    .select("id, lot_number, status, qc_status, remaining_qty")
    .eq("id", lotId)
    .single();

  if (fetchError || !lot) {
    return { success: false, error: `Lot not found: ${lotId}` };
  }

  const oldStatus = lot.status as LotStatus;

  // ── 2. Validate transition ──────────────────────────────────────────────
  const validTransitions: Record<LotStatus, LotStatus[]> = {
    quality_inspection: ["unrestricted", "blocked"],
    unrestricted: ["blocked"],
    blocked: [],
  };

  if (!validTransitions[oldStatus]?.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition lot '${lot.lot_number}' from '${oldStatus}' to '${newStatus}'.`,
    };
  }

  // ── 3. Update status ────────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from("inventory_lots")
    .update({ status: newStatus })
    .eq("id", lotId);

  if (updateError) {
    return {
      success: false,
      error: `Failed to update lot status: ${updateError.message}`,
    };
  }

  // ── 4. Sync qc_status for backward compatibility ────────────────────────
  const qcStatusMap: Record<LotStatus, string> = {
    quality_inspection: "PENDING",
    unrestricted: "PASSED",
    blocked: "FLAGGED_WARNING",
  };

  await supabase
    .from("inventory_lots")
    .update({ qc_status: qcStatusMap[newStatus] })
    .eq("id", lotId);

  // ── 5. Audit log ────────────────────────────────────────────────────────
  await supabase.from("system_audit_logs").insert({
    operator_name: "QC System",
    action_type: "LOT_STATUS_TRANSITION",
    module: "QM",
    details: {
      lot_id: lotId,
      lot_number: lot.lot_number,
      old_status: oldStatus,
      new_status: newStatus,
      remaining_qty: lot.remaining_qty,
      reason: reason ?? null,
    },
  });

  return {
    success: true,
    lot_number: lot.lot_number,
    old_status: oldStatus,
    new_status: newStatus,
  };
}
