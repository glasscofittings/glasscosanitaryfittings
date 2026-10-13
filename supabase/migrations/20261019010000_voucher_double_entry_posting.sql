-- ============================================================================
-- Migration: 20261019010000_voucher_double_entry_posting.sql
-- Description:
--   Payment vouchers (CPV / PPV / BPV / SPV) were posting incomplete journal
--   entries. Live data: 10 of 12 voucher journal entries have only ONE
--   journal_lines row, several with Cash/Bank sitting on the WRONG side
--   (a payment booked as a cash inflow), and no journal line carries a
--   party_id — so Cash/Bank ledgers and party statements miss or misstate
--   every voucher.
--
--   1. Ensure suspense account 9999 exists — used for backfill where the
--      missing side cannot be inferred (expense never selected).
--
--   2. Replace create_payment_voucher so it ALWAYS posts a balanced pair:
--        Customer Receipt (receipt action, money in)
--          Dr Cash/Bank (1000/1002)  Cr AR (1100)
--        Party Payment (money out to a party)
--          Dr party control account  Cr Cash/Bank
--            CUSTOMER payee → Dr AR (1100), otherwise → Dr AP (2001)
--        Salary Payment
--          Dr Salary Expense (5002)  Cr Cash/Bank
--        Cash / Bank Payment (expense)
--          Dr expense/target account  Cr Cash/Bank
--      - missing credit → Cash (1000) / Bank (1002) by voucher type
--      - missing debit   → party control (PPV) / 5002 (SPV) / suspense 9999
--      - RAISE if the debit side is Cash/Bank (the main data-entry bug)
--      - RAISE if the credit side is not an asset account
--      - stamp journal_lines.party_id and (for control-side debits)
--        journal_entries.customer_name so party statements match
--      - SALARY_PAYMENT now gets its SPV prefix (was falling through to BPV)
--
--   3. Idempotent backfill over every existing payment voucher:
--        a. flip a wrong-side liquid debit into the credit side
--        b. fill the missing side per the rules above
--        c. persist the repaired sides onto the voucher row
--        d. create the journal entry if absent, otherwise rebuild its
--           journal_lines as the balanced pair and set is_balanced = true
--
--   4. Diagnostic queries at the end (orphans from historical voucher
--       deletes) — intentionally NOT auto-deleted; review first.
-- ============================================================================

-- ── 1. Suspense account for un-inferable backfill sides ──────────────────────
INSERT INTO public.accounts_chart (account_code, account_name, account_type, is_default_cash, is_liquid_funds)
VALUES ('9999', 'Suspense / Uncategorised Payments', 'ASSET', false, false)
ON CONFLICT (account_code) DO NOTHING;

-- ── 2. Replace create_payment_voucher ────────────────────────────────────────
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
  v_debit         UUID := p_debit_account_id;
  v_credit        UUID := p_credit_account_id;
  v_party_id      UUID;
  v_party_type    TEXT;
  v_customer_name TEXT;
  v_narration     TEXT;
  v_is_liquid     BOOLEAN;
  v_is_asset      BOOLEAN;
  v_defaulted     BOOLEAN := false;
BEGIN
  -- Prefix (SALARY_PAYMENT previously fell through to BPV)
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

  -- Party linkage by payee name (statement matching + control-side default)
  SELECT id, party_type INTO v_party_id, v_party_type
  FROM parties
  WHERE lower(btrim(name)) = lower(btrim(COALESCE(p_payee_name, '')))
  ORDER BY created_at
  LIMIT 1;

  -- ── Resolve credit side (always Cash/Bank for a payment) ───────────────────
  IF v_credit IS NULL THEN
    IF p_voucher_type IN ('BANK_PAYMENT', 'SALARY_PAYMENT') THEN
      SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1002' LIMIT 1;
    END IF;
    IF v_credit IS NULL THEN
      SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
    END IF;
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing Cash (1000) / Bank (1002) — cannot post voucher %', v_voucher_no;
    END IF;
    v_defaulted := true;
  END IF;

  -- ── Resolve debit side per posting rules ───────────────────────────────────
  IF v_debit IS NULL THEN
    IF p_voucher_type = 'PARTY_PAYMENT' THEN
      IF v_party_type = 'CUSTOMER' THEN
        SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '1100' LIMIT 1;
      ELSE
        SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
      END IF;
    ELSIF p_voucher_type = 'SALARY_PAYMENT' THEN
      SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
    ELSE
      SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '9999' LIMIT 1;
    END IF;
    IF v_debit IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing — cannot resolve debit side for voucher type %', p_voucher_type;
    END IF;
    v_defaulted := true;
  END IF;

  -- Debit side must never be Cash/Bank (booking a payment as an inflow)
  SELECT COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
    INTO v_is_liquid
  FROM accounts_chart WHERE id = v_debit;
  IF COALESCE(v_is_liquid, false) THEN
    RAISE EXCEPTION 'Debit account cannot be Cash/Bank for voucher % — pick the expense / AP / asset account instead', v_voucher_no;
  END IF;

  -- Credit side must be an asset account (Cash/Bank), never AP or an expense
  SELECT (account_type = 'ASSET') INTO v_is_asset
  FROM accounts_chart WHERE id = v_credit;
  IF NOT COALESCE(v_is_asset, false) THEN
    RAISE EXCEPTION 'Credit account must be Cash (1000) or Bank (1002) for voucher %', v_voucher_no;
  END IF;

  -- ── Insert voucher with the resolved sides ─────────────────────────────────
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

  -- ── Post the balanced double entry ─────────────────────────────────────────
  v_narration := v_prefix || ' ' || v_voucher_no || ' — ' || p_payee_name;
  IF v_defaulted AND v_debit = (SELECT id FROM accounts_chart WHERE account_code = '9999' LIMIT 1) THEN
    v_narration := v_narration || ' [UNCATEGORISED — re-categorise suspense debit]';
  END IF;

  -- customer_name only when the entry sits on a party control account, so the
  -- party-statement fallback can never double-count non-control entries.
  IF EXISTS (SELECT 1 FROM accounts_chart WHERE id = v_debit AND account_code IN ('1100', '2001')) THEN
    v_customer_name := p_payee_name;
  ELSE
    v_customer_name := NULL;
  END IF;

  v_entry_number := 'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, customer_name, is_balanced, status)
  VALUES (v_entry_number, p_voucher_date, v_narration, v_customer_name, true, 'POSTED')
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_debit, v_party_id, p_amount, 0);

  INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_credit, v_party_id, 0, p_amount);

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

-- ── 3. Backfill existing vouchers (idempotent) ───────────────────────────────
DO $$
DECLARE
  r                RECORD;
  v_je             UUID;
  v_debit          UUID;
  v_credit         UUID;
  v_party_id       UUID;
  v_party_type     TEXT;
  v_entry_number   TEXT;
  v_narration      TEXT;
  v_is_liquid      BOOLEAN;
  v_suspense       UUID;
  v_fixed          INT := 0;
  v_skipped        INT := 0;
BEGIN
  SELECT id INTO v_suspense FROM accounts_chart WHERE account_code = '9999' LIMIT 1;

  FOR r IN SELECT * FROM payment_vouchers ORDER BY voucher_date, voucher_no LOOP
    v_debit  := r.debit_account_id;
    v_credit := r.credit_account_id;

    -- Party linkage by payee name
    SELECT id, party_type INTO v_party_id, v_party_type
    FROM parties
    WHERE lower(btrim(name)) = lower(btrim(r.payee_name))
    ORDER BY created_at
    LIMIT 1;

    -- (a) Cash/Bank wrongly booked on the DEBIT side of a payment voucher:
    --     move it into the empty credit side.
    IF v_debit IS NOT NULL AND v_credit IS NULL THEN
      SELECT COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
        INTO v_is_liquid
      FROM accounts_chart WHERE id = v_debit;
      IF COALESCE(v_is_liquid, false) THEN
        v_credit := v_debit;
        v_debit  := NULL;
      END IF;
    END IF;

    -- (b) Fill the missing debit side per the posting rules
    IF v_debit IS NULL THEN
      IF r.voucher_type = 'PARTY_PAYMENT' THEN
        IF v_party_type = 'CUSTOMER' THEN
          SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '1100' LIMIT 1;
        ELSE
          SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
        END IF;
      ELSIF r.voucher_type = 'SALARY_PAYMENT' THEN
        SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
      ELSE
        v_debit := v_suspense;
      END IF;
    END IF;

    -- (c) Fill the missing credit side (Cash vs Bank by voucher type)
    IF v_credit IS NULL THEN
      IF r.voucher_type IN ('BANK_PAYMENT', 'SALARY_PAYMENT') THEN
        SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1002' LIMIT 1;
      END IF;
      IF v_credit IS NULL THEN
        SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
      END IF;
    END IF;

    IF v_debit IS NULL OR v_credit IS NULL THEN
      RAISE WARNING 'Backfill skipped %: could not resolve accounts (debit=%, credit=%)',
        r.voucher_no, v_debit, v_credit;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Debit still liquid after the flip (e.g. both sides were liquid): skip
    SELECT COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
      INTO v_is_liquid
    FROM accounts_chart WHERE id = v_debit;
    IF COALESCE(v_is_liquid, false) THEN
      RAISE WARNING 'Backfill skipped %: debit side is still Cash/Bank after repair', r.voucher_no;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- (d) Persist repaired sides onto the voucher row
    UPDATE payment_vouchers
       SET debit_account_id  = v_debit,
           credit_account_id = v_credit
     WHERE id = r.id
       AND (debit_account_id IS DISTINCT FROM v_debit
         OR credit_account_id IS DISTINCT FROM v_credit);

    -- (e) Create the journal entry when absent, otherwise rebuild its lines.
    -- Match on " VOUCHER_NO — " so CPV-2026-0001 can never grab CPV-2026-00010.
    SELECT id INTO v_je
    FROM journal_entries
    WHERE narration LIKE '% ' || r.voucher_no || ' — %'
    ORDER BY entry_date, entry_number
    LIMIT 1;

    IF v_je IS NULL THEN
      v_entry_number := 'JE-' || to_char(r.voucher_date, 'YYYYMMDD') || '-' ||
        lpad(nextval('journal_entry_seq')::TEXT, 5, '0');
      v_narration := CASE r.voucher_type
                        WHEN 'CASH_PAYMENT'   THEN 'CPV'
                        WHEN 'PARTY_PAYMENT'  THEN 'PPV'
                        WHEN 'SALARY_PAYMENT' THEN 'SPV'
                        ELSE 'BPV'
                      END
        || ' ' || r.voucher_no || ' — ' || r.payee_name;
      IF v_debit = v_suspense THEN
        v_narration := v_narration || ' [UNCATEGORISED — re-categorise suspense debit]';
      END IF;

      INSERT INTO journal_entries (entry_number, entry_date, narration, customer_name, is_balanced, status)
      VALUES (
        v_entry_number,
        r.voucher_date,
        v_narration,
        CASE WHEN EXISTS (SELECT 1 FROM accounts_chart WHERE id = v_debit AND account_code IN ('1100', '2001'))
             THEN r.payee_name ELSE NULL END,
        true,
        'POSTED'
      )
      RETURNING id INTO v_je;

      INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
      VALUES (v_je, v_debit, v_party_id, r.amount, 0),
             (v_je, v_credit, v_party_id, 0, r.amount);
    ELSE
      -- Rebuild as the balanced pair (vouchers never legitimately own >2 lines)
      DELETE FROM journal_lines WHERE journal_entry_id = v_je;

      INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
      VALUES (v_je, v_debit, v_party_id, r.amount, 0),
             (v_je, v_credit, v_party_id, 0, r.amount);

      -- Suspense note on rebuilt narrations (idempotent)
      IF v_debit = v_suspense AND r.voucher_no IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM journal_entries
            WHERE id = v_je AND narration LIKE '%[UNCATEGORISED%')
      THEN
        UPDATE journal_entries
           SET narration = narration || ' [UNCATEGORISED — re-categorise suspense debit]'
         WHERE id = v_je;
      END IF;

      UPDATE journal_entries
         SET is_balanced = true,
             status      = 'POSTED',
             customer_name = CASE WHEN EXISTS (
                                SELECT 1 FROM accounts_chart
                                 WHERE id = v_debit AND account_code IN ('1100', '2001'))
                              THEN r.payee_name ELSE NULL END
       WHERE id = v_je;
    END IF;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'Voucher ledger backfill complete: % vouchers repaired, % skipped', v_fixed, v_skipped;
END $$;

-- ── 4. Diagnostics (review; not executed) ────────────────────────────────────
-- Orphan voucher journal entries (voucher deleted, entry kept) — they still
-- distort ledgers (e.g. a lone "Dr Cash" from a deleted CPV shows as an
-- inflow). Review, then delete deliberately:
--
--   SELECT je.id, je.entry_number, je.narration,
--          (SELECT count(*) FROM journal_lines jl WHERE jl.journal_entry_id = je.id) AS lines
--   FROM journal_entries je
--   WHERE je.narration ~ '^(CPV|PPV|BPV|SPV) '
--     AND NOT EXISTS (
--       SELECT 1 FROM payment_vouchers pv
--        WHERE je.narration LIKE '% ' || pv.voucher_no || ' — %'
--     );
--
--   -- after review:
--   -- DELETE FROM journal_entries je WHERE je.id IN ( <ids from above> );
--
-- Post-fix verification: every voucher entry must report 2 rows:
--
--   SELECT je.entry_number, count(jl.id) AS lines,
--          sum(jl.debit_pkr) AS dr, sum(jl.credit_pkr) AS cr
--   FROM journal_entries je
--   JOIN journal_lines jl ON jl.journal_entry_id = je.id
--   WHERE je.narration ~ '^(CPV|PPV|BPV|SPV) '
--   GROUP BY je.entry_number
--   HAVING count(jl.id) <> 2 OR sum(jl.debit_pkr) <> sum(jl.credit_pkr);
