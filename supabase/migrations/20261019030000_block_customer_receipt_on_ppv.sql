-- ============================================================================
-- Migration: 20261019030000_block_customer_receipt_on_ppv.sql
-- Description:
--   Adds a DB-level guard to create_payment_voucher: PARTY_PAYMENT vouchers
--   whose payee is a CRM CUSTOMER are now rejected at the database layer.
--   Customer receipts (money IN) belong to the Receipt Voucher path
--   (customer_receipt_vouchers table + createReceiptVoucherAction), which posts
--   the correct entry: Dr Cash/Bank . Cr AR (1100) + party_id.
--
--   The existing backfill (Cases A/B/C in migration 20261019020000) already
--   re-normalised historical rows. New rows are blocked here.
-- ============================================================================

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
  v_debit         UUID;
  v_credit        UUID;
  v_cash          UUID;
  v_party_id      UUID;
  v_party_type    TEXT;
  v_customer_name TEXT;
  v_narration     TEXT;
  v_is_liquid     BOOLEAN;
  v_defaulted     BOOLEAN := false;
BEGIN
  IF p_voucher_type = 'CASH_PAYMENT' THEN
    v_prefix := 'CPV';
  ELSIF p_voucher_type = 'PARTY_PAYMENT' THEN
    v_prefix := 'PPV';
  ELSIF p_voucher_type = 'SALARY_PAYMENT' THEN
    v_prefix := 'SPV';
  ELSE
    v_prefix := 'BPV';
  END IF;

  v_voucher_no := v_prefix || '-' || to_char(p_voucher_date, 'YYYY') || '-' ||
    lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');

  v_created_by := auth.uid();

  -- Party linkage
  SELECT id, party_type INTO v_party_id, v_party_type
  FROM parties
  WHERE lower(btrim(name)) = lower(btrim(COALESCE(p_payee_name, '')))
  ORDER BY created_at
  LIMIT 1;

  IF p_voucher_type = 'PARTY_PAYMENT' THEN

    -- DB-level guard: CUSTOMER receipts must use the Receipt Voucher path.
    -- The UI shows a redirect banner, but we enforce it here too so no API
    -- call or script can bypass it and corrupt the AR control account balance.
    IF v_party_type = 'CUSTOMER' THEN
      RAISE EXCEPTION
        'CUSTOMER_RECEIPT_BLOCKED: % is a Customer party. '
        'Record their payment as a Receipt Voucher (CRV/BRV) via the Customer Receipts screen. '
        'Payment Vouchers (PPV) are for SUPPLIER/VENDOR payments only. '
        'Voucher % not created.',
        COALESCE(p_payee_name, '(unknown)'), v_voucher_no;
    END IF;

    -- Cash/bank side: whichever parameter already carries a liquid account,
    -- else default Cash (1000).
    SELECT id INTO v_cash
    FROM accounts_chart
    WHERE id IN (p_debit_account_id, p_credit_account_id)
      AND COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
    LIMIT 1;
    IF v_cash IS NULL THEN
      SELECT id INTO v_cash FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
    END IF;
    IF v_cash IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing Cash (1000) -- cannot post party voucher %', v_voucher_no;
    END IF;

    -- Case B only (supplier): Dr AP (2001), Cr Cash/Bank
    SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
    IF v_debit IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing Accounts Payable (2001) -- cannot post voucher %', v_voucher_no;
    END IF;
    v_credit := v_cash;

  ELSE
    -- Case C: CPV / BPV / SPV -- expense/target debit, cash/bank credit
    v_debit  := p_debit_account_id;
    v_credit := p_credit_account_id;

    IF v_credit IS NULL THEN
      IF p_voucher_type IN ('BANK_PAYMENT', 'SALARY_PAYMENT') THEN
        SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1002' LIMIT 1;
      END IF;
      IF v_credit IS NULL THEN
        SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
      END IF;
      IF v_credit IS NULL THEN
        RAISE EXCEPTION 'Chart of accounts missing Cash (1000) / Bank (1002) -- cannot post voucher %', v_voucher_no;
      END IF;
      v_defaulted := true;
    END IF;

    IF v_debit IS NULL THEN
      IF p_voucher_type = 'SALARY_PAYMENT' THEN
        SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
      ELSE
        SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '9999' LIMIT 1;
      END IF;
      IF v_debit IS NULL THEN
        RAISE EXCEPTION 'Chart of accounts missing -- cannot resolve debit side for voucher type %', p_voucher_type;
      END IF;
      v_defaulted := true;
    END IF;

    -- Guard: debit must NOT be Cash/Bank
    SELECT COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
      INTO v_is_liquid
    FROM accounts_chart WHERE id = v_debit;
    IF COALESCE(v_is_liquid, false) THEN
      RAISE EXCEPTION 'Debit account cannot be Cash/Bank for voucher % -- pick the expense / target account instead', v_voucher_no;
    END IF;

    -- Guard: receivable control accounts (1100 AR, 1201 Trade Debts) must not
    -- appear on the debit side of a payment voucher.
    IF EXISTS (
      SELECT 1 FROM accounts_chart
       WHERE id = v_debit AND account_code IN ('1100', '1201')
    ) THEN
      RAISE EXCEPTION
        'AR_DEBIT_BLOCKED: Accounts Receivable (1100) / Trade Debts (1201) cannot be debited '
        'on a Payment Voucher (%). '
        'Record customer receipts in the Customer Receipts screen (CRV / BRV) instead.',
        v_voucher_no;
    END IF;

    -- Guard: credit MUST be Cash/Bank
    SELECT COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
      INTO v_is_liquid
    FROM accounts_chart WHERE id = v_credit;
    IF NOT COALESCE(v_is_liquid, false) THEN
      RAISE EXCEPTION 'Credit account must be Cash (1000) or Bank (1002) for voucher %', v_voucher_no;
    END IF;
  END IF;

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
    v_debit, v_credit,
    p_amount, COALESCE(p_amount_in_words, ''),
    p_remarks,
    v_created_by
  )
  RETURNING * INTO v_row;

  -- Atomic double entry
  v_narration := v_prefix || ' ' || v_voucher_no || ' -- ' || p_payee_name;
  IF v_defaulted AND v_debit = (SELECT id FROM accounts_chart WHERE account_code = '9999' LIMIT 1) THEN
    v_narration := v_narration || ' [UNCATEGORISED -- re-categorise suspense debit]';
  END IF;

  -- Stamp customer_name only when AP (2001) sits on either side
  IF EXISTS (
    SELECT 1 FROM accounts_chart
     WHERE id IN (v_debit, v_credit) AND account_code = '2001'
  ) THEN
    v_customer_name := p_payee_name;
  ELSE
    v_customer_name := NULL;
  END IF;

  v_entry_number := 'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, customer_name, is_balanced, status)
  VALUES (v_entry_number, p_voucher_date, v_narration, v_customer_name, true, 'POSTED')
  RETURNING id INTO v_entry_id;

  -- Party is attached only to the non-liquid side (Debit = AP / expense),
  -- never to the liquid Cash/Bank line (Credit).
  INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_debit, v_party_id, p_amount, 0),
         (v_entry_id, v_credit, NULL, 0, p_amount);

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

-- Verification (run manually after applying -- must return 0 rows):
--   SELECT pv.voucher_no, ac.account_code, ac.account_name
--   FROM payment_vouchers pv
--   JOIN accounts_chart ac ON ac.id = pv.debit_account_id
--   WHERE pv.voucher_type = 'PARTY_PAYMENT'
--     AND ac.account_code IN ('1100', '1201');
