-- ============================================================================
-- GLASSCO SANITARY ERP — COMPREHENSIVE DEMO SEED DATA
-- ============================================================================
-- Safe to run: uses WHERE NOT EXISTS / ON CONFLICT to be idempotent.
-- Covers: parties, products, inventory, procurement, invoicing, ledger,
--         workers, attendance, loans, QC, batch orders, dispatch, audit logs
-- ============================================================================

-- ============================================================================
-- 1. PARTIES (Suppliers & Customers)
-- ============================================================================
-- NOTE: live parties table has: id, name, party_type, phone, email, address
-- (ntn_strn and is_registered columns do NOT exist in the live DB)

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000001'::uuid, 'AGD Traders', 'SUPPLIER', '+92-21-34567890', 'sales@agdtraders.com', 'SITE AREA, KARACHI'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'AGD Traders');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000002'::uuid, 'Sapphire Chemicals', 'SUPPLIER', '+92-21-35123456', 'info@sapphirechem.com', 'INDUSTRIAL AREA, LAHORE'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'Sapphire Chemicals');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000003'::uuid, 'Prime Packaging', 'SUPPLIER', '+92-42-37891234', 'orders@primepkg.pk', 'SIALKOT INDUSTRIAL ESTATE'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'Prime Packaging');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000004'::uuid, 'Karachi Hardware', 'CUSTOMER', '+92-21-36661234', 'purchase@karachihardware.com', 'BURNS GARDEN, KARACHI'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'Karachi Hardware');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000005'::uuid, 'HomeBazaar', 'CUSTOMER', '+92-21-38123456', 'procurement@homebazaar.pk', 'DHA PHASE 5, KARACHI'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'HomeBazaar');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000006'::uuid, 'Metro Tiles & Sanitary', 'CUSTOMER', '+92-42-35551234', 'buy@metrotiles.com', 'MALL ROAD, LAHORE'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'Metro Tiles & Sanitary');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000007'::uuid, 'Stall Market Traders', 'CUSTOMER', '+92-21-34441234', NULL, 'STALL ROAD, HYDERABAD'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'Stall Market Traders');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000008'::uuid, 'ABC Builders', 'CUSTOMER', '+92-51-3331234', 'info@abcbuilders.pk', 'BLUE AREA, ISLAMABAD'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'ABC Builders');

INSERT INTO parties (id, name, party_type, phone, email, address)
SELECT 'a0000001-0000-0000-0000-000000000009'::uuid, 'Ravi Sanitary Wholesale', 'BOTH', '+92-42-36661234', 'contact@ravisupply.pk', 'WALTON ROAD, LAHORE'
WHERE NOT EXISTS (SELECT 1 FROM parties WHERE name = 'Ravi Sanitary Wholesale');


-- ============================================================================
-- 2. SANITARY PRODUCTS (for the product dropdown in invoicing)
-- ============================================================================

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000001'::uuid, 'PVC-0200', 'PVC Pipe 2 Inch', 'Pipes', 'PVC', 'White', 'PVC', 180.00, 200, 1500, 1800
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'PVC-0200');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000002'::uuid, 'PVC-0400', 'PVC Pipe 4 Inch', 'Pipes', 'PVC', 'White', 'PVC', 420.00, 100, 800, 950
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'PVC-0400');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000003'::uuid, 'PVC-EL20', 'PVC Elbow 2 Inch', 'Fittings', 'Elbow', 'White', 'PVC', 45.00, 500, 3200, 3500
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'PVC-EL20');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000004'::uuid, 'FAU-0001', 'Shower Mixer Tap', 'Faucets', 'Mixer', 'Chrome', 'Brass', 2850.00, 50, 120, 150
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'FAU-0001');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000005'::uuid, 'FAU-0002', 'Kitchen Sink Tap Single', 'Faucets', 'Single', 'Chrome', 'Brass', 1650.00, 80, 200, 240
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'FAU-0002');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000006'::uuid, 'CER-0001', 'Ceramic Wash Basin', 'Basins', 'Wall Mount', 'White', 'Ceramic', 3500.00, 30, 85, 100
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'CER-0001');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000007'::uuid, 'CER-0002', 'Pedestal Wash Basin', 'Basins', 'Pedestal', 'White', 'Ceramic', 5200.00, 20, 45, 60
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'CER-0002');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000008'::uuid, 'SS-0001', 'Kitchen Sink SS Double', 'Sinks', 'Double Bowl', 'Steel', 'Stainless Steel', 8500.00, 15, 35, 45
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'SS-0001');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000009'::uuid, 'SS-0002', 'Kitchen Sink SS Single', 'Sinks', 'Single Bowl', 'Steel', 'Stainless Steel', 5200.00, 20, 60, 75
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'SS-0002');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000010'::uuid, 'TST-0001', 'Toilet Seat Cover Soft Close', 'Seats', 'Soft Close', 'White', 'Ceramic', 2200.00, 60, 180, 220
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'TST-0001');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000011'::uuid, 'CP-0001', 'CP Connector 1/2 Inch', 'Fittings', 'Connector', 'Chrome', 'Brass', 120.00, 1000, 5000, 6000
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'CP-0001');

INSERT INTO sanitary_products (id, sku, name, category, subcategory, finish, material, unit_price, reorder_level, available_stock, total_stock)
SELECT 'b0000001-0000-0000-0000-000000000012'::uuid, 'FLX-001', 'Flexible Hose 18 Inch', 'Accessories', 'Hose', 'Steel', 'Stainless Steel', 350.00, 200, 900, 1100
WHERE NOT EXISTS (SELECT 1 FROM sanitary_products WHERE sku = 'FLX-001');


-- ============================================================================
-- 3. PRODUCTS MASTER (raw materials + matching finished goods for FK refs)
-- ============================================================================
-- NOTE: live products_master only has: id, name, category
-- We create raw materials AND finished goods (matching sanitary_products UUIDs)

-- Raw Materials
INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000001'::uuid, 'PVC Resin SG5', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'PVC Resin SG5');

INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000002'::uuid, 'Ceramic Clay White Fine', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'Ceramic Clay White Fine');

INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000003'::uuid, 'Rubber Gasket Stock', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'Rubber Gasket Stock');

INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000004'::uuid, 'Stainless Steel Sheet 304', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'Stainless Steel Sheet 304');

INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000005'::uuid, 'Brass Ingot C377', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'Brass Ingot C377');

INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000006'::uuid, 'Ceramic Clay White', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'Ceramic Clay White');

INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000007'::uuid, 'PVC Stabilizer Calcium Zinc', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'PVC Stabilizer Calcium Zinc');

INSERT INTO products_master (id, name, category)
SELECT 'c0000001-0000-0000-0000-000000000008'::uuid, 'Chrome Plating Solution', 'RAW_MATERIAL'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE name = 'Chrome Plating Solution');

-- Finished Goods (matching sanitary_products UUIDs so FK references work)
INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000001'::uuid, 'PVC Pipe 2 Inch', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000001'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000002'::uuid, 'PVC Pipe 4 Inch', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000002'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000003'::uuid, 'PVC Elbow 2 Inch', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000003'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000004'::uuid, 'Shower Mixer Tap', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000004'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000005'::uuid, 'Kitchen Sink Tap Single', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000005'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000006'::uuid, 'Ceramic Wash Basin', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000006'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000007'::uuid, 'Pedestal Wash Basin', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000007'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000008'::uuid, 'Kitchen Sink SS Double', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000008'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000009'::uuid, 'Kitchen Sink SS Single', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000009'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000010'::uuid, 'Toilet Seat Cover Soft Close', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000010'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000011'::uuid, 'CP Connector 1/2 Inch', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000011'::uuid);

INSERT INTO products_master (id, name, category)
SELECT 'b0000001-0000-0000-0000-000000000012'::uuid, 'Flexible Hose 18 Inch', 'FINISHED_GOOD'
WHERE NOT EXISTS (SELECT 1 FROM products_master WHERE id = 'b0000001-0000-0000-0000-000000000012'::uuid);


-- ============================================================================
-- 4. INVENTORY LOTS (raw materials in WH-01)
-- ============================================================================

DO $$
DECLARE
  v_wh01 UUID;
  v_wh02 UUID;
BEGIN
  SELECT id INTO v_wh01 FROM inventory_warehouses WHERE code = 'WH-01';
  SELECT id INTO v_wh02 FROM inventory_warehouses WHERE code = 'WH-02';

  -- Raw material lots in WH-01
  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-001', 'c0000001-0000-0000-0000-000000000001'::uuid, v_wh01, 'AGD-2026-001', '2026-08-15', '2028-08-15', 5000, 3200, 185.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-001');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-002', 'c0000001-0000-0000-0000-000000000002'::uuid, v_wh01, 'SAP-2026-010', '2026-09-01', '2028-09-01', 800, 650, 420.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-002');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-003', 'c0000001-0000-0000-0000-000000000003'::uuid, v_wh01, 'AGD-2026-020', '2026-07-20', '2028-07-20', 10000, 7500, 65.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-003');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-004', 'c0000001-0000-0000-0000-000000000004'::uuid, v_wh01, 'SAP-2026-030', '2026-06-10', '2030-06-10', 2000, 1200, 380.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-004');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-005', 'c0000001-0000-0000-0000-000000000005'::uuid, v_wh01, 'AGD-2026-040', '2026-09-10', '2030-09-10', 1500, 980, 2400.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-005');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-006', 'c0000001-0000-0000-0000-000000000006'::uuid, v_wh01, 'SAP-2026-050', '2026-05-01', '2028-05-01', 3000, 1800, 90.00, 'FLAGGED_WARNING'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-006');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-007', 'c0000001-0000-0000-0000-000000000007'::uuid, v_wh01, 'PRM-2026-015', '2026-08-20', '2028-08-20', 500, 380, 320.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-007');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-RM-008', 'c0000001-0000-0000-0000-000000000008'::uuid, v_wh01, 'SAP-2026-060', '2026-09-15', '2028-09-15', 200, 150, 850.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-RM-008');

  -- Finished goods lots in WH-02
  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-001', 'b0000001-0000-0000-0000-000000000001'::uuid, v_wh02, 'MFG-2026-0901', '2026-09-01', '2030-09-01', 500, 320, 120.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-001');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-002', 'b0000001-0000-0000-0000-000000000003'::uuid, v_wh02, 'MFG-2026-0903', '2026-09-03', '2030-09-03', 2000, 1400, 28.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-002');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-003', 'b0000001-0000-0000-0000-000000000004'::uuid, v_wh02, 'MFG-2026-0910', '2026-09-10', '2030-09-10', 80, 55, 1800.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-003');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-004', 'b0000001-0000-0000-0000-000000000006'::uuid, v_wh02, 'MFG-2026-0912', '2026-09-12', '2030-09-12', 60, 40, 2200.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-004');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-005', 'b0000001-0000-0000-0000-000000000008'::uuid, v_wh02, 'MFG-2026-0915', '2026-09-15', '2030-09-15', 25, 18, 5500.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-005');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-006', 'b0000001-0000-0000-0000-000000000010'::uuid, v_wh02, 'MFG-2026-0918', '2026-09-18', '2030-09-18', 100, 75, 1400.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-006');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-007', 'b0000001-0000-0000-0000-000000000011'::uuid, v_wh02, 'MFG-2026-0920', '2026-09-20', '2030-09-20', 3000, 2200, 75.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-007');

  INSERT INTO inventory_lots (lot_number, product_id, warehouse_id, vendor_lot_code, manufacture_date, expiration_date, initial_qty, remaining_qty, unit_cost_pkr, qc_status)
  SELECT 'LOT-FG-008', 'b0000001-0000-0000-0000-000000000012'::uuid, v_wh02, 'MFG-2026-0922', '2026-09-22', '2030-09-22', 600, 450, 210.00, 'PASSED'
  WHERE NOT EXISTS (SELECT 1 FROM inventory_lots WHERE lot_number = 'LOT-FG-008');
END $$;


-- ============================================================================
-- 5. INVENTORY BALANCES (stock summary per product per warehouse)
-- ============================================================================

DO $$
DECLARE
  v_wh01 UUID;
  v_wh02 UUID;
