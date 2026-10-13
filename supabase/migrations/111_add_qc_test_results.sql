-- 111_add_qc_test_results.sql
-- Add test_results JSONB column to qc_records for Glassco Sanitary-specific
-- QC parameters (alloy composition, pressure test, plating thickness, etc.)

ALTER TABLE qc_records ADD COLUMN IF NOT EXISTS test_results JSONB DEFAULT NULL;

COMMENT ON COLUMN qc_records.test_results IS 'JSONB field storing stage-specific QC test results for Glassco Sanitary manufacturing';
