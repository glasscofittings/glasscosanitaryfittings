-- ============================================================================
-- MIGRATION: 20261120010000_payroll_fixes.sql
-- Payroll Engine Fixes – Part 2
--
-- Requires: 20261116010000_sap_payroll_core_engine.sql
--
-- Changes:
--   1. create_payroll_run     – server-side run creation + validation
--   2. post_payroll_run       – replaced: FOR UPDATE lock, period end_date, correct GL
--   3. reverse_payroll_run    – replaced: FOR UPDATE lock, precise loan restore
--   4. pay_payroll_items      – replaced: partial payments, method/account validation
--   5. reverse_payroll_payment – new: flip individual disbursement JE
--   6. issue_worker_loan      – new: JE-backed loan issuance
--   7. record_loan_repayment  – new: JE-backed cash/bank repayment
--   8. payroll_loan_recoveries – audit table for run-level loan allocations
--   9. Security hardening – drop write policies, revoke direct DML
-- ============================================================================

-- ── Schema additions (idempotent) ────────────────────────────────────────────

-- Add reversed_at to payment logs if missing
ALTER TABLE payroll_payment_logs
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reference_no  TEXT;

-- Loan recovery audit table (which run reduced which loan by how much)
CREATE TABLE IF NOT EXISTS payroll_loan_recoveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES payroll_runs_v2(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES payroll_run_items(id) ON DELETE CASCADE,
  loan_id     UUID NOT NULL REFERENCES worker_loans(id),
  amount      NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  reversed    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plr_run  ON payroll_loan_recoveries(run_id);
CREATE INDEX IF NOT EXISTS idx_plr_loan ON payroll_loan_recoveries(loan_id);
CREATE INDEX IF NOT EXISTS idx_plr_item ON payroll_loan_recoveries(item_id);

-- RLS on new table
ALTER TABLE payroll_loan_recoveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_loan_recoveries" ON payroll_loan_recoveries;
CREATE POLICY "allow_read_loan_recoveries" ON payroll_loan_recoveries FOR SELECT USING (true);

-- Unique partial index: one worker cannot appear in two REGULAR items for the same period
-- (wraps a subquery so it is truly partial and idempotent via DO block)
-- Guard: one worker cannot have two non-reversed REGULAR items in the same period.
-- Implemented as a trigger (index expressions cannot contain subqueries in PG).
CREATE OR REPLACE FUNCTION public.trg_check_duplicate_regular_payroll()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_run_type  TEXT;
BEGIN
  SELECT period_id, run_type INTO v_period_id, v_run_type
  FROM payroll_runs_v2 WHERE id = NEW.run_id;

  IF v_run_type = 'REGULAR' AND NEW.status <> 'REVERSED' THEN
    IF EXISTS (
      SELECT 1
      FROM payroll_run_items  i
      JOIN payroll_runs_v2    r ON r.id = i.run_id
      WHERE r.period_id  = v_period_id
        AND r.run_type   = 'REGULAR'
        AND i.worker_id  = NEW.worker_id
        AND i.status    <> 'REVERSED'
        AND i.id        <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
    ) THEN
      RAISE EXCEPTION
        'Worker % already has a REGULAR payroll item in this period. Reverse the existing run first.',
        NEW.worker_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_duplicate_regular_payroll ON payroll_run_items;
CREATE TRIGGER trg_check_duplicate_regular_payroll
  BEFORE INSERT OR UPDATE ON payroll_run_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_check_duplicate_regular_payroll();

-- ── 1. create_payroll_run ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_payroll_run(
  p_period_id   UUID,
  p_cost_class  worker_cost_class_enum,  -- NULL means both
  p_items       JSONB,                   -- array of item objects (see below)
  p_operator    TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
/*
  p_items element shape:
  {
    "worker_id":         "<uuid>",
    "worker_name":       "Full Name",
    "cost_class":        "PRODUCTION"|"ADMIN",
    "employment_type":   "PERMANENT_SALARY"|"DAILY_PAY"|"PART_TIME_WAGE",
    "cost_center":       "FACTORY_FLOOR",          -- optional
    "days_in_period":    30,
    "present_days":      26,
    "absent_days":       4,
    "leave_days":        0,
    "overtime_minutes":  120,
    "undertime_minutes": 0,
    "basic_rate":        25000,
    "gross_earnings":    26500,
    "total_deductions":  1500,
    "net_pay":           25000,
    "lines": [
      {
        "wage_type_code": "BASIC",
        "wage_type_name": "Basic Salary",
        "category":       "EARNING",
        "qty":            1,
        "rate":           25000,
        "amount":         25000,
        "gl_account_id":  "<uuid>|null"
      },
      ...
    ]
  }
*/
DECLARE
  v_period      RECORD;
  v_run_id      UUID;
  v_run_no      TEXT;
  v_item_el     JSONB;
  v_item_id     UUID;
  v_line_el     JSONB;
  v_worker_id   UUID;
  v_worker_name TEXT;
  v_gross       NUMERIC(18,2);
  v_deductions  NUMERIC(18,2);
  v_net         NUMERIC(18,2);
  v_total_workers   INT := 0;
  v_total_gross     NUMERIC(18,2) := 0;
  v_total_deductions NUMERIC(18,2) := 0;
  v_total_net       NUMERIC(18,2) := 0;
BEGIN
  -- 1. Validate period
  SELECT * INTO v_period FROM payroll_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll period % not found.', p_period_id;
  END IF;
  IF v_period.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Period % is not OPEN (current status: %). Cannot create a run against it.',
      v_period.period_code, v_period.status;
  END IF;

  -- 2. Validate p_items is a non-empty array
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array.';
  END IF;

  -- 3. Pre-validate every item before touching the DB
  FOR v_item_el IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_worker_id  := (v_item_el->>'worker_id')::UUID;
    v_gross      := (v_item_el->>'gross_earnings')::NUMERIC;
    v_deductions := (v_item_el->>'total_deductions')::NUMERIC;
    v_net        := (v_item_el->>'net_pay')::NUMERIC;

    -- net_pay consistency
    IF round(v_net, 2) <> round(v_gross - v_deductions, 2) THEN
      RAISE EXCEPTION
        'Item for worker %: net_pay (%) <> gross_earnings (%) - total_deductions (%).',
        v_worker_id, v_net, v_gross, v_deductions;
    END IF;

    IF v_net < 0 THEN
      RAISE EXCEPTION 'Item for worker %: net_pay (%) cannot be negative.', v_worker_id, v_net;
    END IF;

    -- Double-payroll guard: worker already has a non-REVERSED REGULAR item this period?
    IF EXISTS (
      SELECT 1
      FROM payroll_run_items  i
      JOIN payroll_runs_v2    r ON r.id = i.run_id
      WHERE r.period_id = p_period_id
        AND r.run_type  = 'REGULAR'
        AND i.worker_id = v_worker_id
        AND i.status   <> 'REVERSED'
    ) THEN
      RAISE EXCEPTION
        'Worker % already has a REGULAR payroll item in period %. Reverse the existing run first.',
        v_worker_id, v_period.period_code;
    END IF;
  END LOOP;

  -- 4. Create run header
  v_run_no := fn_next_payroll_run_no();

  INSERT INTO payroll_runs_v2 (
    run_no, period_id, run_type, cost_class_filter, status,
    total_workers, gross_earnings, total_deductions, net_payable,
    created_by, notes
  ) VALUES (
    v_run_no, p_period_id, 'REGULAR', p_cost_class, 'APPROVED',
    0, 0, 0, 0,
    p_operator, 'Created via create_payroll_run RPC'
  ) RETURNING id INTO v_run_id;

  -- 5. Insert items and lines
  FOR v_item_el IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_worker_id   := (v_item_el->>'worker_id')::UUID;
    v_worker_name := v_item_el->>'worker_name';
    v_gross       := (v_item_el->>'gross_earnings')::NUMERIC;
    v_deductions  := (v_item_el->>'total_deductions')::NUMERIC;
    v_net         := (v_item_el->>'net_pay')::NUMERIC;

    INSERT INTO payroll_run_items (
      run_id, worker_id, worker_name,
      cost_class, employment_type, cost_center,
      days_in_period, present_days, absent_days, leave_days,
      overtime_minutes, undertime_minutes,
      basic_rate, gross_earnings, total_deductions, net_pay,
      amount_paid, status
    ) VALUES (
      v_run_id,
      v_worker_id,
      v_worker_name,
      COALESCE((v_item_el->>'cost_class')::worker_cost_class_enum, 'PRODUCTION'),
      COALESCE(v_item_el->>'employment_type', 'PERMANENT_SALARY'),
      v_item_el->>'cost_center',
      COALESCE((v_item_el->>'days_in_period')::INT, 30),
      COALESCE((v_item_el->>'present_days')::NUMERIC, 0),
      COALESCE((v_item_el->>'absent_days')::NUMERIC, 0),
      COALESCE((v_item_el->>'leave_days')::NUMERIC, 0),
      COALESCE((v_item_el->>'overtime_minutes')::INT, 0),
      COALESCE((v_item_el->>'undertime_minutes')::INT, 0),
      COALESCE((v_item_el->>'basic_rate')::NUMERIC, 0),
      v_gross,
      v_deductions,
      v_net,
      0,
      'DRAFT'
    ) RETURNING id INTO v_item_id;

    -- Insert lines
    FOR v_line_el IN SELECT * FROM jsonb_array_elements(v_item_el->'lines')
    LOOP
      INSERT INTO payroll_run_item_lines (
        item_id, wage_type_code, wage_type_name, category,
        qty, rate, amount, gl_account_id
      ) VALUES (
        v_item_id,
        v_line_el->>'wage_type_code',
        v_line_el->>'wage_type_name',
        v_line_el->>'category',
        COALESCE((v_line_el->>'qty')::NUMERIC, 1),
        COALESCE((v_line_el->>'rate')::NUMERIC, 0),
        COALESCE((v_line_el->>'amount')::NUMERIC, 0),
        CASE WHEN (v_line_el->>'gl_account_id') IS NOT NULL AND (v_line_el->>'gl_account_id') <> 'null'
             THEN (v_line_el->>'gl_account_id')::UUID
             ELSE NULL
        END
      );
    END LOOP;

    v_total_workers    := v_total_workers + 1;
    v_total_gross      := v_total_gross + v_gross;
    v_total_deductions := v_total_deductions + v_deductions;
    v_total_net        := v_total_net + v_net;
  END LOOP;

  -- 6. Update header totals from server-side sums (never trust client)
  UPDATE payroll_runs_v2
  SET
    total_workers    = v_total_workers,
    gross_earnings   = v_total_gross,
    total_deductions = v_total_deductions,
    net_payable      = v_total_net,
    updated_at       = NOW()
  WHERE id = v_run_id;

  -- Audit
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator, 'PAYROLL_RUN_CREATED', 'PAYROLL',
    jsonb_build_object(
      'run_id', v_run_id, 'run_no', v_run_no,
      'period_code', v_period.period_code,
      'total_workers', v_total_workers,
      'net_payable', v_total_net
    )
  );

  RETURN jsonb_build_object(
    'success',        true,
    'run_id',         v_run_id,
    'run_no',         v_run_no,
    'total_workers',  v_total_workers,
    'gross_earnings', v_total_gross,
    'net_payable',    v_total_net
  );
END;
$$;

-- ── 2. post_payroll_run (replacement) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.post_payroll_run(
  p_run_id       UUID,
  p_operator_name TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
/*
  Accounting model:
    Dr  5011  Production Salaries (PERMANENT_SALARY in PRODUCTION)  = gross of those items
    Dr  5010  Production Wages   (DAILY_PAY / PART_TIME_WAGE in PRODUCTION) = gross
    Dr  5002  Admin Salaries & Wages (all ADMIN)                    = gross
    Cr  2300  Wages & Salaries Payable                              = SUM(net_pay)
    Cr  1150  Staff Loans & Advances Receivable                     = SUM(loan recoveries)

  Non-loan deductions (undertime, absence, other) REDUCE the expense debit, not a separate credit.
  Expense debit = gross_earnings - non_loan_deductions  per cost bucket.
  Balance check: total_expense_debit = net_pay_credit + loan_recovery_credit

  JE date = period end_date.
*/
DECLARE
  v_run    RECORD;
  v_period RECORD;
  v_je_id  UUID;
  v_je_no  TEXT;

  v_acct_prod_wages  UUID;
  v_acct_prod_sal    UUID;
  v_acct_admin       UUID;
  v_acct_2300        UUID;
  v_acct_1150        UUID;

  -- Expense buckets (net of non-loan deductions)
  v_exp_prod_sal  NUMERIC(18,2) := 0;
  v_exp_prod_wage NUMERIC(18,2) := 0;
  v_exp_admin     NUMERIC(18,2) := 0;

  v_tot_net_pay        NUMERIC(18,2) := 0;
  v_tot_loan_recovery  NUMERIC(18,2) := 0;

  v_item        RECORD;
  v_item_gross  NUMERIC(18,2);
  v_item_loan   NUMERIC(18,2);
  v_item_nonloan NUMERIC(18,2);
  v_item_exp    NUMERIC(18,2);

  v_remain      NUMERIC(18,2);
  v_loan_row    RECORD;
BEGIN
  -- 1. Lock run row
  SELECT * INTO v_run FROM payroll_runs_v2 WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run % not found.', p_run_id;
  END IF;
  IF v_run.status NOT IN ('SIMULATED', 'APPROVED') THEN
    RAISE EXCEPTION 'Cannot post run % with status %. Must be SIMULATED or APPROVED.', v_run.run_no, v_run.status;
  END IF;

  SELECT * INTO v_period FROM payroll_periods WHERE id = v_run.period_id;
  IF v_period.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Cannot post to CLOSED period %.', v_period.period_code;
  END IF;

  -- 2. Resolve accounts
  SELECT id INTO v_acct_prod_wages FROM accounts_chart WHERE account_code = '5010' LIMIT 1;
  SELECT id INTO v_acct_prod_sal   FROM accounts_chart WHERE account_code = '5011' LIMIT 1;
  SELECT id INTO v_acct_admin      FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
  SELECT id INTO v_acct_2300       FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  SELECT id INTO v_acct_1150       FROM accounts_chart WHERE account_code = '1150' LIMIT 1;

  IF v_acct_2300  IS NULL THEN RAISE EXCEPTION 'Account 2300 (Wages & Salaries Payable) not found.'; END IF;
  IF v_acct_admin IS NULL THEN RAISE EXCEPTION 'Account 5002 (Admin Salaries & Wages) not found.'; END IF;
  IF v_acct_1150  IS NULL THEN RAISE EXCEPTION 'Account 1150 (Staff Loans & Advances) not found.'; END IF;
  IF v_acct_prod_sal  IS NULL THEN v_acct_prod_sal  := v_acct_admin; END IF;
  IF v_acct_prod_wages IS NULL THEN v_acct_prod_wages := v_acct_prod_sal; END IF;

  -- 3. Compute expense buckets per item
  --    expense = gross - non_loan_deductions  (loan deductions are separate credit to 1150)
  FOR v_item IN
    SELECT
      i.id,
      i.worker_id,
      i.cost_class,
      i.employment_type,
      i.gross_earnings,
      i.net_pay,
      COALESCE((
        SELECT SUM(l.amount)
        FROM payroll_run_item_lines l
        WHERE l.item_id = i.id AND l.category = 'DEDUCTION'
          AND l.wage_type_code IN ('LOAN_RECOVERY', 'ADVANCE_RECOVERY')
      ), 0) AS loan_deductions,
      COALESCE((
        SELECT SUM(l.amount)
        FROM payroll_run_item_lines l
        WHERE l.item_id = i.id AND l.category = 'DEDUCTION'
          AND l.wage_type_code NOT IN ('LOAN_RECOVERY', 'ADVANCE_RECOVERY')
      ), 0) AS non_loan_deductions
    FROM payroll_run_items i
    WHERE i.run_id = p_run_id
  LOOP
    -- expense debit = gross - non-loan deductions
    v_item_exp    := round(v_item.gross_earnings - v_item.non_loan_deductions, 2);
    v_item_loan   := round(v_item.loan_deductions, 2);

    -- balance check per item
    IF round(v_item.net_pay, 2) <> round(v_item_exp - v_item_loan, 2) THEN
      RAISE EXCEPTION
        'Item %: net_pay (%) <> expense (%) - loan (%). Check payroll data.',
        v_item.id, v_item.net_pay, v_item_exp, v_item_loan;
    END IF;

    v_tot_net_pay       := v_tot_net_pay + v_item.net_pay;
    v_tot_loan_recovery := v_tot_loan_recovery + v_item_loan;

    IF v_item.cost_class = 'PRODUCTION' THEN
      IF v_item.employment_type = 'PERMANENT_SALARY' THEN
        v_exp_prod_sal  := v_exp_prod_sal  + v_item_exp;
      ELSE
        v_exp_prod_wage := v_exp_prod_wage + v_item_exp;
      END IF;
    ELSE
      v_exp_admin := v_exp_admin + v_item_exp;
    END IF;
  END LOOP;

  -- 4. Create Journal Entry dated at period end_date
  v_je_no := 'JE-' || to_char(v_period.end_date, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (
    v_je_no,
    v_period.end_date,
    'Payroll Accrual ' || v_run.run_no || ' [' || v_period.period_code || ']',
    'POSTED', true
  ) RETURNING id INTO v_je_id;

  -- 5. Debit lines (expense)
  IF v_exp_prod_sal > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_prod_sal, v_exp_prod_sal, 0);
  END IF;

  IF v_exp_prod_wage > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_prod_wages, v_exp_prod_wage, 0);
  END IF;

  IF v_exp_admin > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_admin, v_exp_admin, 0);
  END IF;

  -- 6. Credit lines
  IF v_tot_net_pay > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_2300, 0, v_tot_net_pay);
  END IF;

  IF v_tot_loan_recovery > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_1150, 0, v_tot_loan_recovery);
  END IF;

  -- 7. Allocate loan recoveries (oldest-first) and record in payroll_loan_recoveries
  FOR v_item IN
    SELECT
      i.id AS item_id,
      i.worker_id,
      COALESCE((
        SELECT SUM(l.amount)
        FROM payroll_run_item_lines l
        WHERE l.item_id = i.id AND l.category = 'DEDUCTION'
          AND l.wage_type_code IN ('LOAN_RECOVERY', 'ADVANCE_RECOVERY')
      ), 0) AS loan_total
    FROM payroll_run_items i
    WHERE i.run_id = p_run_id AND i.status <> 'REVERSED'
  LOOP
    v_remain := round(v_item.loan_total, 2);

    FOR v_loan_row IN
      SELECT id, current_balance
      FROM worker_loans
      WHERE worker_id = v_item.worker_id
        AND current_balance > 0
        AND status IN ('ACTIVE', 'OVERDUE')
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remain <= 0;

      DECLARE
        v_alloc NUMERIC(18,2);
      BEGIN
        v_alloc := round(LEAST(v_remain, v_loan_row.current_balance), 2);

        -- Update loan balance
        UPDATE worker_loans
        SET current_balance = round(current_balance - v_alloc, 2),
            status = CASE WHEN round(current_balance - v_alloc, 2) <= 0 THEN 'SETTLED' ELSE status END
        WHERE id = v_loan_row.id;

        -- Record in audit table
        INSERT INTO payroll_loan_recoveries (run_id, item_id, loan_id, amount)
        VALUES (p_run_id, v_item.item_id, v_loan_row.id, v_alloc);

        -- Insert repayment log
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'loan_repayment_logs') THEN
          INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
          VALUES (v_loan_row.id, v_alloc, 'SALARY_DEDUCTION', v_period.end_date);
        END IF;

        v_remain := v_remain - v_alloc;
      END;
    END LOOP;
  END LOOP;

  -- 8. Update run and item status
  UPDATE payroll_runs_v2
  SET status = 'POSTED', journal_entry_id = v_je_id, approved_by = p_operator_name, updated_at = NOW()
  WHERE id = p_run_id;

  UPDATE payroll_run_items
  SET status = 'POSTED'
  WHERE run_id = p_run_id;

  -- Audit
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator_name, 'PAYROLL_RUN_POSTED', 'PAYROLL',
    jsonb_build_object(
      'run_no', v_run.run_no, 'run_id', p_run_id,
      'je_id', v_je_id, 'je_date', v_period.end_date,
      'net_payable', v_tot_net_pay,
      'loan_recovery', v_tot_loan_recovery
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', p_run_id, 'run_no', v_run.run_no,
    'journal_entry_id', v_je_id, 'journal_entry_number', v_je_no
  );