BEGIN
  SELECT id INTO v_wh01 FROM inventory_warehouses WHERE code = 'WH-01';
  SELECT id INTO v_wh02 FROM inventory_warehouses WHERE code = 'WH-02';

  -- Raw materials in WH-01
  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000001'::uuid, 3200
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000002'::uuid, 650
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000003'::uuid, 7500
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000004'::uuid, 1200
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000005'::uuid, 980
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000006'::uuid, 1800
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000007'::uuid, 380
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh01, 'c0000001-0000-0000-0000-000000000008'::uuid, 150
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  -- Finished goods in WH-02
  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000001'::uuid, 320
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000003'::uuid, 1400
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000004'::uuid, 55
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000006'::uuid, 40
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000008'::uuid, 18
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000010'::uuid, 75
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000011'::uuid, 2200
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();

  INSERT INTO inventory_balances (warehouse_id, product_id, current_qty)
  SELECT v_wh02, 'b0000001-0000-0000-0000-000000000012'::uuid, 450
  ON CONFLICT (warehouse_id, product_id) DO UPDATE SET current_qty = EXCLUDED.current_qty, updated_at = NOW();
END $$;


-- ============================================================================
-- 6. INWARD GATE PASSES (procurement receipts)
-- ============================================================================

INSERT INTO inward_gate_passes (id, supplier_id, material_description, vendor_lot_number, vendor_lot_code, inward_qty, unit_of_measure, status, igp_code, created_at)
SELECT 'd0000001-0000-0000-0000-000000000001'::uuid, 'AGD Traders', 'PVC Resin SG5', 'AGD-2026-001', 'AGD-2026-001', 5000, 'KG', 'CONVERTED_TO_GRN', 'IGP-2026-0001', '2026-08-15 09:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM inward_gate_passes WHERE igp_code = 'IGP-2026-0001');

INSERT INTO inward_gate_passes (id, supplier_id, material_description, vendor_lot_number, vendor_lot_code, inward_qty, unit_of_measure, status, igp_code, created_at)
SELECT 'd0000001-0000-0000-0000-000000000002'::uuid, 'Sapphire Chemicals', 'Ceramic Clay White Fine', 'SAP-2026-010', 'SAP-2026-010', 800, 'KG', 'CONVERTED_TO_GRN', 'IGP-2026-0002', '2026-09-01 10:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM inward_gate_passes WHERE igp_code = 'IGP-2026-0002');

INSERT INTO inward_gate_passes (id, supplier_id, material_description, vendor_lot_number, vendor_lot_code, inward_qty, unit_of_measure, status, igp_code, created_at)
SELECT 'd0000001-0000-0000-0000-000000000003'::uuid, 'AGD Traders', 'Rubber Gasket Stock', 'AGD-2026-020', 'AGD-2026-020', 10000, 'KG', 'CONVERTED_TO_GRN', 'IGP-2026-0003', '2026-07-20 08:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM inward_gate_passes WHERE igp_code = 'IGP-2026-0003');

INSERT INTO inward_gate_passes (id, supplier_id, material_description, vendor_lot_number, vendor_lot_code, inward_qty, unit_of_measure, status, igp_code, created_at)
SELECT 'd0000001-0000-0000-0000-000000000004'::uuid, 'Sapphire Chemicals', 'Stainless Steel Sheet 304', 'SAP-2026-030', 'SAP-2026-030', 2000, 'KG', 'CONVERTED_TO_GRN', 'IGP-2026-0004', '2026-06-10 11:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM inward_gate_passes WHERE igp_code = 'IGP-2026-0004');

INSERT INTO inward_gate_passes (id, supplier_id, material_description, vendor_lot_number, vendor_lot_code, inward_qty, unit_of_measure, status, igp_code, created_at)
SELECT 'd0000001-0000-0000-0000-000000000005'::uuid, 'AGD Traders', 'Brass Ingot C377', 'AGD-2026-040', 'AGD-2026-040', 1500, 'KG', 'PENDING_INSPECTION', 'IGP-2026-0005', '2026-09-18 14:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM inward_gate_passes WHERE igp_code = 'IGP-2026-0005');

INSERT INTO inward_gate_passes (id, supplier_id, material_description, vendor_lot_number, vendor_lot_code, inward_qty, unit_of_measure, status, igp_code, created_at)
SELECT 'd0000001-0000-0000-0000-000000000006'::uuid, 'Prime Packaging', 'PVC Stabilizer Calcium Zinc', 'PRM-2026-015', 'PRM-2026-015', 500, 'KG', 'CONVERTED_TO_GRN', 'IGP-2026-0006', '2026-08-20 09:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM inward_gate_passes WHERE igp_code = 'IGP-2026-0006');

INSERT INTO inward_gate_passes (id, supplier_id, material_description, vendor_lot_number, vendor_lot_code, inward_qty, unit_of_measure, status, igp_code, created_at)
SELECT 'd0000001-0000-0000-0000-000000000007'::uuid, 'Sapphire Chemicals', 'Chrome Plating Solution', 'SAP-2026-060', 'SAP-2026-060', 200, 'L', 'PENDING_QC', 'IGP-2026-0007', '2026-09-15 16:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM inward_gate_passes WHERE igp_code = 'IGP-2026-0007');


-- ============================================================================
-- 7. GOODS RECEIVED NOTES
-- ============================================================================

INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, unit_price_pkr, total_value_pkr, created_at)
SELECT 'GRN-2026-0001', 'd0000001-0000-0000-0000-000000000001'::uuid, 4950, 50, 185.00, 915750.00, '2026-08-16 10:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE grn_code = 'GRN-2026-0001');

INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, unit_price_pkr, total_value_pkr, created_at)
SELECT 'GRN-2026-0002', 'd0000001-0000-0000-0000-000000000002'::uuid, 800, 0, 420.00, 336000.00, '2026-09-02 11:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE grn_code = 'GRN-2026-0002');

INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, unit_price_pkr, total_value_pkr, created_at)
SELECT 'GRN-2026-0003', 'd0000001-0000-0000-0000-000000000003'::uuid, 9800, 200, 65.00, 637000.00, '2026-07-21 09:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE grn_code = 'GRN-2026-0003');

INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, unit_price_pkr, total_value_pkr, created_at)
SELECT 'GRN-2026-0004', 'd0000001-0000-0000-0000-000000000004'::uuid, 2000, 0, 380.00, 760000.00, '2026-06-11 10:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE grn_code = 'GRN-2026-0004');

INSERT INTO goods_received_notes (grn_code, igp_id, accepted_qty, rejected_qty, unit_price_pkr, total_value_pkr, created_at)
SELECT 'GRN-2026-0005', 'd0000001-0000-0000-0000-000000000006'::uuid, 500, 0, 320.00, 160000.00, '2026-08-21 10:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM goods_received_notes WHERE grn_code = 'GRN-2026-0005');


