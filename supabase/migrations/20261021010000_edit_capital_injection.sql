-- ─── Available Funds → Edit: correct a wrongly recorded capital injection ──
-- Add Funds posts Dr Liquid (1000/1002) · Cr Owner's Equity (3000) as a POSTED
-- entry, and Available Funds is only a live SUM of those lines — so a typo had
-- no correction path. These two RPCs provide one:
--   list_capital_injections   → every injection entry (newest first) for the Edit modal
--   update_capital_injection  → rebuilds the double entry with corrected values
--
-- Structural signature of an injection entry (what both functions accept):
--   journal_entries.status = 'POSTED', voucher_no IS NULL, exactly 2 lines,
--   no party_id, Dr > 0 on 1000/1002, Cr > 0 on 3000, both sides equal.

-- ─── list_capital_injections ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_capital_injections(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id',           x.id,
             'entry_number', x.entry_number,
             'entry_date',   x.entry_date,
             'narration',    x.narration,
             'amount',       x.amount,
             'target',       x.target
           ) ORDER BY x.entry_date DESC, x.created_at DESC)
    FROM (
      SELECT je.id,
             je.entry_number,
             je.entry_date,
             je.narration,
             je.created_at,
             max(CASE WHEN a.account_code IN ('1000','1002') THEN jl.debit_pkr END) AS amount,
             max(CASE WHEN a.account_code = '1002' THEN 'BANK'
                      WHEN a.account_code = '1000' THEN 'CASH' END)                AS target
      FROM journal_entries je
      JOIN journal_lines  jl ON jl.journal_entry_id = je.id
      JOIN accounts_chart a  ON a.id = jl.account_id
      WHERE je.status = 'POSTED'
        AND je.voucher_no IS NULL
        AND (SELECT count(*) FROM journal_lines c
              WHERE c.journal_entry_id = je.id) = 2
        AND NOT EXISTS (
              SELECT 1 FROM journal_lines pl
               WHERE pl.journal_entry_id = je.id AND pl.party_id IS NOT NULL)
        AND EXISTS (
              SELECT 1 FROM journal_lines d
                JOIN accounts_chart da ON da.id = d.account_id
               WHERE d.journal_entry_id = je.id
                 AND da.account_code IN ('1000','1002')
                 AND d.debit_pkr > 0 AND d.credit_pkr = 0)
        AND EXISTS (
              SELECT 1 FROM journal_lines cr
                JOIN accounts_chart ca ON ca.id = cr.account_id
               WHERE cr.journal_entry_id = je.id
                 AND ca.account_code = '3000'
                 AND cr.credit_pkr > 0 AND cr.debit_pkr = 0)
      GROUP BY je.id, je.entry_number, je.entry_date, je.narration, je.created_at
      HAVING max(CASE WHEN a.account_code IN ('1000','1002') THEN jl.debit_pkr END)
           = max(CASE WHEN a.account_code = '3000' THEN jl.credit_pkr END)
      ORDER BY je.entry_date DESC, je.created_at DESC
      LIMIT COALESCE(p_limit, 50)
    ) x
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_capital_injections(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_capital_injections(INT) TO anon;
GRANT EXECUTE ON FUNCTION public.list_capital_injections(INT) TO service_role;

-- ─── update_capital_injection ──────────────────────────────────────────────
-- Corrects amount / target account / narration of one injection entry in place:
-- keeps entry_number + entry_date, rewrites both journal_lines, audits the change.
CREATE OR REPLACE FUNCTION public.update_capital_injection(
  p_entry_id        UUID,
  p_amount          NUMERIC,
  p_target_account  TEXT,   -- 'CASH' | 'BANK'
  p_narration       TEXT,
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
  v_amount       NUMERIC;
  v_entry_number TEXT;
  v_old_amount   NUMERIC;
  v_old_code     TEXT;
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

  SELECT id INTO v_debit_id  FROM accounts_chart WHERE account_code = v_debit_code;
  SELECT id INTO v_credit_id FROM accounts_chart WHERE account_code = '3000';
  IF v_debit_id IS NULL THEN
    RAISE EXCEPTION 'Liquid account % not found', v_debit_code;
  END IF;
  IF v_credit_id IS NULL THEN
    RAISE EXCEPTION 'Owner''s Equity (3000) not found in accounts_chart';
  END IF;

  -- Lock the row; only a genuine capital-injection entry may be rewritten.
  SELECT je.entry_number
    INTO v_entry_number
  FROM journal_entries je
  WHERE je.id = p_entry_id
    AND je.status = 'POSTED'
    AND je.voucher_no IS NULL
    AND (SELECT count(*) FROM journal_lines c
          WHERE c.journal_entry_id = je.id) = 2
    AND NOT EXISTS (
          SELECT 1 FROM journal_lines pl
           WHERE pl.journal_entry_id = je.id AND pl.party_id IS NOT NULL)
    AND EXISTS (
          SELECT 1 FROM journal_lines d
            JOIN accounts_chart da ON da.id = d.account_id
           WHERE d.journal_entry_id = je.id
             AND da.account_code IN ('1000','1002')
             AND d.debit_pkr > 0 AND d.credit_pkr = 0)
    AND EXISTS (
          SELECT 1 FROM journal_lines cr
            JOIN accounts_chart ca ON ca.id = cr.account_id
           WHERE cr.journal_entry_id = je.id
             AND ca.account_code = '3000'
             AND cr.credit_pkr > 0 AND cr.debit_pkr = 0)
  FOR UPDATE OF je;

  IF v_entry_number IS NULL THEN
    RAISE EXCEPTION 'Capital injection entry not found or not editable';
  END IF;

  -- Previous values (for the audit trail).
  SELECT jl.debit_pkr, a.account_code
    INTO v_old_amount, v_old_code
  FROM journal_lines jl
  JOIN accounts_chart a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = p_entry_id
    AND a.account_code IN ('1000','1002')
  LIMIT 1;

  -- Rebuild the double entry with the corrected amount / target account.
  DELETE FROM journal_lines WHERE journal_entry_id = p_entry_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (p_entry_id, v_debit_id, v_amount, 0),
         (p_entry_id, v_credit_id, 0, v_amount);

  UPDATE journal_entries
     SET narration = COALESCE(NULLIF(TRIM(COALESCE(p_narration, '')), ''),
                              'Capital injection — ' || v_debit_code),
         is_balanced = TRUE
   WHERE id = p_entry_id;

  BEGIN
    INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
    VALUES (
      COALESCE(p_device_node, 'SYSTEM_LOCAL'),
      COALESCE(p_operator_name, 'OWNER'),
      'UPDATED_CAPITAL_INJECTION',
      jsonb_build_object(
        'entry_number',     v_entry_number,
        'previous_amount',  v_old_amount,
        'amount',           v_amount,
        'previous_target',  v_old_code,
        'target',           v_debit_code
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- audit is best-effort
  END;

  RETURN jsonb_build_object(
    'id',                p_entry_id,
    'entry_number',      v_entry_number,
    'amount',            v_amount,
    'debit_account_code', v_debit_code,
    'previous_amount',   v_old_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_capital_injection(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_capital_injection(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT)
  TO anon;
GRANT EXECUTE ON FUNCTION public.update_capital_injection(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ─── Post-migration verification ───────────────────────────────────────────
-- SELECT * FROM list_capital_injections(10);
-- SELECT update_capital_injection(
--   '<injection entry id>'::uuid, 999999.00, 'CASH',
--   'Corrected amount', 'OWNER', 'WEB-NODE');
