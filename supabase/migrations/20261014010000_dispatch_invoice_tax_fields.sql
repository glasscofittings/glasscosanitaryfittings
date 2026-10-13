-- ============================================================================
-- INVOICES — tax breakdown columns for dispatch-generated invoices
-- Adds the three tax components (sales, further, additional) so dispatches
-- created from the Inventory "Dispatch Product" modal persist their tax split.
-- ============================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS taxable_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS further_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS further_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0;
