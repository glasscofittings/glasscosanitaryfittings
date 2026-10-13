-- Migration: 20261005010000_grn_and_purchase_invoices.sql
-- Description: Implement goods_receipt_notes and purchase_invoices with 1-click GRN & conditional AP ledger sync

-- 1. Sequences
CREATE SEQUENCE IF NOT EXISTS grn_number_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS purchase_invoice_seq START 1 INCREMENT 1;
-- T2: shared sequential journal entry numbering (idempotent)
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1 INCREMENT 1;

-- 2. goods_receipt_notes Table
CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number TEXT NOT NULL UNIQUE,
    gate_pass_id UUID REFERENCES inward_gate_passes(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    vendor_name TEXT NOT NULL DEFAULT '',
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending_invoice' CHECK (status IN ('pending_invoice', 'invoiced')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_grn_number ON goods_receipt_notes(grn_number);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_gate_pass_id ON goods_receipt_notes(gate_pass_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_vendor_id ON goods_receipt_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_status ON goods_receipt_notes(status);

-- 3. purchase_invoices Table
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT NOT NULL UNIQUE,
    grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,
    grn_number TEXT NOT NULL DEFAULT '',
    vendor_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    vendor_name TEXT NOT NULL DEFAULT '',
    taxable_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (taxable_amount >= 0),
    tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_payable NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_payable >= 0),
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'posted', 'cancelled')),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_invoice_number ON purchase_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_grn_id ON purchase_invoices(grn_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_vendor_id ON purchase_invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(status);

-- 4. RLS Policies
ALTER TABLE goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "erp_full_access" ON goods_receipt_notes;
CREATE POLICY "erp_full_access" ON goods_receipt_notes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "erp_full_access" ON purchase_invoices;
CREATE POLICY "erp_full_access" ON purchase_invoices FOR ALL USING (true) WITH CHECK (true);

-- 5. RPC: generate_grn_from_igp
-- Generates GRN and auto-drafts corresponding record into purchase_invoices with status 'pending_approval'.
-- NOTE: Absolutely NO ledger entries are recorded at this stage!
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
    -- Select IGP
    SELECT * INTO v_igp FROM inward_gate_passes WHERE id = p_igp_id FOR UPDATE;
    IF v_igp.id IS NULL THEN
        RAISE EXCEPTION 'Inward Gate Pass not found: %', p_igp_id;
    END IF;

    -- Lookup vendor
    IF v_igp.supplier_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT * INTO v_vendor FROM parties WHERE id = v_igp.supplier_id::uuid;
    END IF;

    v_qty := COALESCE(v_igp.inward_qty, v_igp.gross_weight_kg, 1);
    v_taxable := ROUND(v_qty * COALESCE(p_unit_price, 0), 2);
    v_total := v_taxable;

    -- Generate sequence numbers
    v_grn_number := 'GRN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('grn_number_seq')::text, 5, '0');
    v_invoice_number := 'PINV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('purchase_invoice_seq')::text, 5, '0');

    v_items := jsonb_build_array(
        jsonb_build_object(
            'description', v_igp.material_description,
            'lot_code', COALESCE(v_igp.vendor_lot_code, v_igp.vendor_lot_number, ''),
            'quantity', v_qty,
            'unit_of_measure', COALESCE(v_igp.unit_of_measure, 'KG'),
            'unit_price', COALESCE(p_unit_price, 0),
            'total_amount', v_total
        )
    );

    -- 1. Insert GRN
    INSERT INTO goods_receipt_notes (
        grn_number,
        gate_pass_id,
        vendor_id,
        vendor_name,
        received_date,
        items,
        status
    ) VALUES (
        v_grn_number,
        v_igp.id,
        v_vendor.id,
        COALESCE(v_vendor.name, v_igp.supplier_id),
        CURRENT_DATE,
        v_items,
        'pending_invoice'
    ) RETURNING id INTO v_grn_id;

    -- 2. Auto-draft corresponding record into purchase_invoices
    INSERT INTO purchase_invoices (
        invoice_number,
        grn_id,
        grn_number,
        vendor_id,
        vendor_name,
        taxable_amount,
        tax_amount,
        total_payable,
        status,
        items
    ) VALUES (
        v_invoice_number,
        v_grn_id,
        v_grn_number,
        v_vendor.id,
        COALESCE(v_vendor.name, v_igp.supplier_id),
        v_taxable,
        0.00,
        v_total,
        'pending_approval',
        v_items
    ) RETURNING id INTO v_invoice_id;

    -- 3. Update IGP status
    UPDATE inward_gate_passes
    SET status = 'CONVERTED_TO_GRN'
    WHERE id = v_igp.id;

    -- 4. Audit Log
    INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
    VALUES (
        p_device_node,
        p_operator_name,
        'GRN_GENERATED_FROM_IGP',
        jsonb_build_object(
            'igp_id', v_igp.id,
            'grn_id', v_grn_id,
            'grn_number', v_grn_number,
            'purchase_invoice_id', v_invoice_id,
            'invoice_number', v_invoice_number
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'grn_id', v_grn_id,
        'grn_number', v_grn_number,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number
    );
END;
$$ LANGUAGE plpgsql;

-- 6. RPC: approve_and_post_purchase_invoice
-- Transitions status to 'posted', updates GRN to 'invoiced', and posts double-entry transaction:
-- DEBIT: Inventory / Raw Material (account_code '1101' or '5001')
-- CREDIT: Vendor Payable / Accounts Payable (account_code '2001') with party_id = vendor_id
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
    -- 1. Lock invoice
    SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF v_inv.id IS NULL THEN
        RAISE EXCEPTION 'Purchase invoice not found: %', p_invoice_id;
    END IF;

    IF v_inv.status != 'pending_approval' THEN
        RAISE EXCEPTION 'Invoice is not in pending_approval status (current status: %)', v_inv.status;
    END IF;

    -- 2. Resolve Accounts Chart IDs
    -- Credit: 2001 (Accounts Payable)
    SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_code = '2001' LIMIT 1;
    IF v_ap_account_id IS NULL THEN
        SELECT id INTO v_ap_account_id FROM accounts_chart WHERE account_type = 'LIABILITY' LIMIT 1;
    END IF;

    -- Debit: 1101 (WH-01 Raw Chemicals Asset) or 5001 (Raw Material Consumption Expense)
    SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '1101' LIMIT 1;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_code = '5001' LIMIT 1;
    END IF;
    IF v_raw_account_id IS NULL THEN
        SELECT id INTO v_raw_account_id FROM accounts_chart WHERE account_type = 'EXPENSE' OR account_type = 'ASSET' LIMIT 1;
    END IF;

    -- 3. Post Double-Entry Journal Entry (T2: shared sequence, no random)
    v_entry_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
        lpad(nextval('journal_entry_seq')::TEXT, 5, '0');

    INSERT INTO journal_entries (
        entry_number,
        entry_date,
        narration,
        customer_name,
        is_balanced,
        status
    ) VALUES (
        v_entry_number,
        CURRENT_DATE,
        'Vendor Purchase Invoice Posted [' || v_inv.invoice_number || ' - ' || v_inv.grn_number || ']',
        v_inv.vendor_name,
        true,
        'POSTED'
    ) RETURNING id INTO v_entry_id;

    -- Line 1: DEBIT Raw Material Asset / Inventory
    INSERT INTO journal_lines (
        journal_entry_id,
        account_id,
        party_id,
        debit_pkr,
        credit_pkr
    ) VALUES (
        v_entry_id,
        v_raw_account_id,
        v_inv.vendor_id,
        v_inv.total_payable,
        0.00
    );

    -- Line 2: CREDIT Vendor Payable Account with party_id
    INSERT INTO journal_lines (
        journal_entry_id,
        account_id,
        party_id,
        debit_pkr,
        credit_pkr
    ) VALUES (
        v_entry_id,
        v_ap_account_id,
        v_inv.vendor_id,
        0.00,
        v_inv.total_payable
    );

    -- 4. Mark purchase invoice posted
    UPDATE purchase_invoices
    SET status = 'posted'
    WHERE id = v_inv.id;

    -- 5. Mark goods receipt note invoiced
    IF v_inv.grn_id IS NOT NULL THEN
        UPDATE goods_receipt_notes
        SET status = 'invoiced'
        WHERE id = v_inv.grn_id;
    END IF;

    -- 6. Audit log
    INSERT INTO system_audit_logs (device_node, operator_name, action_type, details)
    VALUES (
        p_device_node,
        p_operator_name,
        'PURCHASE_INVOICE_APPROVED_POSTED',
        jsonb_build_object(
            'purchase_invoice_id', v_inv.id,
            'invoice_number', v_inv.invoice_number,
            'total_payable', v_inv.total_payable,
            'journal_entry_id', v_entry_id,
            'entry_number', v_entry_number
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_inv.id,
        'journal_entry_id', v_entry_id,
        'entry_number', v_entry_number
    );
END;
$$ LANGUAGE plpgsql;
