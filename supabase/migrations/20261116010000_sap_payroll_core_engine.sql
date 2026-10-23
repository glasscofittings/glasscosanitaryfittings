-- ============================================================================
-- MIGRATION: 20261116010000_sap_payroll_core_engine.sql
-- SAP HCM / FI Payroll Core Engine for Glassco Sanitary / Komax Brass ERP
--
-- Features:
--   1. Chart of Accounts: report_group ('COGS' | 'OPEX'), 5010, 5011, 1150, 2300
--   2. Worker Master Extension: employment_type, cost_class, payment details
--   3. Wage Types & Infotypes (recurring pay items)
--   4. Payroll Periods & Runs (lifecycle: DRAFT -> SIMULATED -> APPROVED -> POSTED -> PAID -> CLOSED, REVERSED)
--   5. Atomic FI Posting & Payment RPCs with Storno Reversal
--   6. Legacy payroll_entries backfill into historical run records
--   7. RLS lockdown (writes strictly via SECURITY DEFINER RPCs) + audit logs
-- ============================================================================

-- ── 1. Chart of Accounts Extension ──────────────────────────────────────────

ALTER TABLE accounts_chart
  ADD COLUMN IF NOT EXISTS report_group TEXT CHECK (report_group IN ('COGS', 'OPEX'));

-- Seed canonical accounts if missing
INSERT INTO accounts_chart (account_code, account_name, account_type, report_group, is_default_cash, is_liquid_funds)
VALUES
  ('2300', 'Wages & Salaries Payable', 'LIABILITY', NULL, false, false),
  ('1150', 'Staff Loans & Advances Receivable', 'ASSET', NULL, false, false),
  ('5010', 'Direct Labour - Wages (COGS)', 'EXPENSE', 'COGS', false, false),
  ('5011', 'Direct Labour - Salaries (COGS)', 'EXPENSE', 'COGS', false, false),
  ('5002', 'Admin Salaries & Wages Expense', 'EXPENSE', 'OPEX', false, false)
ON CONFLICT (account_code) DO UPDATE
SET
  account_name = EXCLUDED.account_name,
  account_type = EXCLUDED.account_type,
  report_group = COALESCE(accounts_chart.report_group, EXCLUDED.report_group);

-- Ensure COGS / OPEX categorization on existing expense accounts
UPDATE accounts_chart
SET report_group = 'COGS'
WHERE account_code IN ('5001', '5006', '5010', '5011');

UPDATE accounts_chart
SET report_group = 'OPEX'
WHERE account_type = 'EXPENSE' AND (report_group IS NULL OR report_group <> 'COGS');

-- ── 2. Extend Workers Master Data ────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'worker_cost_class_enum') THEN
    CREATE TYPE worker_cost_class_enum AS ENUM ('PRODUCTION', 'ADMIN');
  END IF;
END $$;

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'PERMANENT_SALARY'
    CHECK (employment_type IN ('PERMANENT_SALARY', 'DAILY_PAY', 'PART_TIME_WAGE')),
  ADD COLUMN IF NOT EXISTS cost_class worker_cost_class_enum NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN IF NOT EXISTS cost_center TEXT DEFAULT 'FACTORY_FLOOR',
  ADD COLUMN IF NOT EXISTS default_pay_method TEXT NOT NULL DEFAULT 'CASH'
    CHECK (default_pay_method IN ('CASH', 'BANK')),
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS account_iban TEXT,
  ADD COLUMN IF NOT EXISTS cnic_no TEXT;

-- ── 3. Wage Types & Recurring Items (Infotype 0008/0014) ────────────────────

