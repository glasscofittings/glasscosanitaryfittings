-- ============================================================================
-- Migration: 20261010050000_party_opening_balance.sql
-- Add opening balance fields to parties so ledger sheets can show a dynamic
-- OPENING BALANCE B/F instead of a hardcoded Rs 0.00 Dr.
-- ============================================================================

ALTER TABLE parties ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(18, 2) NOT NULL DEFAULT 0;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS opening_balance_type TEXT NOT NULL DEFAULT 'Dr'
  CHECK (opening_balance_type IN ('Dr', 'Cr'));

COMMENT ON COLUMN parties.opening_balance IS 'Signed magnitude of the party opening balance (always >= 0; side is opening_balance_type).';
COMMENT ON COLUMN parties.opening_balance_type IS 'Dr (debit-normal / receivable) or Cr (credit-normal / payable).';
