-- ============================================================
-- Migration 005: RLS Policies — Allow All Operations
-- Run this in Supabase SQL Editor to fix "Post Receipt Voucher"
-- and all other insert/update failures on new tables.
-- ============================================================

-- -- Customer Receipt Vouchers --------------------------------
ALTER TABLE customer_receipt_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on customer_receipt_vouchers" ON customer_receipt_vouchers;
CREATE POLICY "Allow all on customer_receipt_vouchers"
  ON customer_receipt_vouchers FOR ALL
  USING (true) WITH CHECK (true);

-- -- Receipt Voucher Allocations ------------------------------
ALTER TABLE receipt_voucher_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on receipt_voucher_allocations" ON receipt_voucher_allocations;
CREATE POLICY "Allow all on receipt_voucher_allocations"
  ON receipt_voucher_allocations FOR ALL
  USING (true) WITH CHECK (true);

-- -- Production Orders ----------------------------------------
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on production_orders" ON production_orders;
CREATE POLICY "Allow all on production_orders"
  ON production_orders FOR ALL
  USING (true) WITH CHECK (true);

-- -- Production Order Materials -------------------------------
ALTER TABLE production_order_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on production_order_materials" ON production_order_materials;
CREATE POLICY "Allow all on production_order_materials"
  ON production_order_materials FOR ALL
  USING (true) WITH CHECK (true);

-- -- Stock Transfers ------------------------------------------
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on stock_transfers" ON stock_transfers;
CREATE POLICY "Allow all on stock_transfers"
  ON stock_transfers FOR ALL
  USING (true) WITH CHECK (true);

-- -- Stock Transfer Items -------------------------------------
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on stock_transfer_items" ON stock_transfer_items;
CREATE POLICY "Allow all on stock_transfer_items"
  ON stock_transfer_items FOR ALL
  USING (true) WITH CHECK (true);

-- -- Payroll Runs ---------------------------------------------
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on payroll_runs" ON payroll_runs;
CREATE POLICY "Allow all on payroll_runs"
  ON payroll_runs FOR ALL
  USING (true) WITH CHECK (true);

-- -- Payroll Slips --------------------------------------------
ALTER TABLE payroll_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on payroll_slips" ON payroll_slips;
CREATE POLICY "Allow all on payroll_slips"
  ON payroll_slips FOR ALL
  USING (true) WITH CHECK (true);

-- -- Grants (re-confirm) --------------------------------------
GRANT ALL ON customer_receipt_vouchers TO authenticated, service_role, anon;
GRANT ALL ON receipt_voucher_allocations TO authenticated, service_role, anon;
GRANT ALL ON production_orders TO authenticated, service_role, anon;
GRANT ALL ON production_order_materials TO authenticated, service_role, anon;
GRANT ALL ON stock_transfers TO authenticated, service_role, anon;
GRANT ALL ON stock_transfer_items TO authenticated, service_role, anon;
GRANT ALL ON payroll_runs TO authenticated, service_role, anon;
GRANT ALL ON payroll_slips TO authenticated, service_role, anon;
