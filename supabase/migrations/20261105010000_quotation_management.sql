-- ============================================================================
-- Migration: 20261105010000_quotation_management.sql
-- Description:
--   Quotation Management module for the Glassco Sanitary ERP.
--   - quotations + quotation_items tables with sequential numbering QTN-YYYY-XXXXX.
--   - Server-side validation, status-transition guard, and locked-field guard
--     enforced by triggers so REST and RPC paths behave identically.
--   - sales_invoices.quotation_id link column + UNIQUE partial index so a
--     quotation can be converted to an invoice at most once (DB-enforced).
--   - RPCs: create_quotation, update_quotation, set_quotation_status,
--     link_quotation_invoice, quotation_compute_totals, generate_quotation_number.
--   - SAFETY: no quotation function writes inventory_lots, journal_entries,
--     journal_lines, or changes stock. Creating/editing/issuing/accepting a
--     quotation never posts to the ledger. Invoice conversion reuses the
--     existing client-side invoice workflow (createInvoice) and only links IDs.
-- ============================================================================

-- ── 1. Quotation Number Sequence ────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.quotation_number_seq START 1 INCREMENT 1;

-- ── 2. Quotations Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number TEXT NOT NULL UNIQUE,
  quotation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  customer_id UUID REFERENCES public.parties(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  subtotal_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (subtotal_pkr >= 0),
  discount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (discount_pkr >= 0),
  tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (tax_amount_pkr >= 0),
  additional_charges_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (additional_charges_pkr >= 0),
  grand_total_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (grand_total_pkr >= 0),
  terms TEXT,
  notes TEXT,
  internal_notes TEXT,
  -- Internal commercial estimate: never printed on customer-facing documents.
  estimated_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  estimated_profit_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  margin_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
  -- Invoice conversion link (at most one invoice per quotation; see unique index).
  converted_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  operator_name TEXT,
  device_node TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quotations_valid_dates CHECK (valid_until IS NULL OR valid_until >= quotation_date)
);

