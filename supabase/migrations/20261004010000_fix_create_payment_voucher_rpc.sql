-- ============================================================================
-- Migration: Fix create_payment_voucher RPC
-- Date: 2026-10-04
-- Fixes:
--   1. Fix PL/pgSQL variable type mismatch:
--      v_row was declared as payment_vouchers%ROWTYPE, but line:
--        SELECT to_jsonb(pv.*) INTO v_row FROM payment_vouchers pv WHERE pv.id = v_row.id;
--      attempted to store JSONB into a ROWTYPE record variable whose primary key
--      is UUID, causing PostgreSQL error: 22P02 "invalid input syntax for type uuid: {json}".
--   2. Safe journal entry number sequence generation.
--   3. Insert debits/credits to journal_lines if debit_account_id / credit_account_id are provided.
-- ============================================================================

-- Ensure Urdu columns exist on live database
ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS payee_name_ur TEXT,
  ADD COLUMN IF NOT EXISTS purpose_ur TEXT;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- T2: shared sequential journal entry numbering (idempotent)
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

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

  -- Create corresponding journal entry
  INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
  VALUES (
    v_entry_number,
    p_voucher_date,
    v_prefix || ' ' || v_voucher_no || ' — ' || p_payee_name,
    true,
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