-- ============================================================================
-- 8. ACCOUNTS CHART (Chart of Accounts)
-- ============================================================================

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '1000', 'Cash in Hand', 'ASSET'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '1000');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '1100', 'Accounts Receivable', 'ASSET'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '1100');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '1200', 'Inventory — Raw Materials', 'ASSET'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '1200');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '1300', 'Inventory — Finished Goods', 'ASSET'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '1300');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '1400', 'Prepaid Expenses', 'ASSET'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '1400');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '2000', 'Accounts Payable', 'LIABILITY'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '2000');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '2100', 'Accrued Expenses', 'LIABILITY'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '2100');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '2200', 'Sales Tax Payable', 'LIABILITY'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '2200');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '2210', 'Further Tax Payable', 'LIABILITY'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '2210');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '2300', 'Loan Liabilities', 'LIABILITY'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '2300');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '3000', 'Owner Equity', 'EQUITY'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '3000');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '3100', 'Retained Earnings', 'EQUITY'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '3100');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '4000', 'Sales Revenue', 'REVENUE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '4000');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '4100', 'Service Revenue', 'REVENUE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '4100');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '5000', 'Cost of Goods Sold', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '5000');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '5100', 'Sales Discount', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '5100');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '6000', 'Salaries Expense', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '6000');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '6100', 'Rent Expense', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '6100');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '6200', 'Utilities Expense', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '6200');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '6300', 'Factory Consumables', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '6300');

INSERT INTO accounts_chart (account_code, account_name, account_type)
SELECT '6400', 'Repair & Maintenance', 'EXPENSE'
WHERE NOT EXISTS (SELECT 1 FROM accounts_chart WHERE account_code = '6400');


-- ============================================================================
-- 9. JOURNAL ENTRIES (Opening balances + sales transactions)
-- ============================================================================

INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status, created_at)
SELECT 'JE-20260701-0001', '2026-07-01', 'Opening balances — Cash, Inventory, Equity', true, 'POSTED', '2026-07-01 09:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = 'JE-20260701-0001');

INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status, created_at)
SELECT 'JE-20260901-0001', '2026-09-01', 'Raw material purchase — AGD Traders (PVC Resin)', true, 'POSTED', '2026-09-01 10:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = 'JE-20260901-0001');

INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status, created_at)
SELECT 'JE-20260905-0001', '2026-09-05', 'Sales invoice INV-2026-1001 — Karachi Hardware', true, 'POSTED', '2026-09-05 14:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = 'JE-20260905-0001');

INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status, created_at)
SELECT 'JE-20260910-0001', '2026-09-10', 'Sales invoice INV-2026-1002 — HomeBazaar', true, 'POSTED', '2026-09-10 11:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = 'JE-20260910-0001');

INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status, created_at)
SELECT 'JE-20260915-0001', '2026-09-15', 'Sales invoice INV-2026-1003 — Metro Tiles & Sanitary', true, 'POSTED', '2026-09-15 16:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = 'JE-20260915-0001');

INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status, created_at)
SELECT 'JE-20260918-0001', '2026-09-18', 'Monthly salaries — Factory workers September 2026', true, 'POSTED', '2026-09-18 17:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = 'JE-20260918-0001');

INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status, created_at)
SELECT 'JE-20260918-0002', '2026-09-18', 'Factory rent — September 2026', true, 'POSTED', '2026-09-18 17:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE entry_number = 'JE-20260918-0002');


-- ============================================================================
-- 10. JOURNAL LINES
-- ============================================================================

-- Opening balances
INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 5000000.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260701-0001' AND ac.account_code = '1000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 3500000.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260701-0001' AND ac.account_code = '1200'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 2800000.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260701-0001' AND ac.account_code = '1300'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 11300000.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260701-0001' AND ac.account_code = '3000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

-- Purchase entry — AGD Traders PVC Resin
INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 915750.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260901-0001' AND ac.account_code = '1200'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 915750.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260901-0001' AND ac.account_code = '2000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

-- Sales entry — Karachi Hardware (taxable 25000, sales tax 4500, total 29500)
INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 29500.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260905-0001' AND ac.account_code = '1100'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 25000.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260905-0001' AND ac.account_code = '4000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 4500.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260905-0001' AND ac.account_code = '2200'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

-- Sales entry — HomeBazaar (taxable 42000, sales tax 7560, further tax 1680, total 51240)
INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 51240.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260910-0001' AND ac.account_code = '1100'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 42000.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260910-0001' AND ac.account_code = '4000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 7560.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260910-0001' AND ac.account_code = '2200'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 1680.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260910-0001' AND ac.account_code = '2210'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

-- Sales entry — Metro Tiles (taxable 68000, sales tax 12240, total 80240)
INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 80240.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260915-0001' AND ac.account_code = '1100'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 68000.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260915-0001' AND ac.account_code = '4000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 12240.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260915-0001' AND ac.account_code = '2200'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

-- Salaries expense
INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 385000.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260918-0001' AND ac.account_code = '6000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 385000.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260918-0001' AND ac.account_code = '1000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

-- Rent expense
INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 120000.00, 0
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260918-0002' AND ac.account_code = '6100'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);

INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
SELECT je.id, ac.id, 0, 120000.00
FROM journal_entries je, accounts_chart ac
WHERE je.entry_number = 'JE-20260918-0002' AND ac.account_code = '1000'
AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = je.id AND account_id = ac.id);


-- ============================================================================
-- 11. SALES INVOICES + ITEMS
-- ============================================================================

INSERT INTO sales_invoices (id, invoice_number, customer_id, taxable_value_pkr, sales_tax_rate, sales_tax_amount_pkr, further_tax_rate, further_tax_amount_pkr, total_invoice_value_pkr, is_posted, created_at)
SELECT 'e0000001-0000-0000-0000-000000000001'::uuid, 'INV-2026-1001', 'a0000001-0000-0000-0000-000000000004'::uuid, 25000.00, 18, 4500.00, 0, 0, 29500.00, true, '2026-09-05 14:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoices WHERE invoice_number = 'INV-2026-1001');

INSERT INTO sales_invoices (id, invoice_number, customer_id, taxable_value_pkr, sales_tax_rate, sales_tax_amount_pkr, further_tax_rate, further_tax_amount_pkr, total_invoice_value_pkr, is_posted, created_at)
SELECT 'e0000001-0000-0000-0000-000000000002'::uuid, 'INV-2026-1002', 'a0000001-0000-0000-0000-000000000005'::uuid, 42000.00, 18, 7560.00, 4, 1680.00, 51240.00, true, '2026-09-10 11:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoices WHERE invoice_number = 'INV-2026-1002');

