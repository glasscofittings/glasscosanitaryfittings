-- =============================================================================
-- ALL-IN-ONE MASTER SEED SCRIPT (SAP ENTERPRISE ERP)
-- Completely idempotent. Run in Supabase SQL Editor.
-- =============================================================================

-- 1. CHART OF ACCOUNTS (COA)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gl_accounts') THEN
    INSERT INTO public.gl_accounts (account_code, account_name, account_type, is_active) VALUES
      ('1001', 'Cash in Hand',             'asset',     true),
      ('1002', 'Bank - HBL',               'asset',     true),
      ('1100', 'Accounts Receivable',      'asset',     true),
      ('1101', 'Raw Material Inventory',   'asset',     true),
      ('1102', 'Finished Goods Inventory', 'asset',     true),
      ('1200', 'Prepaid Expenses',         'asset',     true),
      ('2001', 'Accounts Payable',         'liability', true),
      ('2100', 'Sales Tax Payable',        'liability', true),
      ('2200', 'Further Tax Payable',      'liability', true),
      ('3001', 'Share Capital',            'equity',    true),
      ('3100', 'Retained Earnings',        'equity',    true),
      ('4001', 'Sales Revenue',            'revenue',   true),
      ('4002', 'Other Income',             'revenue',   true),
      ('5001', 'Cost of Goods Sold',       'expense',   true),
      ('5100', 'Salaries Expense',         'expense',   true),
      ('5200', 'Utilities Expense',        'expense',   true),
      ('5300', 'Rent Expense',             'expense',   true),
      ('5400', 'Office Supplies',          'expense',   true)
    ON CONFLICT (account_code) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounts_chart') THEN
    INSERT INTO public.accounts_chart (account_code, account_name, account_type) VALUES
      ('1001', 'Cash in Hand',             'ASSET'),
      ('1002', 'Bank - HBL',               'ASSET'),
      ('1100', 'Accounts Receivable',      'ASSET'),
      ('1101', 'Raw Material Inventory',   'ASSET'),
      ('1102', 'Finished Goods Inventory', 'ASSET'),
      ('1200', 'Prepaid Expenses',         'ASSET'),
      ('2001', 'Accounts Payable',         'LIABILITY'),
      ('2100', 'Sales Tax Payable',        'LIABILITY'),
      ('2200', 'Further Tax Payable',      'LIABILITY'),
      ('3001', 'Share Capital',            'EQUITY'),
      ('3100', 'Retained Earnings',        'EQUITY'),
      ('4001', 'Sales Revenue',            'REVENUE'),
      ('4002', 'Other Income',             'REVENUE'),
      ('5001', 'Cost of Goods Sold',       'EXPENSE'),
      ('5100', 'Salaries Expense',         'EXPENSE'),
      ('5200', 'Utilities Expense',        'EXPENSE'),
      ('5300', 'Rent Expense',             'EXPENSE'),
      ('5400', 'Office Supplies',          'EXPENSE')
    ON CONFLICT (account_code) DO NOTHING;
  END IF;
END $$;

-- 2. PARTIES (Suppliers & Customers)
INSERT INTO parties (id, name, party_type, phone, email, address, ntn_strn, is_registered) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Chenab Chemical Works',    'SUPPLIER', '+92-42-35110001', 'sales@chenabchem.pk',   '23-Km Lahore Sialkot Motorway, Lahore', '1234567-8', true),
  ('a0000000-0000-0000-0000-000000000002', 'Titanium Pigments Pvt Ltd', 'SUPPLIER', '+92-21-34560002', 'info@titaniumpigments.pk', 'SITE Industrial Area, Karachi',        '2345678-9', true),
  ('a0000000-0000-0000-0000-000000000003', 'Lucky Resin Industries',    'SUPPLIER', '+92-41-8780003',  'contact@luckyresin.pk',    'M-3 Industrial Estate, Faisalabad',     '3456789-0', true),
  ('b0000000-0000-0000-0000-000000000001', 'Karachi Sanitary Mart',     'CUSTOMER', '+92-21-32340001', 'orders@karachisanitary.pk', 'Shop 12, Tariq Road, Karachi',         '4567890-1', true),
  ('b0000000-0000-0000-0000-000000000002', 'Lahore Bath House',         'CUSTOMER', '+92-42-35780002', 'purchase@lahorebath.pk',    '78-A, Mall Road, Lahore',               '5678901-2', true),
  ('b0000000-0000-0000-0000-000000000003', 'Faisalabad Fixtures',       'CUSTOMER', '+92-41-8870003',  'buy@faisalabadfixtures.pk', '15-B, D-Ground, Faisalabad',            '6789012-3', true),
  ('b0000000-0000-0000-0000-000000000004', 'Peshawar Plumbing Co',      'CUSTOMER', '+92-91-2340004',  'info@peshawarplumbing.pk',  '32, University Road, Peshawar',          '7890123-4', false),
  ('b0000000-0000-0000-0000-000000000005', 'Islamabad Hardware Store',  'CUSTOMER', '+92-51-2340005',  'sales@islamabadhw.pk',      'Block C, Blue Area, Islamabad',          '8901234-5', true)
