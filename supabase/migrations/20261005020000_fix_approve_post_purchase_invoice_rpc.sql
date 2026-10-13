-- Migration: 20261005020000_fix_approve_post_purchase_invoice_rpc.sql
-- Run in Supabase SQL Editor to create missing tables and RPC functions.
-- All statements are idempotent (CREATE IF NOT EXISTS / CREATE OR REPLACE).

-- ============================================================
-- 1. SEQUENCES
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS grn_number_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS purchase_invoice_seq START 1 INCREMENT 1;
-- T2: shared sequential journal entry numbering (idempotent)
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

-- ============================================================
-- 2. goods_receipt_notes
-- ============================================================
CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number TEXT NOT NULL UNIQUE,
    gate_pass_id UUID REFERENCES inward_gate_passes(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    vendor_name TEXT NOT NULL DEFAULT '',
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending_invoice'
        CHECK (status IN ('pending_invoice', 'invoiced')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grn_grn_number   ON goods_receipt_notes(grn_number);
CREATE INDEX IF NOT EXISTS idx_grn_gate_pass_id ON goods_receipt_notes(gate_pass_id);
CREATE INDEX IF NOT EXISTS idx_grn_vendor_id    ON goods_receipt_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_grn_status       ON goods_receipt_notes(status);

-- ============================================================
-- 3. purchase_invoices
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT NOT NULL UNIQUE,
    grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,
    grn_number TEXT NOT NULL DEFAULT '',
    vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    vendor_name TEXT NOT NULL DEFAULT '',
    taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (taxable_amount >= 0),
    tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_payable NUMERIC(15,2) NOT NULL DEFAULT 0.00 CHECK (total_payable >= 0),
    status TEXT NOT NULL DEFAULT 'pending_approval'
        CHECK (status IN ('pending_approval', 'posted', 'cancelled')),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pinv_invoice_number ON purchase_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_pinv_grn_id         ON purchase_invoices(grn_id);
CREATE INDEX IF NOT EXISTS idx_pinv_vendor_id      ON purchase_invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pinv_status         ON purchase_invoices(status);

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "erp_full_access" ON goods_receipt_notes;
CREATE POLICY "erp_full_access" ON goods_receipt_notes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "erp_full_access" ON purchase_invoices;
CREATE POLICY "erp_full_access" ON purchase_invoices FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 5. RPC: generate_grn_from_igp
-- ============================================================
CREATE OR REPLACE FUNCTION generate_grn_from_igp(
    p_igp_id UUID,
    p_unit_price NUMERIC DEFAULT 0,
    p_operator_name TEXT DEFAULT 'Gate Operator',
    p_device_node TEXT DEFAULT 'PC-01'
) RETURNS JSONB AS $$
DECLARE
    v_igp inward_gate_passes%ROWTYPE;
    v_vendor parties%ROWTYPE;
    v_grn_id UUID;
    v_grn_number TEXT;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_qty NUMERIC(15, 4);
    v_taxable NUMERIC(15, 2);
    v_total NUMERIC(15, 2);
    v_items JSONB;
BEGIN
    SELECT * INTO v_igp FROM inward_gate_passes WHERE id = p_igp_id FOR UPDATE;
    IF v_igp.id IS NULL THEN
        RAISE EXCEPTION 'Inward Gate Pass not found: %', p_igp_id;
    END IF;

    IF v_igp.supplier_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT * INTO v_vendor FROM parties WHERE id = v_igp.supplier_id::uuid;
    END IF;

    v_qty     := COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg, 1);
    v_taxable := ROUND(v_qty * COALESCE(p_unit_price, 0), 2);
    v_total   := v_taxable;

    v_grn_number     := 'GRN-'  || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_number_seq')::text, 5, '0');
    v_invoice_number := 'PINV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('purchase_invoice_seq')::text, 5, '0');

    v_items := jsonb_build_array(jsonb_build_object(
        'description',    v_igp.material_description,
        'lot_code',       COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, ''),
        'quantity',       v_qty,
        'unit_of_measure', COALESCE(v_igp.unit_of_measure, 'KG'),
        'unit_price',     COALESCE(p_unit_price, 0),
        'total_amount',   v_total
    ));

    INSERT INTO goods_receipt_notes (grn_number, gate_pass_id, vendor_id, vendor_name, received_date, items, status)
    VALUES (v_grn_number, v_igp.id, v_vendor.id, COALESCE(v_vendor.name, v_igp.supplier_id), CURRENT_DATE, v_items, 'pending_invoice')
    RETURNING id INTO v_grn_id;

    INSERT INTO purchase_invoices (invoice_number, grn_id, grn_number, vendor_id, vendor_name, taxable_amount, tax_amount, total_payable, status, items)
    VALUES (v_invoice_number, v_grn_id, v_grn_number, v_vendor.id, COALESCE(v_vendor.name, v_igp.supplier_id), v_taxable, 0.00, v_total, 'pending_approval', v_items)
    RETURNING id INTO v_invoice_id;

    UPDATE inward_gate_passes SET status = 'CONVERTED_TO_GRN' WHERE id = v_igp.id;

    INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
    VALUES (p_device_node, p_operator_name, 'GRN_GENERATED_FROM_IGP',
        jsonb_build_object('igp_id', v_igp.id, 'grn_id', v_grn_id, 'grn_number', v_grn_number,
                           'purchase_invoice_id', v_invoice_id, 'invoice_number', v_invoice_number));

    RETURN jsonb_build_object('success', true, 'grn_id', v_grn_id, 'grn_number', v_grn_number,
                               'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. RPC: approve_and_post_purchase_invoice  ← THE MISSING ONE
-- DEBIT  1101 (Inventory / Raw Chemicals Asset)
-- CREDIT 2001 (Accounts Payable) with party_id = vendor_id
-- ============================================================
CREATE OR REPLACE FUNCTION approve_and_post_purchase_invoice(
    p_invoice_id UUID,
    p_operator_name TEXT DEFAULT 'Accounts Dept',
    p_device_node TEXT DEFAULT 'PC-01'
) RETURNS JSONB AS $$
DECLARE
    v_inv purchase_invoices%ROWTYPE;
    v_ap_account_id UUID;
    v_raw_account_id UUID;
    v_entry_id UUID;
    v_entry_number TEXT;
BEGIN
    -- 1. Lock invoice row
    SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF v_inv.id IS NULL THEN
        RAISE EXCEPTION 'Purchase invoice not found: %', p_invoice_id;
    END IF;

    IF v_inv.status != 'pending_approval' THEN
        RAISE EXCEPTION 'Invoice is not in pending_approval status (current: %)', v_inv.status;
    END IF;

    -- 2. Resolve chart-of-accounts IDs
    SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
    IF v_ap_account_id IS NULL THEN
        SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_type = 'LIABILITY' LIMIT 1;
    END IF;

    SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '1101' LIMIT 1;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '5001' LIMIT 1;
    END IF;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart
        WHERE account_type IN ('EXPENSE', 'ASSET') LIMIT 1;
    END IF;

    IF v_ap_account_id IS NULL OR v_raw_account_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve AP (2001) or Inventory (1101) accounts in accounts_chart';
    END IF;

    -- 3. Create balanced journal entry (T2: shared sequence, no random)
    v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
        lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

    INSERT INTO journal_entries (entry_number, entry_date, narration, customer_name, is_balanced, status)
    VALUES (
        v_entry_number,
        CURRENT_DATE,
        'Vendor Purchase Invoice Posted [' || v_inv.invoice_number || ' - ' || v_inv.grn_number || ']',
        v_inv.vendor_name,
        true,
        'POSTED'
    ) RETURNING id INTO v_entry_id;

    -- DEBIT: Raw Material / Inventory
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_raw_account_id, v_inv.vendor_id, v_inv.total_payable, 0.00);

    -- CREDIT: Accounts Payable (vendor as counter-party)
    INSERT INTO journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_entry_id, v_ap_account_id, v_inv.vendor_id, 0.00, v_inv.total_payable);

    -- 4. Update invoice status
    UPDATE purchase_invoices SET status = 'posted' WHERE id = v_inv.id;

    -- 5. Update GRN status
    IF v_inv.grn_id IS NOT NULL THEN
        UPDATE goods_receipt_notes SET status = 'invoiced' WHERE id = v_inv.grn_id;
    END IF;

    -- 6. Audit log
    INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
    VALUES (p_device_node, p_operator_name, 'PURCHASE_INVOICE_APPROVED_POSTED',
        jsonb_build_object(
            'purchase_invoice_id', v_inv.id,
            'invoice_number',      v_inv.invoice_number,
            'total_payable',       v_inv.total_payable,
            'journal_entry_id',    v_entry_id,
            'entry_number',        v_entry_number
        ));

    RETURN jsonb_build_object(
        'success',          true,
        'invoice_id',       v_inv.id,
        'journal_entry_id', v_entry_id,
        'entry_number',     v_entry_number
    );
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Journal entry number conflict, please retry: %', v_entry_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. GRANTS
-- ============================================================
GRANT EXECUTE ON FUNCTION generate_grn_from_igp(UUID, NUMERIC, TEXT, TEXT)
    TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION approve_and_post_purchase_invoice(UUID, TEXT, TEXT)
    TO authenticated, service_role;
