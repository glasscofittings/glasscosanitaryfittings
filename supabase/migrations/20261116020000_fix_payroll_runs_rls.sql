-- ============================================================================
-- MIGRATION: 20261116020000_fix_payroll_runs_rls.sql
-- Fix RLS policy on payroll_runs_v2 to allow inserting 'APPROVED' status runs
-- ============================================================================

DROP POLICY IF EXISTS "allow_draft_runs_write" ON payroll_runs_v2;

CREATE POLICY "allow_draft_runs_write" ON payroll_runs_v2
  FOR ALL
  USING (status IN ('DRAFT', 'SIMULATED', 'APPROVED'))
  WITH CHECK (status IN ('DRAFT', 'SIMULATED', 'APPROVED'));
