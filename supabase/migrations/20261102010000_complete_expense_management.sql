-- ============================================================================
-- Migration: 20261102010000_complete_expense_management.sql
-- Description:
--   Comprehensive Expense Management Module for Glassco Sanitary ERP.
--   - Ensures core and expense accounts exist in accounts_chart with standard codes.
--   - Creates public.expenses table with sequential numbering EXP-YYYY-XXXXX.
--   - Integrates with double-entry general ledger (journal_entries + journal_lines).
--   - Supports PAID (Dr Expense, Cr Cash/Bank) and UNPAID (Dr Expense, Cr Payable).
--   - Supports settling UNPAID expenses later (Dr Payable, Cr Cash/Bank).
--   - Ensures DRAFT and CANCELLED expenses do not affect posted balances.
--   - Implements full transactional RPCs and system_audit_logs audit tracking.
-- ============================================================================

-- ── 1. Ensure Standard Accounts in Chart of Accounts ────────────────────────
INSERT INTO public.accounts_chart (account_code, account_name, account_type, is_default_cash, is_liquid_funds)
VALUES
  ('1000', 'Cash in Hand', 'ASSET', true, true),
  ('1002', 'Bank Account', 'ASSET', false, true),
  ('1100', 'Accounts Receivable', 'ASSET', false, false),
  ('2001', 'Accounts Payable (Vendors)', 'LIABILITY', false, false),
  ('5002', 'Salaries & Wages Expense', 'EXPENSE', false, false),
  ('5003', 'Electricity & Utilities Expense', 'EXPENSE', false, false),
  ('5004', 'Rent Expense', 'EXPENSE', false, false),
  ('5005', 'Transport & Freight Expense', 'EXPENSE', false, false),
  ('5006', 'Cost of Goods Sold', 'EXPENSE', false, false),
  ('5007', 'Fuel & Generator Expense', 'EXPENSE', false, false),
  ('6300', 'Packaging & Consumables Expense', 'EXPENSE', false, false),
  ('6400', 'Repair & Maintenance Expense', 'EXPENSE', false, false),
  ('6500', 'General & Miscellaneous Expense', 'EXPENSE', false, false)
ON CONFLICT (account_code) DO NOTHING;

-- ── 2. Expense Number Sequence ──────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.expense_number_seq START 1 INCREMENT 1;

-- ── 3. Expenses Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number TEXT NOT NULL UNIQUE,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL CHECK (category IN (
    'RENT', 'ELECTRICITY', 'SALARIES', 'TRANSPORT', 'FUEL', 'MAINTENANCE', 'PACKAGING', 'MISCELLANEOUS'
  )),
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'PAYABLE', 'CHEQUE')),
  expense_account_id UUID NOT NULL REFERENCES public.accounts_chart(id),
  payment_account_id UUID REFERENCES public.accounts_chart(id),
  payable_account_id UUID REFERENCES public.accounts_chart(id),
  party_id UUID REFERENCES public.parties(id) ON DELETE SET NULL,
  payee_name TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'UNPAID', 'PAID', 'CANCELLED')),
  receipt_url TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  payment_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  operator_name TEXT,
  device_node TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_number ON public.expenses(expense_number);
