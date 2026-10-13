-- ============================================================
-- RLS IDEMPOTENT FIX - Safe to run multiple times
-- Drops all existing policies dynamically then creates open_access
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
  tbls TEXT[] := ARRAY[
    'customer_receipt_vouchers',
    'receipt_voucher_allocations',
    'production_orders',
    'production_order_materials',
    'stock_transfers',
    'stock_transfer_items',
    'payroll_runs',
    'payroll_slips'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop EVERY policy on the table dynamically so nothing conflicts
    FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol, tbl);
    END LOOP;

    -- Create fresh open policy
    EXECUTE format(
      'CREATE POLICY "open_access" ON %I FOR ALL USING (true) WITH CHECK (true)',
      tbl
    );

    -- Grant permissions
    EXECUTE format('GRANT ALL ON %I TO authenticated, service_role, anon', tbl);

    RAISE NOTICE 'RLS clean & configured for: %', tbl;
  END LOOP;
END $$;
