-- ============================================================================
-- Migration: Add DAILY_PAY worker type to payroll employment_type enum
--
-- The existing employment_type enum ('PERMANENT_SALARY', 'PART_TIME_WAGE')
-- is expanded to include 'DAILY_PAY'. This is done by recreating the enum
-- type since Postgres does not support ALTER TYPE ADD VALUE safely in all cases.
--
-- Steps:
--   1. Create new enum type payroll_employment_type_enum_v2
--   2. Cast existing rows from old to new type
--   3. Drop the old enum type
--   4. Create the new enum type with all three values
--   5. Update the payroll_entries table to use the new type
-- ============================================================================

-- 1. Create the new enum type with all three values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_employment_type_enum_v2') THEN
    CREATE TYPE payroll_employment_type_enum_v2 AS ENUM ('PERMANENT_SALARY', 'PART_TIME_WAGE', 'DAILY_PAY');
  END IF;
END $$;

-- 2. Cast existing rows from old type to new type
ALTER TABLE payroll_entries ALTER COLUMN employment_type TYPE payroll_employment_type_enum_v2
  USING employment_type::text::payroll_employment_type_enum_v2;

-- 3. Drop the old enum type (safe: no other tables reference it)
DROP TYPE IF EXISTS payroll_employment_type_enum;

-- 4. Rename the new enum to the original name
ALTER TYPE payroll_employment_type_enum_v2 RENAME TO payroll_employment_type_enum;

-- 5. Add a comment documenting the extension
COMMENT ON TYPE payroll_employment_type_enum IS '
  Employment types for payroll entries.
  PERMANENT_SALARY - Fixed monthly salary for permanent staff
  PART_TIME_WAGE   - Part-time or hourly paid staff
  DAILY_PAY        - Daily-wage workers paid per day worked
';

-- Grant access to the new type
GRANT USAGE ON TYPE payroll_employment_type_enum TO authenticated, service_role, anon;