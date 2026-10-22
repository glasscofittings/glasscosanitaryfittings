-- ============================================================================
-- Migration: Dispatch approval workflow (status machine + gated effects)
-- Date: 2026-11-07
--
-- Adds to the Dispatch History flow:
--   1. dispatch_records.status — 'pending_approval' → 'approved' → 'dispatched'
--      plus dispatch parameters (dispatch_date, transport_details, operator_notes)
--   2. sales_invoices.stock_deducted — per-invoice flag recording whether the
--      units were ever taken out of stock, so edit/delete/approve can tell a
--      pre-approval invoice (no stock moved) from a legacy one (stock moved at
--      creation). Legacy rows are backfilled to true; legacy dispatch records
--      are backfilled to 'dispatched' because their effects already ran.
--   3. approve_dispatch RPC — the ONLY place where approving a dispatch flips
--      the status AND deducts stock AND posts the customer's ledger debit, in
--      one transaction. Each effect is guarded so the RPC is safe to retry:
--        • stock runs only when sales_invoices.stock_deducted is false
--        • the journal runs only when the invoice is not yet posted
-- ============================================================================

-- ── 1. dispatch_records: status + dispatch parameters ────────────────────────
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS dispatch_date DATE;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS transport_details TEXT;
ALTER TABLE dispatch_records ADD COLUMN IF NOT EXISTS operator_notes TEXT;

-- Rows that exist before this migration were created after stock and ledger
-- effects had already run (old create/print flow) → they are completed.
UPDATE dispatch_records SET status = 'dispatched' WHERE status IS NULL;

-- New dispatches are auto-approved on creation; backfill any pre-migration
-- pending_approval records so they are not left in a pending state.
UPDATE dispatch_records SET status = 'approved' WHERE status = 'pending_approval';

ALTER TABLE dispatch_records ALTER COLUMN status SET DEFAULT 'approved';
ALTER TABLE dispatch_records ALTER COLUMN status SET NOT NULL;
ALTER TABLE dispatch_records ALTER COLUMN dispatch_date SET DEFAULT CURRENT_DATE;
UPDATE dispatch_records SET dispatch_date = CURRENT_DATE WHERE dispatch_date IS NULL;
ALTER TABLE dispatch_records ALTER COLUMN dispatch_date SET NOT NULL;
ALTER TABLE dispatch_records ALTER COLUMN transport_details SET DEFAULT '';
UPDATE dispatch_records SET transport_details = '' WHERE transport_details IS NULL;
ALTER TABLE dispatch_records ALTER COLUMN transport_details SET NOT NULL;
ALTER TABLE dispatch_records ALTER COLUMN operator_notes SET DEFAULT '';
UPDATE dispatch_records SET operator_notes = '' WHERE operator_notes IS NULL;
ALTER TABLE dispatch_records ALTER COLUMN operator_notes SET NOT NULL;

ALTER TABLE dispatch_records DROP CONSTRAINT IF EXISTS dispatch_records_status_check;
ALTER TABLE dispatch_records ADD CONSTRAINT dispatch_records_status_check
  CHECK (status IN ('pending_approval', 'approved', 'dispatched'));

CREATE INDEX IF NOT EXISTS idx_dispatch_records_status ON dispatch_records(status);

-- ── 2. sales_invoices.stock_deducted ─────────────────────────────────────────
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN;
-- Every pre-migration invoice went through the old create path, which deducted
-- stock immediately — mark them so delete/edit keep reversing correctly.
UPDATE sales_invoices SET stock_deducted = true WHERE stock_deducted IS NULL;
ALTER TABLE sales_invoices ALTER COLUMN stock_deducted SET DEFAULT false;
ALTER TABLE sales_invoices ALTER COLUMN stock_deducted SET NOT NULL;

-- ── 3. approve_dispatch(p_dispatch_id, operator, device) ─────────────────────
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