INSERT INTO sales_invoices (id, invoice_number, customer_id, taxable_value_pkr, sales_tax_rate, sales_tax_amount_pkr, further_tax_rate, further_tax_amount_pkr, total_invoice_value_pkr, is_posted, created_at)
SELECT 'e0000001-0000-0000-0000-000000000003'::uuid, 'INV-2026-1003', 'a0000001-0000-0000-0000-000000000006'::uuid, 68000.00, 18, 12240.00, 0, 0, 80240.00, true, '2026-09-15 16:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoices WHERE invoice_number = 'INV-2026-1003');

-- Unposted draft invoice
INSERT INTO sales_invoices (id, invoice_number, customer_id, taxable_value_pkr, sales_tax_rate, sales_tax_amount_pkr, further_tax_rate, further_tax_amount_pkr, total_invoice_value_pkr, is_posted, created_at)
SELECT 'e0000001-0000-0000-0000-000000000004'::uuid, 'INV-2026-1004', 'a0000001-0000-0000-0000-000000000007'::uuid, 15600.00, 18, 2808.00, 4, 624.00, 19032.00, false, '2026-09-18 10:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoices WHERE invoice_number = 'INV-2026-1004');

-- Invoice items for INV-2026-1001 (Karachi Hardware)
INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'PVC Pipe 2 Inch', 50, 180.00, 9000.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000001'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000001'::uuid);

INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'PVC Elbow 2 Inch', 100, 45.00, 4500.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000001'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000003'::uuid);

INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000011'::uuid, 'CP Connector 1/2 Inch', 50, 120.00, 6000.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000001'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000011'::uuid);

INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000012'::uuid, 'Flexible Hose 18 Inch', 10, 350.00, 3500.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000001'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000012'::uuid);

-- Invoice items for INV-2026-1002 (HomeBazaar — unregistered, further tax applies)
INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000002'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'Shower Mixer Tap', 10, 2850.00, 28500.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000002'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000004'::uuid);

INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000002'::uuid, 'b0000001-0000-0000-0000-000000000005'::uuid, 'Kitchen Sink Tap Single', 5, 1650.00, 8250.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000002'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000005'::uuid);

INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000002'::uuid, 'b0000001-0000-0000-0000-000000000010'::uuid, 'Toilet Seat Cover Soft Close', 5, 2200.00, 11000.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000002'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000010'::uuid);

-- Invoice items for INV-2026-1003 (Metro Tiles — big order)
INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000003'::uuid, 'b0000001-0000-0000-0000-000000000006'::uuid, 'Ceramic Wash Basin', 10, 3500.00, 35000.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000003'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000006'::uuid);

INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000003'::uuid, 'b0000001-0000-0000-0000-000000000007'::uuid, 'Pedestal Wash Basin', 5, 5200.00, 26000.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000003'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000007'::uuid);

INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure)
SELECT 'e0000001-0000-0000-0000-000000000003'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'PVC Pipe 4 Inch', 20, 420.00, 8400.00, 'NOS'
WHERE NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = 'e0000001-0000-0000-0000-000000000003'::uuid AND product_id = 'b0000001-0000-0000-0000-000000000002'::uuid);


-- ============================================================================
-- 12. WORKERS (factory staff)
-- ============================================================================

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000001'::uuid, 'W-001', 'Ahmed Khan', 'OPERATOR', 'Machine Operator', 1200.00, 35000.00, '2023-03-15', 'ACTIVE', true, '2023-03-15'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-001');

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000002'::uuid, 'W-002', 'Hassan Ali', 'OPERATOR', 'Extrusion Operator', 1300.00, 38000.00, '2022-11-01', 'ACTIVE', true, '2022-11-01'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-002');

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000003'::uuid, 'W-003', 'Usman Sheikh', 'SUPERVISOR', 'Production Supervisor', 1500.00, 45000.00, '2021-06-10', 'ACTIVE', true, '2021-06-10'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-003');

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000004'::uuid, 'W-004', 'Bilal Ahmed', 'LAB_TECH', 'Quality Lab Technician', 1400.00, 42000.00, '2022-08-20', 'ACTIVE', true, '2022-08-20'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-004');

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000005'::uuid, 'W-005', 'Rashid Mehmood', 'OPERATOR', 'Moulding Operator', 1100.00, 32000.00, '2024-01-15', 'ACTIVE', true, '2024-01-15'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-005');

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000006'::uuid, 'W-006', 'Zubair Khan', 'HELPER', 'General Helper', 800.00, 24000.00, '2025-02-01', 'ACTIVE', true, '2025-02-01'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-006');

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000007'::uuid, 'W-007', 'Farooq Shah', 'OPERATOR', 'CNC Operator', 1350.00, 40000.00, '2023-07-01', 'ACTIVE', true, '2023-07-01'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-007');

INSERT INTO workers (id, worker_code, full_name, designation, role_designation, daily_rate_pkr, base_salary_pkr, joining_date, status, is_active, created_at)
SELECT 'f0000001-0000-0000-0000-000000000008'::uuid, 'W-008', 'Imran Yousuf', 'HELPER', 'Warehouse Helper', 750.00, 22000.00, '2025-06-10', 'ACTIVE', true, '2025-06-10'
WHERE NOT EXISTS (SELECT 1 FROM workers WHERE worker_code = 'W-008');


-- ============================================================================
-- 13. WORKER ATTENDANCE (September 2026 — 18 working days sample)
-- ============================================================================

DO $$
DECLARE
  w RECORD;
  d DATE;
  v_status TEXT;
BEGIN
  FOR w IN SELECT id FROM workers WHERE worker_code IN ('W-001','W-002','W-003','W-004','W-005','W-006','W-007','W-008')
  LOOP
    FOR d IN SELECT generate_series('2026-09-01'::date, '2026-09-18'::date, '1 day'::interval)::date
    LOOP
      -- Skip weekends (Saturday=6, Sunday=0)
      IF EXTRACT(DOW FROM d) IN (0, 6) THEN CONTINUE; END IF;

      -- Random-ish status: 85% present, 5% absent, 10% leave
      IF random() < 0.85 THEN v_status := 'P';
      ELSIF random() < 0.5 THEN v_status := 'A';
      ELSE v_status := 'L';
      END IF;

      INSERT INTO worker_attendance (worker_id, attendance_date, status)
      VALUES (w.id, d, v_status)
      ON CONFLICT (worker_id, attendance_date) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;


