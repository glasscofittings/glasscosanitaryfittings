-- ============================================================
-- Migration 004: Payroll & Stock Transfers Tables
-- Run this in Supabase SQL Editor > New Query > Run
-- ============================================================

-- -- Payroll Runs --------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_no           TEXT UNIQUE NOT NULL,
  month                INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year                 INT NOT NULL,
  total_workers        INT NOT NULL DEFAULT 0,
  gross_salaries       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_deductions     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_loan_repayments NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_payable          NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT','POSTED','PAID')),
  journal_entry_id     UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -- Payroll Slips (individual per-worker payslips) ----------
CREATE TABLE IF NOT EXISTS payroll_slips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id   UUID REFERENCES payroll_runs(id) ON DELETE CASCADE,
  worker_id        UUID NOT NULL,
  worker_name      TEXT NOT NULL,
  role_designation TEXT,
  base_salary      NUMERIC(14, 2) NOT NULL,
  days_in_month    INT NOT NULL,
  present_days     INT NOT NULL DEFAULT 0,
  absent_days      INT NOT NULL DEFAULT 0,
  leave_days       INT NOT NULL DEFAULT 0,
  daily_rate       NUMERIC(14, 4) NOT NULL,
  earned_salary    NUMERIC(14, 2) NOT NULL,
  loan_deduction   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_salary       NUMERIC(14, 2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -- Stock Transfers ------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no              TEXT UNIQUE NOT NULL,
  source_warehouse_code    TEXT NOT NULL,
  target_warehouse_code    TEXT NOT NULL,
  transfer_date            DATE NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('DISPATCHED','RECEIVED','CANCELLED')),
  dispatched_by            TEXT NOT NULL,
  received_by              TEXT,
  remarks                  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -- Stock Transfer Line Items --------------------------------
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id    UUID REFERENCES stock_transfers(id) ON DELETE CASCADE,
  source_lot_id  UUID NOT NULL,
  lot_number     TEXT NOT NULL,
  product_id     UUID NOT NULL,
  product_name   TEXT NOT NULL,
  transfer_qty   NUMERIC(14, 4) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -- Indexes --------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payroll_slips_run   ON payroll_slips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_slips_worker ON payroll_slips(worker_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_date  ON stock_transfers(transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_sti_transfer_id       ON stock_transfer_items(transfer_id);

-- Enable RLS (no policy = authenticated users have access in service role context)
ALTER TABLE payroll_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_slips    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;
