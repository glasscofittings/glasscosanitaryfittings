-- ============================================================================
-- Migration: 20261010010000_enforce_journal_balance.sql
-- Task: T1 — Enforce double-entry balance at the database level.
--
-- 1. Adds a DEFERRABLE INITIALLY DEFERRED constraint trigger on journal_lines
--    that verifies SUM(debit_pkr) = SUM(credit_pkr) per journal_entry_id at
--    COMMIT time, and RAISE EXCEPTION (aborting the transaction) when not.
-- 2. Recreates the three posting RPCs with the hardcoded `is_balanced = true`
--    literal removed from their journal_entries INSERT — the trigger is now
--    the single source of truth for balance. The `journal_entries.is_balanced`
--    column is left in place (DEFAULT true) for backward compatibility with
--    existing client reads; nothing writes it from these RPCs anymore.
--
-- Superseded copies of the same functions (NOT modified here; latest wins
-- lexicographically, and these are all re-declared below):
--   - 100_fix_rpc_post_invoice.sql
--   - 20260930010000_grant_post_gst_paints_invoice_rpc.sql
--   - 20260930020000_create_payment_vouchers.sql
--   - 20261005010000_grn_and_purchase_invoices.sql
--   - supabase/schema-consolidated.sql (reference, not in migration chain)
--
-- computeTrialBalance in src/lib/supabase/ledger.ts is intentionally NOT
-- changed by this task.
-- ============================================================================

-- T2: shared sequential journal entry numbering (idempotent)
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Balance enforcement trigger function
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_enforce_journal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry_ids UUID[] := '{}';
  v_entry_id  UUID;
  v_entry_no  TEXT;
  v_debits    NUMERIC;
  v_credits   NUMERIC;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_entry_ids := v_entry_ids || NEW.journal_entry_id;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    v_entry_ids := v_entry_ids || OLD.journal_entry_id;
  END IF;

  FOREACH v_entry_id IN ARRAY v_entry_ids LOOP
    CONTINUE WHEN v_entry_id IS NULL;

    -- Parent entry gone (e.g. journal_entries row deleted, lines cascaded):
    -- nothing left to validate.
    SELECT je.entry_number INTO v_entry_no
    FROM journal_entries je
    WHERE je.id = v_entry_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(jl.debit_pkr), 0),
           COALESCE(SUM(jl.credit_pkr), 0)
      INTO v_debits, v_credits
      FROM journal_lines jl
     WHERE jl.journal_entry_id = v_entry_id;

    IF v_debits IS DISTINCT FROM v_credits THEN
      RAISE EXCEPTION
        'Double-entry balance check failed for journal entry %: debits % <> credits %',
        v_entry_no, v_debits, v_credits;
    END IF;
  END LOOP;

  -- AFTER trigger: return value is ignored.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journal_balance ON public.journal_lines;

