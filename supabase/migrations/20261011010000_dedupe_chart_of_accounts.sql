-- ============================================================================
-- Migration: 20261011010000_dedupe_chart_of_accounts.sql
-- Steps 0–1 + Step 3 RPC scaffolding (capital injection).
--
-- LIVE QUERY RESULTS (queried 2026-09-23 via PostgREST before this migration):
--   Cash in Hand   1000  3e68554d-…  lines=32  Dr=7174609  Cr=739700   ← KEEP
--   Cash on Hand   1001  feda36ce-…  lines=9   Dr=255000   Cr=228100   ← retire
--   Owner Equity   3000  c7cc053e-…  lines=2   Dr=0        Cr=11350000 ← KEEP
--   Owner's Capital 3001 63ed96ac-…  lines=0                 ← DELETE (empty)
--   Retained Earn. 3002  a176914a-…  lines=1   Dr=0        Cr=50000    ← retire
--   Retained Earn. 3100  707636bb-…  lines=2   Dr=149919   Cr=5000     ← KEEP (2 > 1)
--   Worker Payroll 5002  e16bc129-…  lines=0                 ← rename (Step 1)
--   Utilities      5200  d5d25e30-…  lines=0                 ← DO NOT TOUCH (name taken)
--   Bank Account   1002  2e2a601b-…  lines=9   Dr=2200700   Cr=2700
--
-- Decisions confirmed by owner:
--   1. Cash canonical = 1000 (most history + PaymentVoucherForm hardcode)
--   2. Owner equity canonical = 3000 (has lines; 3001 empty)
--   3. Retained Earnings canonical = 3100 (2 lines > 1)
--   4. Salary account = existing empty 5002, renamed to Salary & Wages Expense
-- ============================================================================

-- ─── Diagnostic SELECT (results already captured above) ────────────────────
-- SELECT account_code, account_name, id FROM accounts_chart
--  WHERE account_name ILIKE '%cash in hand%'
--   OR account_name ILIKE '%cash on hand%'
--   OR account_name ILIKE '%equity%'
--   OR account_name ILIKE '%retained earnings%'
--   OR account_code IN ('1000','1001','1002','3000','3001','3002','3100','5002','5200');
--
-- SELECT account_id, COUNT(*) AS line_count
--   FROM journal_lines GROUP BY account_id ORDER BY line_count DESC;

-- ─── Step 0 helpers: default-cash + liquid-funds flags ─────────────────────
ALTER TABLE accounts_chart ADD COLUMN IF NOT EXISTS is_default_cash BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts_chart ADD COLUMN IF NOT EXISTS is_liquid_funds BOOLEAN NOT NULL DEFAULT false;

-- ─── Step 0.1: Cash — migrate 1001 → 1000, then delete 1001 ───────────────
DO $$
DECLARE
  v_keep   UUID;
  v_retire UUID;
  v_moved  INT;
BEGIN
  SELECT id INTO v_keep   FROM accounts_chart WHERE account_code = '1000';
  SELECT id INTO v_retire FROM accounts_chart WHERE account_code = '1001';

  IF v_keep IS NULL OR v_retire IS NULL OR v_keep = v_retire THEN
    RAISE NOTICE 'Cash dedupe skipped (missing or already merged). keep=% retire=%', v_keep, v_retire;
    RETURN;
  END IF;

  -- journal_lines first (FK has ON DELETE CASCADE — must repoint before delete)
  UPDATE journal_lines SET account_id = v_keep WHERE account_id = v_retire;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'Cash: moved % journal_lines from 1001 → 1000', v_moved;

  -- payment_vouchers FKs (no cascade — must repoint)
  UPDATE payment_vouchers SET credit_account_id = v_keep WHERE credit_account_id = v_retire;
  UPDATE payment_vouchers SET debit_account_id  = v_keep WHERE debit_account_id  = v_retire;

  -- any other accounts_chart FKs (best-effort columns)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'bank_accounts'
                AND column_name = 'bank_account_id') THEN
    EXECUTE 'UPDATE bank_accounts SET bank_account_id = $1 WHERE bank_account_id = $2'
      USING v_keep, v_retire;
  END IF;

  DELETE FROM accounts_chart WHERE id = v_retire;
  RAISE NOTICE 'Cash: deleted account 1001 (Cash on Hand)';
