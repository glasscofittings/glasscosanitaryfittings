-- ============================================================================
-- Migration: post_gst_paints_invoice RPC
-- Date: 2026-09-30
-- Description: Creates the post_gst_paints_invoice function that posts a
--              sales invoice, inserts line items, creates journal entries,
--              deducts stock, and logs to system_audit_logs.
--              Then grants EXECUTE to authenticated and service_role.
-- ============================================================================

-- 1. Drop old version if it exists (safe re-run)
DROP FUNCTION IF EXISTS public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB);

-- 2. Create the RPC function
--    Parameter names match the TypeScript payload keys exactly.
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
  -- Lock and validate the invoice
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

  -- Calculate taxes (use local variables to avoid column-name shadowing)
  v_sales_tax   := round(v_taxable * 0.18, 2);
  v_further_tax := CASE WHEN apply_further_tax THEN round(v_taxable * 0.04, 2) ELSE 0 END;
  v_total_payable := v_taxable + v_sales_tax + v_further_tax;

  -- Insert line items into sales_invoice_items
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

    -- Deduct stock from inventory_lots if lot_id provided
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

  -- Mark invoice as posted and update tax values
  UPDATE sales_invoices si
  SET is_posted              = true,
      taxable_value_pkr      = v_taxable,
      sales_tax_amount_pkr   = v_sales_tax,
      further_tax_rate       = CASE WHEN apply_further_tax THEN 4 ELSE 0 END,
      further_tax_amount_pkr = v_further_tax,
      total_invoice_value_pkr = v_total_payable
  WHERE si.id = invoice_id;

  -- Create journal entry
  v_entry_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(
    (SELECT COALESCE(MAX(CAST(substring(entry_number FROM 12) AS INT)), 0) + 1
     FROM journal_entries
     WHERE entry_number LIKE 'JE-' || to_char(now(), 'YYYYMMDD') || '-%')::TEXT,
    4, '0'
  );

  INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
  VALUES (
    v_entry_number,
    CURRENT_DATE,
    'Sales invoice ' || v_invoice.invoice_number || ' posted',
    true,
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  -- Resolve account IDs
  SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100';
  SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '5100';
  SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200';
  SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210';

  -- Debit: Accounts Receivable (1100) — total payable
  IF v_account_id_1100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_1100, v_total_payable, 0);
  END IF;

  -- Credit: Sales Revenue (5100) — taxable value
  IF v_account_id_5100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_5100, 0, v_taxable);
  END IF;

  -- Credit: Sales Tax Payable (2200)
  IF v_sales_tax > 0 AND v_account_id_2200 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2200, 0, v_sales_tax);
  END IF;

  -- Credit: Further Tax Payable (2210)
  IF v_further_tax > 0 AND v_account_id_2210 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2210, 0, v_further_tax);
  END IF;

  -- Audit log
  INSERT INTO system_audit_logs (device_node, operator_name, action_type, module, details, payload)
  VALUES (
    post_gst_paints_invoice.device_node,
    post_gst_paints_invoice.operator_name,
    'POSTED_INVOICE',
    'INVOICING',
    jsonb_build_object(
      'invoice_id', invoice_id,
      'invoice_number', v_invoice.invoice_number,
      'total_payable', v_total_payable
    ),
    jsonb_build_object(
      'invoice_id', invoice_id,
      'taxable_value_pkr', v_taxable,
      'sales_tax', v_sales_tax,
      'further_tax', v_further_tax,
      'total_payable', v_total_payable
    )
  );

  -- Return result
  RETURN jsonb_build_object(
    'invoice_number', v_invoice.invoice_number,
    'total_payable',  v_total_payable
  );
END;
$$;

-- 3. Grant permissions
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(
  UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(
  UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB
) TO service_role;
