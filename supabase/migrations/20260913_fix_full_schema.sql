-- ============================================================================
-- Glassco Paints ERP — Full Schema Fix & Alignment Migration
-- Date: 2026-09-13
-- Purpose: Bring Supabase schema in perfect sync with TypeScript types.
--          All statements are idempotent (IF NOT EXISTS / IF EXISTS guards).
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. INWARD_GATE_PASSES — add missing columns from TS types
-- ============================================================================
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS igp_code TEXT;
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS unit_of_measure TEXT DEFAULT 'KG';
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS vendor_lot_code TEXT;
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS inward_qty NUMERIC(12, 3) DEFAULT 0.000;

-- Allow legacy NOT NULL constraints to coexist
DO $$ BEGIN
  ALTER TABLE inward_gate_passes ALTER COLUMN vendor_lot_number DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE inward_gate_passes ALTER COLUMN gross_weight_kg DROP NOT NULL;
  ALTER TABLE inward_gate_passes ALTER COLUMN gross_weight_kg SET DEFAULT 0.000;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE inward_gate_passes ALTER COLUMN net_weight_kg DROP NOT NULL;
  ALTER TABLE inward_gate_passes ALTER COLUMN net_weight_kg SET DEFAULT 0.000;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

-- Backfill vendor_lot_code from vendor_lot_number
DO $$ BEGIN
  UPDATE inward_gate_passes SET vendor_lot_code = vendor_lot_number WHERE vendor_lot_code IS NULL;
  UPDATE inward_gate_passes SET vendor_lot_number = vendor_lot_code WHERE vendor_lot_number IS NULL;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

-- Backfill inward_qty from gross_weight_kg
DO $$ BEGIN
  UPDATE inward_gate_passes SET inward_qty = gross_weight_kg WHERE inward_qty = 0.000;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_supplier_id ON inward_gate_passes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_status ON inward_gate_passes(status);
CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_created_at ON inward_gate_passes(created_at DESC);

-- ============================================================================
-- 2. PARTIES — add missing columns for ntn_strn, is_registered
-- ============================================================================
ALTER TABLE parties ADD COLUMN IF NOT EXISTS ntn_strn TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS is_registered BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_parties_party_type ON parties(party_type);
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

-- ============================================================================
-- 3. GOODS_RECEIVED_NOTES — ensure table exists
-- ============================================================================
CREATE TABLE IF NOT EXISTS goods_received_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_code TEXT NOT NULL UNIQUE,
    igp_id UUID NOT NULL REFERENCES inward_gate_passes(id) ON DELETE CASCADE,
    accepted_qty NUMERIC(15, 4) NOT NULL CHECK (accepted_qty >= 0),
    rejected_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
    rejection_reason TEXT,
    unit_price_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price_pkr >= 0),
    total_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_value_pkr >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_igp_id ON goods_received_notes(igp_id);
CREATE INDEX IF NOT EXISTS idx_grn_code ON goods_received_notes(grn_code);

-- ============================================================================
-- 4. PRODUCTS_MASTER — add missing columns for sku, item_type, etc.
-- ============================================================================
ALTER TABLE products_master ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE products_master ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'RAW_MATERIAL';
ALTER TABLE products_master ADD COLUMN IF NOT EXISTS unit_of_measure TEXT DEFAULT 'KG';
ALTER TABLE products_master ADD COLUMN IF NOT EXISTS minimum_stock_alert NUMERIC(12, 3) DEFAULT 0;
ALTER TABLE products_master ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill sku from name if null
DO $$ BEGIN
  UPDATE products_master SET sku = UPPER(LEFT(name, 3)) || '-' || LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::TEXT, 3, '0') WHERE sku IS NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ============================================================================
-- 5. INVENTORY_WAREHOUSES — seed data
-- ============================================================================
INSERT INTO inventory_warehouses (code, name)
SELECT 'WH-01', 'Raw Material Warehouse 01'
WHERE NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE code = 'WH-01');

INSERT INTO inventory_warehouses (code, name)
SELECT 'WH-02', 'Finished Goods Warehouse 02'
WHERE NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE code = 'WH-02');

