-- Clean reset: delete all glassco users and recreate with proper auth
-- Run in Supabase SQL Editor

-- 1. Drop trigger first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Delete all glassco users and their profiles
DELETE FROM public.profiles WHERE email LIKE '%@glasscosanitary.com';
DELETE FROM auth.users WHERE email LIKE '%@glasscosanitary.com';

-- 3. Create users using Supabase's built-in auth schema
-- This ensures passwords are hashed correctly

-- Owner
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
  is_super_admin, confirmation_sent_at, last_sign_in_at
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'owner@glasscosanitary.com',
  encode(extensions.digest('Owner@2026!', 'bf'), 'hex'),
  now(), '', '',
  now(), now(),
  '{"role":"OWNER","device_name":"Owner Remote"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb,
  false, now(), now()
);

-- Node 1
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
  is_super_admin, confirmation_sent_at, last_sign_in_at
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'pos1@glasscosanitary.com',
  encode(extensions.digest('node1-pass', 'bf'), 'hex'),
  now(), '', '',
  now(), now(),
  '{"role":"TERMINAL","device_name":"Counter Node 1"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb,
  false, now(), now()
);

-- Node 2
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
  is_super_admin, confirmation_sent_at, last_sign_in_at
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'pos2@glasscosanitary.com',
  encode(extensions.digest('node2-pass', 'bf'), 'hex'),
  now(), '', '',
  now(), now(),
  '{"role":"TERMINAL","device_name":"Counter Node 2"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb,
  false, now(), now()
);

-- Node 3
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
  is_super_admin, confirmation_sent_at, last_sign_in_at
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'warehouse@glasscosanitary.com',
  encode(extensions.digest('node3-pass', 'bf'), 'hex'),
  now(), '', '',
  now(), now(),
  '{"role":"TERMINAL","device_name":"Warehouse Tablet"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb,
  false, now(), now()
);

-- Node 4
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
  is_super_admin, confirmation_sent_at, last_sign_in_at
) VALUES (
  (SELECT id FROM auth.instances LIMIT 1),
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'office@glasscosanitary.com',
  encode(extensions.digest('node4-pass', 'bf'), 'hex'),
  now(), '', '',
  now(), now(),
  '{"role":"TERMINAL","device_name":"Office Laptop"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb,
  false, now(), now()
);

-- 4. Backfill profiles
INSERT INTO public.profiles (id, email, role, device_name)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'role', 'TERMINAL')::user_role,
  au.raw_user_meta_data->>'device_name'
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
  AND au.email LIKE '%@glasscosanitary.com';

-- 5. Recreate trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, device_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'TERMINAL')::user_role,
    NEW.raw_user_meta_data->>'device_name'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 6. Normalize the columns Supabase Auth scans on sign-in.
--    The INSERTs above leave email_change / email_change_token_new /
--    email_change_token_current NULL, which makes every login fail with
--    500 "Database error querying schema". They must be '' (empty string).
--    Seeded users also need an auth.identities row for the email provider.
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current', 'phone_change'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = col
    ) THEN
      EXECUTE format('UPDATE auth.users SET %I = '''' WHERE %I IS NULL', col, col);
    END IF;
  END LOOP;

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  SELECT gen_random_uuid(), u.id, u.id::text,
    jsonb_build_object('sub', u.id::text, 'email', u.email,
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  FROM auth.users u
  WHERE u.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM auth.identities i
      WHERE i.user_id = u.id AND i.provider = 'email'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'identities'
        AND column_name = 'provider_id'
    )
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auth normalization skipped: %', SQLERRM;
END $$;
