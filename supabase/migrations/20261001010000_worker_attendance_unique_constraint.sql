-- ============================================================================
-- Ensure UNIQUE constraint on worker_attendance(worker_id, attendance_date)
-- Required for PostgREST upsert (resolution=merge-duplicates) to work.
-- ============================================================================

-- Add the constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'worker_attendance_worker_id_attendance_date_key'
      AND conrelid = 'worker_attendance'::regclass
  ) THEN
    ALTER TABLE worker_attendance
      ADD CONSTRAINT worker_attendance_worker_id_attendance_date_key
      UNIQUE (worker_id, attendance_date);
  END IF;
END $$;

-- Ensure RLS is enabled with full access for authenticated users
ALTER TABLE worker_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "erp_full_access" ON worker_attendance;
CREATE POLICY "erp_full_access" ON worker_attendance
  FOR ALL
  USING (true)
  WITH CHECK (true);
