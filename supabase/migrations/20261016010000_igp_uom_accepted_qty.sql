-- ============================================================================
-- Migration: IGP UOM + Accepted / Rejected quantity tracking
-- ============================================================================
-- Adds accepted/rejected tracking columns to inward_gate_passes (the intake
-- drawer computed them but never persisted them) and patches
-- generate_grn_from_igp so GRN / purchase invoices are built from the
-- ACCEPTED quantity instead of the raw inward (net) quantity.
-- ============================================================================

-- 1. New columns ────────────────────────────────────────────────────────────
ALTER TABLE inward_gate_passes
  ADD COLUMN IF NOT EXISTS accepted_qty NUMERIC(15, 4),
  ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC(15, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2. Backfill existing rows: accepted = net weight (else inward qty) ────────
UPDATE inward_gate_passes
SET accepted_qty = COALESCE(NULLIF(net_weight_kg, 0), inward_qty, 0)
WHERE accepted_qty IS NULL;

UPDATE inward_gate_passes
SET rejected_qty = GREATEST(0, COALESCE(inward_qty, 0) - COALESCE(accepted_qty, 0))
WHERE COALESCE(rejected_qty, 0) = 0
  AND COALESCE(inward_qty, 0) > COALESCE(accepted_qty, 0);

-- 3. GRN generation from IGP now bills the ACCEPTED quantity ────────────────
CREATE OR REPLACE FUNCTION generate_grn_from_igp(
    p_igp_id UUID,
    p_unit_price NUMERIC DEFAULT 0,
    p_operator_name TEXT DEFAULT 'Gate Operator',
    p_device_node TEXT DEFAULT 'PC-01'
) RETURNS JSONB AS $$
DECLARE
    v_igp inward_gate_passes%ROWTYPE;
    v_vendor parties%ROWTYPE;
    v_grn_id UUID;
    v_grn_number TEXT;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_qty NUMERIC(15, 4);
    v_rejected NUMERIC(15, 4);
    v_taxable NUMERIC(15, 2);
    v_total NUMERIC(15, 2);
    v_items JSONB;
BEGIN
    SELECT * INTO v_igp FROM inward_gate_passes WHERE id = p_igp_id FOR UPDATE;
    IF v_igp.id IS NULL THEN
        RAISE EXCEPTION 'Inward Gate Pass not found: %', p_igp_id;
    END IF;

    IF v_igp.supplier_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT * INTO v_vendor FROM parties WHERE id = v_igp.supplier_id::uuid;
    END IF;

    -- Bill only what was ACCEPTED; fall back to legacy rows without the column.
    v_qty := COALESCE(v_igp.accepted_qty, v_igp.inward_qty, v_igp.gross_weight_kg, 1);
    v_rejected := COALESCE(v_igp.rejected_qty, 0);
    v_taxable := ROUND(v_qty * COALESCE(p_unit_price, 0), 2);
    v_total := v_taxable;

    v_grn_number := 'GRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_number_seq')::text, 5, '0');
    v_invoice_number := 'PINV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('purchase_invoice_seq')::text, 5, '0');

    v_items := jsonb_build_array(
        jsonb_build_object(
            'description', v_igp.material_description,
            'lot_code', COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, ''),
            'quantity', v_qty,
            'unit_of_measure', COALESCE(v_igp.unit_of_measure, 'KG'),
            'unit_price', COALESCE(p_unit_price, 0),
            'total_amount', v_total
        )
    );

    INSERT INTO goods_receipt_notes (
        grn_number,
        gate_pass_id,
        vendor_id,
        vendor_name,
        received_date,
        items,
        accepted_qty,
        rejected_qty,
        rejection_reason,
        status
    ) VALUES (
        v_grn_number,
        v_igp.id,
        v_vendor.id,
        COALESCE(v_vendor.name, v_igp.supplier_id),
        CURRENT_DATE,
        v_items,
        v_qty,
        v_rejected,
        v_igp.rejection_reason,
        'pending_invoice'
    ) RETURNING id INTO v_grn_id;

    INSERT INTO purchase_invoices (
        invoice_number,
        grn_id,
        grn_number,
        vendor_id,
        vendor_name,
        taxable_amount,
        tax_amount,
        total_payable,
        status,
        items
    ) VALUES (
        v_invoice_number,
        v_grn_id,
        v_grn_number,
        v_vendor.id,
        COALESCE(v_vendor.name, v_igp.supplier_id),
        v_taxable,
        0.00,
        v_total,
        'pending_approval',
        v_items
    ) RETURNING id INTO v_invoice_id;

    UPDATE inward_gate_passes
    SET status = 'CONVERTED_TO_GRN'
    WHERE id = v_igp.id;

    INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
    VALUES (
        p_device_node,
        p_operator_name,
        'GRN_GENERATED_FROM_IGP',
        jsonb_build_object(
            'igp_id', v_igp.id,
            'grn_id', v_grn_id,
            'grn_number', v_grn_number,
            'purchase_invoice_id', v_invoice_id,
            'invoice_number', v_invoice_number,
            'accepted_qty', v_qty,
            'rejected_qty', v_rejected,
            'uom', COALESCE(v_igp.unit_of_measure, 'KG')
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'grn_id', v_grn_id,
        'grn_number', v_grn_number,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
