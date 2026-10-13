-- ============================================================================
-- Fix: Recreate post_gst_paints_invoice RPC to use live system_audit_logs schema
-- Live system_audit_logs columns: id, timestamp, operator_name, node_id, action_type, details
-- ============================================================================

DROP FUNCTION IF EXISTS public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.post_gst_paints_invoice(
  invoice_id         UUID,
  customer_id        UUID,
  taxable_value_pkr  NUMERIC,
  apply_further_tax  BOOLEAN,
  operator_name      TEXT,
  device_node        TEXT,
  line_items         JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice         sales_invoices%ROWTYPE;
  v_taxable         NUMERIC := taxable_value_pkr;
  v_sales_tax       NUMERIC;
  v_further_tax     NUMERIC;
  v_total_payable   NUMERIC;
  v_line            JSONB;
  v_entry_id        UUID;
  v_entry_number    TEXT;
  v_account_id_1100 UUID;
  v_account_id_5100 UUID;
  v_account_id_2200 UUID;
  v_account_id_2210 UUID;
BEGIN
  SELECT * INTO v_invoice
  FROM sales_invoices
  WHERE id = invoice_id
  FOR UPDATE;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice not found: %', invoice_id;
  END IF;

  IF v_invoice.is_posted THEN
    RAISE EXCEPTION 'Invoice % is already posted', v_invoice.invoice_number;
  END IF;

  IF v_invoice.customer_id != customer_id THEN
    RAISE EXCEPTION 'Customer mismatch: invoice belongs to %, got %', v_invoice.customer_id, customer_id;
  END IF;

  v_sales_tax   := round(v_taxable * 0.18, 2);
  v_further_tax := CASE WHEN apply_further_tax THEN round(v_taxable * 0.04, 2) ELSE 0 END;
  v_total_payable := v_taxable + v_sales_tax + v_further_tax;

  FOR v_line IN SELECT * FROM jsonb_array_elements(line_items)
  LOOP
    INSERT INTO sales_invoice_items (
      invoice_id, product_id, product_name,
      quantity, unit_price_pkr, line_total_pkr, unit_of_measure
    ) VALUES (
      invoice_id,
      (v_line->>'product_id')::UUID,
      COALESCE((v_line->>'product_name')::TEXT, ''),
      COALESCE((v_line->>'qty_buckets')::NUMERIC, 0),
      COALESCE((v_line->>'unit_price_pkr')::NUMERIC, 0),
      COALESCE((v_line->>'qty_buckets')::NUMERIC, 0) * COALESCE((v_line->>'unit_price_pkr')::NUMERIC, 0),
      COALESCE((v_line->>'unit_of_measure')::TEXT, 'L')
    );

    IF v_line ? 'lot_id' AND (v_line->>'lot_id')::TEXT != '' THEN
      UPDATE inventory_lots
      SET remaining_qty = remaining_qty - COALESCE((v_line->>'qty_buckets')::NUMERIC, 0)
      WHERE id = (v_line->>'lot_id')::UUID
        AND remaining_qty >= COALESCE((v_line->>'qty_buckets')::NUMERIC, 0);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock in lot %', v_line->>'lot_id';
      END IF;
    END IF;
  END LOOP;

  UPDATE sales_invoices si
  SET is_posted              = true,
      taxable_value_pkr      = v_taxable,
      sales_tax_amount_pkr   = v_sales_tax,
      further_tax_rate       = CASE WHEN apply_further_tax THEN 4 ELSE 0 END,
      further_tax_amount_pkr = v_further_tax,
      total_invoice_value_pkr = v_total_payable
  WHERE si.id = invoice_id;

  v_entry_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(
    (SELECT COALESCE(MAX(CAST(substring(entry_number FROM 12) AS INT)), 0) + 1
     FROM journal_entries
     WHERE entry_number LIKE 'JE-' || to_char(now(), 'YYYYMMDD') || '-%')::TEXT,
    4, '0'
  );

  INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
  VALUES (v_entry_number, CURRENT_DATE, 'Sales invoice ' || v_invoice.invoice_number || ' posted', true, 'POSTED')
  RETURNING id INTO v_entry_id;

  SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100';
  SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '5100';
  SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200';
  SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210';

  IF v_account_id_1100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_1100, v_total_payable, 0);
  END IF;

  IF v_account_id_5100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_5100, 0, v_taxable);
  END IF;

  IF v_sales_tax > 0 AND v_account_id_2200 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2200, 0, v_sales_tax);
  END IF;

  IF v_further_tax > 0 AND v_account_id_2210 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2210, 0, v_further_tax);
  END IF;

  -- Audit log — uses node_id (not device_node), no module/payload columns
  INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
  VALUES (
    post_gst_paints_invoice.device_node,
    post_gst_paints_invoice.operator_name,
    'POSTED_INVOICE',
    jsonb_build_object(
      'invoice_id', invoice_id,
      'invoice_number', v_invoice.invoice_number,
      'total_payable', v_total_payable
    )
  );

  RETURN jsonb_build_object(
    'invoice_number', v_invoice.invoice_number,
    'total_payable',  v_total_payable
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) TO service_role;


