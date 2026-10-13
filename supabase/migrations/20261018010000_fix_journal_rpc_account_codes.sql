-- ============================================================================
-- Migration: 20261018010000_fix_journal_rpc_account_codes.sql
-- Description:
--   Phase 1 of double-entry accounting bug fixes.
--
--   1. Ensure account 5100 (Sales Revenue — legacy code used by the old
--      post_gst_paints_invoice RPC) exists and maps to the same REVENUE type.
--      The canonical code going forward is 4001; 5100 is kept as a backward-
--      compatible alias so existing data / old RPCs are not broken.
--
--   2. Replace post_gst_paints_invoice to:
--        a. Use account 4001 (REVENUE) as primary, fall back to 5100 only if
--           4001 is absent.
--        b. Remove ON CONFLICT DO NOTHING from journal_lines inserts — a
--           duplicate line signals a logic bug and must surface as an error,
--           not be silently dropped.
--        c. Raise a hard EXCEPTION if any core account cannot be resolved
--           (was previously skipping the missing line entirely).
--
--   3. Replace create_payment_voucher to:
--        a. Only create the journal_entry header when at least one account side
--           is provided (prevents orphaned zero-line "posted" entries).
--        b. Remove ON CONFLICT DO NOTHING from journal_lines inserts.
--        c. Set is_balanced = (both sides provided) so single-sided vouchers
--           are not falsely marked balanced.
-- ============================================================================

-- ── 1. Ensure 5100 exists (idempotent) ───────────────────────────────────────
INSERT INTO public.accounts_chart (account_code, account_name, account_type, is_default_cash, is_liquid_funds)
VALUES ('5100', 'Sales Revenue (Legacy)', 'REVENUE', false, false)
ON CONFLICT (account_code) DO NOTHING;

-- ── 2. Fix post_gst_paints_invoice ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB);

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
  v_acct_ar           UUID;  -- 1100  Accounts Receivable
  v_acct_rev          UUID;  -- 4001  Sales Revenue (canonical)
  v_acct_tax          UUID;  -- 2200  Sales Tax Collected
  v_acct_ftax         UUID;  -- 2210  Further Tax Payable
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

  -- ── 5. Resolve account IDs (hard error if core accounts missing) ──────────
  SELECT id INTO v_acct_ar   FROM accounts_chart WHERE account_code = '1100' LIMIT 1;
  -- Prefer 4001 (canonical), fall back to 5100 (legacy seed) if 4001 absent
  SELECT id INTO v_acct_rev  FROM accounts_chart WHERE account_code = '4001' LIMIT 1;
  IF v_acct_rev IS NULL THEN
    SELECT id INTO v_acct_rev FROM accounts_chart WHERE account_code = '5100' LIMIT 1;
  END IF;
  SELECT id INTO v_acct_tax  FROM accounts_chart WHERE account_code = '2200' LIMIT 1;
  SELECT id INTO v_acct_ftax FROM accounts_chart WHERE account_code = '2210' LIMIT 1;

  IF v_acct_ar IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: account 1100 (Accounts Receivable) not found';
  END IF;
  IF v_acct_rev IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: accounts 4001 and 5100 (Sales Revenue) not found';
  END IF;
  IF v_acct_tax IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: account 2200 (Sales Tax Collected) not found';
  END IF;
  IF apply_further_tax AND v_acct_ftax IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: account 2210 (Further Tax Payable) not found';
  END IF;

  -- ── 6. Generate unique journal entry number ───────────────────────────────
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

  -- ── 7. Insert journal lines (no silent swallowing) ────────────────────────
  -- Debit: Accounts Receivable (1100) — total receivable incl. taxes
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_acct_ar, v_total_payable, 0);

  -- Credit: Sales Revenue (4001/5100) — pre-tax taxable value
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_acct_rev, 0, v_taxable);

  -- Credit: Sales Tax Collected (2200)
  IF v_sales_tax > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_acct_tax, 0, v_sales_tax);
  END IF;

  -- Credit: Further Tax Payable (2210)
  IF v_further_tax > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_acct_ftax, 0, v_further_tax);
  END IF;

  -- ── 8. Audit log ──────────────────────────────────────────────────────────
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
    RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
  WHEN others THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO service_role;

-- ── 3. Fix create_payment_voucher ─────────────────────────────────────────────
-- Only create journal entry when at least one account side is given.
-- Remove ON CONFLICT DO NOTHING from journal_lines inserts.
-- Mark is_balanced correctly (true only when both sides provided).

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
  v_is_balanced   BOOLEAN;
BEGIN
  -- Determine prefix
  IF p_voucher_type = 'CASH_PAYMENT' THEN
    v_prefix := 'CPV';
  ELSIF p_voucher_type = 'PARTY_PAYMENT' THEN
    v_prefix := 'PPV';
  ELSE
    v_prefix := 'BPV';
  END IF;

  -- Generate voucher number: PREFIX-YYYY-NNNNN
  v_voucher_no := v_prefix || '-' || to_char(p_voucher_date, 'YYYY') || '-' ||
    lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');

  -- Get current user if authenticated
  v_created_by := auth.uid();

  -- Insert voucher
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

  -- Only create journal entry when at least one account side is provided.
  -- A header with zero lines is a ghost entry; skip it entirely.
  IF p_debit_account_id IS NOT NULL OR p_credit_account_id IS NOT NULL THEN
    v_is_balanced := (p_debit_account_id IS NOT NULL AND p_credit_account_id IS NOT NULL);

    v_entry_number := 'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' ||
      lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

    INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
    VALUES (
      v_entry_number,
      p_voucher_date,
      v_prefix || ' ' || v_voucher_no || ' — ' || p_payee_name,
      v_is_balanced,
      'POSTED'
    )
    RETURNING id INTO v_entry_id;

    -- Debit side (no silent swallowing — let any error propagate)
    IF p_debit_account_id IS NOT NULL THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
      VALUES (v_entry_id, p_debit_account_id, p_amount, 0);
    END IF;

    -- Credit side
    IF p_credit_account_id IS NOT NULL THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
      VALUES (v_entry_id, p_credit_account_id, 0, p_amount);
    END IF;
  END IF;

  -- Return the created voucher row as JSONB
  RETURN to_jsonb(v_row);
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
