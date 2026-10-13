-- Create device_accounts table for multi-device authentication
CREATE TABLE IF NOT EXISTS device_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_name TEXT NOT NULL,
    assigned_email TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL CHECK (LENGTH(pin_hash) = 64 AND pin_hash ~ '^[a-f0-9]+$'),
    role TEXT NOT NULL CHECK (role IN ('OPERATOR', 'LAB_TECH')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_device_accounts_email ON device_accounts(assigned_email);
-- Index for device name lookup
CREATE INDEX IF NOT EXISTS idx_device_accounts_device_name ON device_accounts(device_name);
-- Index for active status
CREATE INDEX IF NOT EXISTS idx_device_accounts_active ON device_accounts(is_active);

-- Insert 4 authorized devices for Glassco Paints ERP
-- Each device has unique email, PIN, and role assignment
INSERT INTO device_accounts (device_name, assigned_email, pin_hash, role, is_active) VALUES
('Factory PC 1', 'pc1@glassco.com', encode(digest('1122', 'sha256'), 'hex'), 'OPERATOR', true),
('Factory PC 2', 'pc2@glassco.com', encode(digest('3344', 'sha256'), 'hex'), 'OPERATOR', true),
('Lab Laptop 1', 'laptop1@glassco.com', encode(digest('1234', 'sha256'), 'hex'), 'LAB_TECH', true),
('Lab Laptop 2', 'laptop2@glassco.com', encode(digest('5678', 'sha256'), 'hex'), 'LAB_TECH', true)
ON CONFLICT (assigned_email) DO NOTHING;

-- Create RPC: verify_device_pin
-- Returns device account details if PIN matches, enabling session creation
CREATE OR REPLACE FUNCTION verify_device_pin(p_device_id UUID, p_pin TEXT)
RETURNS TABLE (
    device_id UUID,
    device_name TEXT,
    assigned_email TEXT,
    role TEXT,
    pin_valid BOOLEAN
)
LANGUAGE plpgsql
STRICT
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id::UUID AS device_id,
        device_name,
        assigned_email,
        role,
        CASE WHEN pin_hash = encode(digest(p_pin, 'sha256'), 'hex') THEN true ELSE false END AS pin_valid
    FROM device_accounts
    WHERE id = p_device_id AND is_active = true;
END
$$;

-- Create RPC: verify_device_pin_by_email
-- Alternative: verify PIN using assigned_email instead of device_id
CREATE OR REPLACE FUNCTION verify_device_pin_by_email(p_email TEXT, p_pin TEXT)
RETURNS TABLE (
    device_id UUID,
    device_name TEXT,
    assigned_email TEXT,
    role TEXT,
    pin_valid BOOLEAN
)
LANGUAGE plpgsql
STRICT
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id::UUID AS device_id,
        device_name,
        assigned_email,
        role,
        CASE WHEN pin_hash = encode(digest(p_pin, 'sha256'), 'hex') THEN true ELSE false END AS pin_valid
    FROM device_accounts
    WHERE assigned_email = p_email AND is_active = true;
END
$$;