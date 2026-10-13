-- ============================================================================
-- Migration: 20261010020000_sequential_journal_entry_numbers.sql
-- Task: T2 — Single sequential numbering scheme for journal_entries.
--
-- Problem:
--   - post_gst_paints_invoice used a MAX+1 daily scan (JE-YYYYMMDD-0001)
--     with unique_violation retry.
--   - approve_and_post_purchase_invoice used random 4-digit yearly numbers
--     (JE-YYYY-####) with no collision handling.
--
-- Fix:
--   - CREATE SEQUENCE journal_entry_seq (same pattern as grn_number_seq /
--     purchase_invoice_seq).
--   - One format everywhere: JE-YYYYMMDD-00000 (date from entry_date, serial
--     from nextval, zero-padded to 5).
--   - Remove random / MAX+1 blocks; keep unique_violation safety net.
--   - create_payment_voucher also switched so ALL new entry_number values
--     share one format (acceptance criterion 2).
--
-- Supersedes numbering logic in:
--   20261003010000, 20261005010000, 20261005020000, 20261010010000
-- (those files are also updated for repo consistency / full re-runs).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Shared sequence
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

GRANT USAGE ON SEQUENCE public.journal_entry_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.journal_entry_seq TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: post_gst_paints_invoice  (sequence numbering, is_balanced removed
--    per T1; balance enforced by trg_enforce_journal_balance)
-- ─────────────────────────────────────────────────────────────────────────────

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

  IF customer_id IS NOT NULL AND v_invoice.customer_id IS DISTINCT FROM customer_id THEN
    RAISE EXCEPTION 'Customer mismatch: invoice belongs to %, got %',
      v_invoice.customer_id, customer_id;
  END IF;

  v_sales_tax     := round(v_taxable * 0.18, 2);
  v_further_tax   := CASE WHEN apply_further_tax THEN round(v_taxable * 0.04, 2) ELSE 0 END;
  v_total_payable := v_taxable + v_sales_tax + v_further_tax;

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

  UPDATE sales_invoices si
  SET is_posted               = true,
      taxable_value_pkr       = v_taxable,
      sales_tax_amount_pkr    = v_sales_tax,
      further_tax_rate        = CASE WHEN apply_further_tax THEN 4 ELSE 0 END,
      further_tax_amount_pkr  = v_further_tax,
      total_invoice_value_pkr = v_total_payable
  WHERE si.id = invoice_id;

  -- Single shared sequence — format JE-YYYYMMDD-00000
  v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status)
  VALUES (
    v_entry_number,
    CURRENT_DATE,
    'Sales invoice ' || v_invoice.invoice_number || ' posted',
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100';
  SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '5100';
  SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200';
  SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210';

  IF v_account_id_1100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_1100, v_total_payable, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_account_id_5100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_5100, 0, v_taxable)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_sales_tax > 0 AND v_account_id_2200 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2200, 0, v_sales_tax)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_further_tax > 0 AND v_account_id_2210 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2210, 0, v_further_tax)
    ON CONFLICT DO NOTHING;
  END IF;

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

  RETURN jsonb_build_object(
    'invoice_number', v_invoice.invoice_number,
    'total_payable',  v_total_payable
  );

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
  WHEN others THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: approve_and_post_purchase_invoice  (sequence numbering; random
--    block deleted; unique_violation safety net added; is_balanced removed
--    per T1; audit uses node_id — live system_audit_logs has no device_node)
-- DEBIT  1101 (Inventory / Raw Chemicals Asset)
-- CREDIT 2001 (Accounts Payable) with party_id = vendor_id
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_and_post_purchase_invoice(
    p_invoice_id UUID,
    p_operator_name TEXT DEFAULT 'Accounts Dept',
    p_device_node TEXT DEFAULT 'PC-01'
) RETURNS JSONB AS $$
DECLARE
    v_inv purchase_invoices%ROWTYPE;
    v_ap_account_id UUID;
    v_raw_account_id UUID;
    v_entry_id UUID;
    v_entry_number TEXT;
