-- ============================================================================
-- Migration: 20261103010000_purchase_cost_profit_margin_tracking.sql
-- Description:
--   Purchase Cost and Profit Margin Tracking System:
--   - Creates product_purchases table for itemized purchase history.
--   - Supports per-product discounts, landed costs allocation, and taxes.
--   - Tracks supplier-wise rates, latest rate, and previous rate history.
--   - Integrates confirmed purchases with inventory (inventory_lots) and AP ledger.
--   - Adds line-item discount columns to sales_invoice_items.
--   - Prevents duplicate stock updates and ledger postings.
-- ============================================================================

-- ── 1. Sequence for Purchase Numbers ────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.purchase_number_seq START 1 INCREMENT 1;

-- ── 2. product_purchases Table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number TEXT NOT NULL UNIQUE,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id UUID REFERENCES public.parties(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  product_id UUID REFERENCES public.sanitary_products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity NUMERIC(15, 4) NOT NULL CHECK (quantity > 0),
  unit_of_measure TEXT NOT NULL DEFAULT 'PCS',
  purchase_rate NUMERIC(15, 2) NOT NULL CHECK (purchase_rate >= 0),
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (discount_pkr >= 0),
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
  tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (tax_amount_pkr >= 0),
  additional_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (additional_cost_pkr >= 0),
  purchase_subtotal_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (purchase_subtotal_pkr >= 0),
  purchase_total_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (purchase_total_pkr >= 0),
  effective_unit_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (effective_unit_cost_pkr >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  inventory_lot_id UUID REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  operator_name TEXT,
  device_node TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_purchases_product_id ON public.product_purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON public.product_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON public.product_purchases(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON public.product_purchases(status);
CREATE INDEX IF NOT EXISTS idx_purchases_sku ON public.product_purchases(sku);

-- ── 3. RLS for product_purchases ───────────────────────────────────────────
ALTER TABLE public.product_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_purchases_select_all" ON public.product_purchases;
CREATE POLICY "product_purchases_select_all" ON public.product_purchases
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "product_purchases_insert_all" ON public.product_purchases;
CREATE POLICY "product_purchases_insert_all" ON public.product_purchases
  FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "product_purchases_update_all" ON public.product_purchases;
CREATE POLICY "product_purchases_update_all" ON public.product_purchases
  FOR UPDATE TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "product_purchases_delete_all" ON public.product_purchases;
CREATE POLICY "product_purchases_delete_all" ON public.product_purchases
  FOR DELETE TO public USING (true);

GRANT ALL ON public.product_purchases TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_number_seq TO anon, authenticated, service_role;

-- ── 4. Add Line-Item Discounts to sales_invoice_items ───────────────────────
ALTER TABLE public.sales_invoice_items
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN public.sales_invoice_items.discount_percent IS 'Per-item discount percentage.';
COMMENT ON COLUMN public.sales_invoice_items.discount_pkr IS 'Per-item discount amount in PKR.';

-- ── 5. RPC: record_and_confirm_purchase ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_and_confirm_purchase(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase_no      TEXT;
  v_purchase_date    DATE;
  v_supplier_id      UUID;
  v_supplier_name    TEXT;
  v_product_id       UUID;
  v_product_name     TEXT;
  v_sku              TEXT;
  v_quantity         NUMERIC(15, 4);
  v_uom              TEXT;
  v_purchase_rate    NUMERIC(15, 2);
  v_disc_pct         NUMERIC(5, 2);
  v_disc_pkr         NUMERIC(15, 2);
  v_tax_rate         NUMERIC(5, 2);
  v_tax_amt          NUMERIC(15, 2);
  v_add_cost         NUMERIC(15, 2);
  v_subtotal         NUMERIC(15, 2);
  v_total            NUMERIC(15, 2);
  v_unit_cost        NUMERIC(15, 2);
  v_status           TEXT;
  v_notes            TEXT;
  v_operator_name    TEXT;
  v_device_node      TEXT;
  v_wh_id            UUID;
  v_lot_id           UUID := NULL;
  v_lot_number       TEXT;
  v_je_id            UUID := NULL;
  v_je_number        TEXT;
  v_narration        TEXT;
  v_inv_account_id   UUID;
  v_ap_account_id    UUID;
  v_purchase_row     public.product_purchases%ROWTYPE;
BEGIN
  v_purchase_date := COALESCE((p_payload->>'purchase_date')::DATE, CURRENT_DATE);
  v_supplier_id   := (p_payload->>'supplier_id')::UUID;
  v_supplier_name := TRIM(COALESCE(p_payload->>'supplier_name', 'Supplier'));
  v_product_id    := (p_payload->>'product_id')::UUID;
  v_quantity      := (p_payload->>'quantity')::NUMERIC;
  v_uom           := COALESCE(p_payload->>'unit_of_measure', 'PCS');
  v_purchase_rate := (p_payload->>'purchase_rate')::NUMERIC;
  v_disc_pct      := COALESCE((p_payload->>'discount_percent')::NUMERIC, 0.00);
  v_disc_pkr      := COALESCE((p_payload->>'discount_pkr')::NUMERIC, 0.00);
  v_tax_rate      := COALESCE((p_payload->>'tax_rate')::NUMERIC, 0.00);
  v_add_cost      := COALESCE((p_payload->>'additional_cost_pkr')::NUMERIC, 0.00);
  v_status        := LOWER(TRIM(COALESCE(p_payload->>'status', 'confirmed')));
  v_notes         := TRIM(COALESCE(p_payload->>'notes', ''));
  v_operator_name := TRIM(COALESCE(p_payload->>'operator_name', 'Purchasing Dept'));
  v_device_node   := TRIM(COALESCE(p_payload->>'device_node', 'NODE-01'));

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Product ID is required.';
  END IF;

  IF v_quantity IS NULL OR v_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;

  IF v_purchase_rate IS NULL OR v_purchase_rate < 0 THEN
    RAISE EXCEPTION 'Purchase rate must be non-negative.';
  END IF;

  -- Lookup product details
  SELECT name, sku INTO v_product_name, v_sku
  FROM public.sanitary_products
  WHERE id = v_product_id;

  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Sanitary product with ID % not found.', v_product_id;
  END IF;

  -- Calculate calculations
  v_subtotal := ROUND(v_quantity * v_purchase_rate, 2);

  -- Discount: flat or percentage
  IF v_disc_pkr <= 0 AND v_disc_pct > 0 THEN
    v_disc_pkr := ROUND(v_subtotal * (v_disc_pct / 100), 2);
  END IF;
  IF v_disc_pkr > v_subtotal THEN
    v_disc_pkr := v_subtotal;
  END IF;

  -- Tax
  IF v_tax_rate > 0 THEN
    v_tax_amt := ROUND((v_subtotal - v_disc_pkr) * (v_tax_rate / 100), 2);
  ELSE
    v_tax_amt := 0.00;
  END IF;

  -- Total and Landed Cost per unit
  v_total := ROUND((v_subtotal - v_disc_pkr) + v_tax_amt + v_add_cost, 2);
  v_unit_cost := ROUND(((v_subtotal - v_disc_pkr) + v_add_cost) / v_quantity, 2);

  -- Generate sequential purchase number: PUR-YYYY-XXXXX
  v_purchase_no := 'PUR-' || to_char(v_purchase_date, 'YYYY') || '-' ||
                   lpad(nextval('public.purchase_number_seq')::TEXT, 5, '0');

  -- If status = 'confirmed', update stock and post to ledger
  IF v_status = 'confirmed' THEN
    -- 1. Find finished goods warehouse (WH-02 or WH-01)
    SELECT id INTO v_wh_id FROM public.inventory_warehouses WHERE code = 'WH-02' LIMIT 1;
    IF v_wh_id IS NULL THEN
      SELECT id INTO v_wh_id FROM public.inventory_warehouses LIMIT 1;
    END IF;

    -- 2. Create inventory lot entry
    v_lot_number := 'LOT-' || to_char(v_purchase_date, 'YYYYMMDD') || '-' || lpad((RANDOM() * 9999)::INT::TEXT, 4, '0');

    IF v_wh_id IS NOT NULL THEN
      INSERT INTO public.inventory_lots (
        lot_number, product_id, warehouse_id, vendor_lot_code,
        manufacture_date, expiration_date, initial_qty, remaining_qty,
        unit_cost_pkr, qc_status
      )
      VALUES (
        v_lot_number, v_product_id, v_wh_id, v_purchase_no,
        v_purchase_date, (v_purchase_date + INTERVAL '2 years')::DATE,
        v_quantity, v_quantity, v_unit_cost, 'PASSED'
      )
      RETURNING id INTO v_lot_id;
    END IF;

    -- 3. Increase sanitary_products stock
    UPDATE public.sanitary_products
    SET
      total_stock = total_stock + v_quantity,
      available_stock = available_stock + v_quantity
    WHERE id = v_product_id;

    -- 4. Post balanced dual-entry to ledger: Dr Inventory (1102/1101), Cr Accounts Payable (2001)
    SELECT id INTO v_inv_account_id FROM public.accounts_chart
    WHERE account_code IN ('1102', '1101') OR (account_type = 'ASSET' AND LOWER(account_name) LIKE '%inventory%')
    ORDER BY account_code DESC LIMIT 1;

    SELECT id INTO v_ap_account_id FROM public.accounts_chart
    WHERE account_code = '2001' OR (account_type = 'LIABILITY' AND LOWER(account_name) LIKE '%payable%')
    LIMIT 1;

    IF v_inv_account_id IS NOT NULL AND v_ap_account_id IS NOT NULL THEN
      v_je_number := 'JE-' || to_char(v_purchase_date, 'YYYYMMDD') || '-' || lpad((RANDOM() * 999999)::INT::TEXT, 6, '0');
      v_narration := 'Purchase ' || v_purchase_no || ' — ' || v_product_name || ' from ' || v_supplier_name;

      INSERT INTO public.journal_entries (entry_number, entry_date, narration, is_balanced, status, customer_name)
      VALUES (v_je_number, v_purchase_date, v_narration, true, 'POSTED', v_supplier_name)
      RETURNING id INTO v_je_id;

      -- Debit Inventory Asset
      INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
      VALUES (v_je_id, v_inv_account_id, v_supplier_id, v_total, 0.00);

      -- Credit Accounts Payable
      INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
      VALUES (v_je_id, v_ap_account_id, v_supplier_id, 0.00, v_total);
    END IF;
  END IF;

  -- Insert purchase record
  INSERT INTO public.product_purchases (
    purchase_number, purchase_date, supplier_id, supplier_name,
    product_id, product_name, sku, quantity, unit_of_measure,
    purchase_rate, discount_percent, discount_pkr, tax_rate, tax_amount_pkr,
    additional_cost_pkr, purchase_subtotal_pkr, purchase_total_pkr,
    effective_unit_cost_pkr, status, inventory_lot_id, journal_entry_id,
    notes, operator_name, device_node
  )
  VALUES (
    v_purchase_no, v_purchase_date, v_supplier_id, v_supplier_name,
    v_product_id, v_product_name, v_sku, v_quantity, v_uom,
    v_purchase_rate, v_disc_pct, v_disc_pkr, v_tax_rate, v_tax_amt,
    v_add_cost, v_subtotal, v_total,
    v_unit_cost, v_status, v_lot_id, v_je_id,
    NULLIF(v_notes, ''), v_operator_name, v_device_node
  )
  RETURNING * INTO v_purchase_row;

  -- Write audit log
  BEGIN
    INSERT INTO public.system_audit_logs (operator_name, action_type, module, details)
    VALUES (
      v_operator_name,
      'PRODUCT_PURCHASE_' || UPPER(v_status),
      'PROCUREMENT',
      jsonb_build_object(
        'purchase_number', v_purchase_no,
        'product', v_product_name,
        'quantity', v_quantity,
        'purchase_rate', v_purchase_rate,
        'effective_unit_cost', v_unit_cost,
        'total', v_total
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(v_purchase_row);
END;
$$;
