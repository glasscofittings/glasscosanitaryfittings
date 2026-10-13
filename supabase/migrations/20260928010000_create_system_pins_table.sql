-- Create system_pins table for hybrid authentication
CREATE TABLE IF NOT EXISTS system_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin TEXT NOT NULL UNIQUE CHECK (LENGTH(pin) = 4 AND pin ~ '^[0-9]+$'),
    staff_name TEXT NOT NULL DEFAULT 'STAFF',
    assigned_device TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for pin lookup (unique index now redundant but kept for clarity)
CREATE INDEX IF NOT EXISTS idx_system_pins_pin ON system_pins(pin);
CREATE INDEX IF NOT EXISTS idx_system_pins_active ON system_pins(is_active);

-- Insert default staff pins for 4 workshop/desktop devices
INSERT INTO system_pins (pin, staff_name, assigned_device, is_active) VALUES
('1111', 'Workshop Desk 1', 'DESK-01', true),
('2222', 'Workshop Desk 2', 'DESK-02', true),
('3333', 'Office Laptop', 'LAPTOP-01', true),
('4444', 'Main PC', 'PC-01', true)
ON CONFLICT DO NOTHING;

-- Create RPC: verify_staff_pin
-- Returns staff_name and assigned_device for a valid 4-digit PIN
CREATE OR REPLACE FUNCTION verify_staff_pin(p_pin TEXT)
RETURNS TABLE (
    staff_name TEXT,
    assigned_device TEXT,
    pin_valid BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        staff_name,
        assigned_device,
        true::BOOLEAN AS pin_valid
    FROM system_pins
    WHERE pin = p_pin 
      AND is_active = true;
END
$$;