-- ── 20261019 Sales invoice header discount ─────────────────────────────────
-- Adds an invoice-level discount that is applied to the gross line-item total
-- BEFORE tax. taxable_value_pkr keeps storing the net (discounted) value, so
-- every existing calculation (taxes, ledger posting, reports) stays correct;
-- these columns keep the applied discount visible for printouts and audit.
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pkr     NUMERIC(15, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_invoices.discount_percent IS 'Invoice-level discount percentage applied to the gross line-item total (e.g. 5 = 5%).';
COMMENT ON COLUMN sales_invoices.discount_pkr IS 'Invoice-level discount amount in PKR. taxable_value_pkr = gross line total minus discount_pkr.';
