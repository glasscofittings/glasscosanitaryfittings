-- ============================================================
-- MIGRATION 006: Seed Fix + New Module Dummy Data
-- Run in Supabase SQL Editor AFTER migrations 030000 and 040000
-- ============================================================

-- -- FIX WORKERS (correct column names) ----------------------
-- Use ON CONFLICT (worker_code) so this is idempotent regardless of
-- which UUID was assigned by an earlier migration (e.g. 99_seed_demo_data).
INSERT INTO workers (id, full_name, role_designation, base_salary_pkr, joining_date, is_active, designation, daily_rate_pkr, status, worker_code)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Muhammad Ali',     'Machine Operator',  75000, '2024-01-10', true, 'Machine Operator',  2500, 'ACTIVE', 'W-001'),
  ('10000000-0000-0000-0000-000000000002', 'Ahmed Hassan',     'Quality Inspector', 90000, '2024-02-15', true, 'Quality Inspector', 3000, 'ACTIVE', 'W-002'),
  ('10000000-0000-0000-0000-000000000003', 'Bilal Ahmad',      'Warehouse Worker',  60000, '2024-03-01', true, 'Warehouse Worker',  2000, 'ACTIVE', 'W-003'),
  ('10000000-0000-0000-0000-000000000004', 'Tariq Mehmood',    'Production Lead',  105000, '2023-11-20', true, 'Production Lead',   3500, 'ACTIVE', 'W-004'),
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

-- -- WORKER ATTENDANCE (September 2026) ----------------------
-- 22 working days in Sept 2026. Insert attendance for all 8 workers.
-- Resolve worker_id by worker_code to avoid FK errors from UUID mismatches.
INSERT INTO worker_attendance (worker_id, attendance_date, status)
SELECT w.id, d.dt::date, 'P'
FROM (VALUES ('W-001'),('W-002'),('W-003'),('W-004'),('W-005'),('W-006'),('W-007'),('W-008')) AS wc(code)
JOIN workers w ON w.worker_code = wc.code
CROSS JOIN (
  SELECT generate_series('2026-09-01'::date, '2026-09-22'::date, '1 day'::interval) AS dt
) d
WHERE EXTRACT(DOW FROM d.dt) NOT IN (0)  -- exclude Sundays
ON CONFLICT (worker_id, attendance_date) DO NOTHING;

-- Mark 2 absences per worker to show deductions
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

-- -- WORKER LOANS ---------------------------------------------
INSERT INTO worker_loans (id, worker_id, original_loan_amount, current_balance, monthly_deduction_rate)
SELECT v.id::uuid, w.id, v.orig, v.bal, v.rate
FROM (VALUES
  ('0c000000-0000-0000-0000-000000000001', 'W-003', 30000, 20000, 5000),
  ('0c000000-0000-0000-0000-000000000002', 'W-007', 15000, 10000, 3000)
) AS v(id, code, orig, bal, rate)
JOIN workers w ON w.worker_code = v.code
ON CONFLICT (id) DO NOTHING;

-- -- PAYROLL RUNS (pre-seeded for August 2026) -----------------
INSERT INTO payroll_runs (id, payroll_no, month, year, total_workers, gross_salaries, total_deductions, total_loan_repayments, net_payable, status)
VALUES
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

-- -- STOCK TRANSFERS (pre-seeded) -----------------------------
INSERT INTO stock_transfers (id, transfer_no, source_warehouse_code, target_warehouse_code, transfer_date, status, dispatched_by, remarks)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'STO-2026-001', 'WH-01', 'WH-02', '2026-09-18', 'RECEIVED',   'Zahid Iqbal', 'Monthly FG restock from raw material store'),
  ('40000000-0000-0000-0000-000000000002', 'STO-2026-002', 'WH-02', 'WH-03', '2026-09-20', 'RECEIVED',   'Bilal Ahmad', 'Dispatch to distribution point'),
  ('40000000-0000-0000-0000-000000000003', 'STO-2026-003', 'WH-01', 'WH-02', '2026-09-21', 'DISPATCHED', 'Zahid Iqbal', 'Emergency reorder for production line')
ON CONFLICT (transfer_no) DO NOTHING;

-- -- CUSTOMER RECEIPT VOUCHERS (additional) -------------------
INSERT INTO customer_receipt_vouchers (id, voucher_no, customer_id, customer_name, receipt_date, amount, payment_mode, reference_no, remarks, status)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'CRV-2026-003', 'b0000000-0000-0000-0000-000000000003', 'Faisalabad Fixtures',    '2026-09-19', 259600, 'BANK_TRANSFER', 'MCB-TXN-77301', 'Full payment for INV-003', 'POSTED'),
  ('20000000-0000-0000-0000-000000000002', 'CRV-2026-004', 'b0000000-0000-0000-0000-000000000004', 'Peshawar Plumbing Co',   '2026-09-21', 100000, 'CHEQUE',        'CHEQ-003921',   'Partial payment',         'POSTED'),
  ('20000000-0000-0000-0000-000000000003', 'CRV-2026-005', 'b0000000-0000-0000-0000-000000000005', 'Islamabad Hardware Store','2026-09-22', 177000, 'CASH',          NULL,            'Cash payment collected',  'POSTED')
ON CONFLICT (id) DO NOTHING;

-- -- PRODUCTION ORDERS (additional planned/in-progress) -------
INSERT INTO production_orders (id, order_no, bom_id, target_product_id, target_product_name, target_qty, actual_qty, scrap_qty, unit_of_measure, status, start_date, total_material_cost, unit_cost_pkr, operator_name)
VALUES
  ('50000000-0000-0000-0000-000000000001', 'MO-2026-004', '0f000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Ceramic Wash Basin', 500, 0, 0, 'NOS', 'PLANNED', '2026-09-22', 0, 0, 'Tariq Mehmood'),
  ('50000000-0000-0000-0000-000000000002', 'MO-2026-005', '0f000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Health Faucet Set',  300, 0, 0, 'NOS', 'PLANNED', '2026-09-23', 0, 0, 'Tariq Mehmood')
ON CONFLICT (id) DO NOTHING;

-- -- DONE -----------------------------------------------------
-- Workers, attendance, payroll, stock transfers, receipts ready.
