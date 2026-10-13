-- ============================================================================
-- Migration: 20261010030000_allow_unbalanced_drafts.sql
-- Allow DRAFT journal entries to store one-sided (e.g. debit-only) lines.
-- POSTED entries still require SUM(debit) = SUM(credit).
--
-- 1. fn_enforce_journal_balance — only raise when parent status = 'POSTED'
-- 2. fn_enforce_posted_balance  — BEFORE UPDATE status→POSTED, verify lines
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Balance check on journal_lines: DRAFT skipped, POSTED enforced
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_enforce_journal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry_ids UUID[] := '{}';
  v_entry_id  UUID;
  v_entry_no  TEXT;
  v_status    TEXT;
  v_debits    NUMERIC;
  v_credits   NUMERIC;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_entry_ids := v_entry_ids || NEW.journal_entry_id;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    v_entry_ids := v_entry_ids || OLD.journal_entry_id;
  END IF;

  FOREACH v_entry_id IN ARRAY v_entry_ids LOOP
    CONTINUE WHEN v_entry_id IS NULL;

    SELECT je.entry_number, je.status
      INTO v_entry_no, v_status
    FROM journal_entries je
    WHERE je.id = v_entry_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Unbalanced drafts are allowed (e.g. debit-only work-in-progress).
    CONTINUE WHEN v_status IS DISTINCT FROM 'POSTED';

    SELECT COALESCE(SUM(jl.debit_pkr), 0),
           COALESCE(SUM(jl.credit_pkr), 0)
      INTO v_debits, v_credits
    FROM journal_lines jl
    WHERE jl.journal_entry_id = v_entry_id;

    IF v_debits IS DISTINCT FROM v_credits THEN
      RAISE EXCEPTION
        'Double-entry balance check failed for journal entry %: debits % <> credits %',
        v_entry_no, v_debits, v_credits;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journal_balance ON public.journal_lines;

CREATE CONSTRAINT TRIGGER trg_enforce_journal_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enforce_journal_balance();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Block status → POSTED unless lines already balance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_enforce_posted_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_debits  NUMERIC;
  v_credits NUMERIC;
BEGIN
  IF NEW.status = 'POSTED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'POSTED')
  THEN
    SELECT COALESCE(SUM(jl.debit_pkr), 0),
           COALESCE(SUM(jl.credit_pkr), 0)
      INTO v_debits, v_credits
    FROM journal_lines jl
    WHERE jl.journal_entry_id = NEW.id;

    IF v_debits IS DISTINCT FROM v_credits THEN
      RAISE EXCEPTION
        'Cannot post unbalanced journal entry %: debits % <> credits %. Balance the entry first.',
        NEW.entry_number, v_debits, v_credits;
    END IF;

    NEW.is_balanced := (v_debits = v_credits);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_posted_balance ON public.journal_entries;

CREATE TRIGGER trg_enforce_posted_balance
  BEFORE INSERT OR UPDATE OF status ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enforce_posted_balance();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Acceptance tests (run manually in SQL Editor)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- TEST A — debit-only DRAFT must succeed:
--
--   BEGIN;
--   INSERT INTO journal_entries (entry_number, entry_date, narration, status)
--   VALUES ('JE-TEST-DRAFT-1', CURRENT_DATE, 'debit-only draft', 'DRAFT');
--   INSERT INTO journal_lines (journal_entry_id, account_id, debit_pkr, credit_pkr)
--   SELECT id, (SELECT id FROM accounts_chart ORDER BY account_code LIMIT 1), 5000, 0
--   FROM journal_entries WHERE entry_number = 'JE-TEST-DRAFT-1';
--   COMMIT;
--   -- EXPECT: success
--
-- TEST B — posting that draft must fail:
--
--   UPDATE journal_entries SET status = 'POSTED'
--   WHERE entry_number = 'JE-TEST-DRAFT-1';
--   -- EXPECT: ERROR Cannot post unbalanced journal entry ...
--
-- TEST C — balanced POSTED still works (existing T1 tests).
--
-- Cleanup:
--   DELETE FROM journal_entries WHERE entry_number = 'JE-TEST-DRAFT-1';