-- ============================================================================
-- 6. INVENTORY_LOTS — create the lot-level tracking table
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number TEXT NOT NULL UNIQUE,
    product_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
    vendor_lot_code TEXT NOT NULL DEFAULT '',
    manufacture_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiration_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 year'),
    initial_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (initial_qty >= 0),
    remaining_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (remaining_qty >= 0),
    unit_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (unit_cost_pkr >= 0),
    qc_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (qc_status IN ('PENDING', 'PASSED', 'FLAGGED_WARNING')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS batch_order_id UUID REFERENCES batch_orders(id);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_product_id ON inventory_lots(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_warehouse_id ON inventory_lots(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_qc_status ON inventory_lots(qc_status);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_expiration ON inventory_lots(expiration_date);

-- ============================================================================
-- 7. BATCH_ORDERS — for QC references
-- ============================================================================
CREATE TABLE IF NOT EXISTS batch_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number TEXT NOT NULL UNIQUE,
    product_id UUID REFERENCES products_master(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 8. WORKERS — add missing columns (role_designation, base_salary_pkr, etc.)
-- ============================================================================
ALTER TABLE workers ADD COLUMN IF NOT EXISTS role_designation TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS base_salary_pkr NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS joining_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Backfill role_designation from designation
DO $$ BEGIN
  UPDATE workers SET role_designation = designation WHERE role_designation IS NULL;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

-- Backfill base_salary_pkr from daily_rate_pkr * 30
DO $$ BEGIN
  UPDATE workers SET base_salary_pkr = daily_rate_pkr * 30 WHERE base_salary_pkr = 0 AND daily_rate_pkr > 0;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

-- Backfill is_active from status
DO $$ BEGIN
  UPDATE workers SET is_active = (status = 'ACTIVE') WHERE is_active IS NULL;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

-- ============================================================================
-- 9. WORKER_ATTENDANCE — daily attendance tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS worker_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('P', 'A', 'L')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(worker_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_worker_attendance_date ON worker_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_worker_attendance_worker ON worker_attendance(worker_id);

-- ============================================================================
-- 10. WORKER_LOANS — loan tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS worker_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    original_loan_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (original_loan_amount >= 0),
    current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
    monthly_deduction_rate NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_deduction_rate >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_loans_worker_id ON worker_loans(worker_id);

-- ============================================================================
-- 11. LOAN_REPAYMENT_LOGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS loan_repayment_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES worker_loans(id) ON DELETE CASCADE,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    repayment_source TEXT NOT NULL DEFAULT 'CASH' CHECK (repayment_source IN ('CASH', 'BANK_TRANSFER', 'SALARY_DEDUCTION')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loan_repayment_logs_loan_id ON loan_repayment_logs(loan_id);

-- ============================================================================
-- 12. ACCOUNTS_CHART — chart of accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounts_chart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_chart_code ON accounts_chart(account_code);
CREATE INDEX IF NOT EXISTS idx_accounts_chart_type ON accounts_chart(account_type);

-- ============================================================================
-- 13. JOURNAL_ENTRIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number TEXT NOT NULL UNIQUE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    narration TEXT NOT NULL DEFAULT '',
    is_balanced BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);

-- ============================================================================
-- 14. JOURNAL_LINES
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts_chart(id) ON DELETE CASCADE,
    party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    debit_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (debit_pkr >= 0),
    credit_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (credit_pkr >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id ON journal_lines(account_id);

-- ============================================================================
-- 15. QC_RECORDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS qc_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_stage TEXT NOT NULL CHECK (qc_stage IN ('INTAKE', 'IN_PROCESS', 'PACKAGING')),
    lot_id UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
    batch_order_id UUID REFERENCES batch_orders(id) ON DELETE SET NULL,
    viscosity_cp NUMERIC(10, 3),
    specific_gravity NUMERIC(10, 4),
    opacity_percentage NUMERIC(6, 2),
    shade_match_pass BOOLEAN NOT NULL DEFAULT true,
    seal_integrity_pass BOOLEAN NOT NULL DEFAULT true,
    net_weight_kg NUMERIC(12, 3),
    inspector_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qc_records_lot_id ON qc_records(lot_id);
CREATE INDEX IF NOT EXISTS idx_qc_records_stage ON qc_records(qc_stage);
CREATE INDEX IF NOT EXISTS idx_qc_records_created_at ON qc_records(created_at DESC);

-- ============================================================================
-- 16. SALES_INVOICES
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    taxable_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    sales_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18,
    sales_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    further_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
    further_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_invoice_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    is_posted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_created_at ON sales_invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_posted ON sales_invoices(is_posted);

-- ============================================================================
-- 17. SALES_INVOICE_ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products_master(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL DEFAULT '',
    quantity NUMERIC(12, 4) NOT NULL DEFAULT 0,
    unit_price_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    line_total_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    unit_of_measure TEXT NOT NULL DEFAULT 'L',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON sales_invoice_items(invoice_id);

-- ============================================================================
-- 18. BILL_OF_MATERIALS
-- ============================================================================
CREATE TABLE IF NOT EXISTS bill_of_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finished_good_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    version TEXT NOT NULL DEFAULT '1.0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_finished_good ON bill_of_materials(finished_good_id);

-- ============================================================================
-- 19. BOM_ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
    raw_material_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (quantity_required >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_items_bom_id ON bom_items(bom_id);

-- ============================================================================
-- 20. SYSTEM_AUDIT_LOGS — add missing columns for TS compatibility
-- ============================================================================
ALTER TABLE system_audit_logs ADD COLUMN IF NOT EXISTS device_node TEXT;
ALTER TABLE system_audit_logs ADD COLUMN IF NOT EXISTS module TEXT;
ALTER TABLE system_audit_logs ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;

-- Drop NOT NULL on node_id since newer code writes device_node instead
DO $$ BEGIN
  ALTER TABLE system_audit_logs ALTER COLUMN node_id DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

-- Backfill device_node from node_id
DO $$ BEGIN
  UPDATE system_audit_logs SET device_node = node_id WHERE device_node IS NULL;
EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL;
END $$;

-- ============================================================================
-- 21. FLAG_LOT_QC_STATUS RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION flag_lot_qc_status(
  p_lot_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE inventory_lots
  SET qc_status = p_status
  WHERE id = p_lot_id;

  RETURN FOUND;
END;
$$;

-- ============================================================================
-- 22. CONVERT_IGP_TO_GRN RPC (idempotent, latest version)
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS grn_seq START 1 INCREMENT 1;

CREATE OR REPLACE FUNCTION convert_igp_to_grn(
  p_igp_id UUID,
  p_accepted_qty NUMERIC(15, 4),
  p_rejected_qty NUMERIC(15, 4),
  p_rejection_reason TEXT,
  p_unit_price_pkr NUMERIC(15, 2),
  p_device_node TEXT,
  p_operator_name TEXT
)
RETURNS goods_received_notes
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_igp inward_gate_passes%ROWTYPE;
  v_grn goods_received_notes;
  v_grn_code VARCHAR(32);
  v_total_value NUMERIC(15, 2);
  v_lot_num TEXT;
  v_wh01_id UUID;
BEGIN
  SELECT * INTO v_igp FROM inward_gate_passes WHERE id = p_igp_id FOR UPDATE;

  IF v_igp IS NULL THEN
    RAISE EXCEPTION 'IGP not found: %', p_igp_id;
  END IF;

  IF v_igp.status NOT IN ('PENDING_INSPECTION', 'PENDING_QC') THEN
    RAISE EXCEPTION 'IGP % is not pending inspection (current status: %)',
      COALESCE(v_igp.igp_code, v_igp.id::text), v_igp.status;
  END IF;

  IF p_accepted_qty + p_rejected_qty != COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg) THEN
    RAISE EXCEPTION 'Accepted + rejected qty must equal inward qty (% != %)',
      p_accepted_qty + p_rejected_qty, COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg);
  END IF;

  v_grn_code := 'GRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_seq')::text, 4, '0');
  v_total_value := p_accepted_qty * p_unit_price_pkr;

  INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, rejection_reason, unit_price_pkr, total_value_pkr)
  VALUES (v_grn_code, p_igp_id, p_accepted_qty, p_rejected_qty, p_rejection_reason, p_unit_price_pkr, v_total_value)
  RETURNING * INTO v_grn;

  UPDATE inward_gate_passes SET status = 'CONVERTED_TO_GRN' WHERE id = p_igp_id;

  -- Upsert into inventory_lots
  v_lot_num := COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MI'));

  SELECT id INTO v_wh01_id FROM inventory_warehouses WHERE code = 'WH-01' LIMIT 1;

  IF v_wh01_id IS NOT NULL AND p_accepted_qty > 0 THEN
    INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
    SELECT
      v_lot_num,
      pm.id,
      v_wh01_id,
      COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, ''),
      p_accepted_qty,
      p_accepted_qty,
      p_unit_price_pkr,
      'PENDING'
    FROM products_master pm
    WHERE pm.name = v_igp.material_description
    LIMIT 1
    ON CONFLICT (lot_number)
    DO UPDATE SET
      remaining_qty = inventory_lots.remaining_qty + p_accepted_qty;
  END IF;

  -- Audit log
  INSERT INTO system_audit_logs (device_node, operator_name, action_type, module, details, payload)
  VALUES (
    COALESCE(p_device_node, 'SYSTEM_LOCAL'),
    p_operator_name,
    'CONVERTED_IGP_TO_GRN',
    'PROCUREMENT',
    jsonb_build_object('igp_code', v_igp.igp_code, 'grn_code', v_grn_code, 'accepted_qty', p_accepted_qty, 'rejected_qty', p_rejected_qty, 'unit_price_pkr', p_unit_price_pkr, 'total_value_pkr', v_total_value),
    jsonb_build_object('igp_code', v_igp.igp_code, 'grn_code', v_grn_code)
  );

  RETURN v_grn;
END;
$$;

-- ============================================================================
-- 23. SEED ACCOUNTS_CHART with standard Chart of Accounts
-- ============================================================================
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
  ('1001', 'Cash in Hand', 'ASSET'),
  ('1002', 'Bank Account', 'ASSET'),
  ('1100', 'Accounts Receivable', 'ASSET'),
  ('1101', 'Inventory - Raw Materials', 'ASSET'),
  ('1102', 'Inventory - Finished Goods', 'ASSET'),
  ('1201', 'Trade Debts', 'ASSET'),
  ('2001', 'Accounts Payable', 'LIABILITY'),
  ('2002', 'Sales Tax Payable', 'LIABILITY'),
  ('2200', 'Sales Tax Collected', 'LIABILITY'),
  ('2210', 'Further Tax Payable', 'LIABILITY'),
  ('3001', 'Owner''s Equity', 'EQUITY'),
  ('3002', 'Retained Earnings', 'EQUITY'),
  ('4001', 'Sales Revenue', 'REVENUE'),
  ('4002', 'Other Income', 'REVENUE'),
  ('5001', 'Cost of Goods Sold', 'EXPENSE'),
  ('5002', 'Salaries Expense', 'EXPENSE'),
  ('5003', 'Utilities Expense', 'EXPENSE'),
  ('5004', 'Rent Expense', 'EXPENSE'),
  ('5005', 'Freight Expense', 'EXPENSE'),
  ('5100', 'Sales', 'REVENUE')
ON CONFLICT (account_code) DO NOTHING;

-- ============================================================================
-- 24. ROW LEVEL SECURITY — Enable on ALL tables with permissive policies
-- ============================================================================

-- Helper: enable RLS and create permissive ALL policy on a table
DO $$ BEGIN
  -- inward_gate_passes
  ALTER TABLE inward_gate_passes ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON inward_gate_passes;
  CREATE POLICY "erp_full_access" ON inward_gate_passes FOR ALL USING (true) WITH CHECK (true);

  -- parties
  ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON parties;
  CREATE POLICY "erp_full_access" ON parties FOR ALL USING (true) WITH CHECK (true);

  -- goods_received_notes
  ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON goods_received_notes;
  CREATE POLICY "erp_full_access" ON goods_received_notes FOR ALL USING (true) WITH CHECK (true);

  -- products_master
  ALTER TABLE products_master ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON products_master;
  CREATE POLICY "erp_full_access" ON products_master FOR ALL USING (true) WITH CHECK (true);

  -- inventory_warehouses
  ALTER TABLE inventory_warehouses ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON inventory_warehouses;
  CREATE POLICY "erp_full_access" ON inventory_warehouses FOR ALL USING (true) WITH CHECK (true);

  -- inventory_balances
  ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON inventory_balances;
  CREATE POLICY "erp_full_access" ON inventory_balances FOR ALL USING (true) WITH CHECK (true);

  -- inventory_lots
  ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON inventory_lots;
  CREATE POLICY "erp_full_access" ON inventory_lots FOR ALL USING (true) WITH CHECK (true);

  -- inventory_wh01_raw
  ALTER TABLE inventory_wh01_raw ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON inventory_wh01_raw;
  CREATE POLICY "erp_full_access" ON inventory_wh01_raw FOR ALL USING (true) WITH CHECK (true);

  -- inventory_wh02_finished
  ALTER TABLE inventory_wh02_finished ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON inventory_wh02_finished;
  CREATE POLICY "erp_full_access" ON inventory_wh02_finished FOR ALL USING (true) WITH CHECK (true);

  -- workers
  ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON workers;
  CREATE POLICY "erp_full_access" ON workers FOR ALL USING (true) WITH CHECK (true);

  -- worker_attendance
  ALTER TABLE worker_attendance ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON worker_attendance;
  CREATE POLICY "erp_full_access" ON worker_attendance FOR ALL USING (true) WITH CHECK (true);

  -- worker_loans
  ALTER TABLE worker_loans ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON worker_loans;
  CREATE POLICY "erp_full_access" ON worker_loans FOR ALL USING (true) WITH CHECK (true);

  -- loan_repayment_logs
  ALTER TABLE loan_repayment_logs ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON loan_repayment_logs;
  CREATE POLICY "erp_full_access" ON loan_repayment_logs FOR ALL USING (true) WITH CHECK (true);

  -- batch_orders
  ALTER TABLE batch_orders ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON batch_orders;
  CREATE POLICY "erp_full_access" ON batch_orders FOR ALL USING (true) WITH CHECK (true);

  -- accounts_chart
  ALTER TABLE accounts_chart ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON accounts_chart;
  CREATE POLICY "erp_full_access" ON accounts_chart FOR ALL USING (true) WITH CHECK (true);

  -- journal_entries
  ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON journal_entries;
  CREATE POLICY "erp_full_access" ON journal_entries FOR ALL USING (true) WITH CHECK (true);

  -- journal_lines
  ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON journal_lines;
  CREATE POLICY "erp_full_access" ON journal_lines FOR ALL USING (true) WITH CHECK (true);

  -- qc_records
  ALTER TABLE qc_records ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON qc_records;
  CREATE POLICY "erp_full_access" ON qc_records FOR ALL USING (true) WITH CHECK (true);

  -- sales_invoices
  ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON sales_invoices;
  CREATE POLICY "erp_full_access" ON sales_invoices FOR ALL USING (true) WITH CHECK (true);

  -- sales_invoice_items
  ALTER TABLE sales_invoice_items ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON sales_invoice_items;
  CREATE POLICY "erp_full_access" ON sales_invoice_items FOR ALL USING (true) WITH CHECK (true);

  -- bill_of_materials
  ALTER TABLE bill_of_materials ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON bill_of_materials;
  CREATE POLICY "erp_full_access" ON bill_of_materials FOR ALL USING (true) WITH CHECK (true);

  -- bom_items
  ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON bom_items;
  CREATE POLICY "erp_full_access" ON bom_items FOR ALL USING (true) WITH CHECK (true);

  -- system_audit_logs
  ALTER TABLE system_audit_logs ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON system_audit_logs;
  CREATE POLICY "erp_full_access" ON system_audit_logs FOR ALL USING (true) WITH CHECK (true);

  -- system_backups
  ALTER TABLE system_backups ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON system_backups;
  CREATE POLICY "erp_full_access" ON system_backups FOR ALL USING (true) WITH CHECK (true);

  -- dashboard_kpis
  ALTER TABLE dashboard_kpis ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON dashboard_kpis;
  CREATE POLICY "erp_full_access" ON dashboard_kpis FOR ALL USING (true) WITH CHECK (true);

  -- system_pins
  ALTER TABLE system_pins ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON system_pins;
  CREATE POLICY "erp_full_access" ON system_pins FOR ALL USING (true) WITH CHECK (true);

  -- device_accounts
  ALTER TABLE device_accounts ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON device_accounts;
  CREATE POLICY "erp_full_access" ON device_accounts FOR ALL USING (true) WITH CHECK (true);

  -- staff_members
  ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "erp_full_access" ON staff_members;
  CREATE POLICY "erp_full_access" ON staff_members FOR ALL USING (true) WITH CHECK (true);

END $$;

-- ============================================================================
-- 24b. Legacy permissive policies for tables that had split policies (04, 05)
-- ============================================================================
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow select for all on inward_gate_passes" ON inward_gate_passes;
  DROP POLICY IF EXISTS "Allow insert for all on inward_gate_passes" ON inward_gate_passes;
  DROP POLICY IF EXISTS "Allow update for all on inward_gate_passes" ON inward_gate_passes;
  DROP POLICY IF EXISTS "Allow select for all on parties" ON parties;
  DROP POLICY IF EXISTS "Allow insert for all on parties" ON parties;
  DROP POLICY IF EXISTS "Allow select for all on goods_received_notes" ON goods_received_notes;
  DROP POLICY IF EXISTS "Allow insert for all on goods_received_notes" ON goods_received_notes;
  DROP POLICY IF EXISTS "Allow select for all on inventory_wh01_raw" ON inventory_wh01_raw;
  DROP POLICY IF EXISTS "Allow insert for all on inventory_wh01_raw" ON inventory_wh01_raw;
  DROP POLICY IF EXISTS "Allow update for all on inventory_wh01_raw" ON inventory_wh01_raw;
EXCEPTION WHEN others THEN NULL;
END $$;