-- ── 3. Quotation Line Items ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  -- product_id intentionally has no FK: the app spans products_master and
  -- sanitary_products (pre-existing dual-table schema); lines store the SKU and
  -- name as the durable reference, matching sales_invoice_items tolerance.
  product_id UUID,
  product_code TEXT,
  product_name TEXT NOT NULL CHECK (length(trim(product_name)) > 0),
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'PCS',
  quantity NUMERIC(15, 3) NOT NULL CHECK (quantity > 0),
  unit_price_pkr NUMERIC(15, 2) NOT NULL CHECK (unit_price_pkr >= 0),
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (discount_pkr >= 0),
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (tax_amount_pkr >= 0),
  line_total_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (line_total_pkr >= 0),
  -- Internal estimated unit cost for margin display (OWNER only); never printed.
  estimated_unit_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (estimated_unit_cost_pkr >= 0),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_quotations_status ON public.quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_customer_id ON public.quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_date ON public.quotations(quotation_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_converted ON public.quotations(converted_invoice_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON public.quotation_items(quotation_id);

-- ── 5. Invoice ↔ Quotation link (duplicate-conversion guard) ────────────────
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_invoices_quotation_id
  ON public.sales_invoices(quotation_id)
  WHERE quotation_id IS NOT NULL;

-- ── 6. RLS Policies + Grants (same posture as expenses/expenses RPCs) ───────
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotations_select_all" ON public.quotations;
CREATE POLICY "quotations_select_all" ON public.quotations FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "quotations_insert_all" ON public.quotations;
CREATE POLICY "quotations_insert_all" ON public.quotations FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "quotations_update_all" ON public.quotations;
CREATE POLICY "quotations_update_all" ON public.quotations FOR UPDATE TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "quotations_delete_all" ON public.quotations;
CREATE POLICY "quotations_delete_all" ON public.quotations FOR DELETE TO public USING (true);

DROP POLICY IF EXISTS "quotation_items_select_all" ON public.quotation_items;
CREATE POLICY "quotation_items_select_all" ON public.quotation_items FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "quotation_items_insert_all" ON public.quotation_items;
CREATE POLICY "quotation_items_insert_all" ON public.quotation_items FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "quotation_items_update_all" ON public.quotation_items;
CREATE POLICY "quotation_items_update_all" ON public.quotation_items FOR UPDATE TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "quotation_items_delete_all" ON public.quotation_items;
CREATE POLICY "quotation_items_delete_all" ON public.quotation_items FOR DELETE TO public USING (true);

GRANT ALL ON public.quotations TO anon, authenticated, service_role;
GRANT ALL ON public.quotation_items TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.quotation_number_seq TO anon, authenticated, service_role;

-- ── 7. Helpers: numbering, transitions, editability ─────────────────────────
CREATE OR REPLACE FUNCTION public.generate_quotation_number(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- QTN-YYYY-XXXXX (same PREFIX-YYYY-XXXXX convention as EXP-YYYY-XXXXX).
  RETURN 'QTN-' || to_char(COALESCE(p_date, CURRENT_DATE), 'YYYY') || '-' ||
         lpad(nextval('public.quotation_number_seq')::TEXT, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.quotation_is_editable(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') IN ('DRAFT', 'ISSUED');
$$;

-- Single source of truth for status transitions. Mirrored by
-- QUOTATION_TRANSITIONS in src/lib/supabase/quotations.ts (kept in sync by tests).
CREATE OR REPLACE FUNCTION public.quotation_transition_allowed(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_from, '')
    WHEN 'DRAFT'     THEN COALESCE(p_to, '') IN ('ISSUED', 'CANCELLED')
    WHEN 'ISSUED'    THEN COALESCE(p_to, '') IN ('ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')
    WHEN 'ACCEPTED'  THEN COALESCE(p_to, '') IN ('CANCELLED')
    WHEN 'REJECTED'  THEN COALESCE(p_to, '') IN ('DRAFT', 'CANCELLED')
    WHEN 'EXPIRED'   THEN COALESCE(p_to, '') IN ('DRAFT', 'CANCELLED')
    WHEN 'CANCELLED' THEN FALSE
    ELSE FALSE
  END;
$$;

-- ── 8. Trigger: updated_at ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_quotations_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotations_set_updated_at ON public.quotations;
CREATE TRIGGER quotations_set_updated_at
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_quotations_set_updated_at();

-- ── 9. Trigger: status transitions + conversion lock ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_quotation_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- A quotation linked to an invoice can never change status again.
  IF OLD.converted_invoice_id IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Quotation % has already been converted to an invoice and is locked.',
      OLD.quotation_number;
  END IF;

  -- Conversion link may be set once; re-pointing is forbidden (NULL -> value
  -- is allowed so a deleted invoice releases the quotation for re-conversion).
  IF OLD.converted_invoice_id IS NOT NULL
     AND NEW.converted_invoice_id IS NOT NULL
     AND NEW.converted_invoice_id IS DISTINCT FROM OLD.converted_invoice_id THEN
    RAISE EXCEPTION 'Quotation % is already linked to another invoice.', OLD.quotation_number;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.quotation_transition_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'Invalid quotation status transition: % -> % (quotation %)',
        OLD.status, NEW.status, OLD.quotation_number;
    END IF;
    IF NEW.status = 'ISSUED' AND NEW.issued_at IS NULL THEN
      NEW.issued_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotations_status_transition ON public.quotations;
CREATE TRIGGER quotations_status_transition
  BEFORE UPDATE OF status, converted_invoice_id ON public.quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_quotation_status_transition();

-- ── 10. Trigger: locked business fields once decided ────────────────────────
-- Customer contact fields stay editable so a walk-in quotation can be linked
-- to a parties row later; every money/term field freezes on decision states.
CREATE OR REPLACE FUNCTION public.trg_quotation_lock_decided()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.quotation_is_editable(OLD.status) AND OLD.converted_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.quotation_date   IS DISTINCT FROM OLD.quotation_date
     OR NEW.valid_until   IS DISTINCT FROM OLD.valid_until
     OR NEW.subtotal_pkr  IS DISTINCT FROM OLD.subtotal_pkr
     OR NEW.discount_pkr  IS DISTINCT FROM OLD.discount_pkr
     OR NEW.tax_amount_pkr IS DISTINCT FROM OLD.tax_amount_pkr
     OR NEW.additional_charges_pkr IS DISTINCT FROM OLD.additional_charges_pkr
     OR NEW.grand_total_pkr IS DISTINCT FROM OLD.grand_total_pkr
     OR NEW.estimated_cost_pkr IS DISTINCT FROM OLD.estimated_cost_pkr
     OR NEW.estimated_profit_pkr IS DISTINCT FROM OLD.estimated_profit_pkr
     OR NEW.margin_percent IS DISTINCT FROM OLD.margin_percent
     OR NEW.terms         IS DISTINCT FROM OLD.terms
     OR NEW.notes         IS DISTINCT FROM OLD.notes
     OR NEW.internal_notes IS DISTINCT FROM OLD.internal_notes THEN
    RAISE EXCEPTION 'Quotation % is % and its commercial terms are locked (return it to DRAFT to revise).',
      OLD.quotation_number, OLD.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotations_lock_decided ON public.quotations;
CREATE TRIGGER quotations_lock_decided
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_quotation_lock_decided();

-- ── 11. Trigger: line items only while editable ─────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_quotation_items_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_q  public.quotations%ROWTYPE;
  v_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := OLD.quotation_id;
  ELSE
    IF NEW.quotation_id IS DISTINCT FROM COALESCE(OLD.quotation_id, NEW.quotation_id) THEN
      RAISE EXCEPTION 'Quotation line items cannot be moved between quotations.';
    END IF;
    v_id := NEW.quotation_id;
  END IF;

  SELECT * INTO v_q FROM public.quotations WHERE id = v_id;

  IF NOT FOUND THEN
    -- Parent row already removed (ON DELETE CASCADE) — nothing left to guard.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Quotation % not found for line item.', COALESCE(v_id::TEXT, 'NULL');
  END IF;

  IF v_q.converted_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has been converted to an invoice; its lines are locked.',
      v_q.quotation_number;
  END IF;

  IF NOT public.quotation_is_editable(v_q.status) THEN
    RAISE EXCEPTION 'Quotation % is %; its lines cannot be modified.',
      v_q.quotation_number, v_q.status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_items_guard_insert ON public.quotation_items;
CREATE TRIGGER quotation_items_guard_insert
  BEFORE INSERT ON public.quotation_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_quotation_items_guard();

DROP TRIGGER IF EXISTS quotation_items_guard_update ON public.quotation_items;
CREATE TRIGGER quotation_items_guard_update
  BEFORE UPDATE ON public.quotation_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_quotation_items_guard();

DROP TRIGGER IF EXISTS quotation_items_guard_delete ON public.quotation_items;
CREATE TRIGGER quotation_items_guard_delete
  BEFORE DELETE ON public.quotation_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_quotation_items_guard();

-- ── 12. RPC: quotation_compute_totals (server-side calculation) ─────────────
-- Validates a payload's line items and computes every header total. Both the
-- client (src/lib/supabase/quotations.ts) and the invoice conversion mapping
-- use identical formulas; the server result is authoritative.
CREATE OR REPLACE FUNCTION public.quotation_compute_totals(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items        JSONB := COALESCE(p_payload -> 'items', '[]'::jsonb);
  v_count        INT;
  v_subtotal     NUMERIC(15, 2) := 0;
  v_discount     NUMERIC(15, 2) := 0;
  v_tax          NUMERIC(15, 2) := 0;
  v_charges      NUMERIC(15, 2) := 0;
  v_cost         NUMERIC(15, 2) := 0;
  v_net          NUMERIC(15, 2);
  v_out          JSONB := '[]'::jsonb;
  v_qty          NUMERIC;
  v_price        NUMERIC;
  v_drpct        NUMERIC;
  v_dramt        NUMERIC;
  v_trate        NUMERIC;
  v_ucost        NUMERIC;
  v_gross        NUMERIC;
  v_disc         NUMERIC;
  v_line_net     NUMERIC;
  v_line_tax     NUMERIC;
  v_line_total   NUMERIC;
  v_pname        TEXT;
  v_unit         TEXT;
BEGIN
  v_count := jsonb_array_length(v_items);
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'Add at least one line item to the quotation.';
  END IF;

  v_charges := COALESCE((p_payload ->> 'additional_charges_pkr')::NUMERIC, 0);
  IF v_charges < 0 THEN
    RAISE EXCEPTION 'Additional charges cannot be negative.';
  END IF;

  FOR i IN 0 .. v_count - 1 LOOP
    DECLARE
      v_it JSONB := v_items -> i;
    BEGIN
      v_pname := TRIM(COALESCE(v_it ->> 'product_name', ''));
      IF v_pname = '' THEN
        RAISE EXCEPTION 'Line %: product name is required.', i + 1;
      END IF;

      v_qty   := (v_it ->> 'quantity')::NUMERIC;
      v_price := COALESCE((v_it ->> 'unit_price_pkr')::NUMERIC, 0);
      v_drpct := COALESCE((v_it ->> 'discount_percent')::NUMERIC, 0);
      v_dramt := COALESCE((v_it ->> 'discount_pkr')::NUMERIC, 0);
      v_trate := COALESCE((v_it ->> 'tax_rate')::NUMERIC, 0);
      v_ucost := COALESCE((v_it ->> 'estimated_unit_cost_pkr')::NUMERIC, 0);
      v_unit  := NULLIF(TRIM(COALESCE(v_it ->> 'unit', '')), '');

      IF v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Line % (%): quantity must be greater than zero.', i + 1, v_pname;
      END IF;
      IF v_price IS NULL OR v_price < 0 THEN
        RAISE EXCEPTION 'Line % (%): unit price cannot be negative.', i + 1, v_pname;
      END IF;
      IF v_drpct < 0 OR v_drpct > 100 THEN
        RAISE EXCEPTION 'Line % (%): discount percent must be between 0 and 100.', i + 1, v_pname;
      END IF;
      IF v_dramt < 0 THEN
        RAISE EXCEPTION 'Line % (%): discount amount cannot be negative.', i + 1, v_pname;
      END IF;
      IF v_trate < 0 OR v_trate > 100 THEN
        RAISE EXCEPTION 'Line % (%): tax rate must be between 0 and 100.', i + 1, v_pname;
      END IF;
      IF v_ucost < 0 THEN
        RAISE EXCEPTION 'Line % (%): estimated cost cannot be negative.', i + 1, v_pname;
      END IF;

      v_gross := ROUND(v_qty * v_price, 2);
      -- Explicit discount amount wins over percent; never exceeds the gross line.
      v_disc  := CASE
                   WHEN v_dramt > 0 THEN LEAST(ROUND(v_dramt, 2), v_gross)
                   ELSE ROUND(v_gross * v_drpct / 100, 2)
                 END;
      v_line_net := v_gross - v_disc;
      v_line_tax := ROUND(v_line_net * v_trate / 100, 2);
      v_line_total := v_line_net + v_line_tax;

      v_subtotal := v_subtotal + v_gross;
      v_discount := v_discount + v_disc;
      v_tax      := v_tax + v_line_tax;
      v_cost     := v_cost + ROUND(v_qty * v_ucost, 2);

      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'product_id',         NULLIF(v_it ->> 'product_id', ''),
        'product_code',       NULLIF(TRIM(COALESCE(v_it ->> 'product_code', '')), ''),
        'product_name',       v_pname,
        'description',        NULLIF(TRIM(COALESCE(v_it ->> 'description', '')), ''),
        'unit',               COALESCE(v_unit, 'PCS'),
        'quantity',           v_qty,
        'unit_price_pkr',     ROUND(v_price, 2),
        'discount_percent',   v_drpct,
        'discount_pkr',       v_disc,
        'tax_rate',           v_trate,
        'tax_amount_pkr',     v_line_tax,
        'line_total_pkr',     v_line_total,
        'estimated_unit_cost_pkr', ROUND(v_ucost, 2),
        'sort_order',         i
      ));
    END;
  END LOOP;

  v_net := v_subtotal - v_discount;

  RETURN jsonb_build_object(
    'items',                 v_out,
    'subtotal_pkr',          ROUND(v_subtotal, 2),
    'discount_pkr',          ROUND(v_discount, 2),
    'tax_amount_pkr',        ROUND(v_tax, 2),
    'additional_charges_pkr', ROUND(v_charges, 2),
    'grand_total_pkr',       ROUND(v_net + v_tax + v_charges, 2),
    -- Internal estimates: profit measured against net sales excluding tax.
    'estimated_cost_pkr',    ROUND(v_cost, 2),
    'estimated_profit_pkr',  ROUND(v_net - v_cost, 2),
    'margin_percent',        CASE WHEN v_net > 0 THEN ROUND((v_net - v_cost) / v_net * 100, 2) ELSE 0 END
  );
END;
$$;

-- ── 13. RPC: create_quotation ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_quotation(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calc   JSONB;
  v_date   DATE;
  v_valid  DATE;
  v_name   TEXT;
  v_q      public.quotations%ROWTYPE;
  v_item   JSONB;
  v_count  INT;
BEGIN
  v_date  := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'quotation_date', '')), '')::DATE, CURRENT_DATE);
  v_valid := NULLIF(TRIM(COALESCE(p_payload ->> 'valid_until', '')), '')::DATE;
  v_name  := TRIM(COALESCE(p_payload ->> 'customer_name', ''));

  IF v_name = '' THEN
    RAISE EXCEPTION 'Customer name is required.';
  END IF;
  IF v_valid IS NOT NULL AND v_valid < v_date THEN
    RAISE EXCEPTION 'Valid-until date cannot be before the quotation date.';
  END IF;

  v_calc := public.quotation_compute_totals(p_payload);

  INSERT INTO public.quotations (
    quotation_number, quotation_date, valid_until, customer_id, customer_name,
    customer_phone, customer_address, status, subtotal_pkr, discount_pkr,
    tax_amount_pkr, additional_charges_pkr, grand_total_pkr, terms, notes,
    internal_notes, estimated_cost_pkr, estimated_profit_pkr, margin_percent,
    operator_name, device_node, created_by
  )
  VALUES (
    public.generate_quotation_number(v_date),
    v_date,
    v_valid,
    NULLIF(TRIM(COALESCE(p_payload ->> 'customer_id', '')), '')::UUID,
    v_name,
    NULLIF(TRIM(COALESCE(p_payload ->> 'customer_phone', '')), ''),
    NULLIF(TRIM(COALESCE(p_payload ->> 'customer_address', '')), ''),
    'DRAFT',
    (v_calc ->> 'subtotal_pkr')::NUMERIC,
    (v_calc ->> 'discount_pkr')::NUMERIC,
    (v_calc ->> 'tax_amount_pkr')::NUMERIC,
    (v_calc ->> 'additional_charges_pkr')::NUMERIC,
    (v_calc ->> 'grand_total_pkr')::NUMERIC,
    NULLIF(TRIM(COALESCE(p_payload ->> 'terms', '')), ''),
    NULLIF(TRIM(COALESCE(p_payload ->> 'notes', '')), ''),
    NULLIF(TRIM(COALESCE(p_payload ->> 'internal_notes', '')), ''),
    (v_calc ->> 'estimated_cost_pkr')::NUMERIC,
    (v_calc ->> 'estimated_profit_pkr')::NUMERIC,
    (v_calc ->> 'margin_percent')::NUMERIC,
    NULLIF(TRIM(COALESCE(p_payload ->> 'operator_name', '')), ''),
    NULLIF(TRIM(COALESCE(p_payload ->> 'device_node', '')), ''),
    auth.uid()
  )
  RETURNING * INTO v_q;

  v_count := jsonb_array_length(v_calc -> 'items');
  FOR i IN 0 .. v_count - 1 LOOP
    v_item := (v_calc -> 'items') -> i;
    INSERT INTO public.quotation_items (
      quotation_id, product_id, product_code, product_name, description, unit,
      quantity, unit_price_pkr, discount_percent, discount_pkr, tax_rate,
      tax_amount_pkr, line_total_pkr, estimated_unit_cost_pkr, sort_order
    )
    VALUES (
      v_q.id,
      NULLIF(v_item ->> 'product_id', '')::UUID,
      v_item ->> 'product_code',
      v_item ->> 'product_name',
      v_item ->> 'description',
      v_item ->> 'unit',
      (v_item ->> 'quantity')::NUMERIC,
      (v_item ->> 'unit_price_pkr')::NUMERIC,
      (v_item ->> 'discount_percent')::NUMERIC,
      (v_item ->> 'discount_pkr')::NUMERIC,
      (v_item ->> 'tax_rate')::NUMERIC,
      (v_item ->> 'tax_amount_pkr')::NUMERIC,
      (v_item ->> 'line_total_pkr')::NUMERIC,
      (v_item ->> 'estimated_unit_cost_pkr')::NUMERIC,
      (v_item ->> 'sort_order')::INT
    );
  END LOOP;

  BEGIN
    INSERT INTO public.system_audit_logs (operator_name, action_type, module, details)
    VALUES (
      COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'operator_name', '')), ''), 'System Operator'),
      'QUOTATION_CREATED',
      'QUOTATIONS',
      jsonb_build_object(
        'quotation_number', v_q.quotation_number,
        'customer_name', v_q.customer_name,
        'grand_total_pkr', v_q.grand_total_pkr,
        'status', v_q.status
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort audit
  END;

  RETURN to_jsonb(v_q) || jsonb_build_object('items', v_calc -> 'items');
END;
$$;

-- ── 14. RPC: update_quotation ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_quotation(p_quotation_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calc  JSONB;
  v_q     public.quotations%ROWTYPE;
  v_date  DATE;
  v_valid DATE;
  v_name  TEXT;
  v_item  JSONB;
  v_count INT;
BEGIN
  SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found.';
  END IF;
  IF v_q.converted_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has already been converted to an invoice and cannot be edited.', v_q.quotation_number;
  END IF;
  IF NOT public.quotation_is_editable(v_q.status) THEN
    RAISE EXCEPTION 'Quotation % is % and cannot be edited (only DRAFT or ISSUED quotations can be revised).',
      v_q.quotation_number, v_q.status;
  END IF;

  v_date  := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'quotation_date', '')), '')::DATE, v_q.quotation_date);
  v_valid := NULLIF(TRIM(COALESCE(p_payload ->> 'valid_until', '')), '')::DATE;
  v_name  := TRIM(COALESCE(p_payload ->> 'customer_name', ''));

  IF v_name = '' THEN
    RAISE EXCEPTION 'Customer name is required.';
  END IF;
  IF v_valid IS NOT NULL AND v_valid < v_date THEN
    RAISE EXCEPTION 'Valid-until date cannot be before the quotation date.';
  END IF;

  v_calc := public.quotation_compute_totals(p_payload);

  UPDATE public.quotations SET
    quotation_date       = v_date,
    valid_until          = v_valid,
    customer_id          = NULLIF(TRIM(COALESCE(p_payload ->> 'customer_id', '')), '')::UUID,
    customer_name        = v_name,
    customer_phone       = NULLIF(TRIM(COALESCE(p_payload ->> 'customer_phone', '')), ''),
    customer_address     = NULLIF(TRIM(COALESCE(p_payload ->> 'customer_address', '')), ''),
    subtotal_pkr         = (v_calc ->> 'subtotal_pkr')::NUMERIC,
    discount_pkr         = (v_calc ->> 'discount_pkr')::NUMERIC,
    tax_amount_pkr       = (v_calc ->> 'tax_amount_pkr')::NUMERIC,
    additional_charges_pkr = (v_calc ->> 'additional_charges_pkr')::NUMERIC,
    grand_total_pkr      = (v_calc ->> 'grand_total_pkr')::NUMERIC,
    terms                = NULLIF(TRIM(COALESCE(p_payload ->> 'terms', '')), ''),
    notes                = NULLIF(TRIM(COALESCE(p_payload ->> 'notes', '')), ''),
    internal_notes       = NULLIF(TRIM(COALESCE(p_payload ->> 'internal_notes', '')), ''),
    estimated_cost_pkr   = (v_calc ->> 'estimated_cost_pkr')::NUMERIC,
    estimated_profit_pkr = (v_calc ->> 'estimated_profit_pkr')::NUMERIC,
    margin_percent       = (v_calc ->> 'margin_percent')::NUMERIC
  WHERE id = p_quotation_id
  RETURNING * INTO v_q;

  -- Rebuild lines atomically with the header (old lines are unlocked because
  -- the quotation is still in an editable status).
  DELETE FROM public.quotation_items WHERE quotation_id = p_quotation_id;

  v_count := jsonb_array_length(v_calc -> 'items');
  FOR i IN 0 .. v_count - 1 LOOP
    v_item := (v_calc -> 'items') -> i;
    INSERT INTO public.quotation_items (
      quotation_id, product_id, product_code, product_name, description, unit,
      quantity, unit_price_pkr, discount_percent, discount_pkr, tax_rate,
      tax_amount_pkr, line_total_pkr, estimated_unit_cost_pkr, sort_order
    )
    VALUES (
      v_q.id,
      NULLIF(v_item ->> 'product_id', '')::UUID,
      v_item ->> 'product_code',
      v_item ->> 'product_name',
      v_item ->> 'description',
      v_item ->> 'unit',
      (v_item ->> 'quantity')::NUMERIC,
      (v_item ->> 'unit_price_pkr')::NUMERIC,
      (v_item ->> 'discount_percent')::NUMERIC,
      (v_item ->> 'discount_pkr')::NUMERIC,
      (v_item ->> 'tax_rate')::NUMERIC,
      (v_item ->> 'tax_amount_pkr')::NUMERIC,
      (v_item ->> 'line_total_pkr')::NUMERIC,
      (v_item ->> 'estimated_unit_cost_pkr')::NUMERIC,
      (v_item ->> 'sort_order')::INT
    );
  END LOOP;

  BEGIN
    INSERT INTO public.system_audit_logs (operator_name, action_type, module, details)
    VALUES (
      COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'operator_name', '')), ''), 'System Operator'),
      'QUOTATION_UPDATED',
      'QUOTATIONS',
      jsonb_build_object('quotation_number', v_q.quotation_number, 'grand_total_pkr', v_q.grand_total_pkr)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(v_q) || jsonb_build_object(
    'items',
    (SELECT jsonb_agg(i ORDER BY i ->> 'sort_order')
       FROM jsonb_array_elements(v_calc -> 'items') AS i)
  );
END;
$$;

-- ── 15. RPC: set_quotation_status ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_quotation_status(
  p_quotation_id UUID,
  p_new_status TEXT,
  p_operator_name TEXT DEFAULT 'System Operator',
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q   public.quotations%ROWTYPE;
  v_to  TEXT := UPPER(TRIM(COALESCE(p_new_status, '')));
  v_from TEXT;
BEGIN
  SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found.';
  END IF;
  v_from := v_q.status;

  IF v_to NOT IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid quotation status: %', v_to;
  END IF;

  -- Idempotent no-op: already in the requested state.
  IF v_to = v_q.status THEN
    RETURN to_jsonb(v_q) || jsonb_build_object(
      'items', COALESCE((SELECT jsonb_agg(i ORDER BY i.sort_order)
                           FROM public.quotation_items i WHERE i.quotation_id = v_q.id), '[]'::jsonb)
    );
  END IF;

  IF v_q.converted_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has already been converted to an invoice and is locked.', v_q.quotation_number;
  END IF;

  IF NOT public.quotation_transition_allowed(v_q.status, v_to) THEN
    RAISE EXCEPTION 'Invalid quotation status transition: % -> % (quotation %)',
      v_q.status, v_to, v_q.quotation_number;
  END IF;

  UPDATE public.quotations
  SET status = v_to
  WHERE id = p_quotation_id
  RETURNING * INTO v_q;

  BEGIN
    INSERT INTO public.system_audit_logs (operator_name, action_type, module, details)
    VALUES (
      COALESCE(NULLIF(TRIM(COALESCE(p_operator_name, '')), ''), 'System Operator'),
      'QUOTATION_' || v_to,
      'QUOTATIONS',
      jsonb_build_object(
        'quotation_number', v_q.quotation_number,
        'from_status', v_from,
        'to_status', v_to,
        'reason', NULLIF(TRIM(COALESCE(p_reason, '')), '')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(v_q) || jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(i ORDER BY i.sort_order)
                         FROM public.quotation_items i WHERE i.quotation_id = v_q.id), '[]'::jsonb)
  );
END;
$$;

-- ── 16. RPC: link_quotation_invoice (conversion bookkeeping) ────────────────
-- Called AFTER the invoice was created through the existing invoice workflow.
-- Idempotent: re-calling with the same invoice id is a no-op; a different
-- invoice id raises. The unique index on sales_invoices.quotation_id already
-- guarantees at most one invoice per quotation.
CREATE OR REPLACE FUNCTION public.link_quotation_invoice(
  p_quotation_id UUID,
  p_invoice_id UUID,
  p_operator_name TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q public.quotations%ROWTYPE;
BEGIN
  SELECT * INTO v_q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found.';
  END IF;

  IF v_q.converted_invoice_id = p_invoice_id THEN
    RETURN to_jsonb(v_q); -- already linked — replay
  END IF;

  IF v_q.converted_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has already been converted to a different invoice.', v_q.quotation_number;
  END IF;

  -- DRAFT, ISSUED and ACCEPTED may convert; REJECTED / EXPIRED / CANCELLED may not.
  IF v_q.status NOT IN ('DRAFT', 'ISSUED', 'ACCEPTED') THEN
    RAISE EXCEPTION 'This quotation cannot be converted to an invoice while its status is %.', v_q.status;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = p_invoice_id) THEN
    RAISE EXCEPTION 'Invoice % not found.', p_invoice_id;
  END IF;

  UPDATE public.quotations
  SET converted_invoice_id = p_invoice_id,
      converted_at = NOW()
  WHERE id = p_quotation_id
  RETURNING * INTO v_q;

  BEGIN
    INSERT INTO public.system_audit_logs (operator_name, action_type, module, details)
    VALUES (
      COALESCE(NULLIF(TRIM(COALESCE(p_operator_name, '')), ''), 'System Operator'),
      'QUOTATION_CONVERTED',
      'QUOTATIONS',
      jsonb_build_object(
        'quotation_number', v_q.quotation_number,
        'invoice_id', p_invoice_id,
        'grand_total_pkr', v_q.grand_total_pkr
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(v_q);
END;
$$;

-- ── 17. Grants ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.generate_quotation_number(DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quotation_is_editable(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quotation_transition_allowed(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quotation_compute_totals(JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_quotation(JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_quotation(UUID, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_quotation_status(UUID, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_quotation_invoice(UUID, UUID, TEXT) TO anon, authenticated, service_role;
