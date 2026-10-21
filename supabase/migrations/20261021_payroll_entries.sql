-- ============================================================================
-- PAYROLL ENTRIES — Migration
-- Adds payroll_entries table for tracking Salaries & Wages with
-- automatic double-entry journal integration (COGS vs Admin Fixed Costs).
-- ============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_type_enum') THEN
    CREATE TYPE payroll_type_enum AS ENUM ('PRODUCTION_COGS', 'ADMIN_FIXED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type_enum') THEN
    CREATE TYPE employment_type_enum AS ENUM ('PERMANENT_SALARY', 'PART_TIME_WAGE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_payment_method_enum') THEN
    CREATE TYPE payroll_payment_method_enum AS ENUM ('CASH', 'BANK');
  END IF;
END $$;

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number        TEXT NOT NULL UNIQUE,
    employee_name       TEXT NOT NULL,
    amount              NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    payroll_type        payroll_type_enum NOT NULL,
    employment_type     employment_type_enum NOT NULL,
    payment_method      payroll_payment_method_enum NOT NULL,
    -- The expense account debited (COGS or Admin)
    expense_account_id  UUID REFERENCES accounts_chart(id),
    -- The cash/bank account credited
    payment_account_id  UUID REFERENCES accounts_chart(id),
    journal_entry_id    UUID REFERENCES journal_entries(id),
    notes               TEXT,
    payroll_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    operator_name       TEXT DEFAULT 'System Operator',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_date ON payroll_entries(payroll_date DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_type ON payroll_entries(payroll_type);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_employment ON payroll_entries(employment_type);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_payment ON payroll_entries(payment_method);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_entries_updated_at ON payroll_entries;
CREATE TRIGGER trg_payroll_entries_updated_at
  BEFORE UPDATE ON payroll_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;

-- NOTE: the app calls PostgREST with the anon key and no user session (same as
-- every other module), so the policy must cover role `anon` as well. A policy
-- scoped "TO authenticated" alone rejected inserts with 42501
-- ("new row violates row-level security policy for table \"payroll_entries\"").
-- Use the same permissive policy every other ERP table has.
DROP POLICY IF EXISTS "Authenticated users can manage payroll_entries" ON payroll_entries;
DROP POLICY IF EXISTS "erp_full_access" ON payroll_entries;
CREATE POLICY "erp_full_access" ON payroll_entries
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON payroll_entries TO authenticated, service_role, anon;
