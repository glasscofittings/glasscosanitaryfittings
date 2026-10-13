-- =============================================================================
-- products_master: missing columns + raw material seed.
--
-- Symptom: Formula Master -> Create Formula shows an empty "Select material..."
-- dropdown. Two reasons on the live database:
--   1. products_master only has the columns id/name/category, so the app's
--      `item_type = 'RAW_MATERIAL'` filter (and sku / unit_of_measure reads)
--      never match anything.
--   2. products_master has zero rows.
--
-- Idempotent. Safe to re-run in the Supabase SQL Editor.
-- =============================================================================

-- 1. Columns the app reads and writes -----------------------------------------
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'RAW_MATERIAL';
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS unit_of_measure TEXT DEFAULT 'KG';
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS minimum_stock_alert NUMERIC(12, 3) DEFAULT 0;
ALTER TABLE public.products_master ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Backfill rows that predate those columns --------------------------------
UPDATE public.products_master SET item_type = 'RAW_MATERIAL' WHERE item_type IS NULL;
UPDATE public.products_master SET unit_of_measure = 'KG' WHERE unit_of_measure IS NULL;
UPDATE public.products_master SET minimum_stock_alert = 0 WHERE minimum_stock_alert IS NULL;
UPDATE public.products_master SET created_at = NOW() WHERE created_at IS NULL;

DO $$
BEGIN
  UPDATE public.products_master pm
     SET sku = 'SKU-' || LPAD(x.rn::TEXT, 4, '0')
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY name, id) AS rn
        FROM public.products_master
       WHERE sku IS NULL
    ) x
   WHERE pm.id = x.id
     AND pm.sku IS NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 3. Raw materials for the formula / BOM material pickers ---------------------
--    (only inserted when a row with the same name is missing)
INSERT INTO public.products_master (id, name, sku, category, item_type, unit_of_measure, minimum_stock_alert)
SELECT v.id::uuid, v.name, v.sku, v.category, 'RAW_MATERIAL', v.uom, v.alert
FROM (VALUES
  ('9a000000-0000-0000-0000-000000000001', 'Ceramic Clay White',           'RM-CLAY-001',  'Ceramics',  'KG', 50),
  ('9a000000-0000-0000-0000-000000000002', 'Brass Ingot',                  'RM-BRASS-002', 'Metals',    'KG', 50),
  ('9a000000-0000-0000-0000-000000000003', 'Chrome Plating Solution',      'RM-CHR-003',   'Chemicals', 'L',  20),
  ('9a000000-0000-0000-0000-000000000004', 'Rubber Gasket Stock',          'RM-GASK-004',  'Components','KG', 100),
  ('9a000000-0000-0000-0000-000000000005', 'Silicone Sealant',             'RM-SIL-005',   'Adhesives', 'KG', 20),
  ('9a000000-0000-0000-0000-000000000006', 'PVC Fitting Compound',         'RM-PVC-006',   'Polymers',  'KG', 50),
  ('9a000000-0000-0000-0000-000000000007', 'PVC Resin SG5',                'RM-RES-007',   'Polymers',  'KG', 50),
  ('9a000000-0000-0000-0000-000000000008', 'Stainless Steel Sheet 304',    'RM-SS-008',    'Metals',    'KG', 25),
  ('9a000000-0000-0000-0000-000000000009', 'PVC Stabilizer Calcium Zinc',  'RM-STAB-009',  'Chemicals', 'KG', 20),
  ('9a000000-0000-0000-0000-000000000010', 'Zinc Chrome Plating Salt',     'RM-ZN-010',    'Chemicals', 'KG', 20)
) AS v(id, name, sku, category, uom, alert)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products_master pm WHERE pm.name = v.name
);

-- 4. Unique SKU (never blocks the script if duplicates already exist) ---------
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS products_master_sku_key ON public.products_master (sku);
EXCEPTION WHEN others THEN NULL;
END $$;

-- 5. RLS: catalog must stay readable/writable by the anon app role ------------
ALTER TABLE public.products_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "erp_full_access" ON public.products_master;
CREATE POLICY "erp_full_access" ON public.products_master FOR ALL USING (true) WITH CHECK (true);
