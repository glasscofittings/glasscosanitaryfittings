-- ============================================================================
-- Migration: 20261106010000_qa_audit_fixes.sql
-- Description:
--   Fixes surfaced by the independent QA / accounting audit. Two objects:
--
--   1. record_and_confirm_purchase (replaces the 20261104010000 version)
--
--      a. TAX PRECISION FIX — v_tax_amt was declared NUMERIC(5, 2) (max
--         999.99) in 20261104010000, while 20261103010000 used NUMERIC(15, 2).
--         Any purchase whose tax reached PKR 1,000 aborted with a numeric
--         field overflow (drafts and confirmed alike). Restored to
--         NUMERIC(15, 2); percentages stay NUMERIC(5, 2) as they cannot
--         exceed 999.99.
--
--      b. NO SILENT UNPOSTED CONFIRMATIONS — previously, if the inventory or
--         accounts-payable account could not be resolved from
--         accounts_chart, a confirmed purchase committed stock + lot with no
--         journal entry at all (HTTP 200, journal_entry_id NULL). A confirmed
--         purchase MUST produce the balanced Dr Inventory / Cr AP entry, so
--         the function now raises and the whole transaction rolls back
--         (stock included), leaving the operator to fix the chart of accounts
--         or record the purchase as a draft.
--
--      Unchanged on purpose: the idempotency-key replay, the draft branch
--      (drafts never touch stock or the ledger), the products_master FK
--      mirror, the unrestricted lot creation with its exception-safe
--      swallow (deliberate design: a lot failure must never block a
--      purchase), and the balanced two-line posting itself.
--
--   2. Quotations: BEFORE INSERT trigger forcing status = 'DRAFT'
--
--      The lifecycle is enforced by BEFORE UPDATE triggers from
--      20261105010000, but a direct REST insert could still create a row
--      already in a decided state (e.g. ACCEPTED) with arbitrary totals.
--      Every insert now enters the system as a DRAFT and must walk the
--      validated transition table (issue → decide) like every other
--      quotation. The conversion fields are cleared on insert for the same
--      reason: only link_quotation_invoice may ever set them.
--
-- Prerequisites (apply in order):
--   20261103010000 → 20261104010000 → 20261105010000 → this file.
--
-- Idempotent. Safe to re-run in the Supabase SQL Editor.
-- ============================================================================

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
  v_category         TEXT;
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
  v_idem_key         TEXT;
  v_wh_id            UUID;
  v_pm_id            UUID := NULL;
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
  v_idem_key      := NULLIF(TRIM(COALESCE(p_payload->>'idempotency_key', '')), '');

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Product ID is required.';
  END IF;

  IF v_quantity IS NULL OR v_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;

  IF v_purchase_rate IS NULL OR v_purchase_rate < 0 THEN
    RAISE EXCEPTION 'Purchase rate must be non-negative.';
  END IF;

  IF v_status NOT IN ('draft', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid purchase status: %', v_status;
  END IF;

  -- Idempotent replay: a repeated submission with the same client key returns
  -- the purchase that was already recorded. No second stock movement and no
  -- second ledger entry are ever produced for one submission.
  IF v_idem_key IS NOT NULL THEN
    SELECT * INTO v_purchase_row FROM public.product_purchases
    WHERE idempotency_key = v_idem_key
    LIMIT 1;
    IF FOUND THEN
      RETURN to_jsonb(v_purchase_row);
    END IF;
  END IF;

  -- Lookup product details
  SELECT name, sku, category INTO v_product_name, v_sku, v_category
  FROM public.sanitary_products
  WHERE id = v_product_id;

  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Sanitary product with ID % not found.', v_product_id;
  END IF;

  -- Calculations (identical to calculatePurchaseLine in the app)
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

  -- Total and Landed Cost per unit (tax excluded from unit cost, same as app)
  v_total := ROUND((v_subtotal - v_disc_pkr) + v_tax_amt + v_add_cost, 2);
  v_unit_cost := ROUND(((v_subtotal - v_disc_pkr) + v_add_cost) / v_quantity, 2);

  -- Sequential purchase number: PUR-YYYY-XXXXX (purchase_number is UNIQUE)
  v_purchase_no := 'PUR-' || to_char(v_purchase_date, 'YYYY') || '-' ||
                   lpad(nextval('public.purchase_number_seq')::TEXT, 5, '0');

  -- If status = 'confirmed', update stock and post to ledger.
  -- Draft purchases NEVER touch stock or the ledger.
  IF v_status = 'confirmed' THEN
    -- 1. Find finished goods warehouse (WH-02 or WH-01)
    SELECT id INTO v_wh_id FROM public.inventory_warehouses WHERE code = 'WH-02' LIMIT 1;
    IF v_wh_id IS NULL THEN
      SELECT id INTO v_wh_id FROM public.inventory_warehouses ORDER BY code LIMIT 1;
    END IF;

    -- 2. Resolve the products_master row required by the
    --    inventory_lots.product_id -> products_master(id) foreign key.
    SELECT id INTO v_pm_id FROM public.products_master WHERE id = v_product_id;
    IF v_pm_id IS NULL THEN
      SELECT id INTO v_pm_id FROM public.products_master
      WHERE sku = v_sku OR name = v_product_name
      ORDER BY CASE WHEN sku = v_sku THEN 0 ELSE 1 END
      LIMIT 1;
    END IF;
    IF v_pm_id IS NULL THEN
      BEGIN
        INSERT INTO public.products_master (id, name, sku, category, item_type, unit_of_measure)
        VALUES (v_product_id, v_product_name, v_sku, v_category, 'FINISHED_GOOD', v_uom)
        RETURNING id INTO v_pm_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_pm_id FROM public.products_master
        WHERE sku = v_sku OR name = v_product_name
        ORDER BY CASE WHEN sku = v_sku THEN 0 ELSE 1 END
        LIMIT 1;
      END;
    END IF;
    IF v_pm_id IS NULL THEN
      v_pm_id := v_product_id; -- last resort: let the lot block below handle it
    END IF;

    -- 3. Create the inventory lot. status = 'unrestricted' so the
    --    deduction-guard trigger allows this stock to be consumed, and the
    --    lot_number derives from the UNIQUE purchase number (no RANDOM()
    --    collisions). Exception-safe: a lot failure must never roll back the
    --    purchase, the stock update, or the ledger posting.
    v_lot_number := 'LOT-' || v_purchase_no;
    IF v_wh_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.inventory_lots (
          lot_number, product_id, warehouse_id, vendor_lot_code,
          manufacture_date, expiration_date, initial_qty, remaining_qty,
          unit_cost_pkr, qc_status, status
        )
        VALUES (
          v_lot_number, v_pm_id, v_wh_id, v_purchase_no,
          v_purchase_date, (v_purchase_date + INTERVAL '2 years')::DATE,
          v_quantity, v_quantity, v_unit_cost, 'PASSED', 'unrestricted'
        )
        RETURNING id INTO v_lot_id;
      EXCEPTION WHEN OTHERS THEN
        v_lot_id := NULL;
      END;
    END IF;

    -- 4. Increase sanitary_products stock
    UPDATE public.sanitary_products
    SET
      total_stock = total_stock + v_quantity,
      available_stock = available_stock + v_quantity
    WHERE id = v_product_id;

    -- 5. Balanced double entry: Dr Inventory (1102/1101), Cr Accounts Payable
    --    (2001). Canonical codes always win over name-based fallbacks.
    SELECT id INTO v_inv_account_id FROM public.accounts_chart
    WHERE account_code IN ('1102', '1101')
       OR (account_type = 'ASSET' AND LOWER(account_name) LIKE '%inventory%')
    ORDER BY CASE WHEN account_code = '1102' THEN 0
                  WHEN account_code = '1101' THEN 1
                  ELSE 2 END
    LIMIT 1;

    SELECT id INTO v_ap_account_id FROM public.accounts_chart
    WHERE account_code = '2001'
       OR (account_type = 'LIABILITY' AND LOWER(account_name) LIKE '%payable%')
    ORDER BY CASE WHEN account_code = '2001' THEN 0 ELSE 1 END
    LIMIT 1;

    -- QA FIX: a confirmed purchase without its two accounts used to commit
    -- stock and a lot with NO journal entry (silent, HTTP 200). Failing here
    -- rolls the whole transaction back — stock included — so the ledger can
    -- never drift from the books. Drafts never reach this branch.
    IF v_inv_account_id IS NULL OR v_ap_account_id IS NULL THEN
      RAISE EXCEPTION
        'Cannot post purchase %: the Chart of Accounts is missing the inventory account (1102/1101) or the accounts-payable account (2001). Fix the chart, or record the purchase as a draft.',
        v_purchase_no;
    END IF;

    v_je_number := 'JE-' || to_char(v_purchase_date, 'YYYYMMDD') || '-' ||
                   lpad(nextval('public.journal_entry_seq')::TEXT, 5, '0');
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

  -- Insert purchase record
  INSERT INTO public.product_purchases (
    purchase_number, purchase_date, supplier_id, supplier_name,
    product_id, product_name, sku, quantity, unit_of_measure,
    purchase_rate, discount_percent, discount_pkr, tax_rate, tax_amount_pkr,
    additional_cost_pkr, purchase_subtotal_pkr, purchase_total_pkr,
    effective_unit_cost_pkr, status, inventory_lot_id, journal_entry_id,
    notes, operator_name, device_node, idempotency_key
  )
  VALUES (
    v_purchase_no, v_purchase_date, v_supplier_id, v_supplier_name,
    v_product_id, v_product_name, v_sku, v_quantity, v_uom,
    v_purchase_rate, v_disc_pct, v_disc_pkr, v_tax_rate, v_tax_amt,
    v_add_cost, v_subtotal, v_total,
    v_unit_cost, v_status, v_lot_id, v_je_id,
    NULLIF(v_notes, ''), v_operator_name, v_device_node, v_idem_key
  )
  RETURNING * INTO v_purchase_row;

  -- Write audit log (best effort; same column pattern as the expense RPCs)
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

GRANT EXECUTE ON FUNCTION public.record_and_confirm_purchase(jsonb)
  TO anon, authenticated, service_role;

-- ============================================================================
-- 2. Quotations: every INSERT enters the system as a DRAFT.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.quotation_force_draft_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'DRAFT' THEN
    NEW.status := 'DRAFT';
  END IF;
  -- Only link_quotation_invoice (an UPDATE path) may ever carry a conversion.
  NEW.converted_invoice_id := NULL;
  NEW.converted_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotation_force_draft_on_insert ON public.quotations;
CREATE TRIGGER trg_quotation_force_draft_on_insert
  BEFORE INSERT ON public.quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.quotation_force_draft_on_insert();