CREATE OR REPLACE FUNCTION public.approve_dispatch(
  p_dispatch_id   UUID,
  p_operator_name TEXT DEFAULT '',
  p_device_node   TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatch        dispatch_records%ROWTYPE;
  v_invoice         sales_invoices%ROWTYPE;
  v_line            JSONB;
  v_product_id      UUID;
  v_product_name    TEXT;
  v_qty             NUMERIC;
  v_taxable         NUMERIC;
  v_sales_tax       NUMERIC;
  v_further_tax     NUMERIC;
  v_total           NUMERIC;
  v_entry_id        UUID;
  v_entry_number    TEXT;
  v_acct_ar         UUID;  -- 1100  Accounts Receivable
  v_acct_rev        UUID;  -- 4001  Sales Revenue (canonical), 5100 legacy
  v_acct_tax        UUID;  -- 2200  Sales Tax Collected
  v_acct_ftax       UUID;  -- 2210  Further Tax Payable
  v_has_party_col   BOOLEAN;
  v_stock_deducted  BOOLEAN;
  v_posted          BOOLEAN;
BEGIN
  -- ── 1. Lock dispatch + validate transition ─────────────────────────────────
  SELECT * INTO v_dispatch
  FROM dispatch_records
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch record not found: %', p_dispatch_id;
  END IF;

  -- Idempotent: a second click on an already-approved dispatch succeeds.
  IF v_dispatch.status IN ('approved', 'dispatched') THEN
    RETURN jsonb_build_object(
      'status',          v_dispatch.status,
      'already_approved', true,
      'invoice_number',  v_dispatch.invoice_number
    );
  END IF;

  SELECT * INTO v_invoice
  FROM sales_invoices
  WHERE id = v_dispatch.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales invoice % not found for dispatch %',
      v_dispatch.invoice_id, p_dispatch_id;
  END IF;

  v_stock_deducted := COALESCE(v_invoice.stock_deducted, false);
  v_posted         := COALESCE(v_invoice.is_posted, false);

  -- ── 2. Stock deduction — ONLY when stock has never been settled ────────────
  IF NOT v_stock_deducted THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(v_dispatch.line_items, '[]'::jsonb))
    LOOP
      v_product_name := COALESCE(v_line->>'product_name', '');

      -- product_id may be a non-UUID legacy id (e.g. 'fg1') — guard the cast,
      -- then fall back to resolving the product by name.
      IF COALESCE(v_line->>'product_id', '')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN
        v_product_id := (v_line->>'product_id')::UUID;
      ELSE
        v_product_id := NULL;
      END IF;

      IF v_product_id IS NULL AND v_product_name <> '' THEN
        SELECT id INTO v_product_id
        FROM sanitary_products
        WHERE name = v_product_name
        LIMIT 1;
      END IF;

      v_qty := COALESCE((v_line->>'quantity')::NUMERIC, 0);

      IF v_product_id IS NOT NULL AND v_qty > 0 THEN
        UPDATE sanitary_products
        SET available_stock = available_stock - v_qty
        WHERE id = v_product_id
          AND available_stock >= v_qty;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Insufficient stock for % (required %, available %)',
            COALESCE(NULLIF(v_product_name, ''), v_product_id::TEXT),
            v_qty,
            (SELECT available_stock FROM sanitary_products WHERE id = v_product_id);
        END IF;
      END IF;
    END LOOP;

    UPDATE sales_invoices SET stock_deducted = true WHERE id = v_invoice.id;
    v_stock_deducted := true;
  END IF;

  -- ── 3. Customer ledger debit — ONLY when the invoice is not yet posted ─────
  IF NOT v_posted THEN
    v_taxable     := COALESCE(v_dispatch.taxable_value_pkr, 0);
    v_sales_tax   := COALESCE(v_dispatch.sales_tax_amount_pkr, 0);
    v_further_tax := COALESCE(v_dispatch.further_tax_amount_pkr, 0);
    -- Computed, not taken from the stored total, so the entry is always balanced.
    v_total       := v_taxable + v_sales_tax + v_further_tax;

    -- Resolve accounts (canonical 4001 with legacy 5100 fallback)
    SELECT id INTO v_acct_ar  FROM accounts_chart WHERE account_code = '1100' LIMIT 1;
    SELECT id INTO v_acct_rev FROM accounts_chart WHERE account_code = '4001' LIMIT 1;
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
    IF v_sales_tax > 0 AND v_acct_tax IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing: account 2200 (Sales Tax Collected) not found';
    END IF;
    IF v_further_tax > 0 AND v_acct_ftax IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing: account 2210 (Further Tax Payable) not found';
    END IF;

    v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
      lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

    -- Same narration shape as post_gst_paints_invoice so every existing
    -- *invoice_number* probe (delete, retry, duplicate checks) keeps matching.
    INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
    VALUES (
      v_entry_number,
      CURRENT_DATE,
      'Sales invoice ' || v_invoice.invoice_number || ' posted',
      true,
      'POSTED'
    )
    RETURNING id INTO v_entry_id;

    -- party_id (customer statement attribution) only when the column exists —
    -- environments differ, mirroring the guard in post_gst_paints_invoice.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'journal_lines'
        AND column_name = 'party_id'
    ) INTO v_has_party_col;

    IF v_has_party_col THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr, party_id) VALUES
        (v_entry_id, v_acct_ar,  v_total,    0,         v_invoice.customer_id),
        (v_entry_id, v_acct_rev, 0,          v_taxable, v_invoice.customer_id);
      IF v_sales_tax > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr, party_id)
        VALUES (v_entry_id, v_acct_tax, 0, v_sales_tax, v_invoice.customer_id);
      END IF;
      IF v_further_tax > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr, party_id)
        VALUES (v_entry_id, v_acct_ftax, 0, v_further_tax, v_invoice.customer_id);
      END IF;
    ELSE
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr) VALUES
        (v_entry_id, v_acct_ar,  v_total, 0),
        (v_entry_id, v_acct_rev, 0,       v_taxable);
      IF v_sales_tax > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
        VALUES (v_entry_id, v_acct_tax, 0, v_sales_tax);
      END IF;
      IF v_further_tax > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
        VALUES (v_entry_id, v_acct_ftax, 0, v_further_tax);
      END IF;
    END IF;

    UPDATE sales_invoices
    SET is_posted               = true,
        taxable_value_pkr       = v_taxable,
        sales_tax_rate          = COALESCE(v_dispatch.sales_tax_rate, sales_tax_rate),
        sales_tax_amount_pkr    = v_sales_tax,
        further_tax_rate        = COALESCE(v_dispatch.further_tax_rate, further_tax_rate),
        further_tax_amount_pkr  = v_further_tax,
        total_invoice_value_pkr = v_total
    WHERE id = v_invoice.id;

    v_posted := true;
  END IF;

  -- ── 4. Flip the dispatch status ────────────────────────────────────────────
  UPDATE dispatch_records
  SET status = 'approved'
  WHERE id = v_dispatch.id;

  -- ── 5. Audit ───────────────────────────────────────────────────────────────
  INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
  VALUES (
    p_device_node,
    p_operator_name,
    'APPROVED_DISPATCH',
    jsonb_build_object(
      'dispatch_id',    p_dispatch_id,
      'invoice_id',     v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'stock_deducted', v_stock_deducted,
      'entry_number',   CASE WHEN v_posted THEN v_entry_number ELSE NULL END
    )
  );

  -- ── 6. Result ──────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'status',          'approved',
    'already_approved', false,
    'invoice_number',  v_invoice.invoice_number,
    'total_payable',   (SELECT total_invoice_value_pkr FROM sales_invoices WHERE id = v_invoice.id),
    'stock_deducted',  v_stock_deducted
  );

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
  WHEN others THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_dispatch(UUID, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_dispatch(UUID, TEXT, TEXT)
  TO service_role;
