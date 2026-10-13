-- ============================================================================
-- SEED: Factory Chart of Accounts (supplements 20260913_fix_full_schema.sql)
-- Uses ON CONFLICT DO UPDATE to rename existing accounts to factory-specific names
-- and INSERT for genuinely new accounts.
-- ============================================================================

-- ── ASSETS ──────────────────────────────────────────────────────────────────
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
  ('1001', 'Cash on Hand', 'ASSET'),
  ('1002', 'Bank Account', 'ASSET'),
  ('1100', 'Accounts Receivable', 'ASSET'),
  ('1101', 'WH-01 Raw Chemicals Asset', 'ASSET'),
  ('1102', 'WH-02 Finished Goods Asset', 'ASSET'),
  ('1201', 'Trade Debts', 'ASSET')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- ── LIABILITIES ─────────────────────────────────────────────────────────────
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
  ('2001', 'Accounts Payable (Suppliers)', 'LIABILITY'),
  ('2002', 'FBR Sales Tax Payable', 'LIABILITY'),
  ('2200', 'Sales Tax Collected', 'LIABILITY'),
  ('2210', 'Further Tax Payable', 'LIABILITY'),
  ('2300', 'Wages Payable', 'LIABILITY')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- ── EQUITY ──────────────────────────────────────────────────────────────────
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
  ('3001', 'Owner''s Capital', 'EQUITY'),
  ('3002', 'Retained Earnings', 'EQUITY')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- ── REVENUE ─────────────────────────────────────────────────────────────────
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
  ('4001', 'Paint Sales Revenue', 'REVENUE'),
  ('4002', 'Other Income', 'REVENUE')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- ── EXPENSES ────────────────────────────────────────────────────────────────
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
  ('5001', 'Raw Material Consumption Expense', 'EXPENSE'),
  ('5002', 'Worker Payroll Expense', 'EXPENSE'),
  ('5003', 'Utilities Expense', 'EXPENSE'),
  ('5004', 'Rent Expense', 'EXPENSE'),
  ('5005', 'Freight Expense', 'EXPENSE'),
  ('5006', 'Cost of Goods Sold', 'EXPENSE')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;
