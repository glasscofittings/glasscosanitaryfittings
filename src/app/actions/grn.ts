import { createClient } from "@supabase/supabase-js";
import type { UOM } from "@/lib/supabase/procurement";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface GRNInput {
  supplier_id: string;
  material_name: string;
  vendor_lot_number: string;
  coa_code: string;
  gross_weight: number;
  net_weight: number;
  unit_price_pkr: number;
  accepted_qty: number;
  rejected_qty: number;
  /** Unit of measure for the receipted quantities (defaults to KG). */
  uom?: UOM;
  rejection_reason?: string | null;
}

export interface GRNResult {
  success: boolean;
  grn_code?: string;
  invoice_number?: string;
  lot_number?: string;
  error?: string;
}

export async function createGRNAndDraftInvoice(formData: GRNInput): Promise<GRNResult> {
  const supabase = getServiceClient();

  // ── 1. Validate inputs ──────────────────────────────────────────────────
  if (!formData.supplier_id) return { success: false, error: "Supplier is required" };
  if (!formData.material_name?.trim()) return { success: false, error: "Material name is required" };
  if (!formData.vendor_lot_number?.trim()) return { success: false, error: "Vendor lot number is required" };
  if (formData.gross_weight <= 0) return { success: false, error: "Gross weight must be > 0" };
  if (formData.net_weight <= 0) return { success: false, error: "Net weight must be > 0" };
  if (formData.net_weight > formData.gross_weight) {
    return { success: false, error: "Net weight cannot exceed gross weight" };
  }
  if (formData.unit_price_pkr <= 0) return { success: false, error: "Unit price must be > 0" };
  if (formData.accepted_qty < 0) return { success: false, error: "Accepted qty cannot be negative" };
  if (formData.rejected_qty < 0) return { success: false, error: "Rejected qty cannot be negative" };
  if (formData.accepted_qty + formData.rejected_qty !== formData.net_weight) {
    return { success: false, error: "Accepted + rejected qty must equal net weight" };
  }

  // ── 2. Generate sequence numbers ────────────────────────────────────────
  const year = new Date().getFullYear();
  const timestamp = Date.now().toString().slice(-6);
  const grnCode = `GRN-${year}-${timestamp}`;
  const invoiceNumber = `PINV-${year}-${timestamp}`;
  const lotNumber = `LOT-${year}-${timestamp}`;

  // ── 3. Resolve supplier name ────────────────────────────────────────────
  let supplierName = "Unknown Supplier";
  const { data: supplier } = await supabase
    .from("parties")
    .select("name")
    .eq("id", formData.supplier_id)
    .single();
  if (supplier) supplierName = supplier.name;

  // ── 4. Create inventory lot (quality_inspection) ────────────────────────
  const { error: lotError } = await supabase
    .from("inventory_lots")
    .insert({
      lot_number: lotNumber,
      product_id: null,
      warehouse_id: null,
      vendor_lot_code: formData.vendor_lot_number,
      initial_qty: formData.accepted_qty,
      remaining_qty: formData.accepted_qty,
      unit_cost_pkr: formData.unit_price_pkr,
      qc_status: "PENDING",
    })
    .select("id")
    .single();

  if (lotError) {
    return { success: false, error: `Failed to create inventory lot: ${lotError.message}` };
  }

  // ── 5. Create goods receipt note ────────────────────────────────────────
  const totalValue = Math.round(formData.accepted_qty * formData.unit_price_pkr * 100) / 100;

  const { data: grn, error: grnError } = await supabase
    .from("goods_receipt_notes")
    .insert({
      grn_code: grnCode,
      igp_id: null,
      accepted_qty: formData.accepted_qty,
      rejected_qty: formData.rejected_qty,
      rejection_reason:
        formData.rejection_reason?.trim() ||
        (formData.rejected_qty > 0 ? "Manual quality adjustment" : null),
      unit_price_pkr: formData.unit_price_pkr,
      total_value_pkr: totalValue,
      product_id: null,
    })
    .select("id")
    .single();

  if (grnError) {
    return { success: false, error: `Failed to create GRN: ${grnError.message}` };
  }

  // ── 6. Create draft purchase invoice (pending_approval) ─────────────────
  const { error: invError } = await supabase
    .from("purchase_invoices")
    .insert({
      invoice_number: invoiceNumber,
      grn_id: grn.id,
      grn_number: grnCode,
      vendor_id: formData.supplier_id,
      vendor_name: supplierName,
      taxable_amount: totalValue,
      tax_amount: 0,
      total_payable: totalValue,
      status: "pending_approval",
      items: [
        {
          description: formData.material_name,
          lot_code: formData.vendor_lot_number,
          quantity: formData.accepted_qty,
          unit_of_measure: formData.uom || "KG",
          unit_price: formData.unit_price_pkr,
          total_amount: totalValue,
        },
      ],
    })
    .select("id")
    .single();

  if (invError) {
    return { success: false, error: `Failed to create purchase invoice: ${invError.message}` };
  }

  // ── 7. Audit log ────────────────────────────────────────────────────────
  await supabase.from("system_audit_logs").insert({
    operator_name: "Gate Operator",
    action_type: "UNIFIED_GRN_INVOICE_CREATED",
    module: "PROCUREMENT",
    details: {
      grn_code: grnCode,
      invoice_number: invoiceNumber,
      lot_number: lotNumber,
      supplier_name: supplierName,
      material_name: formData.material_name,
      accepted_qty: formData.accepted_qty,
      rejected_qty: formData.rejected_qty,
      uom: formData.uom || "KG",
      unit_price_pkr: formData.unit_price_pkr,
      total_value_pkr: totalValue,
    },
  });

  return {
    success: true,
    grn_code: grnCode,
    invoice_number: invoiceNumber,
    lot_number: lotNumber,
  };
}
