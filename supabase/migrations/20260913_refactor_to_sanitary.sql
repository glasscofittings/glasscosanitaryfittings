-- ============================================================================
-- Migration: Refactor from Paint Manufacturing to Sanitary Products Distribution
-- Date: 2026-09-13
-- Description: Drops chemical formula tables, creates sanitary_products table,
--              updates IGP/GRN/invoicing references.
-- ============================================================================

-- 1. Drop chemical formula tables and BOM dependencies
-- ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS bom_items CASCADE;
DROP TABLE IF EXISTS bill_of_materials CASCADE;
DROP TABLE IF EXISTS formulas CASCADE;
DROP TABLE IF EXISTS formula_boms CASCADE;

-- 2. Create sanitary_products table
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sanitary_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  subcategory VARCHAR(100),
  finish VARCHAR(50),
  material VARCHAR(50),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  total_stock INT NOT NULL DEFAULT 0,
  available_stock INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add product_id FK to inward_gate_passes referencing sanitary_products
-- ─────────────────────────────────────────────────────
ALTER TABLE inward_gate_passes
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES sanitary_products(id);

-- 4. Add product_id FK to goods_received_notes if it doesn't exist
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goods_received_notes' AND column_name = 'product_id'
  ) THEN
    ALTER TABLE goods_received_notes
      ADD COLUMN product_id UUID REFERENCES sanitary_products(id);
  END IF;
END $$;

-- 5. Add product_id to sales_invoices line items if needed
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales_invoice_items' AND column_name = 'product_id'
  ) THEN
    ALTER TABLE sales_invoice_items
      ADD COLUMN product_id UUID REFERENCES sanitary_products(id);
  END IF;
END $$;

-- 6. Seed default sanitary product categories via CHECK constraints (Postgres 12+)
-- ─────────────────────────────────────────────────────
-- Categories enforced at application layer; no DB CHECK needed for flexibility.

-- 7. Index for fast category filtering
-- ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sanitary_products_category ON sanitary_products(category);
CREATE INDEX IF NOT EXISTS idx_sanitary_products_sku ON sanitary_products(sku);

-- 8. Enable RLS on sanitary_products
-- ─────────────────────────────────────────────────────
ALTER TABLE sanitary_products ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Allow all anon access' AND tablename = 'sanitary_products'
  ) THEN
    CREATE POLICY "Allow all anon access" ON sanitary_products
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
