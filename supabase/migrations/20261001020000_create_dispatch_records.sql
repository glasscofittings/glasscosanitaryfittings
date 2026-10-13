-- ============================================================================
-- DISPATCH_RECORDS — full dispatch history persistence
-- Stores every posted invoice as a dispatch event with line items snapshot
-- ============================================================================

CREATE TABLE IF NOT EXISTS dispatch_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL DEFAULT '',
  taxable_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  sales_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18,
  sales_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  further_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  further_tax_amount_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_invoice_value_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  operator_name TEXT NOT NULL DEFAULT '',
  device_node TEXT NOT NULL DEFAULT '',
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_records_invoice ON dispatch_records(invoice_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_records_customer ON dispatch_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_records_posted_at ON dispatch_records(posted_at DESC);

-- RLS
ALTER TABLE dispatch_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "erp_full_access" ON dispatch_records;
CREATE POLICY "erp_full_access" ON dispatch_records FOR ALL USING (true) WITH CHECK (true);