END;
$$;

-- ── 3. reverse_payroll_run (replacement) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverse_payroll_run(
  p_run_id       UUID,
  p_reason       TEXT,
  p_operator_name TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      RECORD;
  v_orig_je  RECORD;
  v_rev_je_id UUID;
  v_rev_je_no TEXT;
  v_line     RECORD;
  v_rec      RECORD;
BEGIN
  -- Lock the run
  SELECT * INTO v_run FROM payroll_runs_v2 WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run % not found.', p_run_id; END IF;

  IF v_run.status <> 'POSTED' THEN
    RAISE EXCEPTION
      'Can only reverse a POSTED run. Current status: % (if paid, reverse payments first).',
      v_run.status;
  END IF;

  IF v_run.amount_paid > 0 THEN
    RAISE EXCEPTION
      'Run % has disbursed PKR %. Reverse disbursements before reversing the accrual.',
      v_run.run_no, v_run.amount_paid;
  END IF;

  SELECT * INTO v_orig_je FROM journal_entries WHERE id = v_run.journal_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original journal entry for run % not found.', v_run.run_no;
  END IF;

  -- Create storno JE
  v_rev_je_no := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (
    v_rev_je_no, CURRENT_DATE,
    'STORNO REVERSAL of ' || v_orig_je.entry_number || ' (' || v_run.run_no || '): ' || COALESCE(p_reason, 'Reason not specified'),
    'POSTED', true
  ) RETURNING id INTO v_rev_je_id;

  -- Flip original lines
  FOR v_line IN SELECT * FROM journal_lines WHERE journal_entry_id = v_orig_je.id
  LOOP
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_rev_je_id, v_line.account_id, v_line.credit_pkr, v_line.debit_pkr);
  END LOOP;

  -- Restore ONLY the loans recorded in payroll_loan_recoveries for this run
  FOR v_rec IN
    SELECT loan_id, amount FROM payroll_loan_recoveries
    WHERE run_id = p_run_id AND reversed = false
  LOOP
    UPDATE worker_loans
    SET current_balance = round(current_balance + v_rec.amount, 2),
        status = CASE WHEN status = 'SETTLED' THEN 'ACTIVE' ELSE status END
    WHERE id = v_rec.loan_id;

    -- Soft-delete the repayment log entries created for this run
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'loan_repayment_logs') THEN
      UPDATE loan_repayment_logs
      SET notes = COALESCE(notes, '') || ' [REVERSED by ' || v_rev_je_no || ']'
      WHERE loan_id = v_rec.loan_id
        AND repayment_source = 'SALARY_DEDUCTION'
        AND payment_date = (SELECT end_date FROM payroll_periods WHERE id = v_run.period_id);
    END IF;
  END LOOP;

  -- Mark recovery rows as reversed
  UPDATE payroll_loan_recoveries SET reversed = true WHERE run_id = p_run_id;

  -- Update run and items
  UPDATE payroll_runs_v2
  SET status = 'REVERSED', reversal_journal_id = v_rev_je_id, reversal_reason = p_reason, updated_at = NOW()
  WHERE id = p_run_id;

  UPDATE payroll_run_items SET status = 'REVERSED' WHERE run_id = p_run_id;

  -- Audit
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator_name, 'PAYROLL_RUN_REVERSED', 'PAYROLL',
    jsonb_build_object(
      'run_no', v_run.run_no,
      'reversal_journal_id', v_rev_je_id,
      'reversal_reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'reversal_journal_id', v_rev_je_id,
    'reversal_journal_number', v_rev_je_no
  );
