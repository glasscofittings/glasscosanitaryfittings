-- Fix RLS for enterprise SAP tables (20261005030000)
-- Without these policies, all inserts/updates are blocked by default RLS.

-- 1. customer_receipt_vouchers
ALTER TABLE customer_receipt_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON customer_receipt_vouchers
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON customer_receipt_vouchers
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2. receipt_voucher_allocations
ALTER TABLE receipt_voucher_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON receipt_voucher_allocations
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON receipt_voucher_allocations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. production_orders
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON production_orders
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON production_orders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. production_order_materials
ALTER TABLE production_order_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON production_order_materials
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON production_order_materials
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 5. stock_transfers
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON stock_transfers
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON stock_transfers
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 6. stock_transfer_items
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON stock_transfer_items
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON stock_transfer_items
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 7. payroll_runs
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON payroll_runs
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON payroll_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 8. payroll_slips
ALTER TABLE payroll_slips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated"
  ON payroll_slips
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow all access to service_role"
  ON payroll_slips
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