ON CONFLICT (id) DO NOTHING;

-- 3. PRODUCTS MASTER (Raw Materials & Finished Goods)
INSERT INTO products_master (id, name, category) VALUES
('c0000000-0000-0000-0000-000000000001', 'Ceramic Clay White',          'Ceramics'),
  ('c0000000-0000-0000-0000-000000000002', 'Brass Ingot',                 'Metals'),
  ('c0000000-0000-0000-0000-000000000003', 'Chrome Plating Solution',     'Chemicals'),
  ('c0000000-0000-0000-0000-000000000004', 'Rubber Gasket Stock',         'Components'),
  ('c0000000-0000-0000-0000-000000000005', 'Silicone Sealant',            'Adhesives'),
  ('c0000000-0000-0000-0000-000000000006', 'PVC Fitting Compound',        'Polymers'),
('d0000000-0000-0000-0000-000000000001', 'Ceramic Wash Basin',           'Basins'),
  ('d0000000-0000-0000-0000-000000000002', 'Health Faucet Set',            'Faucets'),
  ('d0000000-0000-0000-0000-000000000003', 'Bib Cock 1/2 inch Chrome',     'Faucets'),
  ('d0000000-0000-0000-0000-000000000004', 'Flush Tank Complete',          'Flush Tanks')
ON CONFLICT (name) DO NOTHING;

-- 4. SUPPLIERS MASTER
INSERT INTO suppliers (id, supplier_code, company_name, contact_person, email, phone, payment_terms_days) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'SUP-001', 'Chenab Chemical Works',    'Ahmed Raza',     'sales@chenabchem.pk',   '+92-42-35110001', 30),
  ('a0000000-0000-0000-0000-000000000002', 'SUP-002', 'Titanium Pigments Pvt Ltd', 'Bilal Khan',     'info@titaniumpigments.pk', '+92-21-34560002', 45),
  ('a0000000-0000-0000-0000-000000000003', 'SUP-003', 'Lucky Resin Industries',    'Tariq Mehmood',   'contact@luckyresin.pk', '+92-41-8780003',  30)
ON CONFLICT (id) DO NOTHING;

-- 5. PURCHASE ORDERS
INSERT INTO purchase_orders (id, po_number, supplier_id, total_amount_pkr, status) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'PO-2026-001', 'a0000000-0000-0000-0000-000000000001', 1250000.00, 'approved'),
  ('e0000000-0000-0000-0000-000000000002', 'PO-2026-002', 'a0000000-0000-0000-0000-000000000002', 875000.00,  'approved'),
  ('e0000000-0000-0000-0000-000000000003', 'PO-2026-003', 'a0000000-0000-0000-0000-000000000003', 450000.00,  'draft')
ON CONFLICT (id) DO NOTHING;

-- 6. INVENTORY LOTS
INSERT INTO inventory_lots (id, lot_number, product_id, warehouse_id, vendor_lot_code, initial_qty, remaining_qty, unit_cost_pkr, qc_status, status)
SELECT v.id::uuid, v.lot_number, p.id, wh.id, v.vendor_lot_code,
       v.initial_qty, v.remaining_qty, v.unit_cost_pkr, v.qc_status, v.status
