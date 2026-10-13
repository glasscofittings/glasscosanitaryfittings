-- ============================================================================
-- DISPATCHES — tracks product dispatches to customers
-- INVOICES — auto-generated from dispatches, linking dispatch_id as required FK
-- ============================================================================

-- Dispatches table: records every product dispatched from inventory
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

CREATE INDEX IF NOT EXISTS idx_dispatches_product ON dispatches(product_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_customer ON dispatches(customer_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON dispatches(dispatch_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);

-- Invoices table: generated from dispatches, dispatch_id is a required FK
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE,
  dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES sanitary_products(id) ON DELETE RESTRICT,
  quantity_dispatched NUMERIC(12, 4) NOT NULL CHECK (quantity_dispatched > 0),
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DISPATCHED_INVOICED' CHECK (status IN ('DISPATCHED_INVOICED', 'PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_dispatch ON invoices(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_product ON invoices(product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at DESC);

-- RLS policies
ALTER TABLE dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "erp_full_access" ON dispatches;
CREATE POLICY "erp_full_access" ON dispatches FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "erp_full_access" ON invoices;
CREATE POLICY "erp_full_access" ON invoices FOR ALL USING (true) WITH CHECK (true);
