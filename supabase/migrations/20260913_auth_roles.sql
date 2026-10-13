-- ============================================================================
-- Migration: Auth Roles & Device Profiles
-- Date: 2026-09-13
-- Description: Creates profiles table linked to auth.users, user_role enum,
--              RLS policies, and a helper function to auto-create profiles
--              on user signup.
--
-- SAFE TO RE-RUN: All statements use IF NOT EXISTS / OR REPLACE / IF EXISTS.
-- ============================================================================

-- 1. Create user_role enum (idempotent)
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('OWNER', 'TERMINAL');
  END IF;
END $$;

-- 2. Create profiles table (idempotent)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'TERMINAL',
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Unique index on email for fast lookups (idempotent)
-- ─────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- 4. RLS on profiles (idempotent)
-- ─────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own profile' AND tablename = 'profiles'
  ) THEN
    CREATE POLICY "Users can read own profile" ON public.profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile' AND tablename = 'profiles'
  ) THEN
    CREATE POLICY "Users can update own profile" ON public.profiles
      FOR UPDATE USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Service role can insert profiles' AND tablename = 'profiles'
  ) THEN
    CREATE POLICY "Service role can insert profiles" ON public.profiles
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- 5. Drop old trigger first (must drop trigger before function)
-- ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 6. Drop old function if it exists (clean slate)
-- ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 7. Create the trigger function (fresh, no conflicts)
-- ─────────────────────────────────────────────────────
CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, device_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::user_role,
      'TERMINAL'::user_role
    ),
    NEW.raw_user_meta_data->>'device_name'
  );
  RETURN NEW;
END;
$$;

-- 8. Create the trigger
-- ─────────────────────────────────────────────────────
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 9. Seed accounts via Supabase Auth Admin API (run after migration)
-- ─────────────────────────────────────────────────────
-- These must be created via the Supabase Auth Admin API or dashboard.
-- The SQL below uses the auth.admin API via Supabase client.
--
-- Owner Account:
--   Email: owner@glasscosanitary.com
--   Password: Owner@2026!
--   Role: OWNER
--   Device: Owner Remote
--
-- Terminal 1:
--   Email: pos1@glasscosanitary.com
--   Password: node1-pass
--   Role: TERMINAL
--   Device: Counter Node 1
--
-- Terminal 2:
--   Email: pos2@glasscosanitary.com
--   Password: node2-pass
--   Role: TERMINAL
--   Device: Counter Node 2
--
-- Terminal 3:
--   Email: warehouse@glasscosanitary.com
--   Password: node3-pass
--   Role: TERMINAL
--   Device: Warehouse Tablet
--
-- Terminal 4:
--   Email: office@glasscosanitary.com
--   Password: node4-pass
--   Role: TERMINAL
--   Device: Office Laptop