FROM (VALUES
('f0000000-0000-0000-0000-000000000001', 'LOT-2026-001', 'Ceramic Clay White',           'CHENAB-CLAY-001', 500,  500,  850.00,  'PASSED',          'unrestricted'),
  ('f0000000-0000-0000-0000-000000000002', 'LOT-2026-002', 'Brass Ingot',                  'CHENAB-BR-002',    300,  300,  620.00,  'PASSED',          'unrestricted'),
  ('f0000000-0000-0000-0000-000000000003', 'LOT-2026-003', 'Chrome Plating Solution',      'TITAN-CR-003',    200,  200,  310.00,  'PASSED',          'unrestricted'),
  ('f0000000-0000-0000-0000-000000000004', 'LOT-2026-004', 'Rubber Gasket Stock',          'TITAN-RG-004',    1000, 1000, 45.00,   'PASSED',          'unrestricted'),
  ('f0000000-0000-0000-0000-000000000005', 'LOT-2026-005', 'Silicone Sealant',             'LUCKY-SS-005',    50,   50,   1200.00, 'PASSED',          'unrestricted'),
  ('f0000000-0000-0000-0000-000000000006', 'LOT-2026-006', 'PVC Fitting Compound',         'LUCKY-PV-006',    100,  100,  480.00,  'PASSED',          'unrestricted'),
  ('f0000000-0000-0000-0000-000000000007', 'LOT-2026-007', 'Ceramic Clay White',           'CHENAB-CLAY-007', 250,  250,  620.00,  'PENDING',         'quality_inspection'),
  ('f0000000-0000-0000-0000-000000000008', 'LOT-2026-008', 'Brass Ingot',                  'CHENAB-BR-008',    100,  100,  620.00,  'FLAGGED_WARNING', 'blocked')
) AS v(id, lot_number, product_name, vendor_lot_code, initial_qty, remaining_qty, unit_cost_pkr, qc_status, status)
CROSS JOIN LATERAL (SELECT id FROM products_master WHERE name = v.product_name LIMIT 1) p
CROSS JOIN LATERAL (SELECT id FROM inventory_warehouses WHERE code = 'WH-01' LIMIT 1) wh
WHERE p.id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_lots WHERE id = v.id::uuid);

-- 7. GOODS RECEIPT NOTES (GRN)
INSERT INTO goods_receipt_notes (id, grn_number, vendor_id, vendor_name, received_date, items, status) VALUES
('07000000-0000-0000-0000-000000000001', 'GRN-2026-001', 'a0000000-0000-0000-0000-000000000001', 'Chenab Chemical Works',    '2026-09-10', '[{"product":"Ceramic Clay White","qty":500,"unit":"KG","unit_price":850,"total":425000}]'::jsonb, 'invoiced'),
  ('07000000-0000-0000-0000-000000000002', 'GRN-2026-002', 'a0000000-0000-0000-0000-000000000001', 'Chenab Chemical Works',    '2026-09-11', '[{"product":"Brass Ingot","qty":300,"unit":"KG","unit_price":620,"total":186000}]'::jsonb,   'invoiced'),
  ('07000000-0000-0000-0000-000000000003', 'GRN-2026-003', 'a0000000-0000-0000-0000-000000000002', 'Titanium Pigments Pvt Ltd','2026-09-12', '[{"product":"Chrome Plating Solution","qty":200,"unit":"L","unit_price":310,"total":62000}]'::jsonb,          'invoiced'),
  ('07000000-0000-0000-0000-000000000004', 'GRN-2026-004', 'a0000000-0000-0000-0000-000000000002', 'Titanium Pigments Pvt Ltd','2026-09-15', '[{"product":"Ceramic Clay White","qty":240,"unit":"KG","unit_price":850,"total":204000}]'::jsonb, 'pending_invoice'),
  ('07000000-0000-0000-0000-000000000005', 'GRN-2026-005', 'a0000000-0000-0000-0000-000000000003', 'Lucky Resin Industries',   '2026-09-16', '[{"product":"Rubber Gasket Stock","qty":1000,"unit":"KG","unit_price":45,"total":45000}]'::jsonb,  'invoiced')
ON CONFLICT (id) DO NOTHING;

-- 8. PURCHASE INVOICES
INSERT INTO purchase_invoices (id, invoice_number, grn_id, grn_number, vendor_id, vendor_name, taxable_amount, tax_amount, total_payable, status, items) VALUES
  ('08000000-0000-0000-0000-000000000001', 'PINV-2026-001', '07000000-0000-0000-0000-000000000001', 'GRN-2026-001', 'a0000000-0000-0000-0000-000000000001', 'Chenab Chemical Works',    425000.00, 0, 425000.00, 'pending_approval', '[{"description":"Ceramic Clay White","qty":500,"unit_price":850,"total":425000}]'::jsonb),
  ('08000000-0000-0000-0000-000000000002', 'PINV-2026-002', '07000000-0000-0000-0000-000000000002', 'GRN-2026-002', 'a0000000-0000-0000-0000-000000000001', 'Chenab Chemical Works',    186000.00, 0, 186000.00, 'pending_approval', '[{"description":"Brass Ingot","qty":300,"unit_price":620,"total":186000}]'::jsonb),
  ('08000000-0000-0000-0000-000000000003', 'PINV-2026-003', '07000000-0000-0000-0000-000000000003', 'GRN-2026-003', 'a0000000-0000-0000-0000-000000000002', 'Titanium Pigments Pvt Ltd', 62000.00,  0, 62000.00,  'posted',           '[{"description":"Chrome Plating Solution","qty":200,"unit_price":310,"total":62000}]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 9. SAP INVENTORY LOTS (Legacy SAP table)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_lots_sap') THEN
    INSERT INTO inventory_lots_sap (id, lot_number, material_name, initial_qty, current_qty, unit_of_measure, unit_price_pkr, status) VALUES
