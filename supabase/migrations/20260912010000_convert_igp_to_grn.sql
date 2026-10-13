-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Goods Received Notes (GRN) Table Definition
-- Must exist before functions or PL/pgSQL routines reference `goods_received_notes` as a return type or variable rowtype.
CREATE TABLE IF NOT EXISTS goods_received_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_code TEXT NOT NULL UNIQUE,
    igp_id UUID NOT NULL REFERENCES inward_gate_passes(id) ON DELETE CASCADE,
    accepted_qty NUMERIC(15, 4) NOT NULL CHECK (accepted_qty >= 0),
    rejected_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
    rejection_reason TEXT,
    unit_price_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price_pkr >= 0),
    total_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_value_pkr >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for goods_received_notes
CREATE INDEX IF NOT EXISTS idx_grn_igp_id ON goods_received_notes(igp_id);
CREATE INDEX IF NOT EXISTS idx_grn_code ON goods_received_notes(grn_code);

-- 2. Supporting Inventory & Products Lookup Tables if referenced in RPC
CREATE TABLE IF NOT EXISTS inventory_warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

INSERT INTO inventory_warehouses (code, name)
SELECT 'WH-01', 'Raw Material Warehouse 01'
WHERE NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE code = 'WH-01');

CREATE TABLE IF NOT EXISTS products_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT
);

CREATE TABLE IF NOT EXISTS inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    current_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (current_qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wh_product UNIQUE (warehouse_id, product_id)
);

-- 3. Sequence for GRN Code Generation
CREATE SEQUENCE IF NOT EXISTS grn_seq START 1 INCREMENT 1;

-- 4. RPC Function to Convert IGP to GRN
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
  v_wh01_id UUID;
BEGIN
  -- Lock the IGP row
  SELECT * INTO v_igp
  FROM inward_gate_passes
  WHERE id = p_igp_id
  FOR UPDATE;

  IF v_igp IS NULL THEN
    RAISE EXCEPTION 'IGP not found: %', p_igp_id;
  END IF;

  IF v_igp.status != 'PENDING_INSPECTION' THEN
    RAISE EXCEPTION 'IGP % is not pending inspection (current status: %)', v_igp.igp_code, v_igp.status;
  END IF;

  IF p_accepted_qty + p_rejected_qty != v_igp.inward_qty THEN
    RAISE EXCEPTION 'Accepted + rejected qty must equal inward qty (% != %)', p_accepted_qty + p_rejected_qty, v_igp.inward_qty;
  END IF;

  -- Generate GRN code
  v_grn_code := 'GRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_seq')::text, 4, '0');

  -- Calculate total value
  v_total_value := p_accepted_qty * p_unit_price_pkr;

  -- Insert GRN
  INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, rejection_reason, unit_price_pkr, total_value_pkr)
  VALUES (v_grn_code, p_igp_id, p_accepted_qty, p_rejected_qty, p_rejection_reason, p_unit_price_pkr, v_total_value)
  RETURNING * INTO v_grn;

  -- Update IGP status
  UPDATE inward_gate_passes
  SET status = 'CONVERTED_TO_GRN'
  WHERE id = p_igp_id;

  -- Get WH-01 id
  SELECT id INTO v_wh01_id FROM inventory_warehouses WHERE code = 'WH-01';

  -- Upsert inventory balance for WH-01
  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty, updated_at)
  SELECT v_wh01_id, pm.id, p_accepted_qty, now()
  FROM products_master pm
  WHERE pm.name = v_igp.material_description
  ON CONFLICT (warehouse_id, product_id)
  DO UPDATE SET
    current_qty = inventory_balances.current_qty + p_accepted_qty,
    updated_at = now();

  -- Log action in system_audit_logs
  INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
  VALUES (
    p_device_node,
    p_operator_name,
    'CONVERTED_IGP_TO_GRN',
    jsonb_build_object(
      'igp_code', v_igp.igp_code,
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
