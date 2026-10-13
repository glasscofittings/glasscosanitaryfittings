-- ============================================================================
-- FIX: profiles row missing for the owner → "+ Add Funds" button hidden
-- Run in: SQL Editor of project xjcpxecqkebxdeyrpdns  (idempotent, safe to re-run)
-- Symptom: AvailableFundsCard gates "+ Add Funds" on profile?.role === "OWNER",
--          and fetchProfile() returns null silently when the profiles row is
--          absent (no app code ever created one; signup trigger had been dropped).
-- ============================================================================

-- ── 1. profiles table (no-op if it already exists) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'TERMINAL',
  device_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- ── 2. normalize role to TEXT if it is still the user_role enum ────────────
DO $$
DECLARE v_type TEXT;
BEGIN
  SELECT atttypid::regtype::text INTO v_type
    FROM pg_attribute
   WHERE attrelid = 'public.profiles'::regclass
     AND attname = 'role' AND attisdropped = FALSE;
  IF v_type = 'user_role' THEN
    ALTER TABLE public.profiles ALTER COLUMN role TYPE TEXT USING role::text;
    RAISE NOTICE 'profiles.role converted from user_role enum to TEXT';
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 3. RLS: the signed-in user can read/update their own row ───────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ── 4. signup trigger (type-agnostic, warns instead of swallowing errors) ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''), 'TERMINAL');
  IF v_role NOT IN ('OWNER','TERMINAL') THEN v_role := 'TERMINAL'; END IF;
  BEGIN
    INSERT INTO public.profiles (id, email, role, device_name)
    VALUES (NEW.id, NEW.email, v_role, NEW.raw_user_meta_data->>'device_name')
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile not created for %: %', NEW.email, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 5. backfill a profile for every auth user that is missing one ──────────
DO $$
DECLARE u RECORD; v_role TEXT;
BEGIN
  FOR u IN SELECT id, email, raw_user_meta_data FROM auth.users LOOP
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id) THEN
      CONTINUE;
    END IF;
    v_role := COALESCE(NULLIF(u.raw_user_meta_data->>'role',''), 'TERMINAL');
    IF v_role NOT IN ('OWNER','TERMINAL') THEN v_role := 'TERMINAL'; END IF;
    BEGIN
      INSERT INTO public.profiles (id, email, role, device_name)
      VALUES (u.id, u.email, v_role, u.raw_user_meta_data->>'device_name')
      ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'backfill skipped % (email already linked to another profile)', u.email;
    END;
  END LOOP;
END $$;

-- ── 6. owner account: metadata + profile row forced to OWNER ───────────────
UPDATE auth.users
   SET raw_user_meta_data = COALESCE(raw_user_meta_data,'{}'::jsonb) || '{"role":"OWNER"}'::jsonb
 WHERE lower(email) = 'owner@glasscosanitary.com';

-- remove an orphaned profile holding the owner email under a different id
DELETE FROM public.profiles p
 WHERE lower(p.email) = 'owner@glasscosanitary.com'
   AND NOT EXISTS (
         SELECT 1 FROM auth.users u
          WHERE u.id = p.id AND lower(u.email) = 'owner@glasscosanitary.com');

INSERT INTO public.profiles (id, email, role, device_name)
SELECT u.id, u.email, 'OWNER', u.raw_user_meta_data->>'device_name'
  FROM auth.users u
 WHERE lower(u.email) = 'owner@glasscosanitary.com'
ON CONFLICT (id) DO UPDATE SET role = 'OWNER', email = EXCLUDED.email;

-- ── 7. self-heal RPC used by the app when a profile row is missing ─────────
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_meta  JSONB;
  v_role  TEXT;
  v_row   public.profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT email, COALESCE(raw_user_meta_data,'{}'::jsonb)
    INTO v_email, v_meta
    FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'auth user not found'; END IF;

  v_role := COALESCE(NULLIF(v_meta->>'role',''), 'TERMINAL');
  IF v_role NOT IN ('OWNER','TERMINAL') THEN v_role := 'TERMINAL'; END IF;

  INSERT INTO public.profiles (id, email, role, device_name)
  VALUES (v_uid, v_email, v_role, v_meta->>'device_name')
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'profile row missing and could not be created';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;

-- ── 8. verification ────────────────────────────────────────────────────────
SELECT p.id, p.email, p.role, p.device_name
  FROM public.profiles p ORDER BY p.role, p.email;

SELECT u.email,
       (p.id IS NOT NULL) AS has_profile,
       COALESCE(p.role, '—') AS role
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
 ORDER BY u.email;

SELECT policyname, cmd FROM pg_policies WHERE tablename = 'profiles';
