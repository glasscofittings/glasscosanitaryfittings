-- ============================================================================
-- Migration: Sales tax defaults to 0 — stop forcing 18% on post
-- Date: 2026-10-14
-- Fixes:
--   1. post_gst_paints_invoice hardcoded v_sales_tax := round(v_taxable * 0.18)
--      and overwrote sales_tax_amount_pkr / total_invoice_value_pkr on POST,
--      silently re-applying 18% even when the form state had 0%.
--      → The RPC now uses the tax values already stored on the invoice row
--        (the exact form state saved by createInvoice). It no longer computes
--        or forces any rate, making posting idempotent.
--   2. sales_invoices.sales_tax_rate column DEFAULT 18 → 0 so any insert that
--      omits the rate no longer inherits an 18% default.
--   3. apply_further_tax no longer forces 4%; the stored further_tax_rate is
--      respected. When apply_further_tax is TRUE and the stored rate is 0 we
--      keep 0 (the form is the source of truth).
-- ============================================================================

-- ── 1. Column default: 18 → 0 (future inserts that omit the rate) ──────────
ALTER TABLE public.sales_invoices
  ALTER COLUMN sales_tax_rate SET DEFAULT 0;

-- Backfill only the rows that still carry the legacy forced 18% with a
-- matching 18% amount. Rows where the user genuinely chose 18% keep it only
-- if the amount math actually matches 18%; we do NOT touch rows whose rate is
-- already 0 or any other explicit value.
-- (Intentionally no UPDATE here: existing posted history is left intact.
--  Only the DEFAULT going forward changes.)

-- ── 2. Recreate the RPC to honour stored form state (no forced 18%) ────────
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
  v_taxable           NUMERIC;
  v_sales_tax_rate    NUMERIC;
  v_sales_tax         NUMERIC;
  v_further_tax_rate  NUMERIC;
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
  -- ── 1. Lock and validate invoice ─────────────────────────────────────────
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

  -- ── 2. Use the tax state already stored on the invoice (the form state).
  --       Never recompute or force 18% / 4%. Defaults are 0. ────────────────
  v_taxable          := COALESCE(v_invoice.taxable_value_pkr, taxable_value_pkr, 0);
  v_sales_tax_rate   := COALESCE(v_invoice.sales_tax_rate, 0);
  v_further_tax_rate := COALESCE(v_invoice.further_tax_rate, 0);

  -- Respect an explicit amount if one was stored; otherwise derive it from the
  -- stored rate. Both paths are pure and idempotent: tax = taxable * rate / 100.
  v_sales_tax := COALESCE(
    v_invoice.sales_tax_amount_pkr,
    round(v_taxable * v_sales_tax_rate / 100, 2),
    0
  );

  IF apply_further_tax THEN
    v_further_tax := COALESCE(
      v_invoice.further_tax_amount_pkr,
      round(v_taxable * v_further_tax_rate / 100, 2),
      0
    );
  ELSE
    v_further_tax := 0;
    v_further_tax_rate := 0;
  END IF;

  v_total_payable := v_taxable + v_sales_tax + v_further_tax;

  -- ── 3. Insert line items & deduct stock ─────────────────────────────────
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

  -- ── 4. Mark posted — persist the SAME tax state (idempotent, no forcing) ─
  UPDATE sales_invoices si
  SET is_posted               = true,
      taxable_value_pkr       = v_taxable,
      sales_tax_rate          = v_sales_tax_rate,
      sales_tax_amount_pkr    = v_sales_tax,
      further_tax_rate        = v_further_tax_rate,
      further_tax_amount_pkr  = v_further_tax,
      total_invoice_value_pkr = v_total_payable
  WHERE si.id = invoice_id;

  -- ── 5. Journal entry number ─────────────────────────────────────────────
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

  -- ── 6. Resolve account IDs ──────────────────────────────────────────────
  SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100';
  SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '5100';
  SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200';
  SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210';

  -- ── 7. Journal lines (tax lines only when > 0) ──────────────────────────
  -- Stamp party_id (the customer) on every line so the ledger can attribute
  -- this invoice under the person's name (AR / control-account matching).
  IF v_account_id_1100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_1100, v_invoice.customer_id, v_total_payable, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_account_id_5100 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_5100, v_invoice.customer_id, 0, v_taxable)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_sales_tax > 0 AND v_account_id_2200 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2200, v_invoice.customer_id, 0, v_sales_tax)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_further_tax > 0 AND v_account_id_2210 IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_account_id_2210, v_invoice.customer_id, 0, v_further_tax)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── 8. Audit log ────────────────────────────────────────────────────────
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

  -- ── 9. Return result ────────────────────────────────────────────────────
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

-- ── One-time repair: backfill party_id on existing sales-invoice journal lines ──
-- Invoices posted through the RPC before this fix wrote journal_lines with a
-- NULL party_id, so they never appeared under the person's ledger. Link each
-- such line to the invoice's customer via the narration ("Sales invoice <num>").
-- Only touches lines that still have no party_id, so it is safe to re-run.
UPDATE journal_lines jl
SET party_id = si.customer_id
FROM journal_entries je
JOIN sales_invoices si
  ON je.narration LIKE 'Sales invoice ' || si.invoice_number || ' %'
WHERE jl.journal_entry_id = je.id
  AND jl.party_id IS NULL
  AND si.customer_id IS NOT NULL;