CREATE INDEX IF NOT EXISTS idx_expenses_party_id ON public.expenses(party_id);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_account ON public.expenses(expense_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_account ON public.expenses(payment_account_id);

-- ── 4. RLS Policies ─────────────────────────────────────────────────────────
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select_all" ON public.expenses;
CREATE POLICY "expenses_select_all" ON public.expenses
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "expenses_insert_all" ON public.expenses;
CREATE POLICY "expenses_insert_all" ON public.expenses
  FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "expenses_update_all" ON public.expenses;
CREATE POLICY "expenses_update_all" ON public.expenses
  FOR UPDATE TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "expenses_delete_all" ON public.expenses;
CREATE POLICY "expenses_delete_all" ON public.expenses
  FOR DELETE TO public USING (true);

GRANT ALL ON public.expenses TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.expense_number_seq TO anon, authenticated, service_role;

-- ── 5. RPC: create_or_post_expense ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_or_post_expense(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expense_no       TEXT;
  v_expense_date     DATE;
  v_category         TEXT;
  v_description      TEXT;
  v_amount           NUMERIC(15, 2);
  v_payment_method   TEXT;
  v_expense_acc_id   UUID;
  v_payment_acc_id   UUID;
  v_payable_acc_id   UUID;
  v_party_id         UUID;
  v_payee_name       TEXT;
  v_notes            TEXT;
  v_status           TEXT;
  v_receipt_url      TEXT;
  v_operator_name    TEXT;
  v_device_node      TEXT;
  v_created_by       UUID;
  v_je_id            UUID := NULL;
  v_je_number        TEXT;
  v_narration        TEXT;
  v_expense_row      public.expenses%ROWTYPE;
BEGIN
  -- Extract and validate payload
  v_expense_date   := COALESCE((p_payload->>'expense_date')::DATE, CURRENT_DATE);
  v_category       := UPPER(TRIM(COALESCE(p_payload->>'category', 'MISCELLANEOUS')));
  v_description    := TRIM(COALESCE(p_payload->>'description', ''));
  v_amount         := (p_payload->>'amount')::NUMERIC;
  v_payment_method := UPPER(TRIM(COALESCE(p_payload->>'payment_method', 'CASH')));
  v_status         := UPPER(TRIM(COALESCE(p_payload->>'status', 'PAID')));
  v_payee_name     := TRIM(COALESCE(p_payload->>'payee_name', ''));
  v_notes          := TRIM(COALESCE(p_payload->>'notes', ''));
  v_receipt_url    := TRIM(COALESCE(p_payload->>'receipt_url', ''));
  v_operator_name  := TRIM(COALESCE(p_payload->>'operator_name', 'System Operator'));
  v_device_node    := TRIM(COALESCE(p_payload->>'device_node', 'NODE-01'));
  v_created_by     := auth.uid();

  IF v_description = '' THEN
    RAISE EXCEPTION 'Description is required.';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero.';
  END IF;

  IF v_category NOT IN ('RENT', 'ELECTRICITY', 'SALARIES', 'TRANSPORT', 'FUEL', 'MAINTENANCE', 'PACKAGING', 'MISCELLANEOUS') THEN
    RAISE EXCEPTION 'Invalid expense category: %', v_category;
  END IF;

  -- Resolve expense account
  IF p_payload ? 'expense_account_id' AND (p_payload->>'expense_account_id') IS NOT NULL THEN
    v_expense_acc_id := (p_payload->>'expense_account_id')::UUID;
  ELSE
    -- Auto-resolve canonical expense account from category
    SELECT id INTO v_expense_acc_id FROM public.accounts_chart
    WHERE account_type = 'EXPENSE' AND (
      (v_category = 'RENT' AND account_code IN ('5004', '6100')) OR
      (v_category = 'ELECTRICITY' AND account_code IN ('5003', '6200')) OR
      (v_category = 'SALARIES' AND account_code IN ('5002', '6000')) OR
      (v_category = 'TRANSPORT' AND account_code IN ('5005')) OR
      (v_category = 'FUEL' AND account_code IN ('5007', '6250')) OR
      (v_category = 'PACKAGING' AND account_code IN ('6300')) OR
      (v_category = 'MAINTENANCE' AND account_code IN ('6400')) OR
      (v_category = 'MISCELLANEOUS' AND account_code IN ('6500', '5010'))
    ) LIMIT 1;

    -- Fallback to any expense account
    IF v_expense_acc_id IS NULL THEN
      SELECT id INTO v_expense_acc_id FROM public.accounts_chart WHERE account_type = 'EXPENSE' LIMIT 1;
    END IF;
  END IF;

  IF v_expense_acc_id IS NULL THEN
    RAISE EXCEPTION 'Expense account could not be resolved from Chart of Accounts.';
  END IF;

  -- Optional party linkage
  IF p_payload ? 'party_id' AND (p_payload->>'party_id') IS NOT NULL THEN
    v_party_id := (p_payload->>'party_id')::UUID;
  ELSIF v_payee_name <> '' THEN
    SELECT id INTO v_party_id FROM public.parties
    WHERE LOWER(TRIM(name)) = LOWER(v_payee_name) LIMIT 1;
  END IF;

  -- Generate sequential expense number: EXP-YYYY-XXXXX
  v_expense_no := 'EXP-' || to_char(v_expense_date, 'YYYY') || '-' ||
                  lpad(nextval('public.expense_number_seq')::TEXT, 5, '0');

  -- Handle Ledger Postings based on status
  IF v_status = 'PAID' THEN
    -- Resolve Cash or Bank account
    IF p_payload ? 'payment_account_id' AND (p_payload->>'payment_account_id') IS NOT NULL THEN
      v_payment_acc_id := (p_payload->>'payment_account_id')::UUID;
    ELSE
      -- Default Cash in Hand (1000) or Bank (1002) based on payment_method
      IF v_payment_method = 'BANK' THEN
        SELECT id INTO v_payment_acc_id FROM public.accounts_chart
        WHERE account_code = '1002' OR (is_liquid_funds = true AND LOWER(account_name) LIKE '%bank%') LIMIT 1;
      ELSE
        SELECT id INTO v_payment_acc_id FROM public.accounts_chart
        WHERE is_default_cash = true OR account_code = '1000' OR is_liquid_funds = true LIMIT 1;
      END IF;
    END IF;

    IF v_payment_acc_id IS NULL THEN
      RAISE EXCEPTION 'Liquid payment account (Cash/Bank) could not be resolved.';
    END IF;

    -- Generate Journal Entry: Dr Expense, Cr Cash/Bank
    v_je_number := 'JE-' || to_char(v_expense_date, 'YYYYMMDD') || '-' || lpad((RANDOM() * 999999)::INT::TEXT, 6, '0');
    v_narration := 'Expense ' || v_expense_no || ' [' || v_category || '] — ' || COALESCE(NULLIF(v_payee_name, ''), v_description);

    INSERT INTO public.journal_entries (entry_number, entry_date, narration, is_balanced, status, customer_name)
    VALUES (v_je_number, v_expense_date, v_narration, true, 'POSTED', NULLIF(v_payee_name, ''))
    RETURNING id INTO v_je_id;

    -- Line 1: Debit Expense
    INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_expense_acc_id, v_party_id, v_amount, 0.00);

    -- Line 2: Credit Cash/Bank
    INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_payment_acc_id, v_party_id, 0.00, v_amount);

  ELSIF v_status = 'UNPAID' THEN
    -- Resolve Accounts Payable account (2001)
    IF p_payload ? 'payable_account_id' AND (p_payload->>'payable_account_id') IS NOT NULL THEN
      v_payable_acc_id := (p_payload->>'payable_account_id')::UUID;
    ELSE
      SELECT id INTO v_payable_acc_id FROM public.accounts_chart
      WHERE account_code = '2001' OR (account_type = 'LIABILITY' AND LOWER(account_name) LIKE '%payable%') LIMIT 1;
    END IF;

    IF v_payable_acc_id IS NULL THEN
      RAISE EXCEPTION 'Payable liability account could not be resolved.';
    END IF;

    -- Generate Journal Entry: Dr Expense, Cr Payable
    v_je_number := 'JE-' || to_char(v_expense_date, 'YYYYMMDD') || '-' || lpad((RANDOM() * 999999)::INT::TEXT, 6, '0');
    v_narration := 'Accrued Expense ' || v_expense_no || ' [' || v_category || '] — ' || COALESCE(NULLIF(v_payee_name, ''), v_description);

    INSERT INTO public.journal_entries (entry_number, entry_date, narration, is_balanced, status, customer_name)
    VALUES (v_je_number, v_expense_date, v_narration, true, 'POSTED', NULLIF(v_payee_name, ''))
    RETURNING id INTO v_je_id;

    -- Line 1: Debit Expense
    INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_expense_acc_id, v_party_id, v_amount, 0.00);

    -- Line 2: Credit Payable
    INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
    VALUES (v_je_id, v_payable_acc_id, v_party_id, 0.00, v_amount);

  ELSE
    -- DRAFT status: no journal entries posted, ledger remains unaffected
    v_je_id := NULL;
  END IF;

  -- Insert Expense row
  INSERT INTO public.expenses (
    expense_number, expense_date, category, description, amount, payment_method,
    expense_account_id, payment_account_id, payable_account_id, party_id,
    payee_name, notes, status, receipt_url, journal_entry_id,
    operator_name, device_node, created_by
  )
  VALUES (
    v_expense_no, v_expense_date, v_category, v_description, v_amount, v_payment_method,
    v_expense_acc_id, v_payment_acc_id, v_payable_acc_id, v_party_id,
    NULLIF(v_payee_name, ''), NULLIF(v_notes, ''), v_status, NULLIF(v_receipt_url, ''), v_je_id,
    v_operator_name, v_device_node, v_created_by
  )
  RETURNING * INTO v_expense_row;

  -- Write audit log entry
  BEGIN
    INSERT INTO public.system_audit_logs (
      operator_name, action_type, module, details
    )
    VALUES (
      v_operator_name,
      'EXPENSE_' || v_status,
      'EXPENSES',
      jsonb_build_object(
        'expense_number', v_expense_no,
        'category', v_category,
        'amount', v_amount,
        'status', v_status,
        'payment_method', v_payment_method,
        'journal_entry_id', v_je_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort audit logging
    NULL;
  END;

  RETURN to_jsonb(v_expense_row);
END;
$$;

-- ── 6. RPC: pay_unpaid_expense ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pay_unpaid_expense(
  p_expense_id UUID,
  p_payment_account_id UUID,
  p_payment_method TEXT DEFAULT 'CASH',
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_operator_name TEXT DEFAULT 'System Operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exp            public.expenses%ROWTYPE;
  v_je_id          UUID;
  v_je_number      TEXT;
  v_narration      TEXT;
  v_payment_acc_id UUID := p_payment_account_id;
  v_payable_acc_id UUID;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense record % not found.', p_expense_id;
  END IF;

  IF v_exp.status <> 'UNPAID' THEN
    RAISE EXCEPTION 'Only UNPAID expenses can be marked paid. Current status: %', v_exp.status;
  END IF;

  -- Resolve payment account (Cash/Bank)
  IF v_payment_acc_id IS NULL THEN
    IF UPPER(p_payment_method) = 'BANK' THEN
      SELECT id INTO v_payment_acc_id FROM public.accounts_chart
      WHERE account_code = '1002' OR (is_liquid_funds = true AND LOWER(account_name) LIKE '%bank%') LIMIT 1;
    ELSE
      SELECT id INTO v_payment_acc_id FROM public.accounts_chart
      WHERE is_default_cash = true OR account_code = '1000' OR is_liquid_funds = true LIMIT 1;
    END IF;
  END IF;

  IF v_payment_acc_id IS NULL THEN
    RAISE EXCEPTION 'Cash/Bank payment account could not be resolved.';
  END IF;

  -- Resolve payable account (from expense or default AP 2001)
  v_payable_acc_id := v_exp.payable_account_id;
  IF v_payable_acc_id IS NULL THEN
    SELECT id INTO v_payable_acc_id FROM public.accounts_chart
    WHERE account_code = '2001' OR (account_type = 'LIABILITY' AND LOWER(account_name) LIKE '%payable%') LIMIT 1;
  END IF;

  -- Post balanced payment journal entry: Dr Payable, Cr Cash/Bank
  v_je_number := 'JE-' || to_char(p_payment_date, 'YYYYMMDD') || '-' || lpad((RANDOM() * 999999)::INT::TEXT, 6, '0');
  v_narration := 'Settlement for Expense ' || v_exp.expense_number || ' — ' || COALESCE(v_exp.payee_name, v_exp.description);

  INSERT INTO public.journal_entries (entry_number, entry_date, narration, is_balanced, status, customer_name)
  VALUES (v_je_number, p_payment_date, v_narration, true, 'POSTED', v_exp.payee_name)
  RETURNING id INTO v_je_id;

  -- Line 1: Debit Payable
  INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, v_payable_acc_id, v_exp.party_id, v_exp.amount, 0.00);

  -- Line 2: Credit Cash/Bank
  INSERT INTO public.journal_lines (journal_entry_id, account_id, party_id, debit_pkr, credit_pkr)
  VALUES (v_je_id, v_payment_acc_id, v_exp.party_id, 0.00, v_exp.amount);

  -- Update expense
  UPDATE public.expenses
  SET
    status = 'PAID',
    payment_account_id = v_payment_acc_id,
    payment_method = UPPER(p_payment_method),
    payment_journal_entry_id = v_je_id,
    updated_at = NOW()
  WHERE id = p_expense_id
  RETURNING * INTO v_exp;

  -- Audit log
  BEGIN
    INSERT INTO public.system_audit_logs (operator_name, action_type, module, details)
    VALUES (
      p_operator_name,
      'EXPENSE_SETTLED_PAID',
      'EXPENSES',
      jsonb_build_object(
        'expense_number', v_exp.expense_number,
        'amount', v_exp.amount,
        'payment_account_id', v_payment_acc_id,
        'payment_journal_entry_id', v_je_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(v_exp);
END;
$$;

-- ── 7. RPC: cancel_expense ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_expense(
  p_expense_id UUID,
  p_operator_name TEXT DEFAULT 'System Operator',
  p_reason TEXT DEFAULT 'Cancelled by operator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exp   public.expenses%ROWTYPE;
  v_je1   UUID;
  v_je2   UUID;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense record % not found.', p_expense_id;
  END IF;

  IF v_exp.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Expense % is already cancelled.', v_exp.expense_number;
  END IF;

  v_je1 := v_exp.journal_entry_id;
  v_je2 := v_exp.payment_journal_entry_id;

  -- Delete associated journal entries (lines cascade delete via FK),
  -- restoring posted balances completely!
  IF v_je1 IS NOT NULL THEN
    DELETE FROM public.journal_lines WHERE journal_entry_id = v_je1;
    DELETE FROM public.journal_entries WHERE id = v_je1;
  END IF;

  IF v_je2 IS NOT NULL THEN
    DELETE FROM public.journal_lines WHERE journal_entry_id = v_je2;
    DELETE FROM public.journal_entries WHERE id = v_je2;
  END IF;

  UPDATE public.expenses
  SET
    status = 'CANCELLED',
    journal_entry_id = NULL,
    payment_journal_entry_id = NULL,
    notes = TRIM(COALESCE(notes, '') || ' [Cancelled: ' || p_reason || ']'),
    updated_at = NOW()
  WHERE id = p_expense_id
  RETURNING * INTO v_exp;

  -- Audit log
  BEGIN
    INSERT INTO public.system_audit_logs (operator_name, action_type, module, details)
    VALUES (
      p_operator_name,
      'EXPENSE_CANCELLED',
      'EXPENSES',
      jsonb_build_object(
        'expense_number', v_exp.expense_number,
        'amount', v_exp.amount,
        'reason', p_reason
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(v_exp);
END;
$$;
