-- ============================================================================
-- Migration: Payment Vouchers
-- Date: 2026-09-30
-- Description: Creates payment_vouchers table for Cash Payment Vouchers (CPV)
--              and Party Payment Vouchers (PPV), with RLS, voucher number
--              sequence, and the create_payment_voucher RPC function.
-- ============================================================================

-- 1. Sequence for voucher number generation
CREATE SEQUENCE IF NOT EXISTS payment_voucher_seq START 1 INCREMENT 1;

-- 2. Payment Vouchers table
CREATE TABLE IF NOT EXISTS payment_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_no TEXT UNIQUE NOT NULL,
    voucher_type TEXT NOT NULL CHECK (voucher_type IN ('CASH_PAYMENT', 'PARTY_PAYMENT', 'BANK_PAYMENT')),
    voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payee_name TEXT NOT NULL,
    payee_address TEXT,
    cnic_ntn TEXT,
    purpose TEXT,
    reference_no TEXT,
    debit_account_id UUID REFERENCES accounts_chart(id),
    credit_account_id UUID REFERENCES accounts_chart(id),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    amount_in_words TEXT NOT NULL,
    remarks TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_type ON payment_vouchers(voucher_type);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_date ON payment_vouchers(voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_payee ON payment_vouchers(payee_name);

-- 4. RLS
ALTER TABLE payment_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable full access for authenticated users on payment_vouchers" ON payment_vouchers;
CREATE POLICY "Enable full access for authenticated users on payment_vouchers"
ON payment_vouchers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. RPC: create_payment_voucher
--    Generates voucher_no (CPV-YYYY-NNNNN or PPV-YYYY-NNNNN), inserts row,
--    and returns the created record as JSONB.
DROP FUNCTION IF EXISTS public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_payment_voucher(
  p_voucher_type    TEXT,
  p_voucher_date    DATE,
  p_payee_name      TEXT,
  p_amount          NUMERIC,
  p_payee_address   TEXT DEFAULT NULL,
  p_cnic_ntn        TEXT DEFAULT NULL,
  p_purpose         TEXT DEFAULT NULL,
  p_reference_no    TEXT DEFAULT NULL,
  p_debit_account_id UUID DEFAULT NULL,
  p_credit_account_id UUID DEFAULT NULL,
  p_remarks         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix    TEXT;
  v_voucher_no TEXT;
  v_row       payment_vouchers%ROWTYPE;
  v_created_by UUID;
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

  -- Get current user
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
    p_amount, '',  -- amount_in_words is set by the client
    p_remarks,
    v_created_by
  )
  RETURNING * INTO v_row;

  -- Create corresponding journal entry
  INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
  VALUES (
    'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' || v_prefix || '-' || lpad(nextval('payment_voucher_seq')::TEXT, 5, '0'),
    p_voucher_date,
    v_prefix || ' ' || v_voucher_no || ' — ' || p_payee_name,
    true,
    'POSTED'
  );

  -- Return the created voucher
  SELECT to_jsonb(pv.*) INTO v_row
  FROM payment_vouchers pv
  WHERE pv.id = v_row.id;

  RETURN to_jsonb(v_row);
END;
$$;

-- 6. Grant EXECUTE
GRANT EXECUTE ON FUNCTION public.create_payment_voucher(
  TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_payment_voucher(
  TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT
) TO service_role;
