-- ============================================================================
-- Migration: Product Deliveries & Atomic Stock Dispatch
-- Date: 2026-09-13
-- Description: Creates product_deliveries table for dispatch/delivery workflow,
--              adds RPC for atomic stock deduction, and adds search indexes.
-- ============================================================================

-- 1. Create product_deliveries table
-- ─────────────────────────────────────────────────────
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

-- 2. Indexes for fast lookup
-- ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_product_deliveries_product_id ON product_deliveries(product_id);
CREATE INDEX IF NOT EXISTS idx_product_deliveries_created_at ON product_deliveries(created_at DESC);

-- 3. RLS on product_deliveries
-- ─────────────────────────────────────────────────────
ALTER TABLE product_deliveries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Allow all anon access' AND tablename = 'product_deliveries'
  ) THEN
    CREATE POLICY "Allow all anon access" ON product_deliveries
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 4. Atomic stock deduction function (prevents overselling)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION deduct_product_stock(
  p_product_id UUID,
  p_quantity INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_current_stock INT;
BEGIN
  SELECT available_stock INTO v_current_stock
  FROM sanitary_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_current_stock < p_quantity THEN
    RETURN FALSE;
  END IF;

  UPDATE sanitary_products
  SET available_stock = available_stock - p_quantity,
      total_stock = total_stock - p_quantity
  WHERE id = p_product_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 5. Full-text search index on SKU and name for fast autocomplete
-- ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sanitary_products_name_trgm
  ON sanitary_products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sanitary_products_sku_trgm
  ON sanitary_products USING gin (sku gin_trgm_ops);
