-- ============================================================================
-- Migration: 20261024010000_fix_sales_items_product_fk.sql
--
-- Problem:
--   sales_invoice_items.product_id was originally created with a foreign key
--   to products_master (the legacy paint catalogue). The sanitary refactor
--   (20260913_refactor_to_sanitary.sql) tried to re-add the column pointing at
--   sanitary_products, but guarded the ALTER with "IF NOT EXISTS column":
--
--     IF NOT EXISTS (... column_name = 'product_id') THEN
--       ALTER TABLE sales_invoice_items ADD COLUMN product_id UUID
--         REFERENCES sanitary_products(id);
--     END IF;
--
--   On any database that already had product_id the ADD COLUMN was skipped, so
--   the old FK to products_master survived untouched.
--
--   Consequence: inserting a sanitary_products.id fails with FK violation
--   23503. createInvoiceItems() catches that code and silently retries with
--   product_id = null, so invoice lines lose their product link without any
--   error reaching the operator.
--
--   Those null links then force approve_dispatch() to resolve stock by product
--   NAME with LIMIT 1. Two distinct products can share a display name (e.g. two
--   "Basin Mixer Cast Head Chrome" rows differing by SKU / head type), so stock
--   can be deducted from the wrong product.
--
-- Fix:
--   1. Drop whatever FK currently sits on product_id, whatever it is named.
--   2. Re-add one pointing at sanitary_products.
--   3. Backfill null product_id from the line's product_name where that name
--      matches exactly ONE sanitary product. Ambiguous names are deliberately
--      left null — guessing would risk the very mis-deduction this fixes.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. Drop any existing FK on product_id (name-agnostic) ───────────────────
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.oid AS conid, c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum   = ANY (c.conkey)
    WHERE c.conrelid = 'public.sales_invoice_items'::regclass
      AND c.contype  = 'f'
      AND a.attname  = 'product_id'
  LOOP
    EXECUTE format('ALTER TABLE public.sales_invoice_items DROP CONSTRAINT %I',
                   con.conname);
  END LOOP;
END $$;

-- ── 2. Re-add the FK pointing at sanitary_products ──────────────────────────
ALTER TABLE public.sales_invoice_items
  DROP CONSTRAINT IF EXISTS sales_invoice_items_product_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum   = ANY (c.conkey)
    WHERE c.conrelid = 'public.sales_invoice_items'::regclass
      AND c.contype  = 'f'
      AND a.attname  = 'product_id'
      AND c.confrelid = 'public.sanitary_products'::regclass
  ) THEN
    ALTER TABLE public.sales_invoice_items
      ADD CONSTRAINT sales_invoice_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.sanitary_products(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Backfill product_id by unambiguous product name ──────────────────────
-- Only exact, unique name matches are adopted. Duplicate display names are
-- skipped on purpose: silently picking one would reintroduce the wrong-product
-- deduction this migration exists to prevent.
UPDATE public.sales_invoice_items si
SET product_id = sub.id
FROM (
  SELECT lower(trim(name)) AS name_key,
         min(id)           AS id
  FROM public.sanitary_products
  GROUP BY lower(trim(name))
  HAVING count(*) = 1
) sub
WHERE si.product_id IS NULL
  AND si.product_name IS NOT NULL
  AND lower(trim(si.product_name)) = sub.name_key;

-- ── 4. Index so the name fallback stays cheap while any nulls remain ────────
CREATE INDEX IF NOT EXISTS idx_sanitary_products_name_lower
  ON public.sanitary_products (lower(trim(name)));

COMMENT ON CONSTRAINT sales_invoice_items_product_id_fkey
  ON public.sales_invoice_items IS
  'Points at sanitary_products (repaired by 20261024010000; previously products_master).';
