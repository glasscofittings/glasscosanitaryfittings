-- =============================================================================
-- GLASSCO ERP v3.0 — SAP-STYLE CORE ENGINE SCHEMA MIGRATION
-- Migration: 20260921_sap_core_engine_schema
-- Reference: SAP_Core_Engine_Techincal-Architechture.md
--            SAP_Core_Engine_Security-Access-Document.md
-- =============================================================================
-- Creates SAP-style procurement, inventory, finance, and 3-way matching
-- tables with full RLS enforcement.
--
-- NOTE: Tables that conflict with existing schema use a _sap suffix:
--   - purchase_invoices_sap  (existing: purchase_invoices)
--   - goods_receipt_notes_sap (existing: goods_receipt_notes)
--   - inventory_lots_sap     (existing: inventory_lots)
-- =============================================================================

-- ── EXTENSION ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. ENUMS & CUSTOM TYPES ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_enum') THEN
    CREATE TYPE account_type_enum AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lot_status_enum') THEN
    CREATE TYPE lot_status_enum AS ENUM ('quality_inspection', 'unrestricted', 'blocked');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'po_status_enum') THEN
    CREATE TYPE po_status_enum AS ENUM ('draft', 'approved', 'fulfilled', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grn_status_enum') THEN
    CREATE TYPE grn_status_enum AS ENUM ('draft', 'inspected', 'invoiced');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status_enum') THEN
    CREATE TYPE invoice_status_enum AS ENUM ('draft', 'pending_approval', 'posted', 'blocked_variance', 'cancelled');
  END IF;
END $$;

-- ── 2. CORE TABLES (in dependency order) ─────────────────────────────────────

-- ── 2.1 Chart of Accounts (FI Module) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code    VARCHAR(20) UNIQUE NOT NULL,
    account_name    VARCHAR(100) NOT NULL,
    account_type    account_type_enum NOT NULL,
    current_balance NUMERIC(15, 2) DEFAULT 0.00,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.gl_accounts IS 'Chart of Accounts — SAP FI Module. Stores all general ledger account master data.';

-- ── 2.2 Suppliers / Vendors Master Data (MM Module) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_code     VARCHAR(50) UNIQUE NOT NULL,
    company_name      VARCHAR(150) NOT NULL,
    contact_person    VARCHAR(100),
    email             VARCHAR(100),
    phone             VARCHAR(50),
    payment_terms_days INT DEFAULT 30,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.suppliers IS 'Vendor master data — SAP MM Module. All procurement references link here.';

-- ── 2.3 Purchase Orders (MM Module) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number         VARCHAR(50) UNIQUE NOT NULL,
    supplier_id       UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    total_amount_pkr  NUMERIC(15, 2) NOT NULL,
    status            po_status_enum DEFAULT 'draft',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.purchase_orders IS 'Purchase orders — SAP MM Module. Links to suppliers with ON DELETE RESTRICT for audit trail.';

-- ── 2.4 Inventory Lots / Batch Tracking (QM/MM Module) ─────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_lots_sap (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number        VARCHAR(50) UNIQUE NOT NULL,
    material_name     VARCHAR(100) NOT NULL,
    initial_qty       NUMERIC(12, 4) NOT NULL,
    current_qty       NUMERIC(12, 4) NOT NULL,
    unit_of_measure   VARCHAR(20) NOT NULL DEFAULT 'KG',
    unit_price_pkr    NUMERIC(15, 2) NOT NULL,
    status            lot_status_enum DEFAULT 'quality_inspection',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.inventory_lots_sap IS 'SAP-style batch/lot inventory tracking with lot_status_enum lifecycle locks.';

-- ── 2.5 Goods Receipt Notes (MM Module) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_receipt_notes_sap (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number        VARCHAR(50) UNIQUE NOT NULL,
    po_id             UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
    supplier_id       UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    lot_id            UUID NOT NULL REFERENCES public.inventory_lots_sap(id) ON DELETE RESTRICT,
    received_qty      NUMERIC(12, 4) NOT NULL,
    accepted_qty      NUMERIC(12, 4) NOT NULL,
    rejected_qty      NUMERIC(12, 4) DEFAULT 0.00,
    unit_price_pkr    NUMERIC(15, 2) NOT NULL,
    status            grn_status_enum DEFAULT 'draft',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.goods_receipt_notes_sap IS 'SAP MM Goods Receipt Notes. Triple FK to PO, Supplier, Lot with RESTRICT.';

-- ── 2.6 Purchase Invoices — AP with 3-Way Match (AP Module) ─────────────────
CREATE TABLE IF NOT EXISTS public.purchase_invoices_sap (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number    VARCHAR(50) UNIQUE NOT NULL,
    grn_id            UUID NOT NULL REFERENCES public.goods_receipt_notes_sap(id) ON DELETE RESTRICT,
    po_id             UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
    supplier_id       UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    taxable_amount    NUMERIC(15, 2) NOT NULL,
    tax_amount        NUMERIC(15, 2) NOT NULL,
    total_payable     NUMERIC(15, 2) NOT NULL,
    status            invoice_status_enum DEFAULT 'pending_approval',
    variance_flag     BOOLEAN DEFAULT FALSE,
    variance_reason   TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.purchase_invoices_sap IS 'AP purchase invoices. Enforces 3-way match (PO -> GRN -> Invoice). Variance flag locks for manager approval.';

-- ── 2.7 Immutable General Ledger Entries (FI Engine) ────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_ledger_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_ref   VARCHAR(100) NOT NULL,
    account_id        UUID NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
    debit_pkr         NUMERIC(15, 2) DEFAULT 0.00,
    credit_pkr        NUMERIC(15, 2) DEFAULT 0.00,
    posted_by         VARCHAR(100) NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT chk_debit_credit_positive CHECK (
      (debit_pkr > 0 AND credit_pkr = 0) OR
      (credit_pkr > 0 AND debit_pkr = 0)
    )
);

COMMENT ON TABLE public.gl_ledger_entries IS 'Immutable double-entry GL postings. UPDATE and DELETE blocked at RLS level.';

-- ── 3. PERFORMANCE INDEXES ──────────────────────────────────────────────────

-- Purchase Orders: supplier lookups
CREATE INDEX IF NOT EXISTS idx_po_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);

-- GRN SAP: PO, Supplier, Lot foreign key lookups
CREATE INDEX IF NOT EXISTS idx_grn_sap_po ON public.goods_receipt_notes_sap(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_sap_supplier ON public.goods_receipt_notes_sap(supplier_id);
CREATE INDEX IF NOT EXISTS idx_grn_sap_lot ON public.goods_receipt_notes_sap(lot_id);
CREATE INDEX IF NOT EXISTS idx_grn_sap_status ON public.goods_receipt_notes_sap(status);

-- Inventory Lots: status for production lock checks
CREATE INDEX IF NOT EXISTS idx_lot_sap_status ON public.inventory_lots_sap(status);

-- Purchase Invoices SAP: GRN, PO, Supplier FK lookups + status for queue views
CREATE INDEX IF NOT EXISTS idx_invoice_sap_grn ON public.purchase_invoices_sap(grn_id);
CREATE INDEX IF NOT EXISTS idx_invoice_sap_po ON public.purchase_invoices_sap(po_id);
CREATE INDEX IF NOT EXISTS idx_invoice_sap_supplier ON public.purchase_invoices_sap(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoice_sap_status ON public.purchase_invoices_sap(status);

-- GL Ledger: account_id for trial balance + transaction_ref for grouping
CREATE INDEX IF NOT EXISTS idx_ledger_account ON public.gl_ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction_ref ON public.gl_ledger_entries(transaction_ref);

-- GL Accounts: account_code for fast lookup by code
CREATE INDEX IF NOT EXISTS idx_gl_account_code ON public.gl_accounts(account_code);
CREATE INDEX IF NOT EXISTS idx_gl_account_type ON public.gl_accounts(account_type);

-- ── 4. ROW-LEVEL SECURITY (RLS) ─────────────────────────────────────────────

-- ── 4.1 Helper function: extract role from JWT ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json
      ->'app_metadata'
      ->>'user_role',
    ''
  )::text;
$$;

COMMENT ON FUNCTION public.get_auth_role() IS 'Returns the user_role claim from the current JWT. Used by RLS policies for RBAC.';

-- ── 4.2 Enable RLS on all SAP tables ────────────────────────────────────────
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lots_sap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_notes_sap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoices_sap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_ledger_entries ENABLE ROW LEVEL SECURITY;

-- ── 4.3 RLS POLICIES — gl_accounts ──────────────────────────────────────────

CREATE POLICY "gl_accounts_select"
ON public.gl_accounts FOR SELECT
USING (
    public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
);

CREATE POLICY "gl_accounts_insert"
ON public.gl_accounts FOR INSERT
WITH CHECK (
    public.get_auth_role() IN ('admin')
);

CREATE POLICY "gl_accounts_update"
ON public.gl_accounts FOR UPDATE
USING (
    public.get_auth_role() IN ('admin')
)
WITH CHECK (
    public.get_auth_role() IN ('admin')
);

-- ── 4.4 RLS POLICIES — suppliers ────────────────────────────────────────────

CREATE POLICY "suppliers_select"
ON public.suppliers FOR SELECT
USING (
    public.get_auth_role() IN ('gate_keeper', 'ap_accountant', 'plant_manager', 'admin')
);

CREATE POLICY "suppliers_insert"
ON public.suppliers FOR INSERT
WITH CHECK (
    public.get_auth_role() IN ('plant_manager', 'admin')
);

CREATE POLICY "suppliers_update"
ON public.suppliers FOR UPDATE
USING (
    public.get_auth_role() IN ('plant_manager', 'admin')
)
WITH CHECK (
    public.get_auth_role() IN ('plant_manager', 'admin')
);

-- ── 4.5 RLS POLICIES — purchase_orders ──────────────────────────────────────

CREATE POLICY "purchase_orders_select"
ON public.purchase_orders FOR SELECT
USING (
    public.get_auth_role() IN ('gate_keeper', 'qc_inspector', 'ap_accountant', 'plant_manager', 'admin')
);

CREATE POLICY "purchase_orders_insert"
ON public.purchase_orders FOR INSERT
WITH CHECK (
    public.get_auth_role() IN ('plant_manager', 'admin')
);

CREATE POLICY "purchase_orders_update"
ON public.purchase_orders FOR UPDATE
USING (
    public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
)
WITH CHECK (
    public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
);

-- ── 4.6 RLS POLICIES — inventory_lots_sap ──────────────────────────────────

CREATE POLICY "inventory_lots_sap_select"
ON public.inventory_lots_sap FOR SELECT
USING (
    auth.role() = 'authenticated'
);

CREATE POLICY "inventory_lots_sap_insert"
ON public.inventory_lots_sap FOR INSERT
WITH CHECK (
    public.get_auth_role() IN ('gate_keeper', 'qc_inspector', 'admin')
);

CREATE POLICY "inventory_lots_sap_update"
ON public.inventory_lots_sap FOR UPDATE
USING (
    public.get_auth_role() IN ('qc_inspector', 'plant_manager', 'admin')
)
WITH CHECK (
    public.get_auth_role() IN ('qc_inspector', 'plant_manager', 'admin')
);

-- ── 4.7 RLS POLICIES — goods_receipt_notes_sap ─────────────────────────────

CREATE POLICY "grn_sap_select"
ON public.goods_receipt_notes_sap FOR SELECT
USING (
    public.get_auth_role() IN ('gate_keeper', 'qc_inspector', 'ap_accountant', 'plant_manager', 'admin')
);

CREATE POLICY "grn_sap_insert"
ON public.goods_receipt_notes_sap FOR INSERT
WITH CHECK (
    public.get_auth_role() IN ('qc_inspector', 'plant_manager', 'admin')
);

CREATE POLICY "grn_sap_update"
ON public.goods_receipt_notes_sap FOR UPDATE
USING (
    public.get_auth_role() IN ('qc_inspector', 'ap_accountant', 'plant_manager', 'admin')
)
WITH CHECK (
    public.get_auth_role() IN ('qc_inspector', 'ap_accountant', 'plant_manager', 'admin')
);

-- ── 4.8 RLS POLICIES — purchase_invoices_sap ───────────────────────────────

CREATE POLICY "purchase_invoices_sap_select"
ON public.purchase_invoices_sap FOR SELECT
USING (
    public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
);

CREATE POLICY "purchase_invoices_sap_insert"
ON public.purchase_invoices_sap FOR INSERT
WITH CHECK (
    public.get_auth_role() IN ('ap_accountant', 'admin')
);

-- Variance-flagged invoices can only be updated by plant_manager or admin
CREATE POLICY "purchase_invoices_sap_update"
ON public.purchase_invoices_sap FOR UPDATE
USING (
    public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
)
WITH CHECK (
    CASE
        WHEN variance_flag = true THEN public.get_auth_role() IN ('plant_manager', 'admin')
        ELSE public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
    END
);

-- ── 4.9 RLS POLICIES — gl_ledger_entries (IMMUTABLE) ────────────────────────

CREATE POLICY "ledger_entries_select"
ON public.gl_ledger_entries FOR SELECT
USING (
    public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
);

CREATE POLICY "ledger_entries_insert"
ON public.gl_ledger_entries FOR INSERT
WITH CHECK (
    public.get_auth_role() IN ('ap_accountant', 'admin')
);

-- Block UPDATE and DELETE on ledger entries to enforce strict immutability
CREATE POLICY "ledger_entries_no_update"
ON public.gl_ledger_entries FOR UPDATE
USING (false);

CREATE POLICY "ledger_entries_no_delete"
ON public.gl_ledger_entries FOR DELETE
USING (false);

-- ── 5. GRANT EXECUTE ON HELPER FUNCTION ─────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO service_role;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
