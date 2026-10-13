-- 1. Ensure inward_gate_passes table supports full schema columns & fallback types
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS igp_code TEXT;
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS unit_of_measure TEXT DEFAULT 'KG';
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS vendor_lot_code TEXT;
ALTER TABLE inward_gate_passes ADD COLUMN IF NOT EXISTS inward_qty NUMERIC(12, 3) DEFAULT 0.000;

-- Alter legacy columns to allow NULL or default values so NOT NULL constraints pass
ALTER TABLE inward_gate_passes ALTER COLUMN vendor_lot_number DROP NOT NULL;
ALTER TABLE inward_gate_passes ALTER COLUMN gross_weight_kg DROP NOT NULL;
ALTER TABLE inward_gate_passes ALTER COLUMN gross_weight_kg SET DEFAULT 0.000;
ALTER TABLE inward_gate_passes ALTER COLUMN net_weight_kg DROP NOT NULL;
ALTER TABLE inward_gate_passes ALTER COLUMN net_weight_kg SET DEFAULT 0.000;

-- Backfill legacy column names if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'inward_gate_passes' AND column_name = 'vendor_lot_number'
    ) THEN
        UPDATE inward_gate_passes 
        SET vendor_lot_code = vendor_lot_number 
        WHERE vendor_lot_code IS NULL;

        UPDATE inward_gate_passes 
        SET vendor_lot_number = vendor_lot_code 
        WHERE vendor_lot_number IS NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'inward_gate_passes' AND column_name = 'gross_weight_kg'
    ) THEN
        UPDATE inward_gate_passes 
        SET inward_qty = gross_weight_kg 
        WHERE inward_qty = 0.000;
    END IF;
END $$;

-- 2. Row Level Security (RLS) Policies on inward_gate_passes & parties
ALTER TABLE inward_gate_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;

-- Allow anon / authenticated read access on inward_gate_passes & parties
DROP POLICY IF EXISTS "Allow select for all on inward_gate_passes" ON inward_gate_passes;
CREATE POLICY "Allow select for all on inward_gate_passes" 
ON inward_gate_passes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert for all on inward_gate_passes" ON inward_gate_passes;
CREATE POLICY "Allow insert for all on inward_gate_passes" 
ON inward_gate_passes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update for all on inward_gate_passes" ON inward_gate_passes;
CREATE POLICY "Allow update for all on inward_gate_passes" 
ON inward_gate_passes FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow select for all on parties" ON parties;
CREATE POLICY "Allow select for all on parties" 
ON parties FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert for all on parties" ON parties;
CREATE POLICY "Allow insert for all on parties" 
ON parties FOR INSERT WITH CHECK (true);
