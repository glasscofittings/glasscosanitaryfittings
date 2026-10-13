-- Add category column to payment_vouchers for expense tracking
-- This allows categorizing expenses without creating a parallel ledger
-- Categories: RENT, ELECTRICITY, SALARIES, TRANSPORT, FUEL, MAINTENANCE, PACKAGING, MISCELLANEOUS

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_vouchers' AND column_name = 'category'
  ) THEN
    ALTER TABLE payment_vouchers ADD COLUMN category TEXT;
    -- Set default category for existing rows based on purpose
    UPDATE payment_vouchers SET category =
      CASE
        WHEN purpose ILIKE 'rent%' OR purpose ILIKE 'lease%' THEN 'RENT'
        WHEN purpose ILIKE 'electricity%' OR purpose ILIKE 'power%' THEN 'ELECTRICITY'
        WHEN purpose ILIKE 'salary%' OR purpose ILIKE 'wages%' THEN 'SALARIES'
        WHEN purpose ILIKE 'transport%' OR purpose ILIKE 'delivery%' THEN 'TRANSPORT'
        WHEN purpose ILIKE 'fuel%' THEN 'FUEL'
        WHEN purpose ILIKE 'maintenance%' THEN 'MAINTENANCE'
        WHEN purpose ILIKE 'packaging%' THEN 'PACKAGING'
        ELSE 'MISCELLANEOUS'
      END
    WHERE category IS NULL;
  END IF;
END $$;

-- Add comment to document the column purpose
COMMENT ON COLUMN payment_vouchers.category IS 'Expense category for reporting and filtering. Values: RENT, ELECTRICITY, SALARIES, TRANSPORT, FUEL, MAINTENANCE, PACKAGING, MISCELLANEOUS';