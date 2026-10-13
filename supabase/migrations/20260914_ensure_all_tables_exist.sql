-- ============================================================================
-- Diagnostic: Check and create missing tables/functions
-- Date: 2026-09-14
-- Run this in Supabase SQL Editor to ensure everything exists.
-- ============================================================================

-- 1. Ensure pg_trgm extension (for search indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Ensure sanitary_products table exists
CREATE TABLE IF NOT EXISTS sanitary_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  finish TEXT,
  material TEXT,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 0,
  available_stock INT NOT NULL DEFAULT 0,
  total_stock INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Ensure product_deliveries table exists
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

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_product_deliveries_product_id ON product_deliveries(product_id);
CREATE INDEX IF NOT EXISTS idx_product_deliveries_created_at ON product_deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sanitary_products_name_trgm ON sanitary_products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sanitary_products_sku_trgm ON sanitary_products USING gin (sku gin_trgm_ops);

-- 5. RLS on product_deliveries (permissive)
ALTER TABLE product_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all anon access" ON product_deliveries;
CREATE POLICY "Allow all anon access" ON product_deliveries
  FOR ALL USING (true) WITH CHECK (true);

-- 6. Ensure deduct_product_stock RPC exists
DROP FUNCTION IF EXISTS public.deduct_product_stock(UUID, INT);
DROP FUNCTION IF EXISTS public.deduct_product_stock(UUID, INTEGER);

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

GRANT EXECUTE ON FUNCTION public.deduct_product_stock(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_product_stock(UUID, INTEGER) TO service_role;

-- 7. Verify: list all tables in public schema
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