BEGIN
    SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF v_inv.id IS NULL THEN
        RAISE EXCEPTION 'Purchase invoice not found: %', p_invoice_id;
    END IF;

    IF v_inv.status != 'pending_approval' THEN
        RAISE EXCEPTION 'Invoice is not in pending_approval status (current: %)', v_inv.status;
    END IF;

    SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
    IF v_ap_account_id IS NULL THEN
        SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_type = 'LIABILITY' LIMIT 1;
    END IF;

    SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '1101' LIMIT 1;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '5001' LIMIT 1;
    END IF;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart
        WHERE account_type IN ('EXPENSE', 'ASSET') LIMIT 1;
    END IF;

    IF v_ap_account_id IS NULL OR v_raw_account_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve AP (2001) or Inventory (1101) accounts in accounts_chart';
    END IF;

    -- Single shared sequence — format JE-YYYYMMDD-00000 (no random)
    v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
        lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

    INSERT INTO journal_entries (entry_number, entry_date, narration, customer_name, status)
    VALUES (
        v_entry_number,
        CURRENT_DATE,
        'Vendor Purchase Invoice Posted [' || v_inv.invoice_number || ' - ' || v_inv.grn_number || ']',
        v_inv.vendor_name,
        'POSTED'
    ) RETURNING id INTO v_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_raw_account_id, v_inv.vendor_id, v_inv.total_payable, 0.00);

    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_ap_account_id, v_inv.vendor_id, 0.00, v_inv.total_payable);

    UPDATE purchase_invoices SET status = 'posted' WHERE id = v_inv.id;

    IF v_inv.grn_id IS NOT NULL THEN
        UPDATE goods_receipt_notes SET status = 'invoiced' WHERE id = v_inv.grn_id;
    END IF;

    INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
    VALUES (p_device_node, p_operator_name, 'PURCHASE_INVOICE_APPROVED_POSTED',
        jsonb_build_object(
            'purchase_invoice_id', v_inv.id,
            'invoice_number',      v_inv.invoice_number,
            'total_payable',       v_inv.total_payable,
            'journal_entry_id',    v_entry_id,
            'entry_number',        v_entry_number
        ));

    RETURN jsonb_build_object(
        'success',          true,
        'invoice_id',       v_inv.id,
        'journal_entry_id', v_entry_id,
        'entry_number',     v_entry_number
    );
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION approve_and_post_purchase_invoice(UUID, TEXT, TEXT)
    TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: create_payment_voucher  (same sequence + format so every new
--    entry_number matches JE-YYYYMMDD-00000; T1 is_balanced removal kept;
--    single-sided entries still rejected by trg_enforce_journal_balance)
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_payment_voucher(
  p_voucher_type      TEXT,
  p_voucher_date      DATE,
  p_payee_name        TEXT,
  p_amount            NUMERIC,
  p_payee_address     TEXT DEFAULT NULL,
  p_cnic_ntn          TEXT DEFAULT NULL,
  p_purpose           TEXT DEFAULT NULL,
  p_reference_no      TEXT DEFAULT NULL,
  p_debit_account_id  UUID DEFAULT NULL,
  p_credit_account_id UUID DEFAULT NULL,
  p_remarks           TEXT DEFAULT NULL,
  p_amount_in_words   TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix        TEXT;
  v_voucher_no    TEXT;
  v_row           payment_vouchers%ROWTYPE;
  v_created_by    UUID;
  v_entry_id      UUID;
  v_entry_number  TEXT;
BEGIN
  IF p_voucher_type = 'CASH_PAYMENT' THEN
    v_prefix := 'CPV';
  ELSIF p_voucher_type = 'PARTY_PAYMENT' THEN
    v_prefix := 'PPV';
  ELSE
    v_prefix := 'BPV';
  END IF;

  v_voucher_no := v_prefix || '-' || to_char(p_voucher_date, 'YYYY') || '-' ||
    lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');

  v_created_by := auth.uid();

  INSERT INTO payment_vouchers (
    voucher_no, voucher_type, voucher_date,
    payee_name, payee_address, cnic_ntn,
    purpose, reference_no,
    debit_account_id, credit_account_id,
    amount, amount_in_words, remarks,
    created_by
  ) VALUES (
    v_voucher_no, p_voucher_type, p_voucher_date,
    p_payee_name, p_payee_address, p_cnic_ntn,
    p_purpose, p_reference_no,
    p_debit_account_id, p_credit_account_id,
    p_amount, COALESCE(p_amount_in_words, ''),
    p_remarks,
    v_created_by
  )
  RETURNING * INTO v_row;

  -- Single shared sequence — format JE-YYYYMMDD-00000
  v_entry_number := 'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status)
  VALUES (
    v_entry_number,
    p_voucher_date,
    v_prefix || ' ' || v_voucher_no || ' — ' || p_payee_name,
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  IF p_debit_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, p_debit_account_id, p_amount, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  IF p_credit_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, p_credit_account_id, 0, p_amount)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN to_jsonb(v_row);

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_voucher(
  TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_payment_voucher(
  TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) TO anon;

GRANT EXECUTE ON FUNCTION public.create_payment_voucher(
  TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verify (optional — run after migration)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT nextval('journal_entry_seq');  -- then roll back or ignore the value
-- SELECT proname, prosrc FROM pg_proc
--  WHERE proname IN ('post_gst_paints_invoice',
--                    'approve_and_post_purchase_invoice',
--                    'create_payment_voucher');
-- -- prosrc must contain nextval('journal_entry_seq') and no random() /
-- -- MAX+1 entry-number scan.
