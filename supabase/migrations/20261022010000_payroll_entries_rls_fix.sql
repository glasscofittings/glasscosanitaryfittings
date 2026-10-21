-- ============================================================================
-- PAYROLL ENTRIES — RLS fix
--
-- payroll_entries was created with a policy scoped "TO authenticated" only,
-- but the app (like every other module) calls PostgREST with the anon key and
-- no user session, so saving a payroll record failed with:
--
--   Failed to insert payroll record:
--   {"code":"42501","message":"new row violates row-level security policy
--    for table \"payroll_entries\""}
--
-- Replace it with the same permissive policy every other ERP table uses
-- (sanitary_products, journal_entries, journal_lines, ...), which applies to
-- anon + authenticated + service_role.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage payroll_entries" ON payroll_entries;
DROP POLICY IF EXISTS "erp_full_access" ON payroll_entries;

CREATE POLICY "erp_full_access" ON payroll_entries
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON payroll_entries TO authenticated, service_role, anon;