END;
$$;

-- ── 4. pay_payroll_items (replacement) ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pay_payroll_items(
  p_run_id          UUID,
  p_item_ids        UUID[],
  p_payment_method  TEXT,   -- 'CASH' | 'BANK'
  p_account_id      UUID,
  p_payment_date    DATE    DEFAULT CURRENT_DATE,
  p_operator_name   TEXT    DEFAULT 'System Operator',
  p_allow_overdraft BOOLEAN DEFAULT false,
  p_amounts         JSONB   DEFAULT NULL  -- {"<item_uuid>": amount} for partial
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
/*
  p_amounts allows partial payment per item.  Omit (or NULL) for full pending amount.
  Validates:
    CASH   -> account must have is_default_cash = true
    BANK   -> account must be is_liquid_funds = true AND NOT is_default_cash
  Item status: PAID if amount_paid = net_pay, else PARTIALLY_PAID.
  Run  status: PAID if SUM(amount_paid) >= SUM(net_pay), else PARTIALLY_PAID.
  One payroll_payment_logs row per item per call.
*/
DECLARE
  v_run        RECORD;
  v_pay_acct   RECORD;
  v_acct_2300  UUID;
  v_item       RECORD;
  v_pay_amount NUMERIC(18,2);
  v_pending    NUMERIC(18,2);
  v_total_pay  NUMERIC(18,2) := 0;
  v_item_count INT := 0;
  v_je_id      UUID;
  v_je_no      TEXT;
  v_batch_no   TEXT;
  v_liq_bal    NUMERIC(18,2);
BEGIN
  -- 1. Lock run
  SELECT * INTO v_run FROM payroll_runs_v2 WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run % not found.', p_run_id; END IF;

  IF v_run.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Run % must be POSTED or PARTIALLY_PAID before payment (current: %).', v_run.run_no, v_run.status;
  END IF;

  -- 2. Validate payment account
  SELECT * INTO v_pay_acct FROM accounts_chart WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment account % not found.', p_account_id; END IF;

  IF p_payment_method = 'CASH' THEN
    IF NOT COALESCE(v_pay_acct.is_default_cash, false) THEN
      RAISE EXCEPTION 'Method CASH requires an account where is_default_cash = true. Account % is not a cash account.', v_pay_acct.account_code;
    END IF;
  ELSIF p_payment_method = 'BANK' THEN
    IF NOT (COALESCE(v_pay_acct.is_liquid_funds, false) AND NOT COALESCE(v_pay_acct.is_default_cash, false)) THEN
      RAISE EXCEPTION 'Method BANK requires a liquid non-cash account. Account % does not qualify.', v_pay_acct.account_code;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid payment_method %. Must be CASH or BANK.', p_payment_method;
  END IF;

  SELECT id INTO v_acct_2300 FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  IF v_acct_2300 IS NULL THEN RAISE EXCEPTION 'Account 2300 (Wages Payable) not found.'; END IF;

  -- 3. Lock items and compute total
  FOR v_item IN
    SELECT id, net_pay, amount_paid
    FROM payroll_run_items
    WHERE run_id = p_run_id AND id = ANY(p_item_ids) AND status <> 'REVERSED'
    FOR UPDATE
  LOOP
    v_pending := round(v_item.net_pay - v_item.amount_paid, 2);
    IF v_pending <= 0 THEN CONTINUE; END IF;

    -- Determine pay amount for this item
    IF p_amounts IS NOT NULL AND p_amounts ? (v_item.id::TEXT) THEN
      v_pay_amount := round((p_amounts->>(v_item.id::TEXT))::NUMERIC, 2);
      IF v_pay_amount <= 0 THEN
        RAISE EXCEPTION 'Amount for item % must be positive.', v_item.id;
      END IF;
      IF v_pay_amount > v_pending THEN
        RAISE EXCEPTION 'Amount % for item % exceeds pending balance %.', v_pay_amount, v_item.id, v_pending;
      END IF;
    ELSE
      v_pay_amount := v_pending;
    END IF;

    v_total_pay  := v_total_pay  + v_pay_amount;
    v_item_count := v_item_count + 1;
  END LOOP;

  IF v_total_pay <= 0 THEN
    RAISE EXCEPTION 'No pending payable balance found for selected items.';
  END IF;

  -- 4. Liquidity check
  SELECT COALESCE(SUM(jl.debit_pkr) - SUM(jl.credit_pkr), 0) INTO v_liq_bal
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id AND je.status = 'POSTED';

  IF v_liq_bal < v_total_pay AND NOT p_allow_overdraft THEN
    RAISE EXCEPTION 'Insufficient balance in account % (available: PKR %, required: PKR %).',
      v_pay_acct.account_name, v_liq_bal, v_total_pay;
  END IF;

  -- 5. Create disbursement JE
  v_batch_no := 'DISB-' || to_char(p_payment_date, 'YYYYMMDD') || '-' || lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');
  v_je_no    := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (
    v_je_no, p_payment_date,
    'Payroll Disbursement ' || v_batch_no || ' (' || v_item_count || ' staff) Run: ' || v_run.run_no,
    'POSTED', true
  ) RETURNING id INTO v_je_id;

  -- Dr 2300 / Cr cash or bank
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, v_acct_2300, v_total_pay, 0);
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, p_account_id, 0, v_total_pay);

  -- 6. Update items and insert payment logs
  FOR v_item IN
    SELECT id, net_pay, amount_paid
    FROM payroll_run_items
    WHERE run_id = p_run_id AND id = ANY(p_item_ids) AND status <> 'REVERSED'
  LOOP
    v_pending := round(v_item.net_pay - v_item.amount_paid, 2);
    IF v_pending <= 0 THEN CONTINUE; END IF;

    IF p_amounts IS NOT NULL AND p_amounts ? (v_item.id::TEXT) THEN
      v_pay_amount := round((p_amounts->>(v_item.id::TEXT))::NUMERIC, 2);
    ELSE
      v_pay_amount := v_pending;
    END IF;

    UPDATE payroll_run_items
    SET
      amount_paid = round(amount_paid + v_pay_amount, 2),
      status = CASE
        WHEN round(amount_paid + v_pay_amount, 2) >= net_pay THEN 'PAID'
        ELSE 'PARTIALLY_PAID'
      END
    WHERE id = v_item.id;

    INSERT INTO payroll_payment_logs (
      run_id, item_id, amount, payment_method, payment_account_id,
      journal_entry_id, payment_date, disbursement_batch_no, operator_name
    ) VALUES (
      p_run_id, v_item.id, v_pay_amount, p_payment_method, p_account_id,
      v_je_id, p_payment_date, v_batch_no, p_operator_name
    );
  END LOOP;

  -- 7. Recompute run status from item sums (correct, not from header arithmetic)
  UPDATE payroll_runs_v2
  SET
    amount_paid = (SELECT COALESCE(SUM(amount_paid), 0) FROM payroll_run_items WHERE run_id = p_run_id),
    status = (
      CASE
        WHEN (SELECT COALESCE(SUM(amount_paid), 0) FROM payroll_run_items WHERE run_id = p_run_id) >=
             (SELECT COALESCE(SUM(net_pay), 0)     FROM payroll_run_items WHERE run_id = p_run_id)
        THEN 'PAID'
        ELSE 'PARTIALLY_PAID'
      END
    ),
    updated_at = NOW()
  WHERE id = p_run_id;

  -- Audit
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator_name, 'PAYROLL_DISBURSEMENT_POSTED', 'PAYROLL',
    jsonb_build_object(
      'run_no', v_run.run_no, 'batch_no', v_batch_no,
      'amount', v_total_pay, 'method', p_payment_method,
      'account', v_pay_acct.account_code, 'je_id', v_je_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_no', v_batch_no,
    'amount_paid', v_total_pay,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_no
  );
