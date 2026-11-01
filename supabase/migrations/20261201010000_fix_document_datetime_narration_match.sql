-- ============================================================================
-- Migration: fix_document_datetime_narration_match
-- Fixes the narration lookup in set_document_datetime so it correctly finds
-- journal entries whose narration starts with 'Sales invoice <number> posted'
-- (the app appends ' — <customer name>' after "posted", so an exact match was
-- never finding the entry and invoice date changes were not propagating to the
-- ledger).
--
-- Also fixes postInvoiceWithLedger: the entry_date now uses the invoice's own
-- created_at date instead of CURRENT_DATE.
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_document_datetime(
  p_doc_type text,
  p_id uuid,
  p_at timestamptz,
  p_reason text,
  p_operator text DEFAULT 'System Operator'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_type     text;
  v_local_date   date;
  v_old_at       timestamptz;
  v_valid_until  date;
  v_invoice_no   text;
  v_ledger_moved boolean := false;
BEGIN
  -- ── Validate doc type ───────────────────────────────────────────────────
  IF p_doc_type IS NULL
     OR upper(btrim(p_doc_type)) NOT IN ('INVOICE', 'JOURNAL', 'QUOTATION') THEN
    RAISE EXCEPTION 'Invalid doc type: %. Must be INVOICE, JOURNAL or QUOTATION.',
      COALESCE(p_doc_type, '(null)');
  END IF;
  v_doc_type := upper(btrim(p_doc_type));

  -- ── Validate reason ─────────────────────────────────────────────────────
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required to change a document date/time.';
  END IF;

  -- ── Validate not unreasonably in the future ─────────────────────────────
  IF p_at IS NULL OR p_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'The new date/time cannot be in the future.';
  END IF;

  -- Local (Asia/Karachi, fixed UTC+05:00) calendar date for DATE columns.
  v_local_date := (p_at AT TIME ZONE 'Asia/Karachi')::date;

  -- ── INVOICE ─────────────────────────────────────────────────────────────
  IF v_doc_type = 'INVOICE' THEN
    SELECT si.created_at, si.invoice_number
      INTO v_old_at, v_invoice_no
      FROM sales_invoices si
     WHERE si.id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice % not found.', p_id;
    END IF;

    UPDATE sales_invoices
       SET created_at = p_at
     WHERE id = p_id;

    -- Move the ledger posting that was created when this invoice was posted.
    -- Use LIKE with a prefix match because the app appends ' — <customer name>'
    -- after "posted" in the narration, so an exact match never finds the entry.
    -- The prefix 'Sales invoice <number> posted' is unique per invoice.
    UPDATE journal_entries
       SET entry_date = v_local_date,
           created_at = p_at
     WHERE narration LIKE 'Sales invoice ' || v_invoice_no || ' posted%';

    v_ledger_moved := FOUND;

  -- ── JOURNAL ─────────────────────────────────────────────────────────────
  ELSIF v_doc_type = 'JOURNAL' THEN
    SELECT je.created_at
      INTO v_old_at
      FROM journal_entries je
     WHERE je.id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Journal entry % not found.', p_id;
    END IF;

    UPDATE journal_entries
       SET entry_date = v_local_date,
           created_at = p_at
     WHERE id = p_id;

  -- ── QUOTATION ───────────────────────────────────────────────────────────
  ELSIF v_doc_type = 'QUOTATION' THEN
    SELECT q.created_at, q.valid_until
      INTO v_old_at, v_valid_until
      FROM quotations q
     WHERE q.id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quotation % not found.', p_id;
    END IF;

    IF v_valid_until IS NOT NULL AND v_valid_until < v_local_date THEN
      RAISE EXCEPTION 'Valid-until date cannot be before the quotation date.';
    END IF;

    -- NOTE: trg_quotation_lock_decided still fires here and will reject the
    -- change for decided/converted quotations (commercial terms are locked).
    UPDATE quotations
       SET quotation_date = v_local_date,
           created_at = p_at
     WHERE id = p_id;

  END IF;

  -- ── Audit log ───────────────────────────────────────────────────────────
  INSERT INTO system_audit_logs (operator_name, node_id, action_type, details)
  VALUES (
    COALESCE(NULLIF(btrim(p_operator), ''), 'System Operator'),
    'PC-01',
    'DOCUMENT_DATETIME_EDITED',
    jsonb_build_object(
      'doc_type',      v_doc_type,
      'id',            p_id,
      'old_at',        v_old_at,
      'new_at',        p_at,
      'reason',        btrim(p_reason),
      'ledger_moved',  v_ledger_moved
    )
  );

  RETURN jsonb_build_object('ok', true, 'ledger_moved', v_ledger_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_datetime(text, uuid, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_document_datetime(text, uuid, timestamptz, text, text)
  TO anon, authenticated, service_role;

