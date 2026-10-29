-- ============================================================================
-- MIGRATION: 20261118020000_payroll_heads_cash_bank_and_cost_structure.sql
-- Part 8: Payroll heads, cash/bank and cost structure
-- ============================================================================

-- ── 1. Create Expense Account 5012: Admin Wages Expense (OPEX) ───────────────
INSERT INTO accounts_chart (account_code, account_name, account_type, report_group, is_default_cash, is_liquid_funds)
VALUES ('5012', 'Admin Wages Expense', 'EXPENSE', 'OPEX', false, false)
ON CONFLICT (account_code) DO UPDATE
SET
  account_name = EXCLUDED.account_name,
  account_type = EXCLUDED.account_type,
  report_group = 'OPEX';

-- ── 2. Create payroll_expense_map Table & Seed 4 Rows ────────────────────────
CREATE TABLE IF NOT EXISTS payroll_expense_map (
  cost_class TEXT NOT NULL CHECK (cost_class IN ('PRODUCTION', 'ADMIN')),
  wage_group TEXT NOT NULL CHECK (wage_group IN ('SALARY', 'WAGE')),
  account_id UUID NOT NULL REFERENCES accounts_chart(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_expense_map UNIQUE (cost_class, wage_group)
);

-- Seed mapping rows
DO $$
DECLARE
  v_5011 UUID;
  v_5010 UUID;
  v_5002 UUID;
  v_5012 UUID;
BEGIN
  SELECT id INTO v_5011 FROM accounts_chart WHERE account_code = '5011' LIMIT 1;
  SELECT id INTO v_5010 FROM accounts_chart WHERE account_code = '5010' LIMIT 1;
  SELECT id INTO v_5002 FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
  SELECT id INTO v_5012 FROM accounts_chart WHERE account_code = '5012' LIMIT 1;

  IF v_5011 IS NOT NULL THEN
    INSERT INTO payroll_expense_map (cost_class, wage_group, account_id)
    VALUES ('PRODUCTION', 'SALARY', v_5011)
    ON CONFLICT (cost_class, wage_group) DO UPDATE SET account_id = EXCLUDED.account_id;
  END IF;

  IF v_5010 IS NOT NULL THEN
    INSERT INTO payroll_expense_map (cost_class, wage_group, account_id)
    VALUES ('PRODUCTION', 'WAGE', v_5010)
    ON CONFLICT (cost_class, wage_group) DO UPDATE SET account_id = EXCLUDED.account_id;
  END IF;

  IF v_5002 IS NOT NULL THEN
    INSERT INTO payroll_expense_map (cost_class, wage_group, account_id)
    VALUES ('ADMIN', 'SALARY', v_5002)
    ON CONFLICT (cost_class, wage_group) DO UPDATE SET account_id = EXCLUDED.account_id;
  END IF;

  IF v_5012 IS NOT NULL THEN
    INSERT INTO payroll_expense_map (cost_class, wage_group, account_id)
    VALUES ('ADMIN', 'WAGE', v_5012)
    ON CONFLICT (cost_class, wage_group) DO UPDATE SET account_id = EXCLUDED.account_id;
  END IF;
END $$;

ALTER TABLE payroll_expense_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_expense_map" ON payroll_expense_map;
CREATE POLICY "allow_read_expense_map" ON payroll_expense_map FOR SELECT USING (true);

-- ── 3. Add reference_no and overdraft_reason to payroll_payment_logs ────────
ALTER TABLE payroll_payment_logs ADD COLUMN IF NOT EXISTS reference_no TEXT;
ALTER TABLE payroll_payment_logs ADD COLUMN IF NOT EXISTS overdraft_reason TEXT;

-- ── 4. Update post_payroll_run to Read payroll_expense_map ──────────────────
CREATE OR REPLACE FUNCTION public.post_payroll_run(
  p_run_id UUID,
  p_operator_name TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_period RECORD;
  v_je_id UUID;
  v_je_number TEXT;
  v_narration TEXT;

  v_acct_wages_payable UUID;
  v_acct_loan_recv UUID;

  v_tot_prod_salary NUMERIC(18, 2) := 0;
  v_tot_prod_wages NUMERIC(18, 2) := 0;
  v_tot_admin_salary NUMERIC(18, 2) := 0;
  v_tot_admin_wages NUMERIC(18, 2) := 0;
  v_tot_loan_recovery NUMERIC(18, 2) := 0;
  v_tot_other_deductions NUMERIC(18, 2) := 0;
  v_tot_net_pay NUMERIC(18, 2) := 0;

  v_acct_prod_salary UUID;
  v_acct_prod_wages UUID;
  v_acct_admin_salary UUID;
  v_acct_admin_wages UUID;

  v_line RECORD;
  v_loan_item RECORD;
BEGIN
  -- 1. Fetch & Validate Run
  SELECT * INTO v_run FROM payroll_runs_v2 WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run % not found.', p_run_id;
  END IF;

  IF v_run.status NOT IN ('SIMULATED', 'APPROVED') THEN
    RAISE EXCEPTION 'Cannot post payroll run % with status %. Must be SIMULATED or APPROVED.', v_run.run_no, v_run.status;
  END IF;

  SELECT * INTO v_period FROM payroll_periods WHERE id = v_run.period_id;
  IF v_period.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Cannot post to CLOSED period %.', v_period.period_code;
  END IF;

  -- 2. Resolve Accounts from payroll_expense_map
  SELECT account_id INTO v_acct_prod_salary FROM payroll_expense_map WHERE cost_class = 'PRODUCTION' AND wage_group = 'SALARY';
  SELECT account_id INTO v_acct_prod_wages FROM payroll_expense_map WHERE cost_class = 'PRODUCTION' AND wage_group = 'WAGE';
  SELECT account_id INTO v_acct_admin_salary FROM payroll_expense_map WHERE cost_class = 'ADMIN' AND wage_group = 'SALARY';
  SELECT account_id INTO v_acct_admin_wages FROM payroll_expense_map WHERE cost_class = 'ADMIN' AND wage_group = 'WAGE';

  -- Fallbacks to accounts_chart codes if map is incomplete
  IF v_acct_prod_salary IS NULL THEN SELECT id INTO v_acct_prod_salary FROM accounts_chart WHERE account_code = '5011' LIMIT 1; END IF;
  IF v_acct_prod_wages IS NULL THEN SELECT id INTO v_acct_prod_wages FROM accounts_chart WHERE account_code = '5010' LIMIT 1; END IF;
  IF v_acct_admin_salary IS NULL THEN SELECT id INTO v_acct_admin_salary FROM accounts_chart WHERE account_code = '5002' LIMIT 1; END IF;
  IF v_acct_admin_wages IS NULL THEN SELECT id INTO v_acct_admin_wages FROM accounts_chart WHERE account_code = '5012' LIMIT 1; END IF;

  -- Fallback 5012 to 5002 if 5012 still missing
  IF v_acct_admin_wages IS NULL THEN v_acct_admin_wages := v_acct_admin_salary; END IF;

  SELECT id INTO v_acct_wages_payable FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  SELECT id INTO v_acct_loan_recv FROM accounts_chart WHERE account_code = '1150' LIMIT 1;

  IF v_acct_wages_payable IS NULL THEN
    RAISE EXCEPTION 'Account 2300 (Wages & Salaries Payable) is required but missing.';
  END IF;
  IF v_acct_loan_recv IS NULL THEN
    SELECT id INTO v_acct_loan_recv FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
  END IF;

  -- 3. Calculate Totals from lines
  -- wage_group: PERMANENT_SALARY -> SALARY; DAILY_PAY / PART_TIME_WAGE -> WAGE.
  -- Overtime follows worker's group.
  FOR v_line IN
    SELECT
      i.cost_class,
      CASE
        WHEN i.employment_type = 'PERMANENT_SALARY' THEN 'SALARY'
        ELSE 'WAGE'
      END AS wage_group,
      l.category,
      l.wage_type_code,
      SUM(l.amount) AS line_sum
    FROM payroll_run_item_lines l
    JOIN payroll_run_items i ON i.id = l.item_id
    WHERE i.run_id = p_run_id
    GROUP BY i.cost_class,
      CASE
        WHEN i.employment_type = 'PERMANENT_SALARY' THEN 'SALARY'
        ELSE 'WAGE'
      END,
      l.category, l.wage_type_code
  LOOP
    IF v_line.category = 'EARNING' THEN
      IF v_line.cost_class = 'PRODUCTION' THEN
        IF v_line.wage_group = 'SALARY' THEN
          v_tot_prod_salary := v_tot_prod_salary + v_line.line_sum;
        ELSE
          v_tot_prod_wages := v_tot_prod_wages + v_line.line_sum;
        END IF;
      ELSE -- ADMIN
        IF v_line.wage_group = 'SALARY' THEN
          v_tot_admin_salary := v_tot_admin_salary + v_line.line_sum;
        ELSE
          v_tot_admin_wages := v_tot_admin_wages + v_line.line_sum;
        END IF;
      END IF;
    ELSIF v_line.category = 'DEDUCTION' THEN
      IF v_line.wage_type_code IN ('LOAN_RECOVERY', 'ADVANCE_RECOVERY') THEN
        v_tot_loan_recovery := v_tot_loan_recovery + v_line.line_sum;
      ELSE
        v_tot_other_deductions := v_tot_other_deductions + v_line.line_sum;
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(net_pay), 0) INTO v_tot_net_pay
  FROM payroll_run_items
  WHERE run_id = p_run_id;

  -- Verify mathematical balance: Total Earnings = Net Pay + Deductions
  IF (v_tot_prod_salary + v_tot_prod_wages + v_tot_admin_salary + v_tot_admin_wages) <>
     (v_tot_net_pay + v_tot_loan_recovery + v_tot_other_deductions) THEN
    RAISE EXCEPTION 'Payroll math balance check failed: Earnings (%) <> Net (%) + Deductions (%).',
      (v_tot_prod_salary + v_tot_prod_wages + v_tot_admin_salary + v_tot_admin_wages),
      v_tot_net_pay,
      (v_tot_loan_recovery + v_tot_other_deductions);
  END IF;

  -- 4. Create Journal Entry
  v_je_number := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');
  v_narration := 'Payroll Accrual ' || v_run.run_no || ' [' || v_period.period_code || ']';

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (v_je_number, CURRENT_DATE, v_narration, 'POSTED', true)
  RETURNING id INTO v_je_id;

  -- 5. Insert Balanced Journal Lines
  -- Debits (Expenses)
  -- 5011: Production Salaries
  IF v_tot_prod_salary > 0 AND v_acct_prod_salary IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_prod_salary, v_tot_prod_salary, 0);
  END IF;

  -- 5010: Production Wages
  IF v_tot_prod_wages > 0 AND v_acct_prod_wages IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_prod_wages, v_tot_prod_wages, 0);
  END IF;

  -- 5002: Admin Salaries
  IF v_tot_admin_salary > 0 AND v_acct_admin_salary IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_admin_salary, v_tot_admin_salary, 0);
  END IF;

  -- 5012: Admin Wages
  IF v_tot_admin_wages > 0 AND v_acct_admin_wages IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_admin_wages, v_tot_admin_wages, 0);
  END IF;

  -- Credits (Payables & Recoveries)
  IF v_tot_net_pay > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_wages_payable, 0, v_tot_net_pay);
  END IF;

  IF v_tot_loan_recovery > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_loan_recv, 0, v_tot_loan_recovery);
  END IF;

  IF v_tot_other_deductions > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_wages_payable, 0, v_tot_other_deductions);
  END IF;

  -- 6. Apply Loan Deductions to worker_loans & log repayment
  FOR v_loan_item IN
    SELECT i.worker_id, l.amount AS ded_amount
    FROM payroll_run_item_lines l
    JOIN payroll_run_items i ON i.id = l.item_id
    WHERE i.run_id = p_run_id AND l.wage_type_code IN ('LOAN_RECOVERY', 'ADVANCE_RECOVERY') AND l.amount > 0
  LOOP
    UPDATE worker_loans
    SET current_balance = GREATEST(0, current_balance - v_loan_item.ded_amount)
    WHERE worker_id = v_loan_item.worker_id AND current_balance > 0;
  END LOOP;

  -- 7. Update Run Status
  UPDATE payroll_runs_v2
  SET
    status = 'POSTED',
    journal_entry_id = v_je_id,
    updated_at = NOW()
  WHERE id = p_run_id;

  -- 8. Audit Log
  INSERT INTO system_audit_logs (action, module, details)
  VALUES (
    'PAYROLL_ACCRUAL_POSTED',
    'PAYROLL',
    jsonb_build_object(
      'run_no', v_run.run_no,
      'period_code', v_period.period_code,
      'journal_entry_id', v_je_id,
      'journal_entry_number', v_je_number,
      'prod_salary', v_tot_prod_salary,
      'prod_wages', v_tot_prod_wages,
      'admin_salary', v_tot_admin_salary,
      'admin_wages', v_tot_admin_wages,
      'net_payable', v_tot_net_pay,
      'operator_name', p_operator_name
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number
  );
END;
$$;

-- ── 5. Update pay_payroll_items with Validation, Reference & Overdraft Override ─
CREATE OR REPLACE FUNCTION public.pay_payroll_items(
  p_run_id UUID,
  p_item_ids UUID[],
  p_payment_method TEXT,
  p_account_id UUID,
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_operator_name TEXT DEFAULT 'System Operator',
  p_allow_overdraft BOOLEAN DEFAULT false,
  p_reference_no TEXT DEFAULT NULL,
  p_overdraft_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_item RECORD;
  v_acct_payable UUID;
  v_pay_acct RECORD;
  v_total_pay NUMERIC(18, 2) := 0;
  v_current_liquid_bal NUMERIC(18, 2) := 0;
  v_caller_role TEXT;
  v_je_id UUID;
  v_je_number TEXT;
  v_narration TEXT;
  v_batch_no TEXT;
  v_item_count INT := 0;
BEGIN
  -- 1. Validate Payment Method
  IF p_payment_method NOT IN ('CASH', 'BANK') THEN
    RAISE EXCEPTION 'Invalid payment method: %. Must be CASH or BANK.', p_payment_method;
  END IF;

  -- 2. Validate reference_no for BANK
  IF p_payment_method = 'BANK' AND (p_reference_no IS NULL OR trim(p_reference_no) = '') THEN
    RAISE EXCEPTION 'reference_no is required when payment method is BANK.';
  END IF;

  -- 3. Validate Run
  SELECT * INTO v_run FROM payroll_runs_v2 WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run % not found.', p_run_id;
  END IF;

  IF v_run.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payroll run % is in status %. Must be POSTED before payment.', v_run.run_no, v_run.status;
  END IF;

  -- 4. Validate Accounts & Method/Account Matching
  SELECT id INTO v_acct_payable FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  IF v_acct_payable IS NULL THEN
    RAISE EXCEPTION 'Account 2300 (Wages Payable) is missing.';
  END IF;

  SELECT * INTO v_pay_acct FROM accounts_chart WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment account % not found.', p_account_id;
  END IF;

  -- Ensure liquid
  IF NOT (COALESCE(v_pay_acct.is_liquid_funds, false) OR COALESCE(v_pay_acct.is_default_cash, false) OR v_pay_acct.account_code IN ('1000', '1002')) THEN
    RAISE EXCEPTION 'Selected payment account % is not a liquid cash/bank account.', v_pay_acct.account_code;
  END IF;

  -- Check method vs account: CASH must use cash (1000 or is_default_cash); BANK must use bank (1002 or non-cash liquid)
  IF p_payment_method = 'CASH' THEN
    IF NOT (COALESCE(v_pay_acct.is_default_cash, false) OR v_pay_acct.account_code = '1000' OR lower(v_pay_acct.account_name) LIKE '%cash%') THEN
      RAISE EXCEPTION 'Payment method is CASH but selected account % is not a cash account.', v_pay_acct.account_code;
    END IF;
  ELSIF p_payment_method = 'BANK' THEN
    IF (COALESCE(v_pay_acct.is_default_cash, false) OR v_pay_acct.account_code = '1000' OR lower(v_pay_acct.account_name) LIKE '%cash in hand%') THEN
      RAISE EXCEPTION 'Payment method is BANK but selected account % is a cash account.', v_pay_acct.account_code;
    END IF;
  END IF;

  -- 5. Calculate Payment Sum for the chosen items
  SELECT COALESCE(SUM(net_pay - amount_paid), 0), COUNT(*)
  INTO v_total_pay, v_item_count
  FROM payroll_run_items
  WHERE run_id = p_run_id
    AND id = ANY(p_item_ids)
    AND (net_pay - amount_paid) > 0;

  IF v_total_pay <= 0 THEN
    RAISE EXCEPTION 'No pending payable balance found for selected items.';
  END IF;

  -- 6. Liquidity Balance Check
  SELECT COALESCE(SUM(jl.debit_pkr) - SUM(jl.credit_pkr), 0) INTO v_current_liquid_bal
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id AND je.status = 'POSTED';

  IF (v_current_liquid_bal - v_total_pay) < 0 THEN
    IF NOT p_allow_overdraft THEN
      RAISE EXCEPTION 'Insufficient liquid balance in account % (Available: PKR %, Required: PKR %).',
        v_pay_acct.account_name, v_current_liquid_bal, v_total_pay;
    ELSE
      -- Only OWNER may override
      SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
      -- If auth.uid() is not set (e.g. tests running under service_role or superuser), allow if reason is provided
      IF auth.uid() IS NOT NULL AND (v_caller_role IS NULL OR v_caller_role <> 'OWNER') THEN
        RAISE EXCEPTION 'Only an OWNER can override insufficient funds.';
      END IF;
      IF p_overdraft_reason IS NULL OR trim(p_overdraft_reason) = '' THEN
        RAISE EXCEPTION 'Written overdraft reason is required to override negative balance.';
      END IF;
    END IF;
  END IF;

  -- 7. Post Payment Journal Entry
  v_batch_no := 'DISB-' || to_char(p_payment_date, 'YYYYMMDD') || '-' || lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');
  v_je_number := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');
  v_narration := 'Payroll Disbursement ' || v_batch_no || ' (' || v_item_count || ' staff) Run: ' || v_run.run_no;
  IF p_reference_no IS NOT NULL AND trim(p_reference_no) <> '' THEN
    v_narration := v_narration || ' Ref: ' || trim(p_reference_no);
  END IF;

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (v_je_number, p_payment_date, v_narration, 'POSTED', true)
  RETURNING id INTO v_je_id;

  -- Dr 2300 Wages Payable / Cr Cash/Bank
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, v_acct_payable, v_total_pay, 0);

  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, p_account_id, 0, v_total_pay);

  -- 8. Update Items & Insert Payment Logs
  FOR v_item IN
    SELECT id, worker_name, (net_pay - amount_paid) AS pending
    FROM payroll_run_items
    WHERE run_id = p_run_id AND id = ANY(p_item_ids) AND (net_pay - amount_paid) > 0
  LOOP
    UPDATE payroll_run_items
    SET
      amount_paid = net_pay,
      status = 'PAID'
    WHERE id = v_item.id;

    INSERT INTO payroll_payment_logs (
      run_id, item_id, amount, payment_method, payment_account_id,
      journal_entry_id, payment_date, disbursement_batch_no, operator_name,
      reference_no, overdraft_reason
    ) VALUES (
      p_run_id, v_item.id, v_item.pending, p_payment_method, p_account_id,
      v_je_id, p_payment_date, v_batch_no, p_operator_name,
      p_reference_no, p_overdraft_reason
    );
  END LOOP;

  -- 9. Update Run Status & Amount Paid
  UPDATE payroll_runs_v2
  SET
    amount_paid = amount_paid + v_total_pay,
    status = CASE
      WHEN (amount_paid + v_total_pay) >= net_payable THEN 'PAID'
      ELSE 'PARTIALLY_PAID'
    END,
    updated_at = NOW()
  WHERE id = p_run_id;

  -- 10. Audit Log
  INSERT INTO system_audit_logs (action, module, details)
  VALUES (
    'PAYROLL_DISBURSEMENT_POSTED',
    'PAYROLL',
    jsonb_build_object(
      'run_no', v_run.run_no,
      'disbursement_batch_no', v_batch_no,
      'amount_disbursed', v_total_pay,
      'account_code', v_pay_acct.account_code,
      'journal_entry_id', v_je_id,
      'reference_no', p_reference_no,
      'overdraft_override', p_allow_overdraft,
      'overdraft_reason', p_overdraft_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_no', v_batch_no,
    'amount_paid', v_total_pay,
    'journal_entry_id', v_je_id
  );
END;
$$;

-- ── 6. Create post_and_pay_payroll_run RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_and_pay_payroll_run(
  p_run_id UUID,
  p_payment_method TEXT,
  p_account_id UUID,
  p_reference_no TEXT DEFAULT NULL,
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_operator_name TEXT DEFAULT 'System Operator',
  p_allow_overdraft BOOLEAN DEFAULT false,
  p_overdraft_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_res JSONB;
  v_item_ids UUID[];
  v_pay_res JSONB;
BEGIN
  -- 1. Post the accrual
  v_post_res := public.post_payroll_run(p_run_id, p_operator_name);
  IF NOT COALESCE((v_post_res->>'success')::boolean, false) THEN
    RETURN v_post_res;
  END IF;

  -- 2. Fetch all item IDs belonging to this run
  SELECT array_agg(id) INTO v_item_ids
  FROM payroll_run_items
  WHERE run_id = p_run_id AND (net_pay - amount_paid) > 0;

  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Payroll posted; no payable items to disburse.',
      'post_result', v_post_res
    );
  END IF;

  -- 3. Execute disbursement
  v_pay_res := public.pay_payroll_items(
    p_run_id,
    v_item_ids,
    p_payment_method,
    p_account_id,
    p_payment_date,
    p_operator_name,
    p_allow_overdraft,
    p_reference_no,
    p_overdraft_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'post_result', v_post_res,
    'pay_result', v_pay_res
  );
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.post_payroll_run(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pay_payroll_items(UUID, UUID[], TEXT, UUID, DATE, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_and_pay_payroll_run(UUID, TEXT, UUID, TEXT, DATE, TEXT, BOOLEAN, TEXT) TO authenticated, service_role;

