-- ============================================================================
-- GLASSCO SANITARY ERP — CONSOLIDATED DATABASE SCHEMA
-- Generated: 2026-10-01
-- All tables, functions, RLS policies, indexes, and seed data
-- ============================================================================
-- Run this file ONCE on a fresh Supabase project to bootstrap the database.
-- For existing databases, use individual migration files instead.
-- ============================================================================

-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- 1. TYPES (ENUMS)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('OWNER', 'TERMINAL');
  END IF;
END $$;

-- ============================================================================
-- 2. SEQUENCES
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS grn_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS payment_voucher_seq START 1 INCREMENT 1;

-- ============================================================================
-- 3. TABLES (in dependency order)
-- ============================================================================

-- ── 3.1 PARTIES (Suppliers, Customers, Vendors) ─────────────────────────────
CREATE TABLE IF NOT EXISTS parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    party_type TEXT NOT NULL CHECK (party_type IN ('SUPPLIER', 'CUSTOMER', 'VENDOR', 'BOTH')),
    phone TEXT,
    email TEXT,
    address TEXT,
    ntn_strn TEXT,
    is_registered BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parties_party_type ON parties(party_type);
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

-- ── 3.2 INVENTORY WAREHOUSES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

INSERT INTO inventory_warehouses (code, name)
SELECT 'WH-01', 'Raw Material Warehouse 01'
WHERE NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE code = 'WH-01');

INSERT INTO inventory_warehouses (code, name)
SELECT 'WH-02', 'Finished Goods Warehouse 02'
WHERE NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE code = 'WH-02');

-- ── 3.3 PRODUCTS MASTER ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    sku TEXT,
    item_type TEXT DEFAULT 'RAW_MATERIAL',
    unit_of_measure TEXT DEFAULT 'KG',
    minimum_stock_alert NUMERIC(12, 3) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.4 SANITARY PRODUCTS (legacy, kept for compatibility) ──────────────────
CREATE TABLE IF NOT EXISTS sanitary_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT,
    finish TEXT,
    material TEXT,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    reorder_level INT NOT NULL DEFAULT 0,
    available_stock INT NOT NULL DEFAULT 0,
    total_stock INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sanitary_products_category ON sanitary_products(category);
CREATE INDEX IF NOT EXISTS idx_sanitary_products_sku ON sanitary_products(sku);
CREATE INDEX IF NOT EXISTS idx_sanitary_products_name_trgm ON sanitary_products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sanitary_products_sku_trgm ON sanitary_products USING gin (sku gin_trgm_ops);

