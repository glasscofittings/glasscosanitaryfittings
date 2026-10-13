-- ============================================================================
-- Migration: 20261010040000_allow_single_sided_entries.sql
-- Remove double-entry balance enforcement so users can save AND post
-- debit-only or credit-only journal entries.
--
-- Drops:
--   - trg_enforce_journal_balance  (journal_lines deferred balance check)
--   - trg_enforce_posted_balance   (blocks status → POSTED when unbalanced)
--   - fn_enforce_journal_balance / fn_enforce_posted_balance
--
-- journal_entries.is_balanced remains as an informational flag only
-- (clients may still write true/false; nothing enforces it).
-- ============================================================================

DROP TRIGGER IF EXISTS trg_enforce_journal_balance ON public.journal_lines;
DROP TRIGGER IF EXISTS trg_enforce_posted_balance ON public.journal_entries;
DROP FUNCTION IF EXISTS public.fn_enforce_journal_balance();
DROP FUNCTION IF EXISTS public.fn_enforce_posted_balance();

-- Optional: leave is_balanced default true for backward-compatible reads.
-- No constraint on this column.