END $$;

UPDATE accounts_chart SET is_default_cash = true,  is_liquid_funds = true WHERE account_code = '1000';
UPDATE accounts_chart SET is_liquid_funds = true                           WHERE account_code = '1002';
-- clear accidental flags
UPDATE accounts_chart SET is_default_cash = false WHERE account_code <> '1000';

-- ─── Step 0.2: Owner equity — 3001 empty → delete; keep 3000 ───────────────
DO $$
DECLARE
  v_keep   UUID;
  v_retire UUID;
  v_cnt    INT;
BEGIN
  SELECT id INTO v_keep   FROM accounts_chart WHERE account_code = '3000';
  SELECT id INTO v_retire FROM accounts_chart WHERE account_code = '3001';
  IF v_keep IS NULL OR v_retire IS NULL OR v_keep = v_retire THEN
    RAISE NOTICE 'Equity dedupe skipped.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM journal_lines WHERE account_id = v_retire;
  IF v_cnt > 0 THEN
    UPDATE journal_lines SET account_id = v_keep WHERE account_id = v_retire;
    RAISE NOTICE 'Equity: moved % journal_lines from 3001 → 3000', v_cnt;
  END IF;

  UPDATE payment_vouchers SET credit_account_id = v_keep WHERE credit_account_id = v_retire;
  UPDATE payment_vouchers SET debit_account_id  = v_keep WHERE debit_account_id  = v_retire;

  DELETE FROM accounts_chart WHERE id = v_retire;
  RAISE NOTICE 'Equity: deleted account 3001 (Owner''s Capital)';
END $$;

-- ─── Step 0.3: Retained Earnings — keep 3100 (2 lines), retire 3002 ───────
DO $$
DECLARE
  v_keep   UUID;
  v_retire UUID;
  v_moved  INT;
BEGIN
  SELECT id INTO v_keep   FROM accounts_chart WHERE account_code = '3100';
  SELECT id INTO v_retire FROM accounts_chart WHERE account_code = '3002';
  IF v_keep IS NULL OR v_retire IS NULL OR v_keep = v_retire THEN
    RAISE NOTICE 'RE dedupe skipped.';
    RETURN;
  END IF;

  UPDATE journal_lines SET account_id = v_keep WHERE account_id = v_retire;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'RE: moved % journal_lines from 3002 → 3100', v_moved;

  UPDATE payment_vouchers SET credit_account_id = v_keep WHERE credit_account_id = v_retire;
  UPDATE payment_vouchers SET debit_account_id  = v_keep WHERE debit_account_id  = v_retire;

  DELETE FROM accounts_chart WHERE id = v_retire;
  RAISE NOTICE 'RE: deleted account 3002 (Retained Earnings)';
END $$;

-- ─── Step 1: Salary expense account (5200 is Utilities — use empty 5002) ──
-- 5002 "Worker Payroll Expense" has 0 journal_lines; rename to Salary & Wages.
UPDATE accounts_chart
   SET account_name = 'Salary & Wages Expense'
 WHERE account_code = '5002'
   AND account_type = 'EXPENSE';

-- Safety: if 5002 missing for some reason, create it.
INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '5002', 'Salary & Wages Expense', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '5002');

-- ─── Step 4: allow SALARY_PAYMENT on payment_vouchers ──────────────────────
ALTER TABLE payment_vouchers DROP CONSTRAINT IF EXISTS payment_vouchers_voucher_type_check;
ALTER TABLE payment_vouchers ADD CONSTRAINT payment_vouchers_voucher_type_check
  CHECK (voucher_type IN ('CASH_PAYMENT', 'PARTY_PAYMENT', 'BANK_PAYMENT', 'SALARY_PAYMENT'));

