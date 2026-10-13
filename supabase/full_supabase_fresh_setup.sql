-- ============================================================================
-- GLASSCO SANITARY ERP — COMPLETE CONSOLIDATED DATABASE SCHEMA
-- Migration: Fresh Supabase Project Bootstrap (Clean Setup)
-- Description:
--   Complete schema, extensions, sequences, tables, constraints, RPC functions,
--   triggers, RLS policies, chart of accounts seed, product materials seed,
--   system pins/devices, and default auth trigger & users for fresh projects.
-- ============================================================================

-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- 1. TYPES & ENUMS
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('OWNER', 'TERMINAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_enum') THEN
    CREATE TYPE account_type_enum AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lot_status_enum') THEN
    CREATE TYPE lot_status_enum AS ENUM ('quality_inspection', 'unrestricted', 'blocked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'po_status_enum') THEN
    CREATE TYPE po_status_enum AS ENUM ('draft', 'approved', 'fulfilled', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grn_status_enum') THEN
    CREATE TYPE grn_status_enum AS ENUM ('draft', 'inspected', 'invoiced');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status_enum') THEN
    CREATE TYPE invoice_status_enum AS ENUM ('draft', 'pending_approval', 'posted', 'blocked_variance', 'cancelled');
  END IF;
END $$;

-- ============================================================================
-- 2. SEQUENCES
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS grn_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS grn_number_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS purchase_invoice_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS payment_voucher_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

-- ============================================================================
-- 3. CORE ERP & FINANCIAL TABLES
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
    opening_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
    opening_balance_type TEXT NOT NULL DEFAULT 'Dr' CHECK (opening_balance_type IN ('Dr', 'Cr')),
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

INSERT INTO inventory_warehouses (code, name) VALUES
('WH-01', 'Raw Material Warehouse 01'),
('WH-02', 'Finished Goods Warehouse 02')
ON CONFLICT (code) DO NOTHING;

-- ── 3.3 PRODUCTS MASTER (Raw Materials, WIP, Finished Goods) ────────────────
CREATE TABLE IF NOT EXISTS products_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    sku TEXT UNIQUE,
    item_type TEXT DEFAULT 'RAW_MATERIAL',
    unit_of_measure TEXT DEFAULT 'KG',
    minimum_stock_alert NUMERIC(12, 3) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_master_sku ON products_master(sku);
CREATE INDEX IF NOT EXISTS idx_products_master_item_type ON products_master(item_type);

-- ── 3.4 SANITARY PRODUCTS (POS / Finished Goods Catalog) ───────────────────
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

-- ── 3.5 INWARD GATE PASSES (Procurement Entry) ─────────────────────────────
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

-- ── 3.6 GOODS RECEIVED NOTES (GRN) ──────────────────────────────────────────
-- Repair: an earlier run of this script created the table under the misspelled
-- name `goods_received_notes`, which broke the FK in purchase_invoices (42P01).
DO $$
BEGIN
  IF to_regclass('public.goods_received_notes') IS NOT NULL
     AND to_regclass('public.goods_receipt_notes') IS NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'goods_received_notes'
         AND column_name = 'grn_number'
     ) THEN
    ALTER TABLE public.goods_received_notes RENAME TO goods_receipt_notes;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_code TEXT,
    grn_number TEXT UNIQUE,
    igp_id UUID REFERENCES inward_gate_passes(id) ON DELETE CASCADE,
    gate_pass_id UUID REFERENCES inward_gate_passes(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    vendor_name TEXT NOT NULL DEFAULT '',
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    accepted_qty NUMERIC(15, 4) DEFAULT 0 CHECK (accepted_qty >= 0),
    rejected_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
    rejection_reason TEXT,
    unit_price_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (unit_price_pkr >= 0),
    total_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_value_pkr >= 0),
    product_id UUID REFERENCES sanitary_products(id),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending_invoice',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_grn_number ON goods_receipt_notes(grn_number);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_gate_pass_id ON goods_receipt_notes(gate_pass_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_vendor_id ON goods_receipt_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_status ON goods_receipt_notes(status);

-- ── 3.7 PURCHASE INVOICES (AP) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT NOT NULL UNIQUE,
    grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,
    grn_number TEXT NOT NULL DEFAULT '',
    vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    vendor_name TEXT NOT NULL DEFAULT '',
    taxable_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (taxable_amount >= 0),
    tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_payable NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_payable >= 0),
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'posted', 'cancelled')),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_number ON purchase_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_grn_id ON purchase_invoices(grn_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_vendor_id ON purchase_invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(status);

-- ── 3.8 INVENTORY BALANCES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    current_qty NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (current_qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wh_product UNIQUE (warehouse_id, product_id)
);

-- ── 3.9 INVENTORY LOTS & BATCHES ────────────────────────────────────────────
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
    status TEXT NOT NULL DEFAULT 'quality_inspection' CHECK (status IN ('quality_inspection', 'unrestricted', 'blocked')),
    batch_order_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_product_id ON inventory_lots(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_warehouse_id ON inventory_lots(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_qc_status ON inventory_lots(qc_status);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_status ON inventory_lots(status);

-- ── 3.10 LEGACY WH01 & WH02 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_wh01_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_sku TEXT NOT NULL,
    lot_number TEXT NOT NULL UNIQUE,
    balance_kg NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (balance_kg >= 0),
    expiry_date DATE,
    location TEXT NOT NULL DEFAULT 'WH01-GENERAL'
);

CREATE TABLE IF NOT EXISTS inventory_wh02_finished (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_sku TEXT NOT NULL,
    lot_number TEXT NOT NULL UNIQUE,
    balance_liters NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (balance_liters >= 0),
    qc_status TEXT NOT NULL DEFAULT 'PENDING',
    expiry_date DATE
);

-- ── 3.11 BATCH ORDERS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number TEXT NOT NULL UNIQUE,
    product_id UUID REFERENCES products_master(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.12 WORKERS & HR ──────────────────────────────────────────────────────
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

CREATE TABLE IF NOT EXISTS worker_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    original_loan_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (original_loan_amount >= 0),
    current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
    monthly_deduction_rate NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_deduction_rate >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_loans_worker_id ON worker_loans(worker_id);

CREATE TABLE IF NOT EXISTS loan_repayment_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES worker_loans(id) ON DELETE CASCADE,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    repayment_source TEXT NOT NULL DEFAULT 'CASH' CHECK (repayment_source IN ('CASH', 'BANK_TRANSFER', 'SALARY_DEDUCTION')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.13 CHART OF ACCOUNTS (General Ledger) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts_chart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    is_default_cash BOOLEAN NOT NULL DEFAULT false,
    is_liquid_funds BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_chart_code ON accounts_chart(account_code);
CREATE INDEX IF NOT EXISTS idx_accounts_chart_type ON accounts_chart(account_type);

CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number TEXT NOT NULL UNIQUE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    narration TEXT NOT NULL DEFAULT '',
    customer_name TEXT,
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

-- ── 3.14 QC RECORDS ────────────────────────────────────────────────────────
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

-- ── 3.15 SALES INVOICES & DISPATCHES ───────────────────────────────────────
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

-- Separate dispatches & invoices tables (used in inventory dispatches flow)
CREATE TABLE IF NOT EXISTS dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES sanitary_products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 4) NOT NULL CHECK (quantity > 0),
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'DISPATCHED' CHECK (status IN ('DISPATCHED', 'PENDING')),
  customer_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  remarks TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE,
  dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES sanitary_products(id) ON DELETE RESTRICT,
  quantity_dispatched NUMERIC(12, 4) NOT NULL CHECK (quantity_dispatched > 0),
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DISPATCHED_INVOICED' CHECK (status IN ('DISPATCHED_INVOICED', 'PAID')),
  taxable_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  sales_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  sales_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  further_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  further_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  additional_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  additional_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- ── 3.16 BILL OF MATERIALS (BOM) & PRODUCTION ──────────────────────────────
CREATE TABLE IF NOT EXISTS bill_of_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finished_good_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    version TEXT NOT NULL DEFAULT '1.0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES bill_of_materials(id) ON DELETE CASCADE,
    raw_material_id UUID NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (quantity_required >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT NOT NULL UNIQUE,
  bom_id UUID REFERENCES bill_of_materials(id),
  target_product_id UUID NOT NULL,
  target_product_name TEXT NOT NULL,
  target_qty NUMERIC(12, 4) NOT NULL CHECK (target_qty > 0),
  actual_qty NUMERIC(12, 4) DEFAULT 0,
  scrap_qty NUMERIC(12, 4) DEFAULT 0,
  unit_of_measure TEXT NOT NULL DEFAULT 'KG',
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completion_date DATE,
  total_material_cost NUMERIC(15, 2) DEFAULT 0,
  unit_cost_pkr NUMERIC(15, 2) DEFAULT 0,
  output_lot_id UUID,
  operator_name TEXT NOT NULL DEFAULT 'Production Supervisor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_order_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  lot_id UUID REFERENCES inventory_lots(id),
  lot_number TEXT,
  planned_qty NUMERIC(12, 4) NOT NULL,
  actual_issued_qty NUMERIC(12, 4) NOT NULL DEFAULT 0,
  unit_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.17 STOCK TRANSFERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no TEXT NOT NULL UNIQUE,
  source_warehouse_code TEXT NOT NULL,
  target_warehouse_code TEXT NOT NULL,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'DISPATCHED' CHECK (status IN ('DISPATCHED', 'RECEIVED', 'CANCELLED')),
  dispatched_by TEXT NOT NULL DEFAULT 'Warehouse Supervisor',
  received_by TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  source_lot_id UUID NOT NULL,
  lot_number TEXT NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  transfer_qty NUMERIC(12, 4) NOT NULL CHECK (transfer_qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.18 CUSTOMER RECEIPT VOUCHERS (AR) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_receipt_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_no TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES parties(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE')),
  reference_no TEXT,
  bank_account_id UUID REFERENCES accounts_chart(id),
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receipt_voucher_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES customer_receipt_vouchers(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  invoice_number TEXT NOT NULL,
  allocated_amount NUMERIC(15, 2) NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.19 PAYMENT VOUCHERS (Cash, Party, Bank, Salary) ──────────────────────
CREATE TABLE IF NOT EXISTS payment_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_no TEXT UNIQUE NOT NULL,
    voucher_type TEXT NOT NULL CHECK (voucher_type IN ('CASH_PAYMENT', 'PARTY_PAYMENT', 'BANK_PAYMENT', 'SALARY_PAYMENT')),
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

-- ── 3.20 PAYROLL MODULE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_no TEXT NOT NULL UNIQUE,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL,
  total_workers INT NOT NULL DEFAULT 0,
  gross_salaries NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_loan_repayments NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'PAID')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year, month)
);

CREATE TABLE IF NOT EXISTS payroll_slips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id),
  worker_name TEXT NOT NULL,
  role_designation TEXT NOT NULL,
  base_salary NUMERIC(15, 2) NOT NULL,
  days_in_month INT NOT NULL DEFAULT 30,
  present_days INT NOT NULL DEFAULT 0,
  absent_days INT NOT NULL DEFAULT 0,
  leave_days INT NOT NULL DEFAULT 0,
  daily_rate NUMERIC(15, 2) NOT NULL,
  earned_salary NUMERIC(15, 2) NOT NULL,
  loan_deduction NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.21 SYSTEM AUDIT, BACKUPS, KPIS & USER SETTINGS ───────────────────────
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

CREATE TABLE IF NOT EXISTS system_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_name TEXT,
    backup_type TEXT CHECK (backup_type IN ('AUTOMATIC_24H', 'MANUAL')),
    backup_data JSONB,
    data_snapshot JSONB,
    records_count INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    sidebar_modules JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.22 TERMINAL PINS & DEVICE ACCOUNTS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin TEXT NOT NULL UNIQUE CHECK (LENGTH(pin) = 4 AND pin ~ '^[0-9]+$'),
    staff_name TEXT NOT NULL DEFAULT 'STAFF',
    assigned_device TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_pins (pin, staff_name, assigned_device, is_active) VALUES
('1111', 'Workshop Desk 1', 'DESK-01', true),
('2222', 'Workshop Desk 2', 'DESK-02', true),
('3333', 'Office Laptop', 'LAPTOP-01', true),
('4444', 'Main PC', 'PC-01', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    pin TEXT NOT NULL CHECK (LENGTH(pin) = 4 AND pin ~ '^[0-9]+$'),
    assigned_device TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO staff_members (email, pin, assigned_device, is_active) VALUES
('laptop1@glasscopaints.com', '1111', 'LAPTOP-01', true),
('laptop2@glasscopaints.com', '2222', 'LAPTOP-02', true),
('pc1@glasscopaints.com', '3333', 'PC-01', true),
('pc2@glasscopaints.com', '4444', 'PC-02', true),
('owner@glasscopaints.com', '0000', 'OWNER-DESK', true)
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS device_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_name TEXT NOT NULL,
    assigned_email TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL CHECK (LENGTH(pin_hash) = 64 AND pin_hash ~ '^[a-f0-9]+$'),
    role TEXT NOT NULL CHECK (role IN ('OPERATOR', 'LAB_TECH')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO device_accounts (device_name, assigned_email, pin_hash, role, is_active) VALUES
('Factory PC 1', 'pc1@glassco.com', encode(digest('1122', 'sha256'), 'hex'), 'OPERATOR', true),
('Factory PC 2', 'pc2@glassco.com', encode(digest('3344', 'sha256'), 'hex'), 'OPERATOR', true),
('Lab Laptop 1', 'laptop1@glassco.com', encode(digest('1234', 'sha256'), 'hex'), 'LAB_TECH', true),
('Lab Laptop 2', 'laptop2@glassco.com', encode(digest('5678', 'sha256'), 'hex'), 'LAB_TECH', true)
ON CONFLICT (assigned_email) DO NOTHING;

-- ── 3.23 PROFILES TABLE (Supabase Auth Mirror) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'TERMINAL',
    device_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- ============================================================================
-- 4. APPLICATION RPC FUNCTIONS & TRIGGERS
-- ============================================================================

-- ── 4.1 Stock Deduction RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_product_stock(
  p_product_id UUID,
  p_quantity   INTEGER
)
RETURNS BOOLEAN
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

-- ── 4.2 QC Guard Triggers on Inventory Lots ────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_lot_deduction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.remaining_qty < OLD.remaining_qty THEN
    IF OLD.status != 'unrestricted' THEN
      RAISE EXCEPTION
        'Lot % is locked in status "%". Material cannot be deducted or consumed until status is "unrestricted".',
        OLD.lot_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_lot_deduction ON public.inventory_lots;
CREATE TRIGGER trg_guard_lot_deduction
  BEFORE UPDATE OF remaining_qty ON public.inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_lot_deduction();

CREATE OR REPLACE FUNCTION public.sync_lot_status_from_qc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.qc_status IS DISTINCT FROM OLD.qc_status THEN
    NEW.status := CASE
      WHEN NEW.qc_status = 'PASSED' THEN 'unrestricted'
      WHEN NEW.qc_status = 'FLAGGED_WARNING' THEN 'blocked'
      ELSE 'quality_inspection'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lot_status ON public.inventory_lots;
CREATE TRIGGER trg_sync_lot_status
  BEFORE UPDATE OF qc_status ON public.inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lot_status_from_qc();

-- ── 4.3 GRN Generation from Inward Gate Pass (with draft Purchase Invoice) ─
CREATE OR REPLACE FUNCTION generate_grn_from_igp(
    p_igp_id UUID,
    p_unit_price NUMERIC DEFAULT 0,
    p_operator_name TEXT DEFAULT 'Gate Operator',
    p_device_node TEXT DEFAULT 'PC-01'
) RETURNS JSONB AS $$
DECLARE
    v_igp inward_gate_passes%ROWTYPE;
    v_vendor parties%ROWTYPE;
    v_grn_id UUID;
    v_grn_number TEXT;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_qty NUMERIC(15, 4);
    v_rejected NUMERIC(15, 4);
    v_taxable NUMERIC(15, 2);
    v_total NUMERIC(15, 2);
    v_items JSONB;
BEGIN
    SELECT * INTO v_igp FROM inward_gate_passes WHERE id = p_igp_id FOR UPDATE;
    IF v_igp.id IS NULL THEN
        RAISE EXCEPTION 'Inward Gate Pass not found: %', p_igp_id;
    END IF;

    IF v_igp.supplier_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT * INTO v_vendor FROM parties WHERE id = v_igp.supplier_id::uuid;
    END IF;

    -- Bill only what was ACCEPTED; fall back to legacy rows without the column.
    v_qty := COALESCE(v_igp.accepted_qty, v_igp.inward_qty, v_igp.gross_weight_kg, 1);
    v_rejected := COALESCE(v_igp.rejected_qty, 0);
    v_taxable := ROUND(v_qty * COALESCE(p_unit_price, 0), 2);
    v_total := v_taxable;

    v_grn_number := 'GRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_number_seq')::text, 5, '0');
    v_invoice_number := 'PINV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('purchase_invoice_seq')::text, 5, '0');

    v_items := jsonb_build_array(
        jsonb_build_object(
            'description', v_igp.material_description,
            'lot_code', COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, ''),
            'quantity', v_qty,
            'unit_of_measure', COALESCE(v_igp.unit_of_measure, 'KG'),
            'unit_price', COALESCE(p_unit_price, 0),
            'total_amount', v_total
        )
    );

    INSERT INTO goods_receipt_notes (
        grn_number,
        gate_pass_id,
        vendor_id,
        vendor_name,
        received_date,
        items,
        accepted_qty,
        rejected_qty,
        rejection_reason,
        status
    ) VALUES (
        v_grn_number,
        v_igp.id,
        v_vendor.id,
        COALESCE(v_vendor.name, v_igp.supplier_id),
        CURRENT_DATE,
        v_items,
        v_qty,
        v_rejected,
        v_igp.rejection_reason,
        'pending_invoice'
    ) RETURNING id INTO v_grn_id;

    INSERT INTO purchase_invoices (
        invoice_number,
        grn_id,
        grn_number,
        vendor_id,
        vendor_name,
        taxable_amount,
        tax_amount,
        total_payable,
        status,
        items
    ) VALUES (
        v_invoice_number,
        v_grn_id,
        v_grn_number,
        v_vendor.id,
        COALESCE(v_vendor.name, v_igp.supplier_id),
        v_taxable,
        0.00,
        v_total,
        'pending_approval',
        v_items
    ) RETURNING id INTO v_invoice_id;

    UPDATE inward_gate_passes
    SET status = 'CONVERTED_TO_GRN'
    WHERE id = v_igp.id;

    INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
    VALUES (
        p_device_node,
        p_operator_name,
        'GRN_GENERATED_FROM_IGP',
        jsonb_build_object(
            'igp_id', v_igp.id,
            'grn_id', v_grn_id,
            'grn_number', v_grn_number,
            'purchase_invoice_id', v_invoice_id,
            'invoice_number', v_invoice_number,
            'accepted_qty', v_qty,
            'rejected_qty', v_rejected,
            'uom', COALESCE(v_igp.unit_of_measure, 'KG')
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'grn_id', v_grn_id,
        'grn_number', v_grn_number,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4.4 Approve & Post Purchase Invoice (Double Entry GL) ───────────────────
CREATE OR REPLACE FUNCTION approve_and_post_purchase_invoice(
    p_invoice_id UUID,
    p_operator_name TEXT DEFAULT 'Accounts Dept',
    p_device_node TEXT DEFAULT 'PC-01'
) RETURNS JSONB AS $$
DECLARE
    v_inv purchase_invoices%ROWTYPE;
    v_ap_account_id UUID;
    v_raw_account_id UUID;
    v_entry_id UUID;
    v_entry_number TEXT;
BEGIN
    SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF v_inv.id IS NULL THEN
        RAISE EXCEPTION 'Purchase invoice not found: %', p_invoice_id;
    END IF;

    IF v_inv.status != 'pending_approval' THEN
        RAISE EXCEPTION 'Invoice is not in pending_approval status (current: %)', v_inv.status;
    END IF;

    SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
    IF v_ap_account_id IS NULL THEN
        SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_type = 'LIABILITY' LIMIT 1;
    END IF;

    SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '1101' LIMIT 1;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '5001' LIMIT 1;
    END IF;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart
        WHERE account_type IN ('EXPENSE', 'ASSET') LIMIT 1;
    END IF;

    IF v_ap_account_id IS NULL OR v_raw_account_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve AP (2001) or Inventory (1101) accounts in accounts_chart';
    END IF;

    v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
        lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

    INSERT INTO journal_entries (entry_number, entry_date, narration, customer_name, status)
    VALUES (
        v_entry_number,
        CURRENT_DATE,
        'Vendor Purchase Invoice Posted [' || v_inv.invoice_number || ' - ' || v_inv.grn_number || ']',
        v_inv.vendor_name,
        'POSTED'
    ) RETURNING id INTO v_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_raw_account_id, v_inv.vendor_id, v_inv.total_payable, 0.00);

    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_ap_account_id, v_inv.vendor_id, 0.00, v_inv.total_payable);

    UPDATE purchase_invoices SET status = 'posted' WHERE id = v_inv.id;

    IF v_inv.grn_id IS NOT NULL THEN
        UPDATE goods_receipt_notes SET status = 'invoiced' WHERE id = v_inv.grn_id;
    END IF;

    INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
    VALUES (p_device_node, p_operator_name, 'PURCHASE_INVOICE_APPROVED_POSTED',
        jsonb_build_object(
            'purchase_invoice_id', v_inv.id,
            'invoice_number',      v_inv.invoice_number,
            'total_payable',       v_inv.total_payable,
            'journal_entry_id',    v_entry_id,
            'entry_number',        v_entry_number
        ));

    RETURN jsonb_build_object(
        'success',          true,
        'invoice_id',       v_inv.id,
        'journal_entry_id', v_entry_id,
        'entry_number',     v_entry_number
    );
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4.5 Post GST Paints/Sales Invoice RPC ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_gst_paints_invoice(
  invoice_id         UUID,
  customer_id        UUID,
  taxable_value_pkr  NUMERIC,
  apply_further_tax  BOOLEAN,
  operator_name      TEXT,
  device_node        TEXT,
  line_items         JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice           sales_invoices%ROWTYPE;
  v_taxable           NUMERIC := taxable_value_pkr;
  v_sales_tax         NUMERIC;
  v_further_tax       NUMERIC;
  v_total_payable     NUMERIC;
  v_line              JSONB;
  v_entry_id          UUID;
  v_entry_number      TEXT;
  v_account_id_1100   UUID;
  v_account_id_5100   UUID;
  v_account_id_2200   UUID;
  v_account_id_2210   UUID;
BEGIN
  SELECT * INTO v_invoice
  FROM sales_invoices
  WHERE id = invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', invoice_id;
  END IF;

  IF v_invoice.is_posted THEN
    RAISE EXCEPTION 'Invoice % is already posted', v_invoice.invoice_number;
  END IF;

  IF customer_id IS NOT NULL AND v_invoice.customer_id IS DISTINCT FROM customer_id THEN
    RAISE EXCEPTION 'Customer mismatch: invoice belongs to %, got %',
      v_invoice.customer_id, customer_id;
  END IF;

  v_sales_tax     := round(v_taxable * 0.18, 2);
  v_further_tax   := CASE WHEN apply_further_tax THEN round(v_taxable * 0.04, 2) ELSE 0 END;
  v_total_payable := v_taxable + v_sales_tax + v_further_tax;

  FOR v_line IN SELECT * FROM jsonb_array_elements(line_items)
  LOOP
    INSERT INTO sales_invoice_items (
      invoice_id, product_id, product_name,
      quantity, unit_price_pkr, line_total_pkr, unit_of_measure
    ) VALUES (
      invoice_id,
      NULLIF((v_line->>'product_id')::TEXT, '')::UUID,
      COALESCE((v_line->>'product_name')::TEXT, ''),
      COALESCE((v_line->>'qty_buckets')::NUMERIC, 0),
      COALESCE((v_line->>'rate')::NUMERIC, 0),
      COALESCE((v_line->>'amount')::NUMERIC, 0),
      COALESCE((v_line->>'unit_of_measure')::TEXT, 'L')
    );
  END LOOP;

  SELECT id INTO v_account_id_1100 FROM accounts_chart WHERE account_code = '1100' LIMIT 1;
  SELECT id INTO v_account_id_5100 FROM accounts_chart WHERE account_code = '4001' LIMIT 1;
  SELECT id INTO v_account_id_2200 FROM accounts_chart WHERE account_code = '2200' LIMIT 1;
  SELECT id INTO v_account_id_2210 FROM accounts_chart WHERE account_code = '2210' LIMIT 1;

  IF v_account_id_1100 IS NULL OR v_account_id_5100 IS NULL THEN
    RAISE EXCEPTION 'Missing core accounts in accounts_chart (1100 or 4001)';
  END IF;

  v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (
    entry_number, entry_date, narration, customer_name, status
  ) VALUES (
    v_entry_number,
    CURRENT_DATE,
    'Sales Invoice ' || v_invoice.invoice_number,
    (SELECT name FROM parties WHERE id = v_invoice.customer_id),
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (
    journal_entry_id, account_id, party_id, debit_pkr, credit_pkr
  ) VALUES (
    v_entry_id, v_account_id_1100, v_invoice.customer_id, v_total_payable, 0
  );

  INSERT INTO journal_lines (
    journal_entry_id, account_id, party_id, debit_pkr, credit_pkr
  ) VALUES (
    v_entry_id, v_account_id_5100, NULL, 0, v_taxable
  );

  IF v_sales_tax > 0 AND v_account_id_2200 IS NOT NULL THEN
    INSERT INTO journal_lines (
      journal_entry_id, account_id, party_id, debit_pkr, credit_pkr
    ) VALUES (
      v_entry_id, v_account_id_2200, NULL, 0, v_sales_tax
    );
  END IF;

  IF v_further_tax > 0 AND v_account_id_2210 IS NOT NULL THEN
    INSERT INTO journal_lines (
      journal_entry_id, account_id, party_id, debit_pkr, credit_pkr
    ) VALUES (
      v_entry_id, v_account_id_2210, NULL, 0, v_further_tax
    );
  END IF;

  UPDATE sales_invoices
  SET taxable_value_pkr       = v_taxable,
      sales_tax_rate          = 18,
      sales_tax_amount_pkr    = v_sales_tax,
      further_tax_rate        = CASE WHEN apply_further_tax THEN 4 ELSE 0 END,
      further_tax_amount_pkr  = v_further_tax,
      total_invoice_value_pkr = v_total_payable,
      is_posted               = true
  WHERE id = invoice_id;

  INSERT INTO system_audit_logs (
    node_id, operator_name, action_type, details
  ) VALUES (
    post_gst_paints_invoice.device_node,
    post_gst_paints_invoice.operator_name,
    'POSTED_INVOICE',
    jsonb_build_object(
      'invoice_id',      invoice_id,
      'invoice_number',  v_invoice.invoice_number,
      'total_payable',   v_total_payable,
      'entry_number',    v_entry_number
    )
  );

  RETURN jsonb_build_object(
    'invoice_number', v_invoice.invoice_number,
    'total_payable',  v_total_payable
  );

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
  WHEN others THEN
    RAISE;
END;
$$;

-- ── 4.6 Payment Voucher Creation RPC ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_payment_voucher(
  p_voucher_type      TEXT,
  p_voucher_date      DATE,
  p_payee_name        TEXT,
  p_amount            NUMERIC,
  p_payee_address     TEXT DEFAULT NULL,
  p_cnic_ntn          TEXT DEFAULT NULL,
  p_purpose           TEXT DEFAULT NULL,
  p_reference_no      TEXT DEFAULT NULL,
  p_debit_account_id  UUID DEFAULT NULL,
  p_credit_account_id UUID DEFAULT NULL,
  p_remarks           TEXT DEFAULT NULL,
  p_amount_in_words   TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix        TEXT;
  v_voucher_no    TEXT;
  v_row           payment_vouchers%ROWTYPE;
  v_created_by    UUID;
  v_entry_id      UUID;
  v_entry_number  TEXT;
  v_debit         UUID;
  v_credit        UUID;
  v_cash          UUID;
  v_party_id      UUID;
  v_party_type    TEXT;
  v_customer_name TEXT;
  v_narration     TEXT;
  v_is_liquid     BOOLEAN;
  v_defaulted     BOOLEAN := false;
BEGIN
  IF p_voucher_type = 'CASH_PAYMENT' THEN
    v_prefix := 'CPV';
  ELSIF p_voucher_type = 'PARTY_PAYMENT' THEN
    v_prefix := 'PPV';
  ELSIF p_voucher_type = 'SALARY_PAYMENT' THEN
    v_prefix := 'SPV';
  ELSE
    v_prefix := 'BPV';
  END IF;

  v_voucher_no := v_prefix || '-' || to_char(p_voucher_date, 'YYYY') || '-' ||
    lpad(nextval('payment_voucher_seq')::TEXT, 5, '0');

  v_created_by := auth.uid();

  -- Party linkage
  SELECT id, party_type INTO v_party_id, v_party_type
  FROM parties
  WHERE lower(btrim(name)) = lower(btrim(COALESCE(p_payee_name, '')))
  ORDER BY created_at
  LIMIT 1;

  IF p_voucher_type = 'PARTY_PAYMENT' THEN

    -- DB-level guard: CUSTOMER receipts must use the Receipt Voucher path.
    -- The UI shows a redirect banner, but we enforce it here too so no API
    -- call or script can bypass it and corrupt the AR control account balance.
    IF v_party_type = 'CUSTOMER' THEN
      RAISE EXCEPTION
        'CUSTOMER_RECEIPT_BLOCKED: % is a Customer party. '
        'Record their payment as a Receipt Voucher (CRV/BRV) via the Customer Receipts screen. '
        'Payment Vouchers (PPV) are for SUPPLIER/VENDOR payments only. '
        'Voucher % not created.',
        COALESCE(p_payee_name, '(unknown)'), v_voucher_no;
    END IF;

    -- Cash/bank side: whichever parameter already carries a liquid account,
    -- else default Cash (1000).
    SELECT id INTO v_cash
    FROM accounts_chart
    WHERE id IN (p_debit_account_id, p_credit_account_id)
      AND COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
    LIMIT 1;
    IF v_cash IS NULL THEN
      SELECT id INTO v_cash FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
    END IF;
    IF v_cash IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing Cash (1000) -- cannot post party voucher %', v_voucher_no;
    END IF;

    -- Case B only (supplier): Dr AP (2001), Cr Cash/Bank
    SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
    IF v_debit IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing Accounts Payable (2001) -- cannot post voucher %', v_voucher_no;
    END IF;
    v_credit := v_cash;

  ELSE
    -- Case C: CPV / BPV / SPV -- expense/target debit, cash/bank credit
    v_debit  := p_debit_account_id;
    v_credit := p_credit_account_id;

    IF v_credit IS NULL THEN
      IF p_voucher_type IN ('BANK_PAYMENT', 'SALARY_PAYMENT') THEN
        SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1002' LIMIT 1;
      END IF;
      IF v_credit IS NULL THEN
        SELECT id INTO v_credit FROM accounts_chart WHERE account_code = '1000' LIMIT 1;
      END IF;
      IF v_credit IS NULL THEN
        RAISE EXCEPTION 'Chart of accounts missing Cash (1000) / Bank (1002) -- cannot post voucher %', v_voucher_no;
      END IF;
      v_defaulted := true;
    END IF;

    IF v_debit IS NULL THEN
      IF p_voucher_type = 'SALARY_PAYMENT' THEN
        SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '5002' LIMIT 1;
      ELSE
        SELECT id INTO v_debit FROM accounts_chart WHERE account_code = '9999' LIMIT 1;
      END IF;
      IF v_debit IS NULL THEN
        RAISE EXCEPTION 'Chart of accounts missing -- cannot resolve debit side for voucher type %', p_voucher_type;
      END IF;
      v_defaulted := true;
    END IF;

    -- Guard: debit must NOT be Cash/Bank
    SELECT COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
      INTO v_is_liquid
    FROM accounts_chart WHERE id = v_debit;
    IF COALESCE(v_is_liquid, false) THEN
      RAISE EXCEPTION 'Debit account cannot be Cash/Bank for voucher % -- pick the expense / target account instead', v_voucher_no;
    END IF;

    -- Guard: receivable control accounts (1100 AR, 1201 Trade Debts) must not
    -- appear on the debit side of a payment voucher.
    IF EXISTS (
      SELECT 1 FROM accounts_chart
       WHERE id = v_debit AND account_code IN ('1100', '1201')
    ) THEN
      RAISE EXCEPTION
        'AR_DEBIT_BLOCKED: Accounts Receivable (1100) / Trade Debts (1201) cannot be debited '
        'on a Payment Voucher (%). '
        'Record customer receipts in the Customer Receipts screen (CRV / BRV) instead.',
        v_voucher_no;
    END IF;

    -- Guard: credit MUST be Cash/Bank
    SELECT COALESCE(is_liquid_funds OR is_default_cash OR account_code IN ('1000', '1002'), false)
      INTO v_is_liquid
    FROM accounts_chart WHERE id = v_credit;
    IF NOT COALESCE(v_is_liquid, false) THEN
      RAISE EXCEPTION 'Credit account must be Cash (1000) or Bank (1002) for voucher %', v_voucher_no;
    END IF;
  END IF;

  -- Insert voucher
  INSERT INTO payment_vouchers (
    voucher_no, voucher_type, voucher_date,
    payee_name, payee_address, cnic_ntn,
    purpose, reference_no,
    debit_account_id, credit_account_id,
    amount, amount_in_words, remarks,
    created_by
  ) VALUES (
    v_voucher_no, p_voucher_type, p_voucher_date,
    p_payee_name, p_payee_address, p_cnic_ntn,
    p_purpose, p_reference_no,
    v_debit, v_credit,
    p_amount, COALESCE(p_amount_in_words, ''),
    p_remarks,
    v_created_by
  )
  RETURNING * INTO v_row;

  -- Atomic double entry
  v_narration := v_prefix || ' ' || v_voucher_no || ' -- ' || p_payee_name;
  IF v_defaulted AND v_debit = (SELECT id FROM accounts_chart WHERE account_code = '9999' LIMIT 1) THEN
    v_narration := v_narration || ' [UNCATEGORISED -- re-categorise suspense debit]';
  END IF;

  -- Stamp customer_name only when AP (2001) sits on either side
  IF EXISTS (
    SELECT 1 FROM accounts_chart
     WHERE id IN (v_debit, v_credit) AND account_code = '2001'
  ) THEN
    v_customer_name := p_payee_name;
  ELSE
    v_customer_name := NULL;
  END IF;

  v_entry_number := 'JE-' || to_char(p_voucher_date, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, customer_name, is_balanced, status)
  VALUES (v_entry_number, p_voucher_date, v_narration, v_customer_name, true, 'POSTED')
  RETURNING id INTO v_entry_id;

  -- Party is attached only to the non-liquid side (Debit = AP / expense),
  -- never to the liquid Cash/Bank line (Credit).
  INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_debit, v_party_id, p_amount, 0),
         (v_entry_id, v_credit, NULL, 0, p_amount);

  RETURN to_jsonb(v_row);
END;
$$;

-- ── 4.7 Capital Injection RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_capital_injection(
  p_amount         NUMERIC,
  p_target_account TEXT,   -- 'CASH' | 'BANK'
  p_narration      TEXT,
  p_operator_name   TEXT,
  p_device_node     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit_code   TEXT;
  v_debit_id     UUID;
  v_credit_id    UUID;
  v_entry_id     UUID;
  v_entry_number TEXT;
  v_amount       NUMERIC;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  v_amount := round(p_amount::numeric, 2);

  IF upper(COALESCE(p_target_account, '')) = 'BANK' THEN
    v_debit_code := '1002';
  ELSE
    v_debit_code := '1000';
  END IF;

  SELECT id INTO v_debit_id FROM accounts_chart WHERE account_code = v_debit_code;
  SELECT id INTO v_credit_id FROM accounts_chart WHERE account_code = '3000';

  IF v_debit_id IS NULL THEN
    RAISE EXCEPTION 'Liquid account % not found', v_debit_code;
  END IF;
  IF v_credit_id IS NULL THEN
    RAISE EXCEPTION 'Owner Equity (3000) not found in accounts_chart';
  END IF;

  v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

  INSERT INTO journal_entries (entry_number, entry_date, narration, status)
  VALUES (
    v_entry_number,
    CURRENT_DATE,
    COALESCE(NULLIF(TRIM(p_narration), ''), 'Capital injection — ' || v_debit_code),
    'POSTED'
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (v_entry_id, v_debit_id, v_amount, 0),
         (v_entry_id, v_credit_id, 0, v_amount);

  BEGIN
    INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
    VALUES (
      COALESCE(p_device_node, 'SYSTEM_LOCAL'),
      COALESCE(p_operator_name, 'OWNER'),
      'RECORDED_CAPITAL_INJECTION',
      jsonb_build_object(
        'entry_number', v_entry_number,
        'amount', v_amount,
        'target', v_debit_code
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'id', v_entry_id,
    'entry_number', v_entry_number,
    'amount', v_amount,
    'debit_account_code', v_debit_code
  );
END;
$$;

-- ── 4.7b Capital Injection List/Edit RPCs (Available Funds → Edit) ─────────
-- Structural signature of an injection entry: POSTED, no voucher_no, exactly
-- 2 party-less lines — Dr > 0 on 1000/1002, Cr > 0 on 3000, both sides equal.
CREATE OR REPLACE FUNCTION public.list_capital_injections(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id',           x.id,
             'entry_number', x.entry_number,
             'entry_date',   x.entry_date,
             'narration',    x.narration,
             'amount',       x.amount,
             'target',       x.target
           ) ORDER BY x.entry_date DESC, x.created_at DESC)
    FROM (
      SELECT je.id,
             je.entry_number,
             je.entry_date,
             je.narration,
             je.created_at,
             max(CASE WHEN a.account_code IN ('1000','1002') THEN jl.debit_pkr END) AS amount,
             max(CASE WHEN a.account_code = '1002' THEN 'BANK'
                      WHEN a.account_code = '1000' THEN 'CASH' END)                AS target
      FROM journal_entries je
      JOIN journal_lines  jl ON jl.journal_entry_id = je.id
      JOIN accounts_chart a  ON a.id = jl.account_id
      WHERE je.status = 'POSTED'
        AND je.voucher_no IS NULL
        AND (SELECT count(*) FROM journal_lines c
              WHERE c.journal_entry_id = je.id) = 2
        AND NOT EXISTS (
              SELECT 1 FROM journal_lines pl
               WHERE pl.journal_entry_id = je.id AND pl.party_id IS NOT NULL)
        AND EXISTS (
              SELECT 1 FROM journal_lines d
                JOIN accounts_chart da ON da.id = d.account_id
               WHERE d.journal_entry_id = je.id
                 AND da.account_code IN ('1000','1002')
                 AND d.debit_pkr > 0 AND d.credit_pkr = 0)
        AND EXISTS (
              SELECT 1 FROM journal_lines cr
                JOIN accounts_chart ca ON ca.id = cr.account_id
               WHERE cr.journal_entry_id = je.id
                 AND ca.account_code = '3000'
                 AND cr.credit_pkr > 0 AND cr.debit_pkr = 0)
      GROUP BY je.id, je.entry_number, je.entry_date, je.narration, je.created_at
      HAVING max(CASE WHEN a.account_code IN ('1000','1002') THEN jl.debit_pkr END)
           = max(CASE WHEN a.account_code = '3000' THEN jl.credit_pkr END)
      ORDER BY je.entry_date DESC, je.created_at DESC
      LIMIT COALESCE(p_limit, 50)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_capital_injection(
  p_entry_id        UUID,
  p_amount          NUMERIC,
  p_target_account  TEXT,   -- 'CASH' | 'BANK'
  p_narration       TEXT,
  p_operator_name   TEXT,
  p_device_node     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit_code   TEXT;
  v_debit_id     UUID;
  v_credit_id    UUID;
  v_amount       NUMERIC;
  v_entry_number TEXT;
  v_old_amount   NUMERIC;
  v_old_code     TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  v_amount := round(p_amount::numeric, 2);

  IF upper(COALESCE(p_target_account, '')) = 'BANK' THEN
    v_debit_code := '1002';
  ELSE
    v_debit_code := '1000';
  END IF;

  SELECT id INTO v_debit_id  FROM accounts_chart WHERE account_code = v_debit_code;
  SELECT id INTO v_credit_id FROM accounts_chart WHERE account_code = '3000';
  IF v_debit_id IS NULL THEN
    RAISE EXCEPTION 'Liquid account % not found', v_debit_code;
  END IF;
  IF v_credit_id IS NULL THEN
    RAISE EXCEPTION 'Owner Equity (3000) not found in accounts_chart';
  END IF;

  SELECT je.entry_number
    INTO v_entry_number
  FROM journal_entries je
  WHERE je.id = p_entry_id
    AND je.status = 'POSTED'
    AND je.voucher_no IS NULL
    AND (SELECT count(*) FROM journal_lines c
          WHERE c.journal_entry_id = je.id) = 2
    AND NOT EXISTS (
          SELECT 1 FROM journal_lines pl
           WHERE pl.journal_entry_id = je.id AND pl.party_id IS NOT NULL)
    AND EXISTS (
          SELECT 1 FROM journal_lines d
            JOIN accounts_chart da ON da.id = d.account_id
           WHERE d.journal_entry_id = je.id
             AND da.account_code IN ('1000','1002')
             AND d.debit_pkr > 0 AND d.credit_pkr = 0)
    AND EXISTS (
          SELECT 1 FROM journal_lines cr
            JOIN accounts_chart ca ON ca.id = cr.account_id
           WHERE cr.journal_entry_id = je.id
             AND ca.account_code = '3000'
             AND cr.credit_pkr > 0 AND cr.debit_pkr = 0)
  FOR UPDATE OF je;

  IF v_entry_number IS NULL THEN
    RAISE EXCEPTION 'Capital injection entry not found or not editable';
  END IF;

  SELECT jl.debit_pkr, a.account_code
    INTO v_old_amount, v_old_code
  FROM journal_lines jl
  JOIN accounts_chart a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = p_entry_id
    AND a.account_code IN ('1000','1002')
  LIMIT 1;

  DELETE FROM journal_lines WHERE journal_entry_id = p_entry_id;

  INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
  VALUES (p_entry_id, v_debit_id, v_amount, 0),
         (p_entry_id, v_credit_id, 0, v_amount);

  UPDATE journal_entries
     SET narration = COALESCE(NULLIF(TRIM(COALESCE(p_narration, '')), ''),
                              'Capital injection — ' || v_debit_code),
         is_balanced = TRUE
   WHERE id = p_entry_id;

  BEGIN
    INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
    VALUES (
      COALESCE(p_device_node, 'SYSTEM_LOCAL'),
      COALESCE(p_operator_name, 'OWNER'),
      'UPDATED_CAPITAL_INJECTION',
      jsonb_build_object(
        'entry_number',     v_entry_number,
        'previous_amount',  v_old_amount,
        'amount',           v_amount,
        'previous_target',  v_old_code,
        'target',           v_debit_code
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'id',                p_entry_id,
    'entry_number',      v_entry_number,
    'amount',            v_amount,
    'debit_account_code', v_debit_code,
    'previous_amount',   v_old_amount
  );
END;
$$;

-- ── 4.8 Custom Backup Snapshot RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_custom_backup_snapshot(
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_backup_id UUID;
    v_snapshot JSONB;
    v_inward_data JSONB;
    v_wh01_data JSONB;
    v_wh02_data JSONB;
    v_sales_data JSONB;
    v_ledger_data JSONB;
    v_audit_data JSONB;
    v_total_records INT := 0;
BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_inward_data
    FROM inward_gate_passes t
    WHERE t.created_at BETWEEN start_date AND end_date;

    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_wh01_data
    FROM inventory_wh01_raw t;

    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_wh02_data
    FROM inventory_wh02_finished t;

    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_sales_data
    FROM sales_invoices t
    WHERE t.created_at BETWEEN start_date AND end_date;

    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_ledger_data
    FROM journal_entries t
    WHERE t.created_at BETWEEN start_date AND end_date;

    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_audit_data
    FROM system_audit_logs t
    WHERE t.timestamp BETWEEN start_date AND end_date;

    v_total_records := jsonb_array_length(v_inward_data) +
                       jsonb_array_length(v_wh01_data) +
                       jsonb_array_length(v_wh02_data) +
                       jsonb_array_length(v_sales_data) +
                       jsonb_array_length(v_ledger_data) +
                       jsonb_array_length(v_audit_data);

    v_snapshot := jsonb_build_object(
        'metadata', jsonb_build_object(
            'generated_at', NOW(),
            'backup_type', 'MANUAL',
            'start_date', start_date,
            'end_date', end_date,
            'total_records', v_total_records
        ),
        'tables', jsonb_build_object(
            'inward_gate_passes', v_inward_data,
            'inventory_wh01_raw', v_wh01_data,
            'inventory_wh02_finished', v_wh02_data,
            'sales_invoices', v_sales_data,
            'journal_entries', v_ledger_data,
            'system_audit_logs', v_audit_data
        )
    );

    INSERT INTO system_backups (backup_type, data_snapshot, records_count)
    VALUES ('MANUAL', v_snapshot, v_total_records)
    RETURNING id INTO v_backup_id;

    INSERT INTO system_audit_logs (operator_name, node_id, action_type, details)
    VALUES (
        CURRENT_USER,
        'RPC_NODE',
        'CUSTOM_BACKUP_GENERATED',
        jsonb_build_object(
            'backup_id', v_backup_id,
            'start_date', start_date,
            'end_date', end_date,
            'records_count', v_total_records
        )
    );

    RETURN jsonb_build_object(
        'status', 'SUCCESS',
        'backup_id', v_backup_id,
        'records_count', v_total_records,
        'snapshot', v_snapshot
    );
END;
$$;

-- ── 4.9 Auth Trigger & Profile Auto-Creation ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''), 'TERMINAL');
  IF v_role NOT IN ('OWNER','TERMINAL') THEN v_role := 'TERMINAL'; END IF;
  BEGIN
    INSERT INTO public.profiles (id, email, role, device_name)
    VALUES (NEW.id, NEW.email, v_role, NEW.raw_user_meta_data->>'device_name')
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile not created for %: %', NEW.email, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Self-heal RPC: ensure_my_profile (used by src/lib/supabase/auth.ts)
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_meta  JSONB;
  v_role  TEXT;
  v_row   public.profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT email, COALESCE(raw_user_meta_data,'{}'::jsonb)
    INTO v_email, v_meta
    FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'auth user not found'; END IF;

  v_role := COALESCE(NULLIF(v_meta->>'role',''), 'TERMINAL');
  IF v_role NOT IN ('OWNER','TERMINAL') THEN v_role := 'TERMINAL'; END IF;

  INSERT INTO public.profiles (id, email, role, device_name)
  VALUES (v_uid, v_email, v_role, v_meta->>'device_name')
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'profile row missing and could not be created';
  END IF;
  RETURN v_row;
END;
$$;

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) & GRANTS
-- ============================================================================

DO $$
DECLARE
  tbl text;
  all_tables text[] := ARRAY[
    'parties', 'inventory_warehouses', 'products_master', 'sanitary_products',
    'inward_gate_passes', 'goods_receipt_notes', 'purchase_invoices',
    'inventory_balances', 'inventory_lots', 'inventory_wh01_raw',
    'inventory_wh02_finished', 'batch_orders', 'workers', 'worker_attendance',
    'worker_loans', 'loan_repayment_logs', 'accounts_chart', 'journal_entries',
    'journal_lines', 'qc_records', 'sales_invoices', 'sales_invoice_items',
    'dispatch_records', 'dispatches', 'invoices', 'product_deliveries',
    'bill_of_materials', 'bom_items', 'production_orders',
    'production_order_materials', 'stock_transfers', 'stock_transfer_items',
    'customer_receipt_vouchers', 'receipt_voucher_allocations',
    'payment_vouchers', 'payroll_runs', 'payroll_slips', 'system_audit_logs',
    'system_backups', 'dashboard_kpis', 'system_pins', 'staff_members',
    'device_accounts'
  ];
BEGIN
  FOREACH tbl IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "erp_full_access" ON %I;', tbl);
    EXECUTE format('CREATE POLICY "erp_full_access" ON %I FOR ALL USING (true) WITH CHECK (true);', tbl);
    EXECUTE format('GRANT ALL ON %I TO authenticated, service_role, anon;', tbl);
  END LOOP;
END $$;

-- RLS for user_settings: strictly per-user
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own settings" ON user_settings;
CREATE POLICY "Users read own settings" ON user_settings FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own settings" ON user_settings;
CREATE POLICY "Users insert own settings" ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own settings" ON user_settings;
CREATE POLICY "Users update own settings" ON user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own settings" ON user_settings;
CREATE POLICY "Users delete own settings" ON user_settings FOR DELETE USING (auth.uid() = user_id);
GRANT ALL ON user_settings TO authenticated, service_role;

-- RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
CREATE POLICY "Service role can insert profiles" ON public.profiles FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated can insert profiles" ON public.profiles;
CREATE POLICY "Authenticated can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (true);
GRANT ALL ON public.profiles TO authenticated, service_role, anon;

-- Function execution grants
GRANT EXECUTE ON FUNCTION public.deduct_product_stock(UUID, INTEGER) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.generate_grn_from_igp(UUID, NUMERIC, TEXT, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.approve_and_post_purchase_invoice(UUID, TEXT, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.post_gst_paints_invoice(UUID, UUID, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.create_payment_voucher(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.record_capital_injection(NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.list_capital_injections(INT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.update_capital_injection(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.generate_custom_backup_snapshot(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated, service_role;

-- Sequence grants
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role, anon;

-- Realtime Publication
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE system_audit_logs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 6. SYSTEM SEED DATA (Chart of Accounts, Raw Materials, Workers & Auth)
-- ============================================================================

-- ── 6.1 Chart of Accounts (COA) ─────────────────────────────────────────────
INSERT INTO accounts_chart (account_code, account_name, account_type, is_default_cash, is_liquid_funds) VALUES
    ('1000', 'Cash in Hand', 'ASSET', true, true),
    ('1002', 'Bank Account', 'ASSET', false, true),
    ('1100', 'Accounts Receivable', 'ASSET', false, false),
    ('1101', 'Raw Material & Chemicals Asset', 'ASSET', false, false),
    ('1102', 'Finished Goods Asset', 'ASSET', false, false),
    ('1201', 'Trade Debts', 'ASSET', false, false),
    ('2001', 'Accounts Payable (Vendors)', 'LIABILITY', false, false),
    ('2002', 'FBR Sales Tax Payable', 'LIABILITY', false, false),
    ('2200', 'Sales Tax Collected', 'LIABILITY', false, false),
    ('2210', 'Further Tax Payable', 'LIABILITY', false, false),
    ('2300', 'Wages Payable', 'LIABILITY', false, false),
    ('3000', 'Owner Equity', 'EQUITY', false, false),
    ('3100', 'Retained Earnings', 'EQUITY', false, false),
    ('4001', 'Sales Revenue', 'REVENUE', false, false),
    ('4002', 'Other Income', 'REVENUE', false, false),
    ('5001', 'Raw Material Consumption Expense', 'EXPENSE', false, false),
    ('5002', 'Salary & Wages Expense', 'EXPENSE', false, false),
    ('5003', 'Utilities Expense', 'EXPENSE', false, false),
    ('5004', 'Rent Expense', 'EXPENSE', false, false),
    ('5005', 'Freight Expense', 'EXPENSE', false, false),
    ('5006', 'Cost of Goods Sold', 'EXPENSE', false, false),
    ('5100', 'Sales Revenue (Legacy)', 'REVENUE', false, false),
    ('5200', 'Factory Utilities Expense', 'EXPENSE', false, false),
    ('9999', 'Suspense / Uncategorised Payments', 'ASSET', false, false)
ON CONFLICT (account_code) DO UPDATE SET
    account_name = EXCLUDED.account_name,
    account_type = EXCLUDED.account_type,
    is_default_cash = EXCLUDED.is_default_cash,
    is_liquid_funds = EXCLUDED.is_liquid_funds;

-- ── 6.2 Raw Materials Master Catalog ────────────────────────────────────────
INSERT INTO public.products_master (id, name, sku, category, item_type, unit_of_measure, minimum_stock_alert)
VALUES
  ('9a000000-0000-0000-0000-000000000001', 'Ceramic Clay White',           'RM-CLAY-001',  'Ceramics',   'RAW_MATERIAL', 'KG', 50),
  ('9a000000-0000-0000-0000-000000000002', 'Brass Ingot',                  'RM-BRASS-002', 'Metals',     'RAW_MATERIAL', 'KG', 50),
  ('9a000000-0000-0000-0000-000000000003', 'Chrome Plating Solution',      'RM-CHR-003',   'Chemicals',  'RAW_MATERIAL', 'L',  20),
  ('9a000000-0000-0000-0000-000000000004', 'Rubber Gasket Stock',          'RM-GASK-004',  'Components', 'RAW_MATERIAL', 'KG', 100),
  ('9a000000-0000-0000-0000-000000000005', 'Silicone Sealant',             'RM-SIL-005',   'Adhesives',  'RAW_MATERIAL', 'KG', 20),
  ('9a000000-0000-0000-0000-000000000006', 'PVC Fitting Compound',         'RM-PVC-006',   'Polymers',   'RAW_MATERIAL', 'KG', 50),
  ('9a000000-0000-0000-0000-000000000007', 'PVC Resin SG5',                'RM-RES-007',   'Polymers',   'RAW_MATERIAL', 'KG', 50),
  ('9a000000-0000-0000-0000-000000000008', 'Stainless Steel Sheet 304',    'RM-SS-008',    'Metals',     'RAW_MATERIAL', 'KG', 25),
  ('9a000000-0000-0000-0000-000000000009', 'PVC Stabilizer Calcium Zinc',  'RM-STAB-009',  'Chemicals',  'RAW_MATERIAL', 'KG', 20),
  ('9a000000-0000-0000-0000-000000000010', 'Zinc Chrome Plating Salt',     'RM-ZN-010',    'Chemicals',  'RAW_MATERIAL', 'KG', 20)
ON CONFLICT (name) DO NOTHING;

-- ── 6.3 Sanitary Finished Products Catalog ─────────────────────────────────
INSERT INTO public.sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'SAN-WB-001', 'Ceramic Wash Basin Single Hole', 'Basins', 'Countertop', 'Gloss White', 'Ceramic', 4500.00, 10, 50, 50),
  ('d0000000-0000-0000-0000-000000000002', 'SAN-FC-001', 'Health Faucet Chrome Brass', 'Faucets', 'Sanitary Spray', 'Mirror Chrome', 'Brass', 1850.00, 20, 120, 120),
  ('d0000000-0000-0000-0000-000000000003', 'SAN-BC-001', 'Bib Cock 1/2 inch Premium', 'Faucets', 'Valves', 'Chrome Plated', 'Brass', 950.00, 25, 200, 200),
  ('d0000000-0000-0000-0000-000000000004', 'SAN-FT-001', 'Dual Flush Cistern Tank 6L', 'Flush Tanks', 'Plastic Cistern', 'White Poly', 'PVC', 2200.00, 15, 80, 80)
ON CONFLICT (sku) DO NOTHING;

-- ── 6.4 Staff & Workers Seed ───────────────────────────────────────────────
INSERT INTO workers (id, full_name, role_designation, base_salary_pkr, joining_date, is_active, designation, daily_rate_pkr, status, worker_code)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Muhammad Ali',     'Machine Operator',  75000, '2024-01-10', true, 'Machine Operator',  2500, 'ACTIVE', 'W-001'),
  ('10000000-0000-0000-0000-000000000002', 'Ahmed Hassan',     'Quality Inspector', 90000, '2024-02-15', true, 'Quality Inspector', 3000, 'ACTIVE', 'W-002'),
  ('10000000-0000-0000-0000-000000000003', 'Bilal Ahmad',      'Warehouse Worker',  60000, '2024-03-01', true, 'Warehouse Worker',  2000, 'ACTIVE', 'W-003'),
  ('10000000-0000-0000-0000-000000000004', 'Tariq Mehmood',    'Production Lead',  105000, '2023-11-20', true, 'Production Lead',   3500, 'ACTIVE', 'W-004'),
  ('10000000-0000-0000-0000-000000000005', 'Usman Ghani',      'Packaging Staff',   60000, '2024-04-01', true, 'Packaging Staff',   2000, 'ACTIVE', 'W-005'),
  ('10000000-0000-0000-0000-000000000006', 'Zahid Iqbal',      'Forklift Operator', 84000, '2024-01-25', true, 'Forklift Operator', 2800, 'ACTIVE', 'W-006'),
  ('10000000-0000-0000-0000-000000000007', 'Imran Shah',       'Helper',            54000, '2024-05-10', true, 'Helper',            1800, 'ACTIVE', 'W-007'),
  ('10000000-0000-0000-0000-000000000008', 'Kamran Yousuf',    'Security Guard',    66000, '2024-02-28', true, 'Security Guard',    2200, 'ACTIVE', 'W-008')
ON CONFLICT (worker_code) DO NOTHING;

-- ── 6.5 Initial Parties (Suppliers & Customers) ────────────────────────────
INSERT INTO parties (id, name, party_type, phone, email, address, is_registered, opening_balance, opening_balance_type)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Master Sanitary Industries', 'SUPPLIER', '0300-1112233', 'info@mastersanitary.pk', 'Gujranwala Industrial Estate', true, 0, 'Cr'),
  ('b0000000-0000-0000-0000-000000000002', 'Falcon Metals & Minerals',   'SUPPLIER', '0321-4455667', 'sales@falconmetals.com', 'Lahore Ring Road', true, 0, 'Cr'),
  ('b0000000-0000-0000-0000-000000000003', 'Faisalabad Fixtures Ltd',     'CUSTOMER', '0333-7788990', 'orders@faisalabadfixtures.pk', 'D-Ground, Faisalabad', true, 0, 'Dr'),
  ('b0000000-0000-0000-0000-000000000004', 'Peshawar Plumbing Co',       'CUSTOMER', '0312-3344556', 'contact@peshawarplumbing.com', 'Karkhano Market, Peshawar', false, 0, 'Dr'),
  ('b0000000-0000-0000-0000-000000000005', 'Islamabad Hardware Store',    'CUSTOMER', '0345-9988776', 'isbhardware@gmail.com', 'I-9 Industrial Area, Islamabad', true, 0, 'Dr')
ON CONFLICT (id) DO NOTHING;

-- ── 6.6 Seed Auth Users (Default Login Accounts) ────────────────────────────
-- Automatically detects the new project's instance_id
DO $$
DECLARE
  correct_instance_id UUID;
BEGIN
  SELECT instance_id INTO correct_instance_id FROM auth.users LIMIT 1;
  IF correct_instance_id IS NULL THEN
    SELECT id INTO correct_instance_id FROM auth.instances LIMIT 1;
  END IF;
  IF correct_instance_id IS NULL THEN
    correct_instance_id := '00000000-0000-0000-0000-000000000000';
  END IF;

  -- 1. Owner Account (Credentials: owner@glasscosanitary.com / Owner@2026!)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'owner@glasscosanitary.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_user_meta_data,
      raw_app_meta_data,
      confirmation_token, email_change, email_change_token_new,
      email_change_token_current, recovery_token
    ) VALUES (
      correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
      'owner@glasscosanitary.com', crypt('Owner@2026!', gen_salt('bf')),
      now(), now(), now(),
      '{"role":"OWNER","device_name":"Owner Remote"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '', '', '', '', ''
    );
  END IF;

  -- 2. POS Terminal 1 (Credentials: pos1@glasscosanitary.com / node1-pass)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'pos1@glasscosanitary.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_user_meta_data,
      raw_app_meta_data,
      confirmation_token, email_change, email_change_token_new,
      email_change_token_current, recovery_token
    ) VALUES (
      correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
      'pos1@glasscosanitary.com', crypt('node1-pass', gen_salt('bf')),
      now(), now(), now(),
      '{"role":"TERMINAL","device_name":"Counter Node 1"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '', '', '', '', ''
    );
  END IF;

  -- 3. POS Terminal 2 (Credentials: pos2@glasscosanitary.com / node2-pass)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'pos2@glasscosanitary.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_user_meta_data,
      raw_app_meta_data,
      confirmation_token, email_change, email_change_token_new,
      email_change_token_current, recovery_token
    ) VALUES (
      correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
      'pos2@glasscosanitary.com', crypt('node2-pass', gen_salt('bf')),
      now(), now(), now(),
      '{"role":"TERMINAL","device_name":"Counter Node 2"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '', '', '', '', ''
    );
  END IF;

  -- 4. Warehouse Tablet (Credentials: warehouse@glasscosanitary.com / node3-pass)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'warehouse@glasscosanitary.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_user_meta_data,
      raw_app_meta_data,
      confirmation_token, email_change, email_change_token_new,
      email_change_token_current, recovery_token
    ) VALUES (
      correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
      'warehouse@glasscosanitary.com', crypt('node3-pass', gen_salt('bf')),
      now(), now(), now(),
      '{"role":"TERMINAL","device_name":"Warehouse Tablet"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '', '', '', '', ''
    );
  END IF;

  -- 5. Office Laptop (Credentials: office@glasscosanitary.com / node4-pass)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'office@glasscosanitary.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_user_meta_data,
      raw_app_meta_data,
      confirmation_token, email_change, email_change_token_new,
      email_change_token_current, recovery_token
    ) VALUES (
      correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
      'office@glasscosanitary.com', crypt('node4-pass', gen_salt('bf')),
      now(), now(), now(),
      '{"role":"TERMINAL","device_name":"Office Laptop"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '', '', '', '', ''
    );
  END IF;
END $$;

-- Every manually seeded user also needs an auth.identities row for the email
-- provider, otherwise Supabase Auth cannot resolve them at sign-in.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities'
      AND column_name = 'provider_id'
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    SELECT gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    FROM auth.users u
    WHERE u.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.identities i
        WHERE i.user_id = u.id AND i.provider = 'email'
      )
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    SELECT gen_random_uuid(), u.id,
      jsonb_build_object('sub', u.id::text, 'email', u.email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    FROM auth.users u
    WHERE u.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.identities i
        WHERE i.user_id = u.id AND i.provider = 'email'
      )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── 6.7 Backfill Profiles for Auth Users ────────────────────────────────────
INSERT INTO public.profiles (id, email, role, device_name)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'role', 'TERMINAL'),
  au.raw_user_meta_data->>'device_name'
FROM auth.users au
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  device_name = EXCLUDED.device_name;

-- Ensure owner profile role is OWNER
UPDATE public.profiles
SET role = 'OWNER'
WHERE lower(email) = 'owner@glasscosanitary.com';

-- ============================================================================
-- FINISHED! Everything is set up cleanly for the new Supabase project.
-- ============================================================================
