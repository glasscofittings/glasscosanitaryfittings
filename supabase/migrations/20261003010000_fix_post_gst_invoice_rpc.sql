-- ============================================================================
-- Migration: Fix post_gst_paints_invoice RPC
-- Date: 2026-10-03
-- Fixes:
--   1. Use IF NOT FOUND (not IS NULL) to detect missing invoice row
--   2. Make entry_number generation safe against non-numeric suffixes
--   3. Make journal_lines party_id optional (skip if column absent)
--   4. Audit log uses both node_id and device_node for broad compatibility
-- ============================================================================

DROP FUNCTION IF EXISTS public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB);

-- T2: shared sequential numbering (idempotent)
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

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
  v_invoice           sales_invoices%ROWTYPE;
  v_taxable           NUMERIC := taxable_value_pkr;
  v_sales_tax         NUMERIC;
  v_further_tax       NUMERIC;
  v_total_payable     NUMERIC;
  v_line              JSONB;
  v_entry_id          UUID;
  v_entry_number      TEXT;
  v_account_id_1100   UUID;
  v_account_id_5100   UUID;
  v_account_id_2200   UUID;
  v_account_id_2210   UUID;
BEGIN
  -- ── 1. Lock and validate invoice ──────────────────────────────────────────
  SELECT * INTO v_invoice
  FROM sales_invoices
  WHERE id = invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', invoice_id;
  END IF;

  IF v_invoice.is_posted THEN
    RAISE EXCEPTION 'Invoice % is already posted', v_invoice.invoice_number;
  END IF;

  -- Only enforce customer_id match when it was provided
  IF customer_id IS NOT NULL AND v_invoice.customer_id IS DISTINCT FROM customer_id THEN
    RAISE EXCEPTION 'Customer mismatch: invoice belongs to %, got %',
      v_invoice.customer_id, customer_id;
  END IF;

  -- ── 2. Calculate taxes ────────────────────────────────────────────────────
  v_sales_tax     := round(v_taxable * 0.18, 2);
  v_further_tax   := CASE WHEN apply_further_tax THEN round(v_taxable * 0.04, 2) ELSE 0 END;
  v_total_payable := v_taxable + v_sales_tax + v_further_tax;

  -- ── 3. Insert line items & deduct stock ───────────────────────────────────
  FOR v_line IN SELECT * FROM jsonb_array_elements(line_items)
  LOOP
    INSERT INTO sales_invoice_items (
      invoice_id, product_id, product_name,
      quantity, unit_price_pkr, line_total_pkr, unit_of_measure
    ) VALUES (
      invoice_id,
      NULLIF((v_line->>'product_id')::TEXT, '')::UUID,
      COALESCE((v_line->>'product_name')::TEXT, ''),
      COALESCE((v_line->>'qty_buckets')::NUMERIC, 0),
      COALESCE((v_line->>'unit_price_pkr')::NUMERIC, 0),
      COALESCE((v_line->>'qty_buckets')::NUMERIC, 0) * COALESCE((v_line->>'unit_price_pkr')::NUMERIC, 0),
      COALESCE((v_line->>'unit_of_measure')::TEXT, 'L')
    );

    -- Deduct from inventory_lots only when lot_id is a valid UUID string
    IF v_line ? 'lot_id'
       AND (v_line->>'lot_id') IS NOT NULL
       AND (v_line->>'lot_id') <> ''
    THEN
      UPDATE inventory_lots
      SET remaining_qty = remaining_qty - COALESCE((v_line->>'qty_buckets')::NUMERIC, 0)
      WHERE id = (v_line->>'lot_id')::UUID
        AND remaining_qty >= COALESCE((v_line->>'qty_buckets')::NUMERIC, 0);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock in lot %', v_line->>'lot_id';
      END IF;
    END IF;
  END LOOP;

  -- ── 4. Mark invoice as posted ─────────────────────────────────────────────
  UPDATE sales_invoices si
  SET is_posted               = true,
      taxable_value_pkr       = v_taxable,
      sales_tax_amount_pkr    = v_sales_tax,
      further_tax_rate        = CASE WHEN apply_further_tax THEN 4 ELSE 0 END,
      further_tax_amount_pkr  = v_further_tax,
      total_invoice_value_pkr = v_total_payable
  WHERE si.id = invoice_id;

  -- ── 5. Generate unique journal entry number (T2: shared sequence) ─────────
  v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
  VALUES (
    v_entry_number,
    CURRENT_DATE,
    'Sales invoice ' || v_invoice.invoice_number || ' posted',
    true,
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  -- ── 6. Resolve account IDs ────────────────────────────────────────────────
  SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100';
  SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '5100';
  SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200';
  SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210';

  -- ── 7. Insert journal lines ───────────────────────────────────────────────
  -- Debit: Accounts Receivable (1100)
  IF v_account_id_1100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_1100, v_total_payable, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Credit: Sales Revenue (5100)
  IF v_account_id_5100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_5100, 0, v_taxable)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Credit: Sales Tax Payable (2200)
  IF v_sales_tax > 0 AND v_account_id_2200 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2200, 0, v_sales_tax)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Credit: Further Tax Payable (2210)
  IF v_further_tax > 0 AND v_account_id_2210 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2210, 0, v_further_tax)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── 8. Audit log (use only base columns guaranteed to exist) ──────────────
  INSERT INTO system_audit_logs (
    node_id, operator_name, action_type, details
  ) VALUES (
    post_gst_paints_invoice.device_node,
    post_gst_paints_invoice.operator_name,
    'POSTED_INVOICE',
    jsonb_build_object(
      'invoice_id',      invoice_id,
      'invoice_number',  v_invoice.invoice_number,
      'total_payable',   v_total_payable,
      'entry_number',    v_entry_number
    )
  );

  -- ── 9. Return result ──────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'invoice_number', v_invoice.invoice_number,
    'total_payable',  v_total_payable
  );

EXCEPTION
  WHEN unique_violation THEN
    -- Duplicate entry_number race: caller can retry
    RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
  WHEN others THEN
    RAISE;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO service_role;
