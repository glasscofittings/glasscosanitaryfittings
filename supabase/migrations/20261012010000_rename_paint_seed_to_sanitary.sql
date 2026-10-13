-- Rename residual paint demo data to sanitary finished goods / materials.
-- Safe to re-run: if the target name already exists, FKs are repointed to the
-- existing sanitary product and the paint duplicate is deleted.

-- 1. Finished goods + raw materials (products_master) — rename-or-merge
DO $$
DECLARE
  r RECORD;
  src_id uuid;
  dst_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Super White Emulsion 20L',    'Ceramic Wash Basin',        'Basins'),
      ('Premium Gloss Enamel 1L',     'Health Faucet Set',         'Faucets'),
      ('Primer Undercoat 5L',         'Bib Cock 1/2 inch Chrome',  'Faucets'),
      ('Texture Finish Grey 25kg',    'Flush Tank Complete',       'Flush Tanks'),
      ('Titanium Dioxide (TiO2)',     'Ceramic Clay White',        'Ceramics'),
      ('Titanium Dioxide Rutile',     'Ceramic Clay White',        'Ceramics'),
      ('Acrylic Resin Binder',        'Brass Ingot',               'Metals'),
      ('Xylene Solvent',              'Chrome Plating Solution',   'Chemicals'),
      ('Calcium Carbonate Filler',    'Rubber Gasket Stock',       'Components'),
      ('Defoamer Additive',           'Silicone Sealant',          'Adhesives'),
      ('Butyl Cellosolve',            'PVC Fitting Compound',      'Polymers')
    ) AS t(old_name, new_name, new_cat)
  LOOP
    SELECT id INTO src_id FROM products_master WHERE name = r.old_name LIMIT 1;
    IF src_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id INTO dst_id FROM products_master WHERE name = r.new_name LIMIT 1;

    IF dst_id IS NULL THEN
      UPDATE products_master
      SET name = r.new_name, category = r.new_cat
      WHERE id = src_id;
    ELSIF dst_id <> src_id THEN
      -- Target already exists: repoint FKs, then delete paint duplicate
      UPDATE inventory_lots SET product_id = dst_id WHERE product_id = src_id;
      UPDATE sales_invoice_items SET product_id = dst_id WHERE product_id = src_id;
      UPDATE bill_of_materials SET finished_good_id = dst_id WHERE finished_good_id = src_id;
      UPDATE bom_items SET raw_material_id = dst_id WHERE raw_material_id = src_id;
      UPDATE production_orders SET target_product_id = dst_id WHERE target_product_id = src_id;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory_balances'
          AND column_name = 'product_id'
      ) THEN
        -- 1) Merge qty into existing (warehouse, dst_product) rows
        EXECUTE $q$
          UPDATE inventory_balances d
          SET current_qty = d.current_qty + s.current_qty,
              updated_at = NOW()
          FROM inventory_balances s
          WHERE s.product_id = $1
            AND d.product_id = $2
            AND d.warehouse_id = s.warehouse_id
        $q$ USING src_id, dst_id;

        -- 2) Delete src rows that were merged (dst already has that warehouse)
        EXECUTE $q$
          DELETE FROM inventory_balances s
          WHERE s.product_id = $1
            AND EXISTS (
              SELECT 1 FROM inventory_balances d
              WHERE d.product_id = $2
                AND d.warehouse_id = s.warehouse_id
            )
        $q$ USING src_id, dst_id;

        -- 3) Repoint remaining src rows (no warehouse conflict)
        EXECUTE $q$
          UPDATE inventory_balances
          SET product_id = $2, updated_at = NOW()
          WHERE product_id = $1
        $q$ USING src_id, dst_id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inward_gate_passes'
          AND column_name = 'product_id'
      ) THEN
        EXECUTE 'UPDATE inward_gate_passes SET product_id = $1 WHERE product_id = $2'
          USING dst_id, src_id;
      END IF;

      DELETE FROM products_master WHERE id = src_id;
    ELSE
      UPDATE products_master SET category = r.new_cat WHERE id = src_id;
    END IF;
  END LOOP;
END $$;

-- 2. Production orders (display name + unit)
UPDATE production_orders
SET target_product_name = 'Ceramic Wash Basin', unit_of_measure = 'NOS'
WHERE target_product_name = 'Super White Emulsion 20L';

