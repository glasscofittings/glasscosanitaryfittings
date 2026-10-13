-- Step 3: Seed users one at a time
-- Run each INSERT block separately if needed

-- Owner
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(), 'authenticated', 'authenticated',
  'owner@glasscosanitary.com', crypt('Owner@2026!', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"OWNER","device_name":"Owner Remote"}'::jsonb
);

-- Node 1
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(), 'authenticated', 'authenticated',
  'pos1@glasscosanitary.com', crypt('node1-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Counter Node 1"}'::jsonb
);

-- Node 2
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(), 'authenticated', 'authenticated',
  'pos2@glasscosanitary.com', crypt('node2-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Counter Node 2"}'::jsonb
);

-- Node 3
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(), 'authenticated', 'authenticated',
  'warehouse@glasscosanitary.com', crypt('node3-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Warehouse Tablet"}'::jsonb
);

-- Node 4
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(), 'authenticated', 'authenticated',
  'office@glasscosanitary.com', crypt('node4-pass', gen_salt('bf')),
  now(), now(), now(),
  '{"role":"TERMINAL","device_name":"Office Laptop"}'::jsonb
);
