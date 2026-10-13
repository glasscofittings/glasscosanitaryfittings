-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Inward Gate Passes Table
CREATE TABLE IF NOT EXISTS inward_gate_passes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id TEXT NOT NULL,
    material_description TEXT NOT NULL,
    vendor_lot_number TEXT NOT NULL,
    coa_code TEXT,
    gross_weight_kg NUMERIC(12, 3) NOT NULL CHECK (gross_weight_kg >= 0),
    net_weight_kg NUMERIC(12, 3) NOT NULL CHECK (net_weight_kg >= 0),
    status TEXT NOT NULL DEFAULT 'PENDING_INSPECTION',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for inward_gate_passes
CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_supplier_id ON inward_gate_passes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_status ON inward_gate_passes(status);
CREATE INDEX IF NOT EXISTS idx_inward_gate_passes_created_at ON inward_gate_passes(created_at DESC);

-- 2. Raw Material Warehouse Inventory Table (WH01)
CREATE TABLE IF NOT EXISTS inventory_wh01_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_sku TEXT NOT NULL,
    lot_number TEXT NOT NULL UNIQUE,
    balance_kg NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (balance_kg >= 0),
    expiry_date DATE,
    location TEXT NOT NULL DEFAULT 'WH01-GENERAL'
);

-- Indexes for inventory_wh01_raw
CREATE INDEX IF NOT EXISTS idx_inventory_wh01_material_sku ON inventory_wh01_raw(material_sku);
CREATE INDEX IF NOT EXISTS idx_inventory_wh01_expiry_date ON inventory_wh01_raw(expiry_date);

-- 3. Finished Goods Warehouse Inventory Table (WH02)
CREATE TABLE IF NOT EXISTS inventory_wh02_finished (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_sku TEXT NOT NULL,
    lot_number TEXT NOT NULL UNIQUE,
    balance_liters NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (balance_liters >= 0),
    qc_status TEXT NOT NULL DEFAULT 'PENDING',
    expiry_date DATE
);

-- Indexes for inventory_wh02_finished
CREATE INDEX IF NOT EXISTS idx_inventory_wh02_product_sku ON inventory_wh02_finished(product_sku);
CREATE INDEX IF NOT EXISTS idx_inventory_wh02_qc_status ON inventory_wh02_finished(qc_status);

-- 4. System Audit Logs Table
CREATE TABLE IF NOT EXISTS system_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operator_name TEXT NOT NULL,
    node_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes for system_audit_logs
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_timestamp ON system_audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_node_id ON system_audit_logs(node_id);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_action_type ON system_audit_logs(action_type);

-- Enable Realtime CDC for system_audit_logs
ALTER PUBLICATION supabase_realtime ADD TABLE system_audit_logs;