-- ============================================================================
-- 14. WORKER LOANS + REPAYMENT LOGS
-- ============================================================================

INSERT INTO worker_loans (id, worker_id, original_loan_amount, current_balance, monthly_deduction_rate, created_at)
SELECT 'aa000001-0000-0000-0000-000000000001'::uuid, 'f0000001-0000-0000-0000-000000000001'::uuid, 50000.00, 30000.00, 5000.00, '2026-01-15'
WHERE NOT EXISTS (SELECT 1 FROM worker_loans WHERE worker_id = 'f0000001-0000-0000-0000-000000000001'::uuid);

INSERT INTO worker_loans (id, worker_id, original_loan_amount, current_balance, monthly_deduction_rate, created_at)
SELECT 'aa000001-0000-0000-0000-000000000002'::uuid, 'f0000001-0000-0000-0000-000000000002'::uuid, 30000.00, 15000.00, 3000.00, '2026-04-01'
WHERE NOT EXISTS (SELECT 1 FROM worker_loans WHERE worker_id = 'f0000001-0000-0000-0000-000000000002'::uuid);

INSERT INTO worker_loans (id, worker_id, original_loan_amount, current_balance, monthly_deduction_rate, created_at)
SELECT 'aa000001-0000-0000-0000-000000000003'::uuid, 'f0000001-0000-0000-0000-000000000005'::uuid, 20000.00, 14000.00, 2000.00, '2026-06-15'
WHERE NOT EXISTS (SELECT 1 FROM worker_loans WHERE worker_id = 'f0000001-0000-0000-0000-000000000005'::uuid);

-- Repayment logs
INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000001'::uuid, 5000.00, 'SALARY_DEDUCTION', '2026-02-28'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000001'::uuid AND payment_date = '2026-02-28');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000001'::uuid, 5000.00, 'SALARY_DEDUCTION', '2026-03-31'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000001'::uuid AND payment_date = '2026-03-31');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000001'::uuid, 5000.00, 'SALARY_DEDUCTION', '2026-04-30'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000001'::uuid AND payment_date = '2026-04-30');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000001'::uuid, 5000.00, 'SALARY_DEDUCTION', '2026-05-31'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000001'::uuid AND payment_date = '2026-05-31');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000001'::uuid, 5000.00, 'SALARY_DEDUCTION', '2026-06-30'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000001'::uuid AND payment_date = '2026-06-30');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000002'::uuid, 3000.00, 'SALARY_DEDUCTION', '2026-05-31'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000002'::uuid AND payment_date = '2026-05-31');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000002'::uuid, 3000.00, 'SALARY_DEDUCTION', '2026-06-30'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000002'::uuid AND payment_date = '2026-06-30');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000002'::uuid, 3000.00, 'SALARY_DEDUCTION', '2026-07-31'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000002'::uuid AND payment_date = '2026-07-31');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000002'::uuid, 3000.00, 'SALARY_DEDUCTION', '2026-08-31'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000002'::uuid AND payment_date = '2026-08-31');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000003'::uuid, 2000.00, 'SALARY_DEDUCTION', '2026-07-31'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000003'::uuid AND payment_date = '2026-07-31');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000003'::uuid, 2000.00, 'SALARY_DEDUCTION', '2026-08-31'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000003'::uuid AND payment_date = '2026-08-31');

INSERT INTO loan_repayment_logs (loan_id, amount_paid, repayment_source, payment_date)
SELECT 'aa000001-0000-0000-0000-000000000003'::uuid, 2000.00, 'CASH', '2026-09-15'
WHERE NOT EXISTS (SELECT 1 FROM loan_repayment_logs WHERE loan_id = 'aa000001-0000-0000-0000-000000000003'::uuid AND payment_date = '2026-09-15');


-- ============================================================================
-- 15. BATCH ORDERS
-- ============================================================================

INSERT INTO batch_orders (id, batch_number, product_id, status, created_at)
SELECT 'bb000001-0000-0000-0000-000000000001'::uuid, 'BATCH-2026-001', 'b0000001-0000-0000-0000-000000000001'::uuid, 'ACTIVE', '2026-09-01 08:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM batch_orders WHERE batch_number = 'BATCH-2026-001');

INSERT INTO batch_orders (id, batch_number, product_id, status, created_at)
SELECT 'bb000001-0000-0000-0000-000000000002'::uuid, 'BATCH-2026-002', 'b0000001-0000-0000-0000-000000000004'::uuid, 'ACTIVE', '2026-09-05 08:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM batch_orders WHERE batch_number = 'BATCH-2026-002');

INSERT INTO batch_orders (id, batch_number, product_id, status, created_at)
SELECT 'bb000001-0000-0000-0000-000000000003'::uuid, 'BATCH-2026-003', 'b0000001-0000-0000-0000-000000000006'::uuid, 'ACTIVE', '2026-09-10 08:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM batch_orders WHERE batch_number = 'BATCH-2026-003');

INSERT INTO batch_orders (id, batch_number, product_id, status, created_at)
SELECT 'bb000001-0000-0000-0000-000000000004'::uuid, 'BATCH-2026-004', 'b0000001-0000-0000-0000-000000000011'::uuid, 'COMPLETED', '2026-08-15 08:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM batch_orders WHERE batch_number = 'BATCH-2026-004');

INSERT INTO batch_orders (id, batch_number, product_id, status, created_at)
SELECT 'bb000001-0000-0000-0000-000000000005'::uuid, 'BATCH-2026-005', 'b0000001-0000-0000-0000-000000000012'::uuid, 'ACTIVE', '2026-09-12 08:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM batch_orders WHERE batch_number = 'BATCH-2026-005');


-- ============================================================================
-- 16. QC RECORDS
-- ============================================================================

