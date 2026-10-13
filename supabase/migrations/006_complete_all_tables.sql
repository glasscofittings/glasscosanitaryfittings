-- ============================================================
-- MIGRATION 006: Complete ERP Tables + RLS Policies (All-in-One)
-- Run this SINGLE script in Supabase SQL Editor > New Query > Run
-- This creates ALL missing tables and grants full access.
-- ============================================================

-- -- 1. CUSTOMER RECEIPT VOUCHERS (AR) -----------------------
CREATE TABLE IF NOT EXISTS customer_receipt_vouchers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_no    TEXT NOT NULL UNIQUE,
  customer_id   UUID,
  customer_name TEXT NOT NULL,
  receipt_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  amount        NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  payment_mode  TEXT NOT NULL DEFAULT ''BANK_TRANSFER''
                  CHECK (payment_mode IN (''CASH'',''BANK_TRANSFER'',''CHEQUE'',''ONLINE'')),
  reference_no  TEXT,
  bank_account_id UUID,
  remarks       TEXT,
  status        TEXT NOT NULL DEFAULT ''POSTED''
                  CHECK (status IN (''DRAFT'',''POSTED'',''CANCELLED'')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_receipt_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crv_allow_all" ON customer_receipt_vouchers;
CREATE POLICY "crv_allow_all" ON customer_receipt_vouchers FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON customer_receipt_vouchers TO authenticated, service_role, anon;

-- -- 2. RECEIPT VOUCHER ALLOCATIONS --------------------------
CREATE TABLE IF NOT EXISTS receipt_voucher_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id       UUID NOT NULL REFERENCES customer_receipt_vouchers(id) ON DELETE CASCADE,
  invoice_id       UUID NOT NULL,
  invoice_number   TEXT NOT NULL,
  allocated_amount NUMERIC(15, 2) NOT NULL CHECK (allocated_amount > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE receipt_voucher_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rva_allow_all" ON receipt_voucher_allocations;
CREATE POLICY "rva_allow_all" ON receipt_voucher_allocations FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON receipt_voucher_allocations TO authenticated, service_role, anon;

-- -- 3. PRODUCTION ORDERS ------------------------------------
CREATE TABLE IF NOT EXISTS production_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no             TEXT NOT NULL UNIQUE,
  bom_id               UUID,
  target_product_id    UUID NOT NULL,
  target_product_name  TEXT NOT NULL,
  target_qty           NUMERIC(12, 4) NOT NULL CHECK (target_qty > 0),
  actual_qty           NUMERIC(12, 4) DEFAULT 0,
  scrap_qty            NUMERIC(12, 4) DEFAULT 0,
  unit_of_measure      TEXT NOT NULL DEFAULT ''KG'',
  status               TEXT NOT NULL DEFAULT ''PLANNED''
                         CHECK (status IN (''PLANNED'',''IN_PROGRESS'',''COMPLETED'',''CANCELLED'')),
  start_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  completion_date      DATE,
  total_material_cost  NUMERIC(15, 2) DEFAULT 0,
  unit_cost_pkr        NUMERIC(15, 2) DEFAULT 0,
  output_lot_id        UUID,
  operator_name        TEXT NOT NULL DEFAULT ''Production Supervisor'',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_allow_all" ON production_orders;
CREATE POLICY "po_allow_all" ON production_orders FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON production_orders TO authenticated, service_role, anon;

-- -- 4. PRODUCTION ORDER MATERIALS ---------------------------
CREATE TABLE IF NOT EXISTS production_order_materials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL,
  product_name     TEXT NOT NULL,
  lot_id           UUID,
  lot_number       TEXT,
  planned_qty      NUMERIC(12, 4) NOT NULL,
  actual_issued_qty NUMERIC(12, 4) NOT NULL DEFAULT 0,
  unit_cost_pkr    NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_cost_pkr   NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE production_order_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pom_allow_all" ON production_order_materials;
CREATE POLICY "pom_allow_all" ON production_order_materials FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON production_order_materials TO authenticated, service_role, anon;

-- -- 5. STOCK TRANSFERS --------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no           TEXT NOT NULL UNIQUE,
  source_warehouse_code TEXT NOT NULL,
  target_warehouse_code TEXT NOT NULL,
  transfer_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  status                TEXT NOT NULL DEFAULT ''RECEIVED''
                          CHECK (status IN (''DISPATCHED'',''RECEIVED'',''CANCELLED'')),
  dispatched_by         TEXT NOT NULL DEFAULT ''Warehouse Supervisor'',
  received_by           TEXT,
  remarks               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "st_allow_all" ON stock_transfers;
CREATE POLICY "st_allow_all" ON stock_transfers FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON stock_transfers TO authenticated, service_role, anon;

-- -- 6. STOCK TRANSFER ITEMS ---------------------------------
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id   UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  source_lot_id UUID NOT NULL,
  lot_number    TEXT NOT NULL,
  product_id    UUID NOT NULL,
  product_name  TEXT NOT NULL,
  transfer_qty  NUMERIC(12, 4) NOT NULL CHECK (transfer_qty > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sti_allow_all" ON stock_transfer_items;
CREATE POLICY "sti_allow_all" ON stock_transfer_items FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON stock_transfer_items TO authenticated, service_role, anon;

-- -- 7. PAYROLL RUNS ------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_no            TEXT NOT NULL UNIQUE,
  month                 INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year                  INT NOT NULL,
  total_workers         INT NOT NULL DEFAULT 0,
  gross_salaries        NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_deductions      NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_loan_repayments NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_payable           NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT ''POSTED''
                          CHECK (status IN (''DRAFT'',''POSTED'',''PAID'')),
  journal_entry_id      UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year, month)
);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pr_allow_all" ON payroll_runs;
CREATE POLICY "pr_allow_all" ON payroll_runs FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON payroll_runs TO authenticated, service_role, anon;

-- -- 8. PAYROLL SLIPS -----------------------------------------
CREATE TABLE IF NOT EXISTS payroll_slips (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  worker_id      UUID NOT NULL,
  worker_name    TEXT NOT NULL,
  role_designation TEXT NOT NULL DEFAULT ''Worker'',
  base_salary    NUMERIC(15, 2) NOT NULL,
  days_in_month  INT NOT NULL DEFAULT 30,
  present_days   INT NOT NULL DEFAULT 0,
  absent_days    INT NOT NULL DEFAULT 0,
  leave_days     INT NOT NULL DEFAULT 0,
  daily_rate     NUMERIC(15, 2) NOT NULL,
  earned_salary  NUMERIC(15, 2) NOT NULL,
  loan_deduction NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_salary     NUMERIC(15, 2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payroll_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ps_allow_all" ON payroll_slips;
CREATE POLICY "ps_allow_all" ON payroll_slips FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON payroll_slips TO authenticated, service_role, anon;

-- -- Done -----------------------------------------------------
-- All 8 tables created with RLS policies and full grants.
-- You can now use:
--   Customer Receipts (AR), Production Orders,
--   Stock Transfers, Payroll