-- ============================================================================
-- Fix: Recreate convert_igp_to_grn RPC to use live system_audit_logs schema
-- ============================================================================

DROP FUNCTION IF EXISTS public.convert_igp_to_grn(UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.convert_igp_to_grn(
  p_igp_id UUID,
  p_accepted_qty NUMERIC(15, 4),
  p_rejected_qty NUMERIC(15, 4),
  p_rejection_reason TEXT,
  p_unit_price_pkr NUMERIC(15, 2),
  p_device_node TEXT,
  p_operator_name TEXT
) RETURNS goods_received_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_igp inward_gate_passes%ROWTYPE;
  v_grn goods_received_notes;
  v_grn_code VARCHAR(32);
  v_total_value NUMERIC(15, 2);
  v_wh01_id UUID;
BEGIN
  SELECT * INTO v_igp FROM inward_gate_passes WHERE id = p_igp_id FOR UPDATE;

  IF v_igp IS NULL THEN
    RAISE EXCEPTION 'IGP not found: %', p_igp_id;
  END IF;

  IF v_igp.status NOT IN ('PENDING_INSPECTION', 'PENDING_QC') THEN
    RAISE EXCEPTION 'IGP % is not pending inspection (current status: %)',
        COALESCE(v_igp.igp_code, v_igp.id::text), v_igp.status;
  END IF;

  IF p_accepted_qty + p_rejected_qty != COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg) THEN
    RAISE EXCEPTION 'Accepted + rejected qty must equal inward qty (% != %)',
        p_accepted_qty + p_rejected_qty, COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg);
  END IF;

  v_grn_code := 'GRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_seq')::text, 4, '0');
  v_total_value := p_accepted_qty * p_unit_price_pkr;

  INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, rejection_reason, unit_price_pkr, total_value_pkr)
  VALUES (v_grn_code, p_igp_id, p_accepted_qty, p_rejected_qty, p_rejection_reason, p_unit_price_pkr, v_total_value)
  RETURNING * INTO v_grn;

  UPDATE inward_gate_passes SET status = 'CONVERTED_TO_GRN' WHERE id = p_igp_id;

  SELECT id INTO v_wh01_id FROM inventory_warehouses WHERE code = 'WH-01' LIMIT 1;

  IF v_wh01_id IS NOT NULL AND p_accepted_qty > 0 THEN
    INSERT INTO inventory_balances (warehouse_id, product_id, current_qty, updated_at)
    SELECT v_wh01_id, pm.id, p_accepted_qty, now()
    FROM products_master pm
    WHERE pm.name = v_igp.material_description
    ON CONFLICT (warehouse_id, product_id)
    DO UPDATE SET current_qty = inventory_balances.current_qty + p_accepted_qty, updated_at = now();
  END IF;

  -- Audit log — uses node_id (not device_node), no module/payload columns
  INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
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
$$;

GRANT EXECUTE ON FUNCTION public.convert_igp_to_grn(UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_igp_to_grn(UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) TO service_role;