END;
$$;

-- ── 5. reverse_payroll_payment ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverse_payroll_payment(
  p_log_id   UUID,
  p_reason   TEXT,
  p_operator TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
/*
  Reverses a single payroll_payment_logs row:
    - Creates a flipped JE (Dr cash/bank, Cr 2300)
    - Decreases item.amount_paid; recalculates item status
    - Recalculates run.amount_paid / status
    - Sets payroll_payment_logs.reversal_journal_id and reversed_at
    - Rejects if already reversed
*/
DECLARE
  v_log     RECORD;
  v_item    RECORD;
  v_run     RECORD;
  v_orig_je RECORD;
  v_acct_2300 UUID;
  v_rev_je_id UUID;
  v_rev_je_no TEXT;
BEGIN
  SELECT * INTO v_log FROM payroll_payment_logs WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment log % not found.', p_log_id; END IF;
  IF v_log.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment log % is already reversed.', p_log_id;
  END IF;

  SELECT * INTO v_item FROM payroll_run_items WHERE id = v_log.item_id FOR UPDATE;
  SELECT * INTO v_run  FROM payroll_runs_v2   WHERE id = v_log.run_id  FOR UPDATE;

  SELECT id INTO v_acct_2300 FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  IF v_acct_2300 IS NULL THEN RAISE EXCEPTION 'Account 2300 not found.'; END IF;

  -- Build reversal JE  (Dr cash/bank, Cr 2300)
  v_rev_je_no := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (
    v_rev_je_no, CURRENT_DATE,
    'REVERSAL of disbursement log ' || p_log_id || ': ' || COALESCE(p_reason, 'Reason not specified'),
    'POSTED', true
  ) RETURNING id INTO v_rev_je_id;

  -- Original JE: Dr 2300 / Cr cash. Reversal: Dr cash / Cr 2300
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_rev_je_id, v_log.payment_account_id, v_log.amount, 0);
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_rev_je_id, v_acct_2300, 0, v_log.amount);

  -- Decrease item amount_paid
  UPDATE payroll_run_items
  SET
    amount_paid = GREATEST(0, round(amount_paid - v_log.amount, 2)),
    status = CASE
      WHEN round(amount_paid - v_log.amount, 2) <= 0 THEN 'POSTED'
      ELSE 'PARTIALLY_PAID'
    END
  WHERE id = v_log.item_id;

  -- Mark log as reversed
  UPDATE payroll_payment_logs
  SET reversal_journal_id = v_rev_je_id, reversed_at = NOW()
  WHERE id = p_log_id;

  -- Recompute run status
  UPDATE payroll_runs_v2
  SET
    amount_paid = (SELECT COALESCE(SUM(amount_paid), 0) FROM payroll_run_items WHERE run_id = v_log.run_id),
    status = (
      CASE
        WHEN (SELECT COALESCE(SUM(amount_paid), 0) FROM payroll_run_items WHERE run_id = v_log.run_id) <= 0
        THEN 'POSTED'
        WHEN (SELECT COALESCE(SUM(amount_paid), 0) FROM payroll_run_items WHERE run_id = v_log.run_id) >=
             (SELECT COALESCE(SUM(net_pay),     0) FROM payroll_run_items WHERE run_id = v_log.run_id)
        THEN 'PAID'
        ELSE 'PARTIALLY_PAID'
      END
    ),
    updated_at = NOW()
  WHERE id = v_log.run_id;

  -- Audit
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator, 'PAYROLL_PAYMENT_REVERSED', 'PAYROLL',
    jsonb_build_object(
      'log_id', p_log_id, 'amount', v_log.amount,
      'reason', p_reason, 'reversal_je', v_rev_je_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'reversal_journal_id', v_rev_je_id,
    'reversal_journal_number', v_rev_je_no
  );
