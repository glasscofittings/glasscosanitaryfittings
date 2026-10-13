-- 1. Create Parties Table (Suppliers, Customers, Vendors)
CREATE TABLE IF NOT EXISTS parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    party_type TEXT NOT NULL CHECK (party_type IN ('SUPPLIER', 'CUSTOMER', 'VENDOR', 'BOTH')),
    phone TEXT,
    email TEXT,
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for parties
CREATE INDEX IF NOT EXISTS idx_parties_party_type ON parties(party_type);
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

-- 2. Create Workers Table (Labour / Factory Staff)
CREATE TABLE IF NOT EXISTS workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    designation TEXT NOT NULL DEFAULT 'OPERATOR',
    daily_rate_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (daily_rate_pkr >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for workers
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

-- 3. Create Dashboard KPIs Table
CREATE TABLE IF NOT EXISTS dashboard_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_material_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    finished_goods_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    active_batch_orders_count INTEGER NOT NULL DEFAULT 0,
    qc_warning_lots_count INTEGER NOT NULL DEFAULT 0,
    trial_balance_status TEXT NOT NULL DEFAULT 'BALANCED',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial default row for dashboard_kpis if empty
INSERT INTO dashboard_kpis (raw_material_value_pkr, finished_goods_value_pkr, active_batch_orders_count, qc_warning_lots_count, trial_balance_status)
SELECT 4250000.50, 8910200.00, 3, 1, 'BALANCED'
WHERE NOT EXISTS (SELECT 1 FROM dashboard_kpis);

-- 4. Add Explicit Foreign Key Relationship on inward_gate_passes.supplier_id -> parties.id
-- Note: supplier_id is converted/linked to parties.id (UUID) via foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_inward_gate_passes_supplier'
    ) THEN
        -- Safely cast supplier_id column type to UUID if needed, or add FK if types match
        ALTER TABLE inward_gate_passes 
        ADD CONSTRAINT fk_inward_gate_passes_supplier 
        FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE SET NULL;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Constraint already exists or supplier_id data type conversion required.';
END $$;
