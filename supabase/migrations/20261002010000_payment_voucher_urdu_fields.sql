-- ============================================================================
-- Migration: Urdu payee name / purpose on payment vouchers
-- Description: Free-text voucher fields cannot be translated automatically, so
--              the operator enters the Urdu alongside the English when creating
--              a voucher. Both are printed on the bilingual voucher PDFs.
-- ============================================================================

ALTER TABLE payment_vouchers
    ADD COLUMN IF NOT EXISTS payee_name_ur TEXT,
    ADD COLUMN IF NOT EXISTS purpose_ur TEXT;

COMMENT ON COLUMN payment_vouchers.payee_name_ur IS 'Payee name in Urdu, entered by the operator (optional).';
COMMENT ON COLUMN payment_vouchers.purpose_ur IS 'Purpose in Urdu, entered by the operator (optional).';