END;
$$;

-- ── 6. issue_worker_loan ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_worker_loan(
  p_worker_id    UUID,
  p_amount       NUMERIC,
  p_monthly_rate NUMERIC,   -- monthly interest rate %, 0 for interest-free
  p_reason       TEXT,
  p_account_id   UUID,      -- cash or bank account to disburse from
  p_operator     TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
/*
  JE: Dr 1150 Staff Loans & Advances / Cr p_account_id (cash or bank)
  Validates account is liquid (cash or bank).
  Inserts worker_loans row; returns loan_id.
*/
DECLARE
  v_acct      RECORD;
  v_acct_1150 UUID;
  v_liq_bal   NUMERIC(18,2);
  v_je_id     UUID;
  v_je_no     TEXT;
  v_loan_id   UUID;
  v_worker    RECORD;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Loan amount must be positive.'; END IF;

  SELECT * INTO v_worker FROM workers WHERE id = p_worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker % not found.', p_worker_id; END IF;

  SELECT * INTO v_acct FROM accounts_chart WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account % not found.', p_account_id; END IF;

  IF NOT (COALESCE(v_acct.is_liquid_funds, false) OR COALESCE(v_acct.is_default_cash, false)) THEN
    RAISE EXCEPTION 'Loan must be disbursed from a cash or liquid bank account. Account % does not qualify.', v_acct.account_code;
  END IF;

  SELECT id INTO v_acct_1150 FROM accounts_chart WHERE account_code = '1150' LIMIT 1;
  IF v_acct_1150 IS NULL THEN RAISE EXCEPTION 'Account 1150 (Staff Loans) not found.'; END IF;

  -- Liquidity check
  SELECT COALESCE(SUM(jl.debit_pkr) - SUM(jl.credit_pkr), 0) INTO v_liq_bal
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id AND je.status = 'POSTED';

  IF v_liq_bal < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance in account % (available: PKR %, required: PKR %).',
      v_acct.account_name, v_liq_bal, p_amount;
  END IF;

  -- Create JE
  v_je_no := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (
    v_je_no, CURRENT_DATE,
    'Loan Issued to ' || v_worker.full_name || ' – ' || COALESCE(p_reason, 'Staff Loan'),
    'POSTED', true
  ) RETURNING id INTO v_je_id;

  -- Dr 1150 / Cr cash or bank
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, v_acct_1150, round(p_amount, 2), 0);
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, p_account_id, 0, round(p_amount, 2));

  -- Insert loan
  INSERT INTO worker_loans (
    worker_id, principal_amount, current_balance,
    monthly_interest_rate, reason, status, created_at
  ) VALUES (
    p_worker_id, round(p_amount, 2), round(p_amount, 2),
    COALESCE(p_monthly_rate, 0), p_reason, 'ACTIVE', NOW()
  ) RETURNING id INTO v_loan_id;

  -- Audit
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator, 'LOAN_ISSUED', 'PAYROLL',
    jsonb_build_object(
      'loan_id', v_loan_id, 'worker_id', p_worker_id,
      'amount', p_amount, 'je_id', v_je_id, 'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'loan_id', v_loan_id,
    'journal_entry_id', v_je_id, 'journal_entry_number', v_je_no
  );
