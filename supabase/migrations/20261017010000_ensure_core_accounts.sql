-- ============================================================================
-- Migration: Ensure core chart of accounts exist
-- Timestamp: 20261017010000
-- Description:
--   Ensures each canonical account constant exists in accounts_chart with the
--   correct account_type.
--   Uses ON CONFLICT (account_code) DO NOTHING (idempotent, never alters existing rows).
-- ============================================================================

INSERT INTO public.accounts_chart (account_code, account_name, account_type, is_default_cash, is_liquid_funds)
VALUES
  ('1000', 'Cash in Hand', 'ASSET', true, true),
  ('1002', 'Bank Account', 'ASSET', false, true),
  ('1100', 'Accounts Receivable', 'ASSET', false, false),
  ('1101', 'Raw Material & Chemicals Asset', 'ASSET', false, false),
  ('1102', 'Finished Goods Asset', 'ASSET', false, false),
  ('2001', 'Accounts Payable (Vendors)', 'LIABILITY', false, false),
  ('2200', 'Sales Tax Collected', 'LIABILITY', false, false),
  ('2210', 'Further Tax Payable', 'LIABILITY', false, false),
  ('4001', 'Sales Revenue', 'REVENUE', false, false),
  ('5006', 'Cost of Goods Sold', 'EXPENSE', false, false)
ON CONFLICT (account_code) DO NOTHING;
