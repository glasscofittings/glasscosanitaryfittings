-- 1. Ensure RLS policies exist for goods_received_notes and inventory_wh01_raw
ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_wh01_raw ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select for all on goods_received_notes" ON goods_received_notes;
CREATE POLICY "Allow select for all on goods_received_notes" 
ON goods_received_notes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert for all on goods_received_notes" ON goods_received_notes;
CREATE POLICY "Allow insert for all on goods_received_notes" 
ON goods_received_notes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow select for all on inventory_wh01_raw" ON inventory_wh01_raw;
CREATE POLICY "Allow select for all on inventory_wh01_raw" 
ON inventory_wh01_raw FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert for all on inventory_wh01_raw" ON inventory_wh01_raw;
CREATE POLICY "Allow insert for all on inventory_wh01_raw" 
ON inventory_wh01_raw FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update for all on inventory_wh01_raw" ON inventory_wh01_raw;
CREATE POLICY "Allow update for all on inventory_wh01_raw" 
ON inventory_wh01_raw FOR UPDATE USING (true);

-- 2. Enhanced RPC Function to Convert IGP to GRN with automatic inventory posting to inventory_wh01_raw
CREATE OR REPLACE FUNCTION convert_igp_to_grn(
  p_igp_id UUID,
  p_accepted_qty NUMERIC(15, 4),
  p_rejected_qty NUMERIC(15, 4),
  p_rejection_reason TEXT,
  p_unit_price_pkr NUMERIC(15, 2),
  p_device_node TEXT,
  p_operator_name TEXT
) RETURNS goods_received_notes AS $$
DECLARE
  v_igp inward_gate_passes%ROWTYPE;
  v_grn goods_received_notes;
  v_grn_code VARCHAR(32);
  v_total_value NUMERIC(15, 2);
  v_lot_num TEXT;
BEGIN
  -- Lock the IGP row
  SELECT * INTO v_igp
  FROM inward_gate_passes
  WHERE id = p_igp_id
  FOR UPDATE;

  IF v_igp IS NULL THEN
    RAISE EXCEPTION 'IGP not found: %', p_igp_id;
  END IF;

  IF v_igp.status NOT IN ('PENDING_INSPECTION', 'PENDING_QC') THEN
    RAISE EXCEPTION 'IGP % is not pending inspection (current status: %)', COALESCE(v_igp.igp_code, v_igp.id::text), v_igp.status;
  END IF;

  IF p_accepted_qty + p_rejected_qty != COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg) THEN
    RAISE EXCEPTION 'Accepted + rejected qty must equal inward qty (% != %)', p_accepted_qty + p_rejected_qty, COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg);
  END IF;

  -- Generate GRN code
  v_grn_code := 'GRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_seq')::text, 4, '0');

  -- Calculate total value
  v_total_value := p_accepted_qty * p_unit_price_pkr;

  -- Insert GRN
  INSERT INTO goods_received_notes (
    grn_code,
    igp_id,
    accepted_qty,
    rejected_qty,
    rejection_reason,
    unit_price_pkr,
    total_value_pkr
  )
  VALUES (
    v_grn_code,
    p_igp_id,
    p_accepted_qty,
    p_rejected_qty,
    p_rejection_reason,
    p_unit_price_pkr,
    v_total_value
  )
  RETURNING * INTO v_grn;

  -- Update IGP status to 'INSPECTED' / 'PASSED_QC' / 'CONVERTED_TO_GRN'
  UPDATE inward_gate_passes
  SET status = 'INSPECTED'
  WHERE id = p_igp_id;

  -- Automatically post accepted quantity into inventory_wh01_raw
  IF p_accepted_qty > 0 THEN
    v_lot_num := COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MI'));

    INSERT INTO inventory_wh01_raw (
      material_sku,
      lot_number,
      balance_kg,
      location
    )
    VALUES (
      v_igp.material_description,
      v_lot_num,
      p_accepted_qty,
      'WH01-GENERAL'
    )
    ON CONFLICT (lot_number)
    DO UPDATE SET
      balance_kg = inventory_wh01_raw.balance_kg + EXCLUDED.balance_kg;
  END IF;

  -- Audit log
  INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
  VALUES (
    p_device_node,
    p_operator_name,
    'CONVERTED_IGP_TO_GRN',
    jsonb_build_object(
      'igp_id', p_igp_id,
      'grn_code', v_grn_code,
      'accepted_qty', p_accepted_qty,
      'rejected_qty', p_rejected_qty,
      'unit_price_pkr', p_unit_price_pkr,
      'total_value_pkr', v_total_value
    )
  );

  RETURN v_grn;
END;
$$ LANGUAGE plpgsql;