-- ─── Recreate create_payment_voucher with SALARY_PAYMENT (SPV) prefix ──────
-- Same signature as T2 (12 args) + journal_entry_seq entry numbering.
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
  ELSIF p_voucher_type = 'SALARY_PAYMENT' THEN
    v_prefix := 'SPV';
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
    VALUES (v_entry_id, p_debit_account_id, p_amount, 0);
  END IF;

  IF p_credit_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, p_credit_account_id, 0, p_amount);
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

-- ─── Step 3: record_capital_injection ──────────────────────────────────────
-- Dr Cash (1000) or Bank (1002), Cr Owner's Equity (3000).
-- Uses journal_entry_seq (T2). Creates a real POSTED balanced entry.
CREATE OR REPLACE FUNCTION public.record_capital_injection(
  p_amount         NUMERIC,
  p_target_account TEXT,   -- 'CASH' | 'BANK'
  p_narration      TEXT,
  p_operator_name   TEXT,
  p_device_node     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit_code   TEXT;
  v_debit_id     UUID;
  v_credit_id    UUID;
  v_entry_id     UUID;
  v_entry_number TEXT;
  v_amount       NUMERIC;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  v_amount := round(p_amount::numeric, 2);

  IF upper(COALESCE(p_target_account, '')) = 'BANK' THEN
    v_debit_code := '1002';
  ELSE
    v_debit_code := '1000';
  END IF;

  SELECT id INTO v_debit_id FROM accounts_chart WHERE account_code = v_debit_code;
  SELECT id INTO v_credit_id FROM accounts_chart WHERE account_code = '3000';

  IF v_debit_id IS NULL THEN
    RAISE EXCEPTION 'Liquid account % not found — run COA dedupe migration first', v_debit_code;
  END IF;
  IF v_credit_id IS NULL THEN
    RAISE EXCEPTION 'Owner''s Equity (3000) not found — run COA dedupe migration first';
  END IF;

  v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status)
  VALUES (
    v_entry_number,
    CURRENT_DATE,
    NULLIF(TRIM(COALESCE(p_narration, '')), '') ||
      CASE WHEN COALESCE(p_narration, '') = '' THEN
        'Capital injection — ' || v_debit_code
      ELSE '' END,
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  -- Fix narration when empty
  UPDATE journal_entries
     SET narration = 'Capital injection — ' || v_debit_code
   WHERE id = v_entry_id AND (narration IS NULL OR narration = '');

  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_debit_id, v_amount, 0),
         (v_entry_id, v_credit_id, 0, v_amount);

  BEGIN
    INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
    VALUES (
      COALESCE(p_device_node, 'SYSTEM_LOCAL'),
      COALESCE(p_operator_name, 'OWNER'),
      'RECORDED_CAPITAL_INJECTION',
      jsonb_build_object(
        'entry_number', v_entry_number,
        'amount', v_amount,
        'target', v_debit_code
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- audit is best-effort
  END;

  RETURN jsonb_build_object(
    'id', v_entry_id,
    'entry_number', v_entry_number,
    'amount', v_amount,
    'debit_account_code', v_debit_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_capital_injection(NUMERIC, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_capital_injection(NUMERIC, TEXT, TEXT, TEXT, TEXT)
  TO anon;
GRANT EXECUTE ON FUNCTION public.record_capital_injection(NUMERIC, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ─── Post-migration verification ───────────────────────────────────────────
-- SELECT account_code, account_name, is_default_cash, is_liquid_funds
--   FROM accounts_chart
--  WHERE account_code IN ('1000','1001','1002','3000','3001','3002','3100','5002')
--  ORDER BY account_code;
-- Expect: 1000 Cash in Hand (default+liquid), 1002 Bank (liquid),
--         3000 Owner Equity, 3100 Retained Earnings, 5002 Salary & Wages Expense
--         and NO 1001 / 3001 / 3002.