END;
$$;

-- ── 7. record_loan_repayment ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_loan_repayment(
  p_loan_id    UUID,
  p_amount     NUMERIC,
  p_source     TEXT,       -- 'CASH' | 'BANK_TRANSFER'
  p_account_id UUID,       -- cash or bank account receiving the repayment
  p_operator   TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
/*
  JE: Dr p_account_id (cash/bank) / Cr 1150 (reduces the receivable)
  Validates amount <= current_balance.
  Inserts loan_repayment_logs row.
*/
DECLARE
  v_loan      RECORD;
  v_acct      RECORD;
  v_acct_1150 UUID;
  v_worker    RECORD;
  v_je_id     UUID;
  v_je_no     TEXT;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Repayment amount must be positive.'; END IF;

  SELECT * INTO v_loan FROM worker_loans WHERE id = p_loan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan % not found.', p_loan_id; END IF;
  IF v_loan.status = 'SETTLED' THEN RAISE EXCEPTION 'Loan % is already fully settled.', p_loan_id; END IF;

  IF round(p_amount, 2) > round(v_loan.current_balance, 2) THEN
    RAISE EXCEPTION 'Repayment amount % exceeds outstanding loan balance %.', p_amount, v_loan.current_balance;
  END IF;

  SELECT * INTO v_acct FROM accounts_chart WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account % not found.', p_account_id; END IF;

  IF NOT (COALESCE(v_acct.is_liquid_funds, false) OR COALESCE(v_acct.is_default_cash, false)) THEN
    RAISE EXCEPTION 'Repayment must come from a cash or liquid bank account. Account % does not qualify.', v_acct.account_code;
  END IF;

  SELECT id INTO v_acct_1150 FROM accounts_chart WHERE account_code = '1150' LIMIT 1;
  IF v_acct_1150 IS NULL THEN RAISE EXCEPTION 'Account 1150 (Staff Loans) not found.'; END IF;

  SELECT full_name INTO v_worker FROM workers WHERE id = v_loan.worker_id;

  -- Create JE
  v_je_no := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (
    v_je_no, CURRENT_DATE,
    'Loan Repayment from ' || COALESCE(v_worker.full_name, 'Worker') || ' via ' || p_source,
    'POSTED', true
  ) RETURNING id INTO v_je_id;

  -- Dr cash/bank / Cr 1150
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, p_account_id, round(p_amount, 2), 0);
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, v_acct_1150, 0, round(p_amount, 2));

  -- Update loan balance
  UPDATE worker_loans
  SET
    current_balance = round(current_balance - p_amount, 2),
    status = CASE WHEN round(current_balance - p_amount, 2) <= 0 THEN 'SETTLED' ELSE status END
  WHERE id = p_loan_id;

  -- Repayment log
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'loan_repayment_logs') THEN
    INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
    VALUES (p_loan_id, round(p_amount, 2), p_source, CURRENT_DATE);
  END IF;

  -- Audit
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator, 'LOAN_REPAYMENT_RECORDED', 'PAYROLL',
    jsonb_build_object(
      'loan_id', p_loan_id, 'amount', p_amount,
      'source', p_source, 'je_id', v_je_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_no,
    'new_balance', round(v_loan.current_balance - p_amount, 2)
  );