UPDATE production_orders
SET target_product_name = 'Health Faucet Set', unit_of_measure = 'NOS'
WHERE target_product_name = 'Premium Gloss Enamel 1L';

UPDATE production_orders
SET target_product_name = 'Bib Cock 1/2 inch Chrome', unit_of_measure = 'NOS'
WHERE target_product_name = 'Primer Undercoat 5L';

UPDATE production_orders
SET target_product_name = 'Flush Tank Complete', unit_of_measure = 'NOS'
WHERE target_product_name = 'Texture Finish Grey 25kg';

-- 3. Sales invoice line names (match product_id)
UPDATE sales_invoice_items si
SET product_name = pm.name
FROM products_master pm
WHERE si.product_id = pm.id
  AND si.product_name IN (
    'Super White Emulsion 20L',
    'Premium Gloss Enamel 1L',
    'Primer Undercoat 5L',
    'Texture Finish Grey 25kg',
    'Titanium Dioxide (TiO2)',
    'Titanium Dioxide Rutile',
    'Acrylic Resin Binder',
    'Xylene Solvent',
    'Calcium Carbonate Filler',
    'Defoamer Additive',
    'Butyl Cellosolve'
  );

-- 4. Legacy GRN / purchase invoice JSON descriptions
UPDATE goods_receipt_notes
SET items = replace(
  replace(
    replace(
      replace(
        replace(
          replace(
            items::text,
            'Super White Emulsion 20L', 'Ceramic Wash Basin'),
          'Premium Gloss Enamel 1L', 'Health Faucet Set'),
        'Primer Undercoat 5L', 'Bib Cock 1/2 inch Chrome'),
      'Titanium Dioxide (TiO2)', 'Ceramic Clay White'),
    'Acrylic Resin Binder', 'Brass Ingot'),
  'Xylene Solvent', 'Chrome Plating Solution')::jsonb
WHERE items::text LIKE '%Emulsion%'
   OR items::text LIKE '%Enamel%'
   OR items::text LIKE '%Titanium Dioxide%';

UPDATE purchase_invoices
SET items = replace(
  replace(
    replace(
      items::text,
      'Titanium Dioxide (TiO2)', 'Ceramic Clay White'),
    'Acrylic Resin Binder', 'Brass Ingot'),
  'Xylene Solvent', 'Chrome Plating Solution')::jsonb
WHERE items::text LIKE '%Titanium Dioxide%'
   OR items::text LIKE '%Acrylic Resin%'
   OR items::text LIKE '%Xylene%';

-- 4b. Legacy GRN / PINV JSON: remaining raw materials + TiO2 variants
UPDATE goods_receipt_notes
SET items = replace(
  replace(
    replace(
      replace(
        items::text,
        'Calcium Carbonate Filler', 'Rubber Gasket Stock'),
      'Defoamer Additive', 'Silicone Sealant'),
    'Butyl Cellosolve', 'PVC Fitting Compound'),
  'Titanium Dioxide Rutile', 'Ceramic Clay White')::jsonb
WHERE items::text LIKE '%Calcium Carbonate%'
   OR items::text LIKE '%Defoamer%'
   OR items::text LIKE '%Butyl%'
   OR items::text LIKE '%Titanium Dioxide Rutile%';

-- 5. Inward gate pass material descriptions (99_seed_demo_data)
UPDATE inward_gate_passes
SET material_description = 'Ceramic Clay White Fine'
WHERE material_description = 'Titanium Dioxide Rutile';

UPDATE inward_gate_passes
SET material_description = 'Rubber Gasket Stock'
WHERE material_description = 'Calcium Carbonate Filler';

-- 6. Activity log product references (best-effort, only if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'activity_log'
  ) THEN
    EXECUTE $q$
      UPDATE activity_log
      SET metadata = replace(
        replace(
          metadata::text,
          'Super White Emulsion 20L', 'Ceramic Wash Basin'),
        'Premium Gloss Enamel 1L', 'Health Faucet Set')::jsonb
      WHERE metadata::text LIKE '%Emulsion%'
         OR metadata::text LIKE '%Enamel%'
    $q$;
  END IF;
END $$;