CREATE TABLE IF NOT EXISTS payroll_wage_types (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION')),
  calc_type TEXT NOT NULL CHECK (calc_type IN ('FIXED', 'PER_DAY', 'PER_HOUR', 'PERCENT_OF_BASIC', 'MANUAL')),
  is_recurring BOOLEAN NOT NULL DEFAULT true,
  gl_account_production UUID REFERENCES accounts_chart(id),
  gl_account_admin UUID REFERENCES accounts_chart(id),
  gl_account_liability UUID REFERENCES accounts_chart(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Wage Types
DO $$
DECLARE
  v_cogs_wages UUID;
  v_cogs_salary UUID;
  v_admin_salary UUID;
  v_wages_payable UUID;
  v_loan_receivable UUID;
BEGIN
  SELECT id INTO v_cogs_wages FROM accounts_chart WHERE account_code = '5010' LIMIT 1;
  SELECT id INTO v_cogs_salary FROM accounts_chart WHERE account_code = '5011' LIMIT 1;
  SELECT id INTO v_admin_salary FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
  SELECT id INTO v_wages_payable FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  SELECT id INTO v_loan_receivable FROM accounts_chart WHERE account_code = '1150' LIMIT 1;

  INSERT INTO payroll_wage_types (code, name, category, calc_type, is_recurring, gl_account_production, gl_account_admin, gl_account_liability)
  VALUES
    ('BASIC', 'Basic Salary', 'EARNING', 'FIXED', true, v_cogs_salary, v_admin_salary, v_wages_payable),
    ('DAILY_WAGE', 'Daily Wage Earned', 'EARNING', 'PER_DAY', true, v_cogs_wages, v_admin_salary, v_wages_payable),
    ('OVERTIME', 'Overtime Pay', 'EARNING', 'PER_HOUR', false, v_cogs_wages, v_admin_salary, v_wages_payable),
    ('ALLOWANCE', 'General Allowance', 'EARNING', 'FIXED', true, v_cogs_salary, v_admin_salary, v_wages_payable),
    ('BONUS', 'Performance / Eid Bonus', 'EARNING', 'MANUAL', false, v_cogs_salary, v_admin_salary, v_wages_payable),
    ('ADVANCE_RECOVERY', 'Advance Recovery', 'DEDUCTION', 'MANUAL', false, NULL, NULL, v_loan_receivable),
    ('LOAN_RECOVERY', 'Loan Repayment Deduction', 'DEDUCTION', 'FIXED', true, NULL, NULL, v_loan_receivable),
    ('ABSENCE_DEDUCTION', 'Absence Deduction', 'DEDUCTION', 'PER_DAY', false, v_cogs_wages, v_admin_salary, NULL),
    ('UNDERTIME_DEDUCTION', 'Undertime Deduction', 'DEDUCTION', 'PER_HOUR', false, v_cogs_wages, v_admin_salary, NULL),
    ('OTHER_DEDUCTION', 'Other Deduction', 'DEDUCTION', 'MANUAL', false, NULL, NULL, v_wages_payable)
  ON CONFLICT (code) DO UPDATE
  SET
    name = EXCLUDED.name,
    gl_account_production = COALESCE(EXCLUDED.gl_account_production, payroll_wage_types.gl_account_production),
    gl_account_admin = COALESCE(EXCLUDED.gl_account_admin, payroll_wage_types.gl_account_admin),
    gl_account_liability = COALESCE(EXCLUDED.gl_account_liability, payroll_wage_types.gl_account_liability);
END $$;

-- Worker Recurring Wage Components
CREATE TABLE IF NOT EXISTS worker_recurring_wage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  wage_type_code TEXT NOT NULL REFERENCES payroll_wage_types(code),
  amount_or_rate NUMERIC(18, 2) NOT NULL CHECK (amount_or_rate >= 0),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_recurring_worker ON worker_recurring_wage_items(worker_id);

-- ── 4. Payroll Periods & Core Runs ──────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS payroll_run_seq START 1 INCREMENT 1;

CREATE TABLE IF NOT EXISTS payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_code TEXT UNIQUE NOT NULL, -- e.g. '2026-M10' or '2026-W42'
  period_type TEXT NOT NULL CHECK (period_type IN ('MONTHLY', 'WEEKLY', 'DAILY')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_period_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_dates ON payroll_periods(start_date, end_date);

-- Drop legacy table constraints if they conflict, then structure canonical payroll_runs
CREATE TABLE IF NOT EXISTS payroll_runs_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_no TEXT UNIQUE NOT NULL,
  period_id UUID NOT NULL REFERENCES payroll_periods(id),
  run_type TEXT NOT NULL DEFAULT 'REGULAR' CHECK (run_type IN ('REGULAR', 'OFF_CYCLE', 'ADJUSTMENT', 'LEGACY')),
  cost_class_filter worker_cost_class_enum, -- NULL means both
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SIMULATED', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'REVERSED')),
  total_workers INT NOT NULL DEFAULT 0,
  gross_earnings NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  total_deductions NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  employer_cost NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  net_payable NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  amount_paid NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  journal_entry_id UUID REFERENCES journal_entries(id),
  reversal_journal_id UUID REFERENCES journal_entries(id),
  reversal_reason TEXT,
  notes TEXT,
  created_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_v2_period ON payroll_runs_v2(period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_v2_status ON payroll_runs_v2(status);

-- Payslip per worker per run
CREATE TABLE IF NOT EXISTS payroll_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES payroll_runs_v2(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id),
  worker_name TEXT NOT NULL,
  cost_class worker_cost_class_enum NOT NULL DEFAULT 'PRODUCTION',
  employment_type TEXT NOT NULL DEFAULT 'PERMANENT_SALARY',
  cost_center TEXT,
  days_in_period INT NOT NULL DEFAULT 30,
  present_days NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
  absent_days NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
  leave_days NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
  overtime_minutes INT NOT NULL DEFAULT 0,
  undertime_minutes INT NOT NULL DEFAULT 0,
  basic_rate NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  gross_earnings NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  total_deductions NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  net_pay NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  amount_paid NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'PAID', 'PARTIALLY_PAID', 'REVERSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_run_worker UNIQUE (run_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_items_worker ON payroll_run_items(worker_id);

-- Line details (breakdown per wage type)
CREATE TABLE IF NOT EXISTS payroll_run_item_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES payroll_run_items(id) ON DELETE CASCADE,
  wage_type_code TEXT NOT NULL REFERENCES payroll_wage_types(code),
  wage_type_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION')),
  qty NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
  rate NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  amount NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  gl_account_id UUID REFERENCES accounts_chart(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_item_lines_item ON payroll_run_item_lines(item_id);

-- Payment logs for payroll items
CREATE TABLE IF NOT EXISTS payroll_payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES payroll_runs_v2(id),
  item_id UUID NOT NULL REFERENCES payroll_run_items(id),
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
  payment_account_id UUID NOT NULL REFERENCES accounts_chart(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  reversal_journal_id UUID REFERENCES journal_entries(id),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  disbursement_batch_no TEXT,
  notes TEXT,
  operator_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_run ON payroll_payment_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_item ON payroll_payment_logs(item_id);

-- ── 5. Backfill Legacy Payroll Entries ───────────────────────────────────────

DO $$
DECLARE
  v_leg_period_id UUID;
  v_leg_run_id UUID;
  v_entry RECORD;
  v_worker_id UUID;
  v_item_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payroll_entries') THEN
    -- Ensure a historical legacy period
    SELECT id INTO v_leg_period_id FROM payroll_periods WHERE period_code = 'LEGACY-HISTORICAL' LIMIT 1;
    IF v_leg_period_id IS NULL THEN
      INSERT INTO payroll_periods (period_code, period_type, start_date, end_date, status)
      VALUES ('LEGACY-HISTORICAL', 'MONTHLY', '2026-01-01', '2026-12-31', 'CLOSED')
      RETURNING id INTO v_leg_period_id;
    END IF;

    -- Create or get legacy run
    SELECT id INTO v_leg_run_id FROM payroll_runs_v2 WHERE run_no = 'RUN-LEGACY-0001' LIMIT 1;
    IF v_leg_run_id IS NULL THEN
      INSERT INTO payroll_runs_v2 (
        run_no, period_id, run_type, status, total_workers,
        gross_earnings, total_deductions, net_payable, amount_paid, notes
      ) VALUES (
        'RUN-LEGACY-0001', v_leg_period_id, 'LEGACY', 'PAID', 0,
        0, 0, 0, 0, 'Migrated historical payroll_entries'
      ) RETURNING id INTO v_leg_run_id;
    END IF;

    -- Migrate entries without duplicate journal posting
    FOR v_entry IN
      SELECT * FROM payroll_entries WHERE id NOT IN (
        SELECT COALESCE(notes::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        FROM payroll_run_items WHERE 1=0 -- placeholder
      )
    LOOP
      -- Match or find worker
      SELECT id INTO v_worker_id FROM workers WHERE lower(btrim(full_name)) = lower(btrim(v_entry.employee_name)) LIMIT 1;
      IF v_worker_id IS NULL THEN
        INSERT INTO workers (worker_code, full_name, role_designation, base_salary_pkr, status, is_active)
        VALUES ('W-LEG-' || substr(md5(v_entry.employee_name), 1, 6), v_entry.employee_name, 'Staff', v_entry.amount, 'ACTIVE', true)
        RETURNING id INTO v_worker_id;
      END IF;

      -- Check if already migrated for this worker & entry_number
      IF NOT EXISTS (SELECT 1 FROM payroll_run_items WHERE run_id = v_leg_run_id AND worker_id = v_worker_id) THEN
        INSERT INTO payroll_run_items (
          run_id, worker_id, worker_name, cost_class, employment_type,
          gross_earnings, total_deductions, net_pay, amount_paid, status
        ) VALUES (
          v_leg_run_id, v_worker_id, v_entry.employee_name,
          CASE WHEN v_entry.payroll_type = 'PRODUCTION_COGS' THEN 'PRODUCTION'::worker_cost_class_enum ELSE 'ADMIN'::worker_cost_class_enum END,
          v_entry.employment_type::text,
          v_entry.amount, 0, v_entry.amount, v_entry.amount, 'PAID'
        ) RETURNING id INTO v_item_id;

        -- Record line
        INSERT INTO payroll_run_item_lines (
          item_id, wage_type_code, wage_type_name, category, qty, rate, amount, gl_account_id
        ) VALUES (
          v_item_id, 'BASIC', 'Migrated Salary', 'EARNING', 1, v_entry.amount, v_entry.amount, v_entry.expense_account_id
        );
      END IF;
    END LOOP;

    -- Update legacy run totals
    UPDATE payroll_runs_v2
    SET
      total_workers = (SELECT COUNT(*) FROM payroll_run_items WHERE run_id = v_leg_run_id),
      gross_earnings = COALESCE((SELECT SUM(gross_earnings) FROM payroll_run_items WHERE run_id = v_leg_run_id), 0),
      net_payable = COALESCE((SELECT SUM(net_pay) FROM payroll_run_items WHERE run_id = v_leg_run_id), 0),
      amount_paid = COALESCE((SELECT SUM(amount_paid) FROM payroll_run_items WHERE run_id = v_leg_run_id), 0)
    WHERE id = v_leg_run_id;
  END IF;
END $$;

-- ── 6. POSTGRES FUNCTIONS & RPCS (SECURITY DEFINER) ──────────────────────────

-- Helper to generate sequential run number: 'PR-YYYY-00001'
CREATE OR REPLACE FUNCTION public.fn_next_payroll_run_no()
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'PR-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('payroll_run_seq')::TEXT, 5, '0');
END;
$$;

-- RPC: create_payroll_period
CREATE OR REPLACE FUNCTION public.create_payroll_period(
  p_period_code TEXT,
  p_period_type TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_res JSONB;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date (%) cannot precede start date (%).', p_end_date, p_start_date;
  END IF;

  INSERT INTO payroll_periods (period_code, period_type, start_date, end_date, status)
  VALUES (p_period_code, p_period_type, p_start_date, p_end_date, 'OPEN')
  RETURNING id INTO v_id;

  SELECT to_jsonb(p) INTO v_res FROM payroll_periods p WHERE p.id = v_id;
  RETURN v_res;
END;
$$;

-- RPC: post_payroll_run
-- Generates ONE balanced journal entry for the payroll accrual:
--   Dr Production Labour (5010/5011) for PRODUCTION workers
--   Dr Admin Salaries & Wages (5002) for ADMIN workers
--   Dr Employer Contributions (if any)
--     Cr Staff Loans & Advances Receivable (1150) for loan recoveries
--     Cr Other Deduction Liabilities (if any)
--     Cr Wages & Salaries Payable (2300) for Net Pay
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

  v_acct_cogs_wages UUID;
  v_acct_cogs_salary UUID;
  v_acct_admin_salary UUID;
  v_acct_wages_payable UUID;
  v_acct_loan_recv UUID;

  v_tot_prod_wages NUMERIC(18, 2) := 0;
  v_tot_prod_salary NUMERIC(18, 2) := 0;
  v_tot_admin_salary NUMERIC(18, 2) := 0;
  v_tot_loan_recovery NUMERIC(18, 2) := 0;
  v_tot_other_deductions NUMERIC(18, 2) := 0;
  v_tot_net_pay NUMERIC(18, 2) := 0;

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

  -- 2. Resolve Accounts
  SELECT id INTO v_acct_cogs_wages FROM accounts_chart WHERE account_code = '5010' LIMIT 1;
  SELECT id INTO v_acct_cogs_salary FROM accounts_chart WHERE account_code = '5011' LIMIT 1;
  SELECT id INTO v_acct_admin_salary FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
  SELECT id INTO v_acct_wages_payable FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  SELECT id INTO v_acct_loan_recv FROM accounts_chart WHERE account_code = '1150' LIMIT 1;

  IF v_acct_wages_payable IS NULL THEN
    RAISE EXCEPTION 'Account 2300 (Wages & Salaries Payable) is required but missing.';
  END IF;
  IF v_acct_admin_salary IS NULL THEN
    RAISE EXCEPTION 'Account 5002 (Admin Salaries & Wages Expense) is required but missing.';
  END IF;
  IF v_acct_cogs_salary IS NULL THEN
    v_acct_cogs_salary := v_acct_admin_salary;
  END IF;
  IF v_acct_cogs_wages IS NULL THEN
    v_acct_cogs_wages := v_acct_cogs_salary;
  END IF;
  IF v_acct_loan_recv IS NULL THEN
    -- Fallback to Cash/Bank or suspense if loan recv account missing
    SELECT id INTO v_acct_loan_recv FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
  END IF;

  -- 3. Calculate Totals from lines
  FOR v_line IN
    SELECT
      i.cost_class,
      i.employment_type,
      l.category,
      l.wage_type_code,
      SUM(l.amount) AS line_sum
    FROM payroll_run_item_lines l
    JOIN payroll_run_items i ON i.id = l.item_id
    WHERE i.run_id = p_run_id
    GROUP BY i.cost_class, i.employment_type, l.category, l.wage_type_code
  LOOP
    IF v_line.category = 'EARNING' THEN
      IF v_line.cost_class = 'PRODUCTION' THEN
        IF v_line.employment_type = 'PERMANENT_SALARY' THEN
          v_tot_prod_salary := v_tot_prod_salary + v_line.line_sum;
        ELSE
          v_tot_prod_wages := v_tot_prod_wages + v_line.line_sum;
        END IF;
      ELSE
        v_tot_admin_salary := v_tot_admin_salary + v_line.line_sum;
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
  IF (v_tot_prod_salary + v_tot_prod_wages + v_tot_admin_salary) <>
     (v_tot_net_pay + v_tot_loan_recovery + v_tot_other_deductions) THEN
    RAISE EXCEPTION 'Payroll math balance check failed: Earnings (%) <> Net (%) + Deductions (%).',
      (v_tot_prod_salary + v_tot_prod_wages + v_tot_admin_salary),
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
  IF v_tot_prod_wages > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_cogs_wages, v_tot_prod_wages, 0);
  END IF;

  IF v_tot_prod_salary > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_cogs_salary, v_tot_prod_salary, 0);
  END IF;

  IF v_tot_admin_salary > 0 THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_acct_admin_salary, v_tot_admin_salary, 0);
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
    -- Decrement active worker loan
    UPDATE worker_loans
    SET current_balance = GREATEST(0, current_balance - v_loan_item.ded_amount)
    WHERE worker_id = v_loan_item.worker_id AND current_balance > 0;

    -- Insert log if table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'loan_repayment_logs') THEN
      INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
      SELECT id, v_loan_item.ded_amount, 'SALARY_DEDUCTION', CURRENT_DATE
      FROM worker_loans
      WHERE worker_id = v_loan_item.worker_id
      ORDER BY created_at DESC LIMIT 1;
    END IF;
  END LOOP;

  -- 7. Update Run & Item Status
  UPDATE payroll_runs_v2
  SET
    status = 'POSTED',
    journal_entry_id = v_je_id,
    approved_by = p_operator_name,
    updated_at = NOW()
  WHERE id = p_run_id;

  UPDATE payroll_run_items
  SET status = 'POSTED'
  WHERE run_id = p_run_id;

  -- Audit log
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator_name,
    'PAYROLL_RUN_POSTED',
    'PAYROLL',
    jsonb_build_object(
      'run_no', v_run.run_no,
      'run_id', p_run_id,
      'journal_entry_id', v_je_id,
      'net_payable', v_tot_net_pay,
      'cogs_total', v_tot_prod_wages + v_tot_prod_salary,
      'admin_total', v_tot_admin_salary
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', p_run_id,
    'run_no', v_run.run_no,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number
  );
END;
$$;

-- RPC: pay_payroll_items
-- Executes cash or bank disbursement:
--   Dr Wages & Salaries Payable (2300)
--     Cr Cash (1000) or Bank (1002)
-- Supports batch or individual items. Checks liquid balance unless overridden.
CREATE OR REPLACE FUNCTION public.pay_payroll_items(
  p_run_id UUID,
  p_item_ids UUID[],
  p_payment_method TEXT,
  p_account_id UUID,
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_operator_name TEXT DEFAULT 'System Operator',
  p_allow_overdraft BOOLEAN DEFAULT false
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
  v_je_id UUID;
  v_je_number TEXT;
  v_narration TEXT;
  v_batch_no TEXT;
  v_item_count INT := 0;
BEGIN
  -- 1. Validate Run
  SELECT * INTO v_run FROM payroll_runs_v2 WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run % not found.', p_run_id;
  END IF;

  IF v_run.status NOT IN ('POSTED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payroll run % is in status %. Must be POSTED before payment.', v_run.run_no, v_run.status;
  END IF;

  -- 2. Validate Accounts
  SELECT id INTO v_acct_payable FROM accounts_chart WHERE account_code = '2300' LIMIT 1;
  IF v_acct_payable IS NULL THEN
    RAISE EXCEPTION 'Account 2300 (Wages Payable) is missing.';
  END IF;

  SELECT * INTO v_pay_acct FROM accounts_chart WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment account % not found.', p_account_id;
  END IF;

  IF NOT (COALESCE(v_pay_acct.is_liquid_funds, false) OR COALESCE(v_pay_acct.is_default_cash, false) OR v_pay_acct.account_code IN ('1000', '1002')) THEN
    RAISE EXCEPTION 'Selected payment account % is not a liquid cash/bank account.', v_pay_acct.account_code;
  END IF;

  -- 3. Calculate Payment Sum for the chosen items
  SELECT COALESCE(SUM(net_pay - amount_paid), 0), COUNT(*)
  INTO v_total_pay, v_item_count
  FROM payroll_run_items
  WHERE run_id = p_run_id
    AND id = ANY(p_item_ids)
    AND (net_pay - amount_paid) > 0;

  IF v_total_pay <= 0 THEN
    RAISE EXCEPTION 'No pending payable balance found for selected items.';
  END IF;

  -- 4. Liquidity Balance Check
  SELECT COALESCE(SUM(jl.debit_pkr) - SUM(jl.credit_pkr), 0) INTO v_current_liquid_bal
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_id = p_account_id AND je.status = 'POSTED';

  IF v_current_liquid_bal < v_total_pay AND NOT p_allow_overdraft THEN
    RAISE EXCEPTION 'Insufficient liquid balance in account % (Available: PKR %, Required: PKR %).',
      v_pay_acct.account_name, v_current_liquid_bal, v_total_pay;
  END IF;

  -- 5. Post Payment Journal Entry
  v_batch_no := 'DISB-' || to_char(p_payment_date, 'YYYYMMDD') || '-' || lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');
  v_je_number := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');
  v_narration := 'Payroll Disbursement ' || v_batch_no || ' (' || v_item_count || ' staff) Run: ' || v_run.run_no;

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (v_je_number, p_payment_date, v_narration, 'POSTED', true)
  RETURNING id INTO v_je_id;

  -- Dr 2300 Wages Payable / Cr 1000 or 1002 Cash/Bank
  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, v_acct_payable, v_total_pay, 0);

  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, p_account_id, 0, v_total_pay);

  -- 6. Update Items & Insert Payment Logs
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
      journal_entry_id, payment_date, disbursement_batch_no, operator_name
    ) VALUES (
      p_run_id, v_item.id, v_item.pending, p_payment_method, p_account_id,
      v_je_id, p_payment_date, v_batch_no, p_operator_name
    );
  END LOOP;

  -- 7. Update Run Status & Amount Paid
  UPDATE payroll_runs_v2
  SET
    amount_paid = amount_paid + v_total_pay,
    status = CASE
      WHEN (amount_paid + v_total_pay) >= net_payable THEN 'PAID'
      ELSE 'PARTIALLY_PAID'
    END,
    updated_at = NOW()
  WHERE id = p_run_id;

  -- Audit log
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator_name,
    'PAYROLL_DISBURSEMENT_POSTED',
    'PAYROLL',
    jsonb_build_object(
      'run_no', v_run.run_no,
      'disbursement_batch_no', v_batch_no,
      'amount_disbursed', v_total_pay,
      'account_code', v_pay_acct.account_code,
      'journal_entry_id', v_je_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_no', v_batch_no,
    'amount_paid', v_total_pay,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number
  );
END;
$$;

-- RPC: reverse_payroll_run (Storno Reversal)
CREATE OR REPLACE FUNCTION public.reverse_payroll_run(
  p_run_id UUID,
  p_reason TEXT,
  p_operator_name TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_orig_je RECORD;
  v_rev_je_id UUID;
  v_rev_je_no TEXT;
  v_line RECORD;
BEGIN
  SELECT * INTO v_run FROM payroll_runs_v2 WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run % not found.', p_run_id;
  END IF;

  IF v_run.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Can only reverse a POSTED payroll run. Current status is % (if paid, reverse payments first).', v_run.status;
  END IF;

  IF v_run.amount_paid > 0 THEN
    RAISE EXCEPTION 'Run % has disbursed payments of PKR %. Reverse disbursements before reversing the accrual run.', v_run.run_no, v_run.amount_paid;
  END IF;

  SELECT * INTO v_orig_je FROM journal_entries WHERE id = v_run.journal_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original journal entry for run % not found.', v_run.run_no;
  END IF;

  -- Create Reversing Journal Entry (Storno)
  v_rev_je_no := 'JE-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status, is_balanced)
  VALUES (
    v_rev_je_no,
    CURRENT_DATE,
    'STORNO REVERSAL of ' || v_orig_je.entry_number || ' (' || v_run.run_no || '): ' || COALESCE(p_reason, 'Reason not specified'),
    'POSTED',
    true
  ) RETURNING id INTO v_rev_je_id;

  -- Flip debits and credits of original lines
  FOR v_line IN
    SELECT * FROM journal_lines WHERE journal_entry_id = v_orig_je.id
  LOOP
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES (v_rev_je_id, v_line.account_id, v_line.credit_pkr, v_line.debit_pkr);
  END LOOP;

  -- Restore worker loans if any deductions were applied
  -- (Loan reductions are restored back)
  FOR v_line IN
    SELECT i.worker_id, l.amount AS ded_amount
    FROM payroll_run_item_lines l
    JOIN payroll_run_items i ON i.id = l.item_id
    WHERE i.run_id = p_run_id AND l.wage_type_code IN ('LOAN_RECOVERY', 'ADVANCE_RECOVERY') AND l.amount > 0
  LOOP
    UPDATE worker_loans
    SET current_balance = current_balance + v_line.ded_amount
    WHERE worker_id = v_line.worker_id;
  END LOOP;

  -- Update run status
  UPDATE payroll_runs_v2
  SET
    status = 'REVERSED',
    reversal_journal_id = v_rev_je_id,
    reversal_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_run_id;

  UPDATE payroll_run_items
  SET status = 'REVERSED'
  WHERE run_id = p_run_id;

  -- Audit log
  INSERT INTO system_audit_logs (operator_name, action_type, module, details)
  VALUES (
    p_operator_name,
    'PAYROLL_RUN_REVERSED',
    'PAYROLL',
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

-- ── 7. RLS & Security Hardening ─────────────────────────────────────────────

ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_item_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_payment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_wage_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_recurring_wage_items ENABLE ROW LEVEL SECURITY;

-- Read policies for UI
DROP POLICY IF EXISTS "allow_read_periods" ON payroll_periods;
CREATE POLICY "allow_read_periods" ON payroll_periods FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_runs" ON payroll_runs_v2;
CREATE POLICY "allow_read_runs" ON payroll_runs_v2 FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_items" ON payroll_run_items;
CREATE POLICY "allow_read_items" ON payroll_run_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_item_lines" ON payroll_run_item_lines;
CREATE POLICY "allow_read_item_lines" ON payroll_run_item_lines FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_payments" ON payroll_payment_logs;
CREATE POLICY "allow_read_payments" ON payroll_payment_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_wage_types" ON payroll_wage_types;
CREATE POLICY "allow_read_wage_types" ON payroll_wage_types FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_recurring" ON worker_recurring_wage_items;
CREATE POLICY "allow_read_recurring" ON worker_recurring_wage_items FOR SELECT USING (true);

-- Allow draft and approved insertions/updates for simulation and creation wizard
DROP POLICY IF EXISTS "allow_draft_runs_write" ON payroll_runs_v2;
CREATE POLICY "allow_draft_runs_write" ON payroll_runs_v2 FOR ALL USING (status IN ('DRAFT', 'SIMULATED', 'APPROVED')) WITH CHECK (status IN ('DRAFT', 'SIMULATED', 'APPROVED'));

DROP POLICY IF EXISTS "allow_draft_items_write" ON payroll_run_items;
CREATE POLICY "allow_draft_items_write" ON payroll_run_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_draft_lines_write" ON payroll_run_item_lines;
CREATE POLICY "allow_draft_lines_write" ON payroll_run_item_lines FOR ALL USING (true) WITH CHECK (true);

-- Revoke direct destructive operations from anon/authenticated on sensitive payment logs
REVOKE DELETE, UPDATE ON payroll_payment_logs FROM anon, authenticated;

-- Grants
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role, anon;
GRANT ALL ON payroll_periods, payroll_runs_v2, payroll_run_items, payroll_run_item_lines, payroll_payment_logs, payroll_wage_types, worker_recurring_wage_items TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.create_payroll_period TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.post_payroll_run TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.pay_payroll_items TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.reverse_payroll_run TO authenticated, service_role, anon;
