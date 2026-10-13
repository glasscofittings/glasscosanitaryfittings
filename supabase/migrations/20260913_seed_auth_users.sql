-- ============================================================================
-- Seed: Create Auth Users
-- Date: 2026-09-13
-- Description: Seeds 5 auth users with bcrypt-hashed passwords.
--              Run AFTER 20260913_fix_auth_trigger.sql
-- ============================================================================

-- Owner Account
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'owner@glasscosanitary.com',
  crypt('Owner@2026!', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"OWNER","device_name":"Owner Remote"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'owner@glasscosanitary.com'
);

-- Node 1 — Main Counter
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'pos1@glasscosanitary.com',
  crypt('node1-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Counter Node 1"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'pos1@glasscosanitary.com'
);

-- Node 2 — Counter 2
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'pos2@glasscosanitary.com',
  crypt('node2-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Counter Node 2"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'pos2@glasscosanitary.com'
);

-- Node 3 — Warehouse
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'warehouse@glasscosanitary.com',
  crypt('node3-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Warehouse Tablet"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'warehouse@glasscosanitary.com'
);

-- Node 4 — Office
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'office@glasscosanitary.com',
  crypt('node4-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Office Laptop"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'office@glasscosanitary.com'
);
