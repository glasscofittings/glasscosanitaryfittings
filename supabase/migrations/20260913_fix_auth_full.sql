-- ============================================================================
-- Diagnostic & Fix: Auth schema error
-- Date: 2026-09-13
-- Description: Drops trigger, fixes seed data, and repairs auth schema.
--              Run this SINGLE file in Supabase SQL Editor.
-- ============================================================================

-- 1. Drop trigger and function completely (temporarily)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Delete broken seed data (wrong instance_id)
DELETE FROM auth.users WHERE email LIKE '%@glasscosanitary.com';

-- 3. Get the correct instance_id from this Supabase project
-- and seed users with it
DO $$
DECLARE
  correct_instance_id UUID;
BEGIN
  SELECT instance_id INTO correct_instance_id FROM auth.users LIMIT 1;

  -- If no users exist, try instances table
  IF correct_instance_id IS NULL THEN
    SELECT id INTO correct_instance_id FROM auth.instances LIMIT 1;
  END IF;

  -- Fallback: use the Supabase default
  IF correct_instance_id IS NULL THEN
    correct_instance_id := '00000000-0000-0000-0000-000000000000';
  END IF;

  -- Seed Owner
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data
  ) VALUES (
    correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
    'owner@glasscosanitary.com', crypt('Owner@2026!', gen_salt('bf')),
    now(), now(), now(),
    '{"role":"OWNER","device_name":"Owner Remote"}'::jsonb
  );

  -- Seed Node 1
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data
  ) VALUES (
    correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
    'pos1@glasscosanitary.com', crypt('node1-pass', gen_salt('bf')),
    now(), now(), now(),
    '{"role":"TERMINAL","device_name":"Counter Node 1"}'::jsonb
  );

  -- Seed Node 2
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data
  ) VALUES (
    correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
    'pos2@glasscosanitary.com', crypt('node2-pass', gen_salt('bf')),
    now(), now(), now(),
    '{"role":"TERMINAL","device_name":"Counter Node 2"}'::jsonb
  );

  -- Seed Node 3
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data
  ) VALUES (
    correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
    'warehouse@glasscosanitary.com', crypt('node3-pass', gen_salt('bf')),
    now(), now(), now(),
    '{"role":"TERMINAL","device_name":"Warehouse Tablet"}'::jsonb
  );

  -- Seed Node 4
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data
  ) VALUES (
    correct_instance_id, gen_random_uuid(), 'authenticated', 'authenticated',
    'office@glasscosanitary.com', crypt('node4-pass', gen_salt('bf')),
    now(), now(), now(),
    '{"role":"TERMINAL","device_name":"Office Laptop"}'::jsonb
  );

  RAISE NOTICE 'Seeded 5 users with instance_id: %', correct_instance_id;
END $$;

-- 4. Backfill profiles for seeded users
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

-- 5. Recreate trigger (with safe error handling, AFTER everything else)
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