-- ── 3.5 INWARD GATE PASSES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inward_gate_passes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id TEXT NOT NULL,
    material_description TEXT NOT NULL,
    vendor_lot_number TEXT,
    vendor_lot_code TEXT,
    coa_code TEXT,
    gross_weight_kg NUMERIC(12, 3) DEFAULT 0.000,
    net_weight_kg NUMERIC(12, 3) DEFAULT 0.000,
    inward_qty NUMERIC(12, 3) DEFAULT 0.000,
    unit_of_measure TEXT DEFAULT 'KG',
    accepted_qty NUMERIC(15, 4),
    rejected_qty NUMERIC(15, 4) NOT NULL DEFAULT 0,
    rejection_reason TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING_INSPECTION',
    igp_code TEXT,
    product_id UUID REFERENCES sanitary_products(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column upgrade for databases created before accepted/rejected
-- tracking existed (CREATE TABLE IF NOT EXISTS cannot add columns).
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS accepted_qty NUMERIC(15, 4);
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC(15, 4) NOT NULL DEFAULT 0;
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
UPDATE inward_gate_passes
SET accepted_qty = COALESCE(NULLIF(net_weight_kg, 0), inward_qty, 0)
WHERE accepted_qty IS NULL;

CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_supplier_id ON inward_gate_passes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_status ON inward_gate_passes(status);
CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_created_at ON inward_gate_passes(created_at DESC);

-- ── 3.6 GOODS RECEIVED NOTES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goods_received_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_code TEXT NOT NULL UNIQUE,
    igp_id UUID NOT NULL REFERENCES inward_gate_passes(id) ON DELETE CASCADE,
    accepted_qty NUMERIC(15, 4) NOT NULL CHECK (accepted_qty >= 0),
    rejected_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
    rejection_reason TEXT,
    unit_price_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price_pkr >= 0),
    total_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_value_pkr >= 0),
    product_id UUID REFERENCES sanitary_products(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_igp_id ON goods_received_notes(igp_id);
CREATE INDEX IF NOT EXISTS idx_grn_code ON goods_received_notes(grn_code);

-- ── 3.7 INVENTORY BALANCES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    current_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (current_qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wh_product UNIQUE (warehouse_id, product_id)
);

-- ── 3.8 INVENTORY LOTS ─────────────────────────────────────────────────────
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
    batch_order_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_product_id ON inventory_lots(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_warehouse_id ON inventory_lots(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_qc_status ON inventory_lots(qc_status);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_expiration ON inventory_lots(expiration_date);

-- ── 3.9 INVENTORY WH01 RAW (legacy) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_wh01_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_sku TEXT NOT NULL,
    lot_number TEXT NOT NULL UNIQUE,
    balance_kg NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (balance_kg >= 0),
    expiry_date DATE,
    location TEXT NOT NULL DEFAULT 'WH01-GENERAL'
);

CREATE INDEX IF NOT EXISTS idx_inventory_wh01_material_sku ON inventory_wh01_raw(material_sku);
CREATE INDEX IF NOT EXISTS idx_inventory_wh01_expiry_date ON inventory_wh01_raw(expiry_date);

-- ── 3.10 INVENTORY WH02 FINISHED (legacy) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_wh02_finished (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_sku TEXT NOT NULL,
    lot_number TEXT NOT NULL UNIQUE,
    balance_liters NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (balance_liters >= 0),
    qc_status TEXT NOT NULL DEFAULT 'PENDING',
    expiry_date DATE
);

CREATE INDEX IF NOT EXISTS idx_inventory_wh02_product_sku ON inventory_wh02_finished(product_sku);
CREATE INDEX IF NOT EXISTS idx_inventory_wh02_qc_status ON inventory_wh02_finished(qc_status);

-- ── 3.11 BATCH ORDERS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number TEXT NOT NULL UNIQUE,
    product_id UUID REFERENCES products_master(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.12 WORKERS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    designation TEXT NOT NULL DEFAULT 'OPERATOR',
    role_designation TEXT,
    daily_rate_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (daily_rate_pkr >= 0),
    base_salary_pkr NUMERIC(12, 2) DEFAULT 0,
    joining_date DATE DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

-- ── 3.13 WORKER ATTENDANCE ─────────────────────────────────────────────────
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

-- ── 3.14 WORKER LOANS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    original_loan_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (original_loan_amount >= 0),
    current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
    monthly_deduction_rate NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_deduction_rate >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_loans_worker_id ON worker_loans(worker_id);

-- ── 3.15 LOAN REPAYMENT LOGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_repayment_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES worker_loans(id) ON DELETE CASCADE,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    repayment_source TEXT NOT NULL DEFAULT 'CASH' CHECK (repayment_source IN ('CASH', 'BANK_TRANSFER', 'SALARY_DEDUCTION')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loan_repayment_logs_loan_id ON loan_repayment_logs(loan_id);

-- ── 3.16 ACCOUNTS CHART ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts_chart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_chart_code ON accounts_chart(account_code);
CREATE INDEX IF NOT EXISTS idx_accounts_chart_type ON accounts_chart(account_type);

-- ── 3.17 JOURNAL ENTRIES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number TEXT NOT NULL UNIQUE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    narration TEXT NOT NULL DEFAULT '',
    is_balanced BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
    voucher_no TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);
-- One journal entry per payment voucher (NULLs — manual entries — exempt).
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_voucher_no_key
    ON journal_entries (voucher_no) WHERE voucher_no IS NOT NULL;

-- ── 3.18 JOURNAL LINES ─────────────────────────────────────────────────────
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

-- ── 3.19 QC RECORDS ────────────────────────────────────────────────────────
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

-- ── 3.20 SALES INVOICES ───────────────────────────────────────────────────
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
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    discount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    is_posted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_created_at ON sales_invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_posted ON sales_invoices(is_posted);

-- ── 3.21 SALES INVOICE ITEMS ───────────────────────────────────────────────
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

-- ── 3.22 BILL OF MATERIALS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bill_of_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finished_good_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    version TEXT NOT NULL DEFAULT '1.0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_finished_good ON bill_of_materials(finished_good_id);

-- ── 3.23 BOM ITEMS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
    raw_material_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (quantity_required >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_items_bom_id ON bom_items(bom_id);

-- ── 3.24 SYSTEM AUDIT LOGS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operator_name TEXT NOT NULL DEFAULT '',
    node_id TEXT,
    device_node TEXT,
    action_type TEXT NOT NULL,
    module TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_timestamp ON system_audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_node_id ON system_audit_logs(node_id);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_action_type ON system_audit_logs(action_type);

-- ── 3.25 SYSTEM BACKUPS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_name TEXT NOT NULL,
    backup_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.26 DASHBOARD KPIs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_material_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    finished_goods_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    active_batch_orders_count INTEGER NOT NULL DEFAULT 0,
    qc_warning_lots_count INTEGER NOT NULL DEFAULT 0,
    trial_balance_status TEXT NOT NULL DEFAULT 'BALANCED',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dashboard_kpis (raw_material_value_pkr, finished_goods_value_pkr, active_batch_orders_count, qc_warning_lots_count, trial_balance_status)
SELECT 4250000.50, 8910200.00, 3, 1, 'BALANCED'
WHERE NOT EXISTS (SELECT 1 FROM dashboard_kpis);

-- ── 3.27 SYSTEM PINS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin TEXT NOT NULL UNIQUE CHECK (LENGTH(pin) = 4 AND pin ~ '^[0-9]+$'),
    staff_name TEXT NOT NULL DEFAULT 'STAFF',
    assigned_device TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_pins_pin ON system_pins(pin);
CREATE INDEX IF NOT EXISTS idx_system_pins_active ON system_pins(is_active);

INSERT INTO system_pins (pin, staff_name, assigned_device, is_active) VALUES
('1111', 'Workshop Desk 1', 'DESK-01', true),
('2222', 'Workshop Desk 2', 'DESK-02', true),
('3333', 'Office Laptop', 'LAPTOP-01', true),
('4444', 'Main PC', 'PC-01', true)
ON CONFLICT DO NOTHING;

-- ── 3.28 STAFF MEMBERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    pin TEXT NOT NULL CHECK (LENGTH(pin) = 4 AND pin ~ '^[0-9]+$'),
    assigned_device TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_members_email ON staff_members(email);
CREATE INDEX IF NOT EXISTS idx_staff_members_pin ON staff_members(pin);
CREATE INDEX IF NOT EXISTS idx_staff_members_active ON staff_members(is_active);

INSERT INTO staff_members (email, pin, assigned_device, is_active) VALUES
('laptop1@glasscopaints.com', '1111', 'LAPTOP-01', true),
('laptop2@glasscopaints.com', '2222', 'LAPTOP-02', true),
('pc1@glasscopaints.com', '3333', 'PC-01', true),
('pc2@glasscopaints.com', '4444', 'PC-02', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO staff_members (email, pin, assigned_device, is_active) VALUES
('owner@glasscopaints.com', '0000', 'OWNER-DESK', true)
ON CONFLICT (email) DO NOTHING;

-- ── 3.29 DEVICE ACCOUNTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_name TEXT NOT NULL,
    assigned_email TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL CHECK (LENGTH(pin_hash) = 64 AND pin_hash ~ '^[a-f0-9]+$'),
    role TEXT NOT NULL CHECK (role IN ('OPERATOR', 'LAB_TECH')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_accounts_email ON device_accounts(assigned_email);
CREATE INDEX IF NOT EXISTS idx_device_accounts_device_name ON device_accounts(device_name);
CREATE INDEX IF NOT EXISTS idx_device_accounts_active ON device_accounts(is_active);

INSERT INTO device_accounts (device_name, assigned_email, pin_hash, role, is_active) VALUES
('Factory PC 1', 'pc1@glassco.com', encode(digest('1122', 'sha256'), 'hex'), 'OPERATOR', true),
('Factory PC 2', 'pc2@glassco.com', encode(digest('3344', 'sha256'), 'hex'), 'OPERATOR', true),
('Lab Laptop 1', 'laptop1@glassco.com', encode(digest('1234', 'sha256'), 'hex'), 'LAB_TECH', true),
('Lab Laptop 2', 'laptop2@glassco.com', encode(digest('5678', 'sha256'), 'hex'), 'LAB_TECH', true)
ON CONFLICT (assigned_email) DO NOTHING;

-- ── 3.30 PRODUCT DELIVERIES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES sanitary_products(id) ON DELETE RESTRICT,
    quantity_delivered INT NOT NULL CHECK (quantity_delivered > 0),
    customer_name VARCHAR(255) NOT NULL,
    delivery_destination VARCHAR(500),
    delivery_chalan VARCHAR(100),
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_deliveries_product_id ON product_deliveries(product_id);
CREATE INDEX IF NOT EXISTS idx_product_deliveries_created_at ON product_deliveries(created_at DESC);

-- ── 3.31 PAYMENT VOUCHERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_no TEXT UNIQUE NOT NULL,
    voucher_type TEXT NOT NULL CHECK (voucher_type IN ('CASH_PAYMENT', 'PARTY_PAYMENT', 'BANK_PAYMENT')),
    voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payee_name TEXT NOT NULL,
    payee_name_ur TEXT,
    payee_address TEXT,
    cnic_ntn TEXT,
    purpose TEXT,
    purpose_ur TEXT,
    reference_no TEXT,
    debit_account_id UUID REFERENCES accounts_chart(id),
    credit_account_id UUID REFERENCES accounts_chart(id),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    amount_in_words TEXT NOT NULL,
    remarks TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Urdu fields for the bilingual voucher PDFs (also in migration 20261002010000)
ALTER TABLE payment_vouchers
    ADD COLUMN IF NOT EXISTS payee_name_ur TEXT,
    ADD COLUMN IF NOT EXISTS purpose_ur TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_vouchers_type ON payment_vouchers(voucher_type);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_date ON payment_vouchers(voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_payee ON payment_vouchers(payee_name);

-- ── 3.32 DISPATCH RECORDS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL DEFAULT '',
    taxable_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    sales_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18,
    sales_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    further_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
    further_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_invoice_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
    line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    operator_name TEXT NOT NULL DEFAULT '',
    device_node TEXT NOT NULL DEFAULT '',
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_records_invoice ON dispatch_records(invoice_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_records_customer ON dispatch_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_records_posted_at ON dispatch_records(posted_at DESC);

-- ── 3.33 PROFILES (Auth) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'TERMINAL',
    device_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- ============================================================================
-- 4. FUNCTIONS / RPCs
-- ============================================================================

-- ── 4.1 convert_igp_to_grn ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION convert_igp_to_grn(
    p_igp_id UUID,
    p_accepted_qty NUMERIC(15, 4),
    p_rejected_qty NUMERIC(15, 4),
    p_rejection_reason TEXT,
    p_unit_price_pkr NUMERIC(15, 2),
    p_device_node TEXT,
    p_operator_name TEXT
) RETURNS goods_received_notes
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

    v_lot_num := COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD-HH24MI'));

    SELECT id INTO v_wh01_id FROM inventory_warehouses WHERE code = 'WH-01' LIMIT 1;

    IF v_wh01_id IS NOT NULL AND p_accepted_qty > 0 THEN
        INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
        SELECT
            v_lot_num, pm.id, v_wh01_id,
            COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, ''),
            p_accepted_qty, p_accepted_qty, p_unit_price_pkr, 'PENDING'
        FROM products_master pm
        WHERE pm.name = v_igp.material_description
        LIMIT 1
        ON CONFLICT (lot_number)
        DO UPDATE SET remaining_qty = inventory_lots.remaining_qty + p_accepted_qty;
    END IF;

    INSERT INTO system_audit_logs (device_node, operator_name, action_type, module, details, payload)
    VALUES (
        COALESCE(p_device_node, 'SYSTEM_LOCAL'), p_operator_name,
        'CONVERTED_IGP_TO_GRN', 'PROCUREMENT',
        jsonb_build_object('igp_code', v_igp.igp_code, 'grn_code', v_grn_code,
            'accepted_qty', p_accepted_qty, 'rejected_qty', p_rejected_qty,
            'unit_price_pkr', p_unit_price_pkr, 'total_value_pkr', v_total_value),
        jsonb_build_object('igp_code', v_igp.igp_code, 'grn_code', v_grn_code)
    );

    RETURN v_grn;
END;
$$;

-- ── 4.2 flag_lot_qc_status ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION flag_lot_qc_status(
    p_lot_id UUID,
    p_status TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE inventory_lots SET qc_status = p_status WHERE id = p_lot_id;
    RETURN FOUND;
END;
$$;

-- ── 4.3 deduct_product_stock ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_product_stock(
    p_product_id UUID,
    p_quantity INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_stock INTEGER;
BEGIN
    SELECT available_stock INTO v_current_stock
    FROM sanitary_products
    WHERE id = p_product_id
    FOR UPDATE;

    IF v_current_stock IS NULL THEN
        RAISE EXCEPTION 'Product with ID % not found.', p_product_id;
    END IF;

    IF v_current_stock < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock. Required: %, Available: %', p_quantity, v_current_stock;
    END IF;

    UPDATE sanitary_products
    SET available_stock = available_stock - p_quantity
    WHERE id = p_product_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_product_stock(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_product_stock(UUID, INTEGER) TO service_role;

-- ── 4.4 post_gst_paints_invoice ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_gst_paints_invoice(
    invoice_id UUID,
    customer_id UUID,
    taxable_value_pkr NUMERIC,
    apply_further_tax BOOLEAN,
    operator_name TEXT,
    device_node TEXT,
    line_items JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invoice         sales_invoices%ROWTYPE;
    v_taxable         NUMERIC := taxable_value_pkr;
    v_sales_tax       NUMERIC;
    v_further_tax     NUMERIC;
    v_total_payable   NUMERIC;
    v_line            JSONB;
    v_entry_id        UUID;
    v_entry_number    TEXT;
    v_account_id_1100 UUID;
    v_account_id_5100 UUID;
    v_account_id_2200 UUID;
    v_account_id_2210 UUID;
BEGIN
    SELECT * INTO v_invoice FROM sales_invoices WHERE id = invoice_id FOR UPDATE;

    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found: %', invoice_id;
    END IF;
    IF v_invoice.is_posted THEN
        RAISE EXCEPTION 'Invoice % is already posted', v_invoice.invoice_number;
    END IF;
    IF v_invoice.customer_id != customer_id THEN
        RAISE EXCEPTION 'Customer mismatch: invoice belongs to %, got %', v_invoice.customer_id, customer_id;
    END IF;

    v_sales_tax   := round(v_taxable * 0.18, 2);
    v_further_tax := CASE WHEN apply_further_tax THEN round(v_taxable * 0.04, 2) ELSE 0 END;
    v_total_payable := v_taxable + v_sales_tax + v_further_tax;

    FOR v_line IN SELECT * FROM jsonb_array_elements(line_items) LOOP
        INSERT INTO sales_invoice_items (
            invoice_id, product_id, product_name,
            quantity, unit_price_pkr, line_total_pkr, unit_of_measure
        ) VALUES (
            invoice_id,
            (v_line->>'product_id')::UUID,
            COALESCE((v_line->>'product_name')::TEXT, ''),
            COALESCE((v_line->>'qty_buckets')::NUMERIC, 0),
            COALESCE((v_line->>'unit_price_pkr')::NUMERIC, 0),
            COALESCE((v_line->>'qty_buckets')::NUMERIC, 0) * COALESCE((v_line->>'unit_price_pkr')::NUMERIC, 0),
            COALESCE((v_line->>'unit_of_measure')::TEXT, 'L')
        );

        IF v_line ? 'lot_id' AND (v_line->>'lot_id')::TEXT != '' THEN
            UPDATE inventory_lots
            SET remaining_qty = remaining_qty - COALESCE((v_line->>'qty_buckets')::NUMERIC, 0)
            WHERE id = (v_line->>'lot_id')::UUID
                AND remaining_qty >= COALESCE((v_line->>'qty_buckets')::NUMERIC, 0);
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Insufficient stock in lot %', v_line->>'lot_id';
            END IF;
        END IF;
    END LOOP;

    UPDATE sales_invoices si
    SET is_posted              = true,
        taxable_value_pkr      = v_taxable,
        sales_tax_amount_pkr   = v_sales_tax,
        further_tax_rate       = CASE WHEN apply_further_tax THEN 4 ELSE 0 END,
        further_tax_amount_pkr = v_further_tax,
        total_invoice_value_pkr = v_total_payable
    WHERE si.id = invoice_id;

    v_entry_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(
        (SELECT COALESCE(MAX(CAST(substring(entry_number FROM 12) AS INT)), 0) + 1
         FROM journal_entries
         WHERE entry_number LIKE 'JE-' || to_char(now(), 'YYYYMMDD') || '-%')::TEXT,
        4, '0'
    );

    INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
    VALUES (v_entry_number, CURRENT_DATE, 'Sales invoice ' || v_invoice.invoice_number || ' posted', true, 'POSTED')
    RETURNING id INTO v_entry_id;

    SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100';
    SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '5100';
    SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200';
    SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210';

    IF v_account_id_1100 IS NOT NULL THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
        VALUES (v_entry_id, v_account_id_1100, v_total_payable, 0);
    END IF;
    IF v_account_id_5100 IS NOT NULL THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
        VALUES (v_entry_id, v_account_id_5100, 0, v_taxable);
    END IF;
    IF v_sales_tax > 0 AND v_account_id_2200 IS NOT NULL THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
        VALUES (v_entry_id, v_account_id_2200, 0, v_sales_tax);
    END IF;
    IF v_further_tax > 0 AND v_account_id_2210 IS NOT NULL THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
        VALUES (v_entry_id, v_account_id_2210, 0, v_further_tax);
    END IF;

    INSERT INTO system_audit_logs (device_node, operator_name, action_type, module, details, payload)
    VALUES (
        post_gst_paints_invoice.device_node,
        post_gst_paints_invoice.operator_name,
        'POSTED_INVOICE', 'INVOICING',
        jsonb_build_object('invoice_id', invoice_id, 'invoice_number', v_invoice.invoice_number, 'total_payable', v_total_payable),
        jsonb_build_object('invoice_id', invoice_id, 'taxable_value_pkr', v_taxable, 'sales_tax', v_sales_tax,
            'further_tax', v_further_tax, 'total_payable', v_total_payable)
    );

    RETURN jsonb_build_object('invoice_number', v_invoice.invoice_number, 'total_payable', v_total_payable);
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) TO service_role;

-- ── 4.5 create_payment_voucher ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_voucher(
    p_voucher_type    TEXT,
    p_voucher_date    DATE,
    p_payee_name      TEXT,
    p_amount          NUMERIC,
    p_payee_address   TEXT DEFAULT NULL,
    p_cnic_ntn        TEXT DEFAULT NULL,
    p_purpose         TEXT DEFAULT NULL,
    p_reference_no    TEXT DEFAULT NULL,
    p_debit_account_id UUID DEFAULT NULL,
    p_credit_account_id UUID DEFAULT NULL,
    p_remarks         TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_prefix    TEXT;
    v_voucher_no TEXT;
    v_row       payment_vouchers%ROWTYPE;
    v_created_by UUID;
BEGIN
    IF p_voucher_type = 'CASH_PAYMENT' THEN
        v_prefix := 'CPV';
    ELSIF p_voucher_type = 'PARTY_PAYMENT' THEN
        v_prefix := 'PPV';
    ELSE
        v_prefix := 'BPV';
    END IF;

    v_voucher_no := v_prefix || '-' || to_char(p_voucher_date, 'YYYY') || '-' ||
        lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');

    v_created_by := auth.uid();

    INSERT INTO payment_vouchers (
        voucher_no, voucher_type, voucher_date,
        payee_name, payee_address, cnic_ntn,
        purpose, reference_no,
        debit_account_id, credit_account_id,
        amount, amount_in_words, remarks, created_by
    ) VALUES (
        v_voucher_no, p_voucher_type, p_voucher_date,
        p_payee_name, p_payee_address, p_cnic_ntn,
        p_purpose, p_reference_no,
        p_debit_account_id, p_credit_account_id,
        p_amount, '', p_remarks, v_created_by
    )
    RETURNING * INTO v_row;

    INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status)
    VALUES (
        'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' || v_prefix || '-' || lpad(nextval('payment_voucher_seq')::TEXT, 5, '0'),
        p_voucher_date,
        v_prefix || ' ' || v_voucher_no || ' — ' || p_payee_name,
        true, 'POSTED'
    );

    SELECT to_jsonb(pv.*) INTO v_row FROM payment_vouchers pv WHERE pv.id = v_row.id;
    RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO service_role;

-- ── 4.6 verify_staff_credentials ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_staff_credentials(p_email TEXT, p_pin TEXT)
RETURNS TABLE (
    staff_id UUID,
    email TEXT,
    pin_valid BOOLEAN,
    assigned_device TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT id::UUID AS staff_id, email, true::BOOLEAN AS pin_valid, assigned_device
    FROM staff_members
    WHERE email = p_email AND pin = p_pin AND is_active = true;
END
$$;

-- ── 4.7 verify_owner_email ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_owner_email(p_email TEXT)
RETURNS TABLE (is_owner BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_email = 'owner@glasscopaints.com' THEN
        RETURN QUERY SELECT true::BOOLEAN AS is_owner;
    ELSE
        RETURN QUERY SELECT false::BOOLEAN AS is_owner;
    END IF;
END
$$;

-- ── 4.8 verify_staff_pin ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_staff_pin(p_pin TEXT)
RETURNS TABLE (
    staff_name TEXT,
    assigned_device TEXT,
    pin_valid BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT staff_name, assigned_device, true::BOOLEAN AS pin_valid
    FROM system_pins
    WHERE pin = p_pin AND is_active = true;
END
$$;

-- ── 4.9 verify_device_pin ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_device_pin(p_device_id UUID, p_pin TEXT)
RETURNS TABLE (
    device_id UUID,
    device_name TEXT,
    assigned_email TEXT,
    role TEXT,
    pin_valid BOOLEAN
)
LANGUAGE plpgsql
STRICT
AS $$
BEGIN
    RETURN QUERY
    SELECT id::UUID AS device_id, device_name, assigned_email, role,
        CASE WHEN pin_hash = encode(digest(p_pin, 'sha256'), 'hex') THEN true ELSE false END AS pin_valid
    FROM device_accounts
    WHERE id = p_device_id AND is_active = true;
END
$$;

-- ── 4.10 verify_device_pin_by_email ────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_device_pin_by_email(p_email TEXT, p_pin TEXT)
RETURNS TABLE (
    device_id UUID,
    device_name TEXT,
    assigned_email TEXT,
    role TEXT,
    pin_valid BOOLEAN
)
LANGUAGE plpgsql
STRICT
AS $$
BEGIN
    RETURN QUERY
    SELECT id::UUID AS device_id, device_name, assigned_email, role,
        CASE WHEN pin_hash = encode(digest(p_pin, 'sha256'), 'hex') THEN true ELSE false END AS pin_valid
    FROM device_accounts
    WHERE assigned_email = p_email AND is_active = true;
END
$$;

-- ── 4.11 handle_new_user (auth trigger) ────────────────────────────────────
-- SAFETY: Wrapped in DO block so any failure is logged but does NOT abort schema.
-- This trigger auto-creates a profiles row when GoTrue creates a new auth user.
-- If it fails for any reason, profiles are backfilled manually via dashboard.
DO $$ BEGIN
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    DROP FUNCTION IF EXISTS public.handle_new_user();

    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $func$
    BEGIN
        INSERT INTO public.profiles (id, email, role, device_name)
        VALUES (
            NEW.id,
            COALESCE(NEW.email, ''),
            COALESCE(
                (NEW.raw_user_meta_data->>'role')::user_role,
                'TERMINAL'::user_role
            ),
            NEW.raw_user_meta_data->>'device_name'
        );
        RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
        RETURN NEW;
    END;
    $func$;

    CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW
        EXECUTE FUNCTION public.handle_new_user();

    RAISE NOTICE 'Auth trigger created successfully';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not create auth trigger (non-fatal): %', SQLERRM;
END $$;

-- ============================================================================
-- 5. ROW LEVEL SECURITY — Enable on ALL tables
-- ============================================================================

DO $$ BEGIN
    -- Core tables
    ALTER TABLE inward_gate_passes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
    ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE products_master ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_warehouses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_wh01_raw ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_wh02_finished ENABLE ROW LEVEL SECURITY;
    ALTER TABLE batch_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sanitary_products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE product_deliveries ENABLE ROW LEVEL SECURITY;

    -- Labour tables
    ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE worker_attendance ENABLE ROW LEVEL SECURITY;
    ALTER TABLE worker_loans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE loan_repayment_logs ENABLE ROW LEVEL SECURITY;

    -- Financial tables
    ALTER TABLE accounts_chart ENABLE ROW LEVEL SECURITY;
    ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE payment_vouchers ENABLE ROW LEVEL SECURITY;

    -- QC tables
    ALTER TABLE qc_records ENABLE ROW LEVEL SECURITY;

    -- Invoicing tables
    ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sales_invoice_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE dispatch_records ENABLE ROW LEVEL SECURITY;

    -- BOM tables
    ALTER TABLE bill_of_materials ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;

    -- System tables
    ALTER TABLE system_audit_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE system_backups ENABLE ROW LEVEL SECURITY;
    ALTER TABLE dashboard_kpis ENABLE ROW LEVEL SECURITY;
    ALTER TABLE system_pins ENABLE ROW LEVEL SECURITY;
    ALTER TABLE device_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;

    -- Auth tables
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
END $$;

-- Permissive ALL policies for all tables (anon + authenticated full access)
DO $$ BEGIN
    -- inward_gate_passes
    DROP POLICY IF EXISTS "erp_full_access" ON inward_gate_passes;
    CREATE POLICY "erp_full_access" ON inward_gate_passes FOR ALL USING (true) WITH CHECK (true);

    -- parties
    DROP POLICY IF EXISTS "erp_full_access" ON parties;
    CREATE POLICY "erp_full_access" ON parties FOR ALL USING (true) WITH CHECK (true);

    -- goods_received_notes
    DROP POLICY IF EXISTS "erp_full_access" ON goods_received_notes;
    CREATE POLICY "erp_full_access" ON goods_received_notes FOR ALL USING (true) WITH CHECK (true);

    -- products_master
    DROP POLICY IF EXISTS "erp_full_access" ON products_master;
    CREATE POLICY "erp_full_access" ON products_master FOR ALL USING (true) WITH CHECK (true);

    -- inventory_warehouses
    DROP POLICY IF EXISTS "erp_full_access" ON inventory_warehouses;
    CREATE POLICY "erp_full_access" ON inventory_warehouses FOR ALL USING (true) WITH CHECK (true);

    -- inventory_balances
    DROP POLICY IF EXISTS "erp_full_access" ON inventory_balances;
    CREATE POLICY "erp_full_access" ON inventory_balances FOR ALL USING (true) WITH CHECK (true);

    -- inventory_lots
    DROP POLICY IF EXISTS "erp_full_access" ON inventory_lots;
    CREATE POLICY "erp_full_access" ON inventory_lots FOR ALL USING (true) WITH CHECK (true);

    -- inventory_wh01_raw
    DROP POLICY IF EXISTS "erp_full_access" ON inventory_wh01_raw;
    CREATE POLICY "erp_full_access" ON inventory_wh01_raw FOR ALL USING (true) WITH CHECK (true);

    -- inventory_wh02_finished
    DROP POLICY IF EXISTS "erp_full_access" ON inventory_wh02_finished;
    CREATE POLICY "erp_full_access" ON inventory_wh02_finished FOR ALL USING (true) WITH CHECK (true);

    -- batch_orders
    DROP POLICY IF EXISTS "erp_full_access" ON batch_orders;
    CREATE POLICY "erp_full_access" ON batch_orders FOR ALL USING (true) WITH CHECK (true);

    -- sanitary_products
    DROP POLICY IF EXISTS "erp_full_access" ON sanitary_products;
    CREATE POLICY "erp_full_access" ON sanitary_products FOR ALL USING (true) WITH CHECK (true);

    -- product_deliveries
    DROP POLICY IF EXISTS "erp_full_access" ON product_deliveries;
    CREATE POLICY "erp_full_access" ON product_deliveries FOR ALL USING (true) WITH CHECK (true);

    -- workers
    DROP POLICY IF EXISTS "erp_full_access" ON workers;
    CREATE POLICY "erp_full_access" ON workers FOR ALL USING (true) WITH CHECK (true);

    -- worker_attendance
    DROP POLICY IF EXISTS "erp_full_access" ON worker_attendance;
    CREATE POLICY "erp_full_access" ON worker_attendance FOR ALL USING (true) WITH CHECK (true);

    -- worker_loans
    DROP POLICY IF EXISTS "erp_full_access" ON worker_loans;
    CREATE POLICY "erp_full_access" ON worker_loans FOR ALL USING (true) WITH CHECK (true);

    -- loan_repayment_logs
    DROP POLICY IF EXISTS "erp_full_access" ON loan_repayment_logs;
    CREATE POLICY "erp_full_access" ON loan_repayment_logs FOR ALL USING (true) WITH CHECK (true);

    -- accounts_chart
    DROP POLICY IF EXISTS "erp_full_access" ON accounts_chart;
    CREATE POLICY "erp_full_access" ON accounts_chart FOR ALL USING (true) WITH CHECK (true);

    -- journal_entries
    DROP POLICY IF EXISTS "erp_full_access" ON journal_entries;
    CREATE POLICY "erp_full_access" ON journal_entries FOR ALL USING (true) WITH CHECK (true);

    -- journal_lines
    DROP POLICY IF EXISTS "erp_full_access" ON journal_lines;
    CREATE POLICY "erp_full_access" ON journal_lines FOR ALL USING (true) WITH CHECK (true);

    -- payment_vouchers
    DROP POLICY IF EXISTS "erp_full_access" ON payment_vouchers;
    CREATE POLICY "erp_full_access" ON payment_vouchers FOR ALL USING (true) WITH CHECK (true);

    -- qc_records
    DROP POLICY IF EXISTS "erp_full_access" ON qc_records;
    CREATE POLICY "erp_full_access" ON qc_records FOR ALL USING (true) WITH CHECK (true);

    -- sales_invoices
    DROP POLICY IF EXISTS "erp_full_access" ON sales_invoices;
    CREATE POLICY "erp_full_access" ON sales_invoices FOR ALL USING (true) WITH CHECK (true);

    -- sales_invoice_items
    DROP POLICY IF EXISTS "erp_full_access" ON sales_invoice_items;
    CREATE POLICY "erp_full_access" ON sales_invoice_items FOR ALL USING (true) WITH CHECK (true);

    -- dispatch_records
    DROP POLICY IF EXISTS "erp_full_access" ON dispatch_records;
    CREATE POLICY "erp_full_access" ON dispatch_records FOR ALL USING (true) WITH CHECK (true);

    -- bill_of_materials
    DROP POLICY IF EXISTS "erp_full_access" ON bill_of_materials;
    CREATE POLICY "erp_full_access" ON bill_of_materials FOR ALL USING (true) WITH CHECK (true);

    -- bom_items
    DROP POLICY IF EXISTS "erp_full_access" ON bom_items;
    CREATE POLICY "erp_full_access" ON bom_items FOR ALL USING (true) WITH CHECK (true);

    -- system_audit_logs
    DROP POLICY IF EXISTS "erp_full_access" ON system_audit_logs;
    CREATE POLICY "erp_full_access" ON system_audit_logs FOR ALL USING (true) WITH CHECK (true);

    -- system_backups
    DROP POLICY IF EXISTS "erp_full_access" ON system_backups;
    CREATE POLICY "erp_full_access" ON system_backups FOR ALL USING (true) WITH CHECK (true);

    -- dashboard_kpis
    DROP POLICY IF EXISTS "erp_full_access" ON dashboard_kpis;
    CREATE POLICY "erp_full_access" ON dashboard_kpis FOR ALL USING (true) WITH CHECK (true);

    -- system_pins
    DROP POLICY IF EXISTS "erp_full_access" ON system_pins;
    CREATE POLICY "erp_full_access" ON system_pins FOR ALL USING (true) WITH CHECK (true);

    -- device_accounts
    DROP POLICY IF EXISTS "erp_full_access" ON device_accounts;
    CREATE POLICY "erp_full_access" ON device_accounts FOR ALL USING (true) WITH CHECK (true);

    -- staff_members
    DROP POLICY IF EXISTS "erp_full_access" ON staff_members;
    CREATE POLICY "erp_full_access" ON staff_members FOR ALL USING (true) WITH CHECK (true);

    -- profiles (auth)
    DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
    CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
    DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
    CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
    DROP POLICY IF EXISTS "Service role can insert profiles" ON profiles;
    CREATE POLICY "Service role can insert profiles" ON profiles FOR INSERT WITH CHECK (true);
    DROP POLICY IF EXISTS "Authenticated can insert profiles" ON profiles;
    CREATE POLICY "Authenticated can insert profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (true);

    -- Drop legacy split policies
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
    DROP POLICY IF EXISTS "Allow all anon access" ON sanitary_products;
    DROP POLICY IF EXISTS "Allow all anon access" ON product_deliveries;

EXCEPTION WHEN others THEN NULL;
END $$;

-- ============================================================================
-- 6. SEED DATA — Chart of Accounts
-- ============================================================================

-- Assets
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
    ('1001', 'Cash on Hand', 'ASSET'),
    ('1002', 'Bank Account', 'ASSET'),
    ('1100', 'Accounts Receivable', 'ASSET'),
    ('1101', 'WH-01 Raw Chemicals Asset', 'ASSET'),
    ('1102', 'WH-02 Finished Goods Asset', 'ASSET'),
    ('1201', 'Trade Debts', 'ASSET')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Liabilities
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
    ('2001', 'Accounts Payable (Suppliers)', 'LIABILITY'),
    ('2002', 'FBR Sales Tax Payable', 'LIABILITY'),
    ('2200', 'Sales Tax Collected', 'LIABILITY'),
    ('2210', 'Further Tax Payable', 'LIABILITY'),
    ('2300', 'Wages Payable', 'LIABILITY')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Equity
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
    ('3001', 'Owner''s Capital', 'EQUITY'),
    ('3002', 'Retained Earnings', 'EQUITY')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Revenue
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
    ('4001', 'Paint Sales Revenue', 'REVENUE'),
    ('4002', 'Other Income', 'REVENUE')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Expenses
INSERT INTO accounts_chart (account_code, account_name, account_type) VALUES
    ('5001', 'Raw Material Consumption Expense', 'EXPENSE'),
    ('5002', 'Worker Payroll Expense', 'EXPENSE'),
    ('5003', 'Utilities Expense', 'EXPENSE'),
    ('5004', 'Rent Expense', 'EXPENSE'),
    ('5005', 'Freight Expense', 'EXPENSE'),
    ('5006', 'Cost of Goods Sold', 'EXPENSE')
ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name;

-- ============================================================================
-- 7. REALTIME PUBLICATION (idempotent)
-- ============================================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE system_audit_logs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- DONE
-- ============================================================================
