-- ============================================================================
-- Migration: 20261126010000_resync_invoice_journal.sql
-- Function: resync_invoice_journal(p_invoice_id uuid)
-- Re-syncs the journal entry (journal_entries + journal_lines) from the
-- current sales_invoices row after an edit, keeping the ledger and invoice in
-- sync without altering original dates (entry_date and created_at stay untouched).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resync_invoice_journal(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_entry RECORD;
  v_customer_name text;
  v_old_total numeric := 0;
  v_new_total numeric := 0;
  v_acct_ar uuid;
  v_acct_rev uuid;
  v_acct_tax uuid;
  v_acct_ftax uuid;
  v_has_party_col boolean := false;
  v_has_je_cust_name boolean := false;
  v_has_je_cust_id boolean := false;
BEGIN
  -- 1. Lock the invoice row
  SELECT *
    INTO v_invoice
    FROM sales_invoices
   WHERE id = p_invoice_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- 2. Find its journal entry: status='POSTED' and narration LIKE 'Sales invoice <invoice_number> posted%'
  SELECT *
    INTO v_entry
    FROM journal_entries
   WHERE status = 'POSTED'
     AND narration LIKE 'Sales invoice ' || v_invoice.invoice_number || ' posted%'
   LIMIT 1
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('synced', false, 'reason', 'no_journal_entry');
  END IF;

  -- Compute old total from existing lines debit to AR (or sum of lines debit)
  SELECT COALESCE(SUM(debit_pkr), 0)
    INTO v_old_total
    FROM journal_lines
   WHERE journal_entry_id = v_entry.id;

  -- Resolve Customer Name
  SELECT name
    INTO v_customer_name
    FROM parties
   WHERE id = v_invoice.customer_id;

  IF v_customer_name IS NULL OR v_customer_name = '' THEN
    v_customer_name := 'Customer';
  END IF;

  -- Resolve core accounts
  SELECT id INTO v_acct_ar   FROM accounts_chart WHERE account_code = '1100' LIMIT 1;
  SELECT id INTO v_acct_rev  FROM accounts_chart WHERE account_code = '4001' LIMIT 1;
  IF v_acct_rev IS NULL THEN
    SELECT id INTO v_acct_rev FROM accounts_chart WHERE account_code = '5100' LIMIT 1;
  END IF;
  SELECT id INTO v_acct_tax  FROM accounts_chart WHERE account_code = '2200' LIMIT 1;
  SELECT id INTO v_acct_ftax FROM accounts_chart WHERE account_code = '2210' LIMIT 1;

  IF v_acct_ar IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: account 1100 (Accounts Receivable) not found';
  END IF;
  IF v_acct_rev IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: account 4001 (Sales Revenue) not found';
  END IF;
  IF (v_invoice.sales_tax_amount_pkr > 0) AND v_acct_tax IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: account 2200 (Sales Tax Collected) not found';
  END IF;
  IF (v_invoice.further_tax_amount_pkr > 0) AND v_acct_ftax IS NULL THEN
    RAISE EXCEPTION 'Chart of accounts missing: account 2210 (Further Tax Payable) not found';
  END IF;

  v_new_total := COALESCE(v_invoice.taxable_value_pkr, 0)
               + COALESCE(v_invoice.sales_tax_amount_pkr, 0)
               + COALESCE(v_invoice.further_tax_amount_pkr, 0);

  -- 3. Delete existing lines
  DELETE FROM journal_lines
   WHERE journal_entry_id = v_entry.id;

  -- Check if journal_lines has party_id column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'journal_lines'
      AND column_name = 'party_id'
  ) INTO v_has_party_col;

  -- Insert fresh lines
  IF v_has_party_col THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr, party_id)
    VALUES
      (v_entry.id, v_acct_ar,  v_new_total, 0, v_invoice.customer_id),
      (v_entry.id, v_acct_rev, 0, v_invoice.taxable_value_pkr, v_invoice.customer_id);

    IF v_invoice.sales_tax_amount_pkr > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr, party_id)
      VALUES (v_entry.id, v_acct_tax, 0, v_invoice.sales_tax_amount_pkr, v_invoice.customer_id);
    END IF;

    IF v_invoice.further_tax_amount_pkr > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr, party_id)
      VALUES (v_entry.id, v_acct_ftax, 0, v_invoice.further_tax_amount_pkr, v_invoice.customer_id);
    END IF;
  ELSE
    INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
    VALUES
      (v_entry.id, v_acct_ar,  v_new_total, 0),
      (v_entry.id, v_acct_rev, 0, v_invoice.taxable_value_pkr);

    IF v_invoice.sales_tax_amount_pkr > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
      VALUES (v_entry.id, v_acct_tax, 0, v_invoice.sales_tax_amount_pkr);
    END IF;

    IF v_invoice.further_tax_amount_pkr > 0 THEN
      INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
      VALUES (v_entry.id, v_acct_ftax, 0, v_invoice.further_tax_amount_pkr);
    END IF;
  END IF;

  -- 4. Update the entry narration and optional customer fields
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'journal_entries'
      AND column_name = 'customer_name'
  ) INTO v_has_je_cust_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'journal_entries'
      AND column_name = 'customer_id'
  ) INTO v_has_je_cust_id;

  IF v_has_je_cust_name AND v_has_je_cust_id THEN
    UPDATE journal_entries
       SET narration     = 'Sales invoice ' || v_invoice.invoice_number || ' posted — ' || v_customer_name,
           customer_name = v_customer_name,
           customer_id   = v_invoice.customer_id,
           is_balanced   = true
     WHERE id = v_entry.id;
  ELSIF v_has_je_cust_name THEN
    UPDATE journal_entries
       SET narration     = 'Sales invoice ' || v_invoice.invoice_number || ' posted — ' || v_customer_name,
           customer_name = v_customer_name,
           is_balanced   = true
     WHERE id = v_entry.id;
  ELSIF v_has_je_cust_id THEN
    UPDATE journal_entries
       SET narration     = 'Sales invoice ' || v_invoice.invoice_number || ' posted — ' || v_customer_name,
           customer_id   = v_invoice.customer_id,
           is_balanced   = true
     WHERE id = v_entry.id;
  ELSE
    UPDATE journal_entries
       SET narration     = 'Sales invoice ' || v_invoice.invoice_number || ' posted — ' || v_customer_name,
           is_balanced   = true
     WHERE id = v_entry.id;
  END IF;

  -- 5. Insert system audit log
  INSERT INTO system_audit_logs (
    node_id,
    operator_name,
    action_type,
    details
  ) VALUES (
    'PC-01',
    'Terminal Operator',
    'INVOICE_LEDGER_RESYNCED',
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'invoice_number', v_invoice.invoice_number,
      'journal_entry_id', v_entry.id,
      'old_total', v_old_total,
      'new_total', v_new_total
    )
  );

  RETURN jsonb_build_object(
    'synced', true,
    'entry_id', v_entry.id,
    'old_total', v_old_total,
    'new_total', v_new_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resync_invoice_journal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resync_invoice_journal(uuid)
  TO anon, authenticated, service_role;