END;
$$;

-- ── 8. Security hardening ─────────────────────────────────────────────────────

-- Drop write-permissive policies introduced in the first migration
DROP POLICY IF EXISTS "allow_draft_items_write" ON payroll_run_items;
DROP POLICY IF EXISTS "allow_draft_lines_write"  ON payroll_run_item_lines;
DROP POLICY IF EXISTS "allow_draft_runs_write"   ON payroll_runs_v2;

-- Revoke direct DML from anon + authenticated on all payroll write tables
REVOKE INSERT, UPDATE, DELETE ON payroll_periods        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON payroll_runs_v2        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON payroll_run_items      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON payroll_run_item_lines FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON payroll_payment_logs   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON payroll_loan_recoveries FROM anon, authenticated;

-- GRANT EXECUTE on all new and replaced RPCs
GRANT EXECUTE ON FUNCTION public.create_payroll_run(UUID, worker_cost_class_enum, JSONB, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.post_payroll_run(UUID, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reverse_payroll_run(UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.pay_payroll_items(UUID, UUID[], TEXT, UUID, DATE, TEXT, BOOLEAN, JSONB)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reverse_payroll_payment(UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.issue_worker_loan(UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_loan_repayment(UUID, NUMERIC, TEXT, UUID, TEXT)
  TO anon, authenticated, service_role;

-- READ grant for the new table
GRANT SELECT ON payroll_loan_recoveries TO anon, authenticated, service_role;