INSERT INTO qc_records (qc_stage, lot_id, batch_order_id, viscosity_cp, specific_gravity, opacity_percentage, shade_match_pass, seal_integrity_pass, inspector_name, notes, created_at)
SELECT 'INTAKE', (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-RM-001'), NULL, 1250.5, 1.4200, NULL, true, true, 'Bilal Ahmed', 'PVC resin — batch consistent, no discoloration', '2026-08-16 11:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM qc_records WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-RM-001') AND qc_stage = 'INTAKE');

INSERT INTO qc_records (qc_stage, lot_id, batch_order_id, viscosity_cp, specific_gravity, opacity_percentage, shade_match_pass, seal_integrity_pass, inspector_name, notes, created_at)
SELECT 'INTAKE', (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-RM-002'), NULL, NULL, 4.2500, 98.50, true, true, 'Bilal Ahmed', 'TiO2 — high opacity, within spec', '2026-09-02 11:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM qc_records WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-RM-002') AND qc_stage = 'INTAKE');

INSERT INTO qc_records (qc_stage, lot_id, batch_order_id, viscosity_cp, specific_gravity, opacity_percentage, shade_match_pass, seal_integrity_pass, inspector_name, notes, created_at)
SELECT 'IN_PROCESS', (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-001'), 'bb000001-0000-0000-0000-000000000001'::uuid, 850.0, 1.3800, NULL, true, true, 'Bilal Ahmed', 'PVC Pipe 2" — extrusion temp stable, dimensions OK', '2026-09-03 14:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM qc_records WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-001') AND qc_stage = 'IN_PROCESS');

INSERT INTO qc_records (qc_stage, lot_id, batch_order_id, viscosity_cp, specific_gravity, opacity_percentage, shade_match_pass, seal_integrity_pass, inspector_name, notes, created_at)
SELECT 'PACKAGING', (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-001'), 'bb000001-0000-0000-0000-000000000001'::uuid, NULL, NULL, NULL, true, true, 'Bilal Ahmed', 'Labeling correct, weight verified, ready for dispatch', '2026-09-04 10:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM qc_records WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-001') AND qc_stage = 'PACKAGING');

INSERT INTO qc_records (qc_stage, lot_id, batch_order_id, viscosity_cp, specific_gravity, opacity_percentage, shade_match_pass, seal_integrity_pass, inspector_name, notes, created_at)
SELECT 'INTAKE', (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-RM-006'), NULL, NULL, 2.7100, NULL, false, true, 'Bilal Ahmed', 'CaCO3 — slight yellow tint flagged for review', '2026-07-21 09:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM qc_records WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-RM-006') AND qc_stage = 'INTAKE');

INSERT INTO qc_records (qc_stage, lot_id, batch_order_id, viscosity_cp, specific_gravity, opacity_percentage, shade_match_pass, seal_integrity_pass, inspector_name, notes, created_at)
SELECT 'IN_PROCESS', (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-003'), 'bb000001-0000-0000-0000-000000000002'::uuid, NULL, 8.5200, NULL, true, true, 'Bilal Ahmed', 'Shower mixer — pressure test passed at 3 bar', '2026-09-11 15:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM qc_records WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-003') AND qc_stage = 'IN_PROCESS');

INSERT INTO qc_records (qc_stage, lot_id, batch_order_id, viscosity_cp, specific_gravity, opacity_percentage, shade_match_pass, seal_integrity_pass, inspector_name, notes, created_at)
SELECT 'IN_PROCESS', (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-004'), 'bb000001-0000-0000-0000-000000000003'::uuid, NULL, 2.3500, NULL, true, true, 'Bilal Ahmed', 'Washer basin — glaze even, no crazing', '2026-09-13 11:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM qc_records WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'LOT-FG-004') AND qc_stage = 'IN_PROCESS');


-- ============================================================================
-- 17. PRODUCT DELIVERIES
-- ============================================================================

INSERT INTO product_deliveries (product_id, quantity_delivered, customer_name, delivery_destination, delivery_chalan, remarks, created_at)
SELECT 'b0000001-0000-0000-0000-000000000001'::uuid, 50, 'Karachi Hardware', 'Burns Garden, Karachi', 'CH-2026-001', 'Against INV-2026-1001', '2026-09-06 10:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM product_deliveries WHERE delivery_chalan = 'CH-2026-001');

INSERT INTO product_deliveries (product_id, quantity_delivered, customer_name, delivery_destination, delivery_chalan, remarks, created_at)
SELECT 'b0000001-0000-0000-0000-000000000004'::uuid, 10, 'HomeBazaar', 'DHA Phase 5, Karachi', 'CH-2026-002', 'Against INV-2026-1002', '2026-09-11 14:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM product_deliveries WHERE delivery_chalan = 'CH-2026-002');

INSERT INTO product_deliveries (product_id, quantity_delivered, customer_name, delivery_destination, delivery_chalan, remarks, created_at)
SELECT 'b0000001-0000-0000-0000-000000000006'::uuid, 10, 'Metro Tiles & Sanitary', 'Mall Road, Lahore', 'CH-2026-003', 'Against INV-2026-1003', '2026-09-16 09:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM product_deliveries WHERE delivery_chalan = 'CH-2026-003');


-- ============================================================================
-- 18. SYSTEM AUDIT LOGS
-- ============================================================================

INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
SELECT 'PC-01', 'Accounts Dept', 'POSTED_INVOICE',
  '{"invoice_number":"INV-2026-1001","total_payable":29500}'
WHERE NOT EXISTS (SELECT 1 FROM system_audit_logs WHERE action_type = 'POSTED_INVOICE' AND details->>'invoice_number' = 'INV-2026-1001');

INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
SELECT 'PC-01', 'Accounts Dept', 'POSTED_INVOICE',
  '{"invoice_number":"INV-2026-1002","total_payable":51240}'
WHERE NOT EXISTS (SELECT 1 FROM system_audit_logs WHERE action_type = 'POSTED_INVOICE' AND details->>'invoice_number' = 'INV-2026-1002');

INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
SELECT 'PC-01', 'Accounts Dept', 'POSTED_INVOICE',
  '{"invoice_number":"INV-2026-1003","total_payable":80240}'
WHERE NOT EXISTS (SELECT 1 FROM system_audit_logs WHERE action_type = 'POSTED_INVOICE' AND details->>'invoice_number' = 'INV-2026-1003');

INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
SELECT 'PC-01', 'Bilal Ahmed', 'QC_PASSED',
  '{"lot_number":"LOT-FG-001","stage":"PACKAGING"}'
WHERE NOT EXISTS (SELECT 1 FROM system_audit_logs WHERE action_type = 'QC_PASSED' AND details->>'lot_number' = 'LOT-FG-001');

INSERT INTO system_audit_logs (node_id, operator_name, action_type, details)
SELECT 'PC-01', 'Accounts Dept', 'JOURNAL_ENTRY_CREATED',
  '{"entry_number":"JE-20260701-0001","narration":"Opening balances — Cash, Inventory, Equity","source":"INVOICING"}'
WHERE NOT EXISTS (SELECT 1 FROM system_audit_logs WHERE action_type = 'JOURNAL_ENTRY_CREATED' AND details->>'entry_number' = 'JE-20260701-0001');


-- ============================================================================
-- 19. PAYMENT VOUCHERS
-- ============================================================================

INSERT INTO payment_vouchers (voucher_no, voucher_type, voucher_date, payee_name, payee_address, purpose, amount, amount_in_words, remarks, created_at)
SELECT 'CPV-2026-00001', 'CASH_PAYMENT', '2026-09-18', 'Factory Staff Salaries — September 2026', NULL, 'Monthly salaries disbursement', 385000.00, 'Three lakh eighty-five thousand rupees only', 'Paid via cash counter', '2026-09-18 17:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM payment_vouchers WHERE voucher_no = 'CPV-2026-00001');

INSERT INTO payment_vouchers (voucher_no, voucher_type, voucher_date, payee_name, payee_address, purpose, amount, amount_in_words, remarks, created_at)
SELECT 'PPV-2026-00001', 'PARTY_PAYMENT', '2026-09-01', 'AGD Traders', 'SITE AREA, KARACHI', 'Payment against raw material supply (PVC Resin)', 915750.00, 'Nine lakh fifteen thousand seven hundred fifty rupees only', 'Bank transfer Ref: HBL-90812345', '2026-09-01 11:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM payment_vouchers WHERE voucher_no = 'PPV-2026-00001');

INSERT INTO payment_vouchers (voucher_no, voucher_type, voucher_date, payee_name, payee_address, purpose, amount, amount_in_words, remarks, created_at)
SELECT 'PPV-2026-00002', 'PARTY_PAYMENT', '2026-09-02', 'Sapphire Chemicals', 'INDUSTRIAL AREA, LAHORE', 'Payment against TiO2 supply', 336000.00, 'Three lakh thirty-six thousand rupees only', 'Bank transfer Ref: HBL-90812350', '2026-09-02 12:00:00+05'
WHERE NOT EXISTS (SELECT 1 FROM payment_vouchers WHERE voucher_no = 'PPV-2026-00002');

INSERT INTO payment_vouchers (voucher_no, voucher_type, voucher_date, payee_name, payee_address, purpose, amount, amount_in_words, remarks, created_at)
SELECT 'BPV-2026-00001', 'BANK_PAYMENT', '2026-09-18', 'Factory Landlord — M/s BuildWell Associates', 'Gulshan-e-Iqbal, Karachi', 'Factory rent — September 2026', 120000.00, 'One lakh twenty thousand rupees only', 'Online transfer', '2026-09-18 17:30:00+05'
WHERE NOT EXISTS (SELECT 1 FROM payment_vouchers WHERE voucher_no = 'BPV-2026-00001');


-- ============================================================================
-- 20. DASHBOARD KPIs (update with realistic values)
-- ============================================================================

UPDATE dashboard_kpis SET
  raw_material_value_pkr = 3298750.00,
  finished_goods_value_pkr = 5120800.00,
  active_batch_orders_count = 4,
  qc_warning_lots_count = 1,
  trial_balance_status = 'BALANCED',
  updated_at = NOW()
WHERE id = (SELECT id FROM dashboard_kpis LIMIT 1);


-- ============================================================================
-- 21. SANITARY PRODUCTS — update stock to reflect recent activity
-- ============================================================================

UPDATE sanitary_products SET available_stock = 1500, total_stock = 1800 WHERE sku = 'PVC-0200';
UPDATE sanitary_products SET available_stock = 800, total_stock = 950 WHERE sku = 'PVC-0400';
UPDATE sanitary_products SET available_stock = 3200, total_stock = 3500 WHERE sku = 'PVC-EL20';
UPDATE sanitary_products SET available_stock = 120, total_stock = 150 WHERE sku = 'FAU-0001';
UPDATE sanitary_products SET available_stock = 200, total_stock = 240 WHERE sku = 'FAU-0002';
UPDATE sanitary_products SET available_stock = 85, total_stock = 100 WHERE sku = 'CER-0001';
UPDATE sanitary_products SET available_stock = 45, total_stock = 60 WHERE sku = 'CER-0002';
UPDATE sanitary_products SET available_stock = 35, total_stock = 45 WHERE sku = 'SS-0001';
UPDATE sanitary_products SET available_stock = 60, total_stock = 75 WHERE sku = 'SS-0002';
UPDATE sanitary_products SET available_stock = 180, total_stock = 220 WHERE sku = 'TST-0001';
UPDATE sanitary_products SET available_stock = 5000, total_stock = 6000 WHERE sku = 'CP-0001';
UPDATE sanitary_products SET available_stock = 900, total_stock = 1100 WHERE sku = 'FLX-001';

-- ============================================================================
-- DONE
-- ============================================================================
-- Summary of demo data created:
--
-- PARTIES:        3 suppliers + 5 customers + 1 both = 9
-- SANITARY PRODS: 12 products (pipes, faucets, basins, sinks, seats, fittings)
-- PRODUCTS MASTER: 8 raw materials + 12 finished goods = 20
-- INVENTORY LOTS: 8 raw material lots + 8 finished goods lots = 16
-- INV. BALANCES:  8 raw material + 8 finished goods = 16
-- IGPs:           7 (5 converted, 1 pending QC, 1 pending inspection)
-- GRNs:           5
-- ACCOUNTS:       21 accounts (COA)
-- JOURNAL ENTRIES: 7 (opening + 3 sales + 1 purchase + 1 salary + 1 rent)
-- JOURNAL LINES:  ~20 lines
-- SALES INVOICES: 4 (3 posted + 1 draft)
-- INVOICE ITEMS:  ~10 line items across invoices
-- WORKERS:        8 (operators, supervisor, lab tech, helpers)
-- ATTENDANCE:     ~120 records (Sep 1-18)
-- WORKER LOANS:   3 loans + 12 repayments
-- BATCH ORDERS:   5 (4 active + 1 completed)
-- QC RECORDS:     8 records (intake, in-process, packaging)
-- DELIVERIES:     3 product deliveries
-- PAYMENT VOUCHERS: 4 (salary, 2 supplier payments, 1 rent)
-- AUDIT LOGS:     6 entries
-- ============================================================================