CREATE CONSTRAINT TRIGGER trg_enforce_journal_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enforce_journal_balance();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: post_gst_paints_invoice  (recreated from
--    20261003010000_fix_post_gst_invoice_rpc.sql, is_balanced literal removed)
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

  INSERT INTO journal_entries (entry_number, entry_date, narration, status)
  VALUES (
    v_entry_number,
    CURRENT_DATE,
    'Sales invoice ' || v_invoice.invoice_number || ' posted',
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  -- ── 6. Resolve account IDs ────────────────────────────────────────────────
  SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100';
  SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '5100';
  SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200';
  SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210';

  -- ── 7. Insert journal lines ───────────────────────────────────────────────
  -- NOTE: if any required account row is missing, the deferred balance
  -- trigger aborts this transaction at COMMIT with a clear error instead of
  -- silently writing an unbalanced entry.
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

GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: approve_and_post_purchase_invoice  (recreated from
--    20261005020000_fix_approve_post_purchase_invoice_rpc.sql, is_balanced
--    literal removed; customer_name insert preserved — column exists on the
--    live database)
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
    -- 1. Lock invoice row
    SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF v_inv.id IS NULL THEN
        RAISE EXCEPTION 'Purchase invoice not found: %', p_invoice_id;
    END IF;

    IF v_inv.status != 'pending_approval' THEN
        RAISE EXCEPTION 'Invoice is not in pending_approval status (current: %)', v_inv.status;
    END IF;

    -- 2. Resolve chart-of-accounts IDs
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

    -- 3. Create journal entry (balance enforced by trg_enforce_journal_balance)
    -- T2: shared sequence, no random
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

    -- DEBIT: Raw Material / Inventory
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_raw_account_id, v_inv.vendor_id, v_inv.total_payable, 0.00);

    -- CREDIT: Accounts Payable (vendor as counter-party)
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_ap_account_id, v_inv.vendor_id, 0.00, v_inv.total_payable);

    -- 4. Update invoice status
    UPDATE purchase_invoices SET status = 'posted' WHERE id = v_inv.id;

    -- 5. Update GRN status
    IF v_inv.grn_id IS NOT NULL THEN
        UPDATE goods_receipt_notes SET status = 'invoiced' WHERE id = v_inv.grn_id;
    END IF;

    -- 6. Audit log (live system_audit_logs uses node_id, not device_node)
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
-- 4. RPC: create_payment_voucher  (recreated from
--    20261004010000_fix_create_payment_voucher_rpc.sql, is_balanced literal
--    removed)
-- BEHAVIOR CHANGE: if only one of p_debit_account_id / p_credit_account_id is
-- provided, the resulting single-sided entry is rejected by the deferred
-- balance trigger at COMMIT (previously it was silently marked balanced).
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

  -- Single shared sequence — format JE-YYYYMMDD-00000 (T2)
  v_entry_number := 'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  -- Create corresponding journal entry (balance enforced by trigger)
  INSERT INTO journal_entries (entry_number, entry_date, narration, status)
  VALUES (
    v_entry_number,
    p_voucher_date,
    v_prefix || ' ' || v_voucher_no || ' — ' || p_payee_name,
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  -- Add journal lines if accounts are specified
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

  -- Return the created voucher row as JSONB directly
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Manual acceptance tests (paste into Supabase SQL Editor one block at a
--    time; each test is intentionally NOT run as part of this migration)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- TEST 1 — unbalanced insert must fail at COMMIT:
--
--   BEGIN;
--   INSERT INTO journal_entries (entry_number, entry_date, narration, status)
--   VALUES ('JE-TEST-BAL-1', CURRENT_DATE, 'T1 self-test', 'POSTED');
--   INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
--   SELECT id, (SELECT id FROM accounts_chart ORDER BY account_code LIMIT 1), 100, 0
--   FROM journal_entries WHERE entry_number = 'JE-TEST-BAL-1';
--   COMMIT;
--   -- EXPECT: ERROR Double-entry balance check failed for journal entry
--   --         JE-TEST-BAL-1: debits 100 <> credits 0
--
-- TEST 2 — balanced pair must succeed:
--
--   BEGIN;
--   INSERT INTO journal_entries (entry_number, entry_date, narration, status)
--   VALUES ('JE-TEST-BAL-2', CURRENT_DATE, 'T1 self-test', 'POSTED');
--   INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
--   SELECT id, a.id, 100, 0
--   FROM journal_entries e
--   CROSS JOIN (SELECT id FROM accounts_chart ORDER BY account_code OFFSET 0 LIMIT 1) a
--   WHERE e.entry_number = 'JE-TEST-BAL-2';
--   INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
--   SELECT id, a.id, 0, 100
--   FROM journal_entries e
--   CROSS JOIN (SELECT id FROM accounts_chart ORDER BY account_code OFFSET 1 LIMIT 1) a
--   WHERE e.entry_number = 'JE-TEST-BAL-2';
--   COMMIT;
--   -- EXPECT: success; then:
--   --   DELETE FROM journal_entries WHERE entry_number IN ('JE-TEST-BAL-1','JE-TEST-BAL-2');
--
-- TEST 3 — app flows: post a sales invoice (invoicing) and approve a pending
--   purchase invoice (Pending Vendor Invoices → Approve) — both must succeed.
--
-- TEST 4 — deleting an account referenced by journal lines must fail loudly
--   (ON DELETE CASCADE unbalances parent entries → deferred trigger raises):
--
--   BEGIN;
--   DELETE FROM accounts_chart
--   WHERE id IN (SELECT account_id FROM journal_lines GROUP BY account_id
--                ORDER BY count(*) DESC LIMIT 1);
--   COMMIT;
--   -- EXPECT: ERROR Double-entry balance check failed ...