('f0000000-0000-0000-0000-000000000001', 'LOT-2026-001', 'Ceramic Clay White',      500,  500,  'KG', 850.00,  'unrestricted'),
      ('f0000000-0000-0000-0000-000000000002', 'LOT-2026-002', 'Brass Ingot',             300,  300,  'KG', 620.00,  'unrestricted'),
      ('f0000000-0000-0000-0000-000000000003', 'LOT-2026-003', 'Chrome Plating Solution', 200,  200,  'L',  310.00,  'unrestricted'),
      ('f0000000-0000-0000-0000-000000000004', 'LOT-2026-004', 'Rubber Gasket Stock',     1000, 1000, 'KG', 45.00,   'unrestricted'),
      ('f0000000-0000-0000-0000-000000000005', 'LOT-2026-005', 'Silicone Sealant',        50,   50,   'KG', 1200.00, 'unrestricted'),
      ('f0000000-0000-0000-0000-000000000006', 'LOT-2026-006', 'PVC Fitting Compound',    100,  100,  'L',  480.00,  'unrestricted')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- 10. SALES INVOICES & ITEMS
INSERT INTO sales_invoices (id, invoice_number, customer_id, taxable_value_pkr, sales_tax_rate, sales_tax_amount_pkr, total_invoice_value_pkr, is_posted) VALUES
  ('09000000-0000-0000-0000-000000000001', 'INV-2026-001', 'b0000000-0000-0000-0000-000000000001', 480000.00, 18, 86400.00,  566400.00, true),
  ('09000000-0000-0000-0000-000000000002', 'INV-2026-002', 'b0000000-0000-0000-0000-000000000002', 350000.00, 18, 63000.00,  413000.00, true),
  ('09000000-0000-0000-0000-000000000003', 'INV-2026-003', 'b0000000-0000-0000-0000-000000000003', 220000.00, 18, 39600.00,  259600.00, true),
  ('09000000-0000-0000-0000-000000000004', 'INV-2026-004', 'b0000000-0000-0000-0000-000000000004', 150000.00, 18, 27000.00,  177000.00, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_invoice_items (id, invoice_id, product_id, product_name, quantity, unit_price_pkr, line_total_pkr, unit_of_measure) VALUES
('0a000000-0000-0000-0000-000000000001', '09000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Ceramic Wash Basin',       100, 3200.00, 320000.00, 'NOS'),
  ('0a000000-0000-0000-0000-000000000002', '09000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Health Faucet Set',        160, 1000.00, 160000.00, 'NOS'),
  ('0a000000-0000-0000-0000-000000000003', '09000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Ceramic Wash Basin',       70,  3200.00, 224000.00, 'NOS'),
  ('0a000000-0000-0000-0000-000000000004', '09000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'Bib Cock 1/2 inch Chrome', 25,  5040.00, 126000.00, 'NOS'),
  ('0a000000-0000-0000-0000-000000000005', '09000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'Health Faucet Set',        120, 1000.00, 120000.00, 'NOS'),
  ('0a000000-0000-0000-0000-000000000006', '09000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004', 'Flush Tank Complete',      40,  2500.00, 100000.00, 'NOS')
ON CONFLICT (id) DO NOTHING;

-- 11. GL LEDGER ENTRIES
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gl_ledger_entries')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gl_accounts') THEN
    
    INSERT INTO gl_ledger_entries (transaction_ref, account_id, debit_pkr, credit_pkr, posted_by)
    SELECT 'PO-2026-001-RCPT', a.id, 425000.00, 0.00, 'Gate Keeper'
    FROM gl_accounts a
    WHERE a.account_code = '1101'
      AND NOT EXISTS (SELECT 1 FROM gl_ledger_entries WHERE transaction_ref = 'PO-2026-001-RCPT' AND debit_pkr = 425000.00);

    INSERT INTO gl_ledger_entries (transaction_ref, account_id, debit_pkr, credit_pkr, posted_by)
    SELECT 'PO-2026-001-RCPT', a.id, 0.00, 425000.00, 'Gate Keeper'
    FROM gl_accounts a
    WHERE a.account_code = '2001'
      AND NOT EXISTS (SELECT 1 FROM gl_ledger_entries WHERE transaction_ref = 'PO-2026-001-RCPT' AND credit_pkr = 425000.00);

    INSERT INTO gl_ledger_entries (transaction_ref, account_id, debit_pkr, credit_pkr, posted_by)
    SELECT 'PO-2026-002-RCPT', a.id, 186000.00, 0.00, 'Gate Keeper'
    FROM gl_accounts a
    WHERE a.account_code = '1101'
      AND NOT EXISTS (SELECT 1 FROM gl_ledger_entries WHERE transaction_ref = 'PO-2026-002-RCPT' AND debit_pkr = 186000.00);

    INSERT INTO gl_ledger_entries (transaction_ref, account_id, debit_pkr, credit_pkr, posted_by)
    SELECT 'PO-2026-002-RCPT', a.id, 0.00, 186000.00, 'Gate Keeper'
    FROM gl_accounts a
    WHERE a.account_code = '2001'
      AND NOT EXISTS (SELECT 1 FROM gl_ledger_entries WHERE transaction_ref = 'PO-2026-002-RCPT' AND credit_pkr = 186000.00);

    INSERT INTO gl_ledger_entries (transaction_ref, account_id, debit_pkr, credit_pkr, posted_by)
    SELECT 'INV-2026-001-POST', a.id, 566400.00, 0.00, 'Sales Dept'
    FROM gl_accounts a
    WHERE a.account_code = '1100'
      AND NOT EXISTS (SELECT 1 FROM gl_ledger_entries WHERE transaction_ref = 'INV-2026-001-POST' AND debit_pkr = 566400.00);

    INSERT INTO gl_ledger_entries (transaction_ref, account_id, debit_pkr, credit_pkr, posted_by)
    SELECT 'INV-2026-001-POST', a.id, 0.00, 480000.00, 'Sales Dept'
    FROM gl_accounts a
    WHERE a.account_code = '4001'
      AND NOT EXISTS (SELECT 1 FROM gl_ledger_entries WHERE transaction_ref = 'INV-2026-001-POST' AND credit_pkr = 480000.00);

    INSERT INTO gl_ledger_entries (transaction_ref, account_id, debit_pkr, credit_pkr, posted_by)
    SELECT 'INV-2026-001-POST', a.id, 0.00, 86400.00, 'Sales Dept'
    FROM gl_accounts a
    WHERE a.account_code = '2100'
      AND NOT EXISTS (SELECT 1 FROM gl_ledger_entries WHERE transaction_ref = 'INV-2026-001-POST' AND credit_pkr = 86400.00);
  END IF;
END $$;

-- 12. CUSTOMER RECEIPT VOUCHERS (AR Cash/Bank Collections)
INSERT INTO customer_receipt_vouchers (id, voucher_no, customer_id, customer_name, receipt_date, amount, payment_mode, reference_no, remarks, status) VALUES
  ('0b000000-0000-0000-0000-000000000001', 'CRV-2026-001', 'b0000000-0000-0000-0000-000000000001', 'Karachi Sanitary Mart',     '2026-09-20', 500000.00, 'BANK_TRANSFER', 'HBL-TXN-98421', 'Payment against INV-2026-001', 'POSTED'),
  ('0b000000-0000-0000-0000-000000000002', 'CRV-2026-002', 'b0000000-0000-0000-0000-000000000002', 'Lahore Bath House',         '2026-09-21', 300000.00, 'CHEQUE',        'UBL-CHQ-049182','Clearing cheque payment',     'POSTED'),
  ('20000000-0000-0000-0000-000000000001', 'CRV-2026-003', 'b0000000-0000-0000-0000-000000000003', 'Faisalabad Fixtures',       '2026-09-19', 259600.00, 'BANK_TRANSFER', 'MCB-TXN-77301', 'Full payment for INV-003',      'POSTED'),
  ('20000000-0000-0000-0000-000000000002', 'CRV-2026-004', 'b0000000-0000-0000-0000-000000000004', 'Peshawar Plumbing Co',      '2026-09-21', 100000.00, 'CHEQUE',        'CHEQ-003921',   'Partial payment',              'POSTED'),
  ('20000000-0000-0000-0000-000000000003', 'CRV-2026-005', 'b0000000-0000-0000-0000-000000000005', 'Islamabad Hardware Store',  '2026-09-22', 177000.00, 'CASH',          NULL,            'Cash payment counter',         'POSTED')
ON CONFLICT (id) DO NOTHING;

-- 13. JOURNAL ENTRIES
INSERT INTO journal_entries (entry_number, entry_date, narration, is_balanced, status) VALUES
  ('JE-2026-0001', '2026-09-15', 'Opening balance - Cash in Hand',           true, 'POSTED'),
  ('JE-2026-0002', '2026-09-15', 'Opening balance - Bank HBL',               true, 'POSTED'),
  ('JE-2026-0003', '2026-09-18', 'Sale to Karachi Sanitary Mart (INV-001)', true, 'POSTED'),
  ('JE-2026-0004', '2026-09-19', 'Sale to Lahore Bath House (INV-002)',     true, 'POSTED'),
  ('JE-2026-0005', '2026-09-20', 'Customer payment - Karachi Sanitary Mart',true, 'POSTED'),
  ('JE-2026-0006', '2026-09-21', 'Customer payment - Lahore Bath House',    true, 'POSTED')
ON CONFLICT (entry_number) DO NOTHING;

-- 14. BILL OF MATERIALS (BOM)
INSERT INTO bill_of_materials (id, finished_good_id, version, is_active) VALUES
  ('0f000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '1.0', true),
  ('0f000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '1.0', true),
  ('0f000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', '1.0', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO bom_items (bom_id, raw_material_id, quantity_required)
SELECT b.bom_id, p.id, b.qty
FROM (VALUES
('0f000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 'Ceramic Clay White',           0.15),
  ('0f000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 'Brass Ingot',                  0.25),
  ('0f000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000003'::uuid, 'Chrome Plating Solution',      0.10),
  ('0f000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000004'::uuid, 'Rubber Gasket Stock',          0.40),
  ('0f000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000005'::uuid, 'Silicone Sealant',             0.01),
  ('0f000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 'Ceramic Clay White',           0.20),
  ('0f000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 'Brass Ingot',                  0.35),
  ('0f000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000006'::uuid, 'PVC Fitting Compound',         0.15),
  ('0f000000-0000-0000-0000-000000000003'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 'Ceramic Clay White',           0.10),
  ('0f000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 'Brass Ingot',                  0.30),
  ('0f000000-0000-0000-0000-000000000003'::uuid, 'c0000000-0000-0000-0000-000000000004'::uuid, 'Rubber Gasket Stock',          0.50)
) AS b(bom_id, default_id, product_name, qty)
LEFT JOIN products_master p ON (p.id = b.default_id OR p.name = b.product_name)
WHERE p.id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 15. PRODUCTION ORDERS
INSERT INTO production_orders (id, order_no, bom_id, target_product_id, target_product_name, target_qty, actual_qty, scrap_qty, unit_of_measure, status, start_date, total_material_cost, unit_cost_pkr, operator_name) VALUES
('0d000000-0000-0000-0000-000000000001', 'MO-2026-001', '0f000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Ceramic Wash Basin',      200, 200, 0, 'NOS', 'COMPLETED',   '2026-09-14', 385000.00, 1925.00, 'Tariq Mehmood'),
  ('0d000000-0000-0000-0000-000000000002', 'MO-2026-002', '0f000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Health Faucet Set',       500, 480, 5, 'NOS', 'IN_PROGRESS', '2026-09-18', 0,         0,       'Tariq Mehmood'),
  ('0d000000-0000-0000-0000-000000000003', 'MO-2026-003', '0f000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'Bib Cock 1/2 inch Chrome',100, 0,   0, 'NOS', 'PLANNED',     '2026-09-22', 0,         0,       'Tariq Mehmood'),
  ('50000000-0000-0000-0000-000000000001', 'MO-2026-004', '0f000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Ceramic Wash Basin',      500, 0,   0, 'NOS', 'PLANNED',     '2026-09-22', 0,         0,       'Tariq Mehmood'),
  ('50000000-0000-0000-0000-000000000002', 'MO-2026-005', '0f000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Health Faucet Set',       300, 0,   0, 'NOS', 'PLANNED',     '2026-09-23', 0,         0,       'Tariq Mehmood')
ON CONFLICT (id) DO NOTHING;

-- 16. STOCK TRANSFERS (Warehouse transfers)
INSERT INTO stock_transfers (id, transfer_no, source_warehouse_code, target_warehouse_code, transfer_date, status, dispatched_by, remarks) VALUES
  ('0e000000-0000-0000-0000-000000000001', 'STO-2026-001', 'WH-01', 'WH-02', '2026-09-18', 'RECEIVED',   'Warehouse Supervisor', 'Monthly FG restock from raw store'),
  ('0e000000-0000-0000-0000-000000000002', 'STO-2026-002', 'WH-02', 'WH-03', '2026-09-20', 'RECEIVED',   'Warehouse Supervisor', 'Dispatch to distribution point'),
  ('40000000-0000-0000-0000-000000000003', 'STO-2026-003', 'WH-01', 'WH-02', '2026-09-21', 'DISPATCHED', 'Warehouse Supervisor', 'Emergency reorder for line')
ON CONFLICT (transfer_no) DO NOTHING;

-- 17. WORKERS (Labour & HR)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workers') THEN
    INSERT INTO workers (id, full_name, role_designation, base_salary_pkr, joining_date, is_active, designation, daily_rate_pkr, status, worker_code) VALUES
      ('10000000-0000-0000-0000-000000000001', 'Muhammad Ali',     'Machine Operator',  75000, '2024-01-10', true, 'Machine Operator',  2500, 'ACTIVE', 'W-001'),
      ('10000000-0000-0000-0000-000000000002', 'Ahmed Hassan',     'Quality Inspector', 90000, '2024-02-15', true, 'Quality Inspector', 3000, 'ACTIVE', 'W-002'),
      ('10000000-0000-0000-0000-000000000003', 'Bilal Ahmad',      'Warehouse Worker',  60000, '2024-03-01', true, 'Warehouse Worker',  2000, 'ACTIVE', 'W-003'),
      ('10000000-0000-0000-0000-000000000004', 'Tariq Mehmood',    'Production Lead',   105000,'2023-11-20', true, 'Production Lead',   3500, 'ACTIVE', 'W-004'),
      ('10000000-0000-0000-0000-000000000005', 'Usman Ghani',      'Packaging Staff',   60000, '2024-04-01', true, 'Packaging Staff',   2000, 'ACTIVE', 'W-005'),
      ('10000000-0000-0000-0000-000000000006', 'Zahid Iqbal',      'Forklift Operator', 84000, '2024-01-25', true, 'Forklift Operator', 2800, 'ACTIVE', 'W-006'),
      ('10000000-0000-0000-0000-000000000007', 'Imran Shah',       'Helper',            54000, '2024-05-10', true, 'Helper',            1800, 'ACTIVE', 'W-007'),
      ('10000000-0000-0000-0000-000000000008', 'Kamran Yousuf',    'Security Guard',    66000, '2024-02-28', true, 'Security Guard',    2200, 'ACTIVE', 'W-008')
    ON CONFLICT (worker_code) DO UPDATE SET
      full_name          = EXCLUDED.full_name,
      role_designation   = EXCLUDED.role_designation,
      base_salary_pkr    = EXCLUDED.base_salary_pkr,
      joining_date       = EXCLUDED.joining_date,
      designation        = EXCLUDED.designation,
      daily_rate_pkr     = EXCLUDED.daily_rate_pkr,
      status             = EXCLUDED.status,
      is_active          = EXCLUDED.is_active;
  END IF;
END $$;

-- 18. WORKER ATTENDANCE (September 2026)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'worker_attendance') THEN
    -- Bulk attendance: present for all working days in Sep 2026
    INSERT INTO worker_attendance (worker_id, attendance_date, status)
    SELECT w.id, d.dt::date, 'P'
    FROM (VALUES ('W-001'),('W-002'),('W-003'),('W-004'),('W-005'),('W-006'),('W-007'),('W-008')) AS wc(code)
    JOIN workers w ON w.worker_code = wc.code
    CROSS JOIN (
      SELECT generate_series('2026-09-01'::date, '2026-09-22'::date, '1 day'::interval) AS dt
    ) d
    WHERE EXTRACT(DOW FROM d.dt) NOT IN (0)
    ON CONFLICT (worker_id, attendance_date) DO NOTHING;

    -- Override specific absences / leaves
    INSERT INTO worker_attendance (worker_id, attendance_date, status)
    SELECT w.id, v.dt::date, v.status
    FROM (VALUES
      ('W-003', '2026-09-10', 'A'),
      ('W-003', '2026-09-11', 'A'),
      ('W-007', '2026-09-15', 'A'),
      ('W-007', '2026-09-16', 'A'),
      ('W-005', '2026-09-08', 'L'),
      ('W-002', '2026-09-22', 'A')
    ) AS v(code, dt, status)
    JOIN workers w ON w.worker_code = v.code
    ON CONFLICT (worker_id, attendance_date) DO UPDATE SET status = EXCLUDED.status;
  END IF;
END $$;

-- 19. WORKER LOANS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'worker_loans') THEN
    INSERT INTO worker_loans (id, worker_id, original_loan_amount, current_balance, monthly_deduction_rate)
    SELECT v.id::uuid, w.id, v.orig, v.bal, v.rate
    FROM (VALUES
      ('0c000000-0000-0000-0000-000000000001', 'W-003', 30000, 20000, 5000),
      ('0c000000-0000-0000-0000-000000000002', 'W-007', 15000, 10000, 3000)
    ) AS v(id, code, orig, bal, rate)
    JOIN workers w ON w.worker_code = v.code
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- 20. PAYROLL RUNS & PAYROLL SLIPS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payroll_runs') THEN
    INSERT INTO payroll_runs (id, payroll_no, month, year, total_workers, gross_salaries, total_deductions, total_loan_repayments, net_payable, status) VALUES
      ('30000000-0000-0000-0000-000000000001', 'PAY-2026-08', 8, 2026, 8, 594000, 0, 8000, 586000, 'PAID')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO payroll_slips (payroll_run_id, worker_id, worker_name, role_designation, base_salary, days_in_month, present_days, absent_days, leave_days, daily_rate, earned_salary, loan_deduction, net_salary)
    SELECT '30000000-0000-0000-0000-000000000001'::uuid, w.id,
           v.worker_name, v.role_designation, v.base_salary,
           v.days_in_month, v.present_days, v.absent_days, v.leave_days,
           v.daily_rate, v.earned_salary, v.loan_deduction, v.net_salary
    FROM (VALUES
      ('W-001', 'Muhammad Ali',     'Machine Operator',  75000, 31, 31, 0, 0, 2419.35,  75000, 0,    75000),
      ('W-002', 'Ahmed Hassan',     'Quality Inspector', 90000, 31, 31, 0, 0, 2903.23,  90000, 0,    90000),
      ('W-003', 'Bilal Ahmad',      'Warehouse Worker',  60000, 31, 29, 2, 0, 1935.48,  53130, 5000, 48130),
      ('W-004', 'Tariq Mehmood',    'Production Lead',  105000, 31, 31, 0, 0, 3387.10, 105000, 0,   105000),
      ('W-005', 'Usman Ghani',      'Packaging Staff',   60000, 31, 30, 0, 1, 1935.48,  60000, 0,    60000),
      ('W-006', 'Zahid Iqbal',      'Forklift Operator', 84000, 31, 31, 0, 0, 2709.68,  84000, 0,    84000),
      ('W-007', 'Imran Shah',       'Helper',            54000, 31, 29, 2, 0, 1741.94,  50516, 3000, 47516),
      ('W-008', 'Kamran Yousuf',    'Security Guard',    66000, 31, 31, 0, 0, 2129.03,  66000, 0,    66000)
    ) AS v(code, worker_name, role_designation, base_salary, days_in_month, present_days, absent_days, leave_days, daily_rate, earned_salary, loan_deduction, net_salary)
    JOIN workers w ON w.worker_code = v.code
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 21. SYSTEM AUDIT LOGS
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_audit_logs') THEN
    INSERT INTO system_audit_logs (operator_name, node_id, action_type, details) VALUES
      ('System',       'NODE-01', 'SEED_DATA_LOADED',          '{"tables":"all","version":"20261005"}'::jsonb),
      ('Gate Keeper',  'NODE-01', 'GRN_CREATED',               '{"grn_code":"GRN-2026-001","supplier":"Chenab Chemical Works"}'::jsonb),
      ('Gate Keeper',  'NODE-01', 'GRN_CREATED',               '{"grn_code":"GRN-2026-002","supplier":"Chenab Chemical Works"}'::jsonb),
      ('QC Inspector', 'NODE-01', 'LOT_PASSED_QC',             '{"lot_number":"LOT-2026-001","status":"unrestricted"}'::jsonb),
      ('AP Accountant','NODE-01', 'PURCHASE_INVOICE_APPROVED', '{"invoice_number":"PINV-2026-003","amount":62000}'::jsonb),
      ('Sales Dept',   'NODE-01', 'INVOICE_POSTED',            '{"invoice_number":"INV-2026-001","amount":566400}'::jsonb),
      ('AR Accountant','NODE-01', 'CUSTOMER_RECEIPT_POSTED',   '{"voucher_no":"CRV-2026-001","amount":500000}'::jsonb),
      ('Production',   'NODE-01', 'BATCH_COMPLETED',           '{"order_no":"MO-2026-001","product":"Ceramic Wash Basin","qty":200}'::jsonb);
  END IF;
END $$;
