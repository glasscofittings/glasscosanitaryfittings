-- Create staff_members table for hybrid authentication
-- Supports 4 workshop/desktop devices with unique emails and PINs, plus owner email
CREATE TABLE IF NOT EXISTS staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    pin TEXT NOT NULL CHECK (LENGTH(pin) = 4 AND pin ~ '^[0-9]+$'),
    assigned_device TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_staff_members_email ON staff_members(email);
-- Index for PIN lookup
CREATE INDEX IF NOT EXISTS idx_staff_members_pin ON staff_members(pin);
-- Index for active status
CREATE INDEX IF NOT EXISTS idx_staff_members_active ON staff_members(is_active);

-- Insert 4 staff accounts for 4 workshop/desktop devices
-- Each has unique email and PIN combination
INSERT INTO staff_members (email, pin, assigned_device, is_active) VALUES
('laptop1@glasscopaints.com', '1111', 'LAPTOP-01', true),
('laptop2@glasscopaints.com', '2222', 'LAPTOP-02', true),
('pc1@glasscopaints.com', '3333', 'PC-01', true),
('pc2@glasscopaints.com', '4444', 'PC-02', true)
ON CONFLICT (email) DO NOTHING;

-- Insert owner email for Google OAuth restriction
-- This is just a marker row; owner verification is done in middleware/login page
INSERT INTO staff_members (email, pin, assigned_device, is_active) VALUES
('owner@glasscopaints.com', '0000', 'OWNER-DESK', true)
ON CONFLICT (email) DO NOTHING;

-- Create RPC: verify_staff_pin
-- Returns staff member details for a valid email + PIN combination
CREATE OR REPLACE FUNCTION verify_staff_credentials(p_email TEXT, p_pin TEXT)
RETURNS TABLE (
    staff_id UUID,
    email TEXT,
    pin_valid BOOLEAN,
    assigned_device TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id::UUID AS staff_id,
        email,
        true::BOOLEAN AS pin_valid,
        assigned_device
    FROM staff_members
    WHERE email = p_email 
      AND pin = p_pin 
      AND is_active = true;
END
$$;

-- Create RPC: verify_owner_email
-- Checks if a given email matches the owner email
CREATE OR REPLACE FUNCTION verify_owner_email(p_email TEXT)
RETURNS TABLE (
    is_owner BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_email = 'owner@glasscopaints.com' THEN
        RETURN QUERY SELECT true::BOOLEAN AS is_owner;
    ELSE
        RETURN QUERY SELECT false::BOOLEAN AS is_owner;
    END IF;
END
$$;