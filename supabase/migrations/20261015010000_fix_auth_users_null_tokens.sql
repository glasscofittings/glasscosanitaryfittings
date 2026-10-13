-- ============================================================================
-- Fix: 500 "Database error querying schema" when signing in
--
-- Cause: users were seeded with direct INSERTs into auth.users (see
-- full_transfer_setup.sql 6.6, fix_auth_complete_reset.sql,
-- 20260913_seed_auth_users.sql, fix_step3_seed_users.sql), which leaves the
-- token columns NULL. Supabase Auth scans those columns into Go strings and
-- fails on NULL: "error finding user: sql: Scan error on column index 3,
-- name confirmation_token: converting NULL to string is unsupported".
-- See: https://github.com/supabase/auth/issues/1940
--
-- Fix: set the token columns to '' (empty string) and make sure every seeded
-- user has an auth.identities row for the email provider.
-- Run in the Supabase SQL Editor.
-- ============================================================================

-- 1. NULL token columns -> empty string (column-existence guarded so the
--    script still runs on older/newer auth schema versions).
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'confirmation_token',
    'recovery_token',
    'email_change',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth'
        AND table_name   = 'users'
        AND column_name  = col
    ) THEN
      EXECUTE format('UPDATE auth.users SET %I = '''' WHERE %I IS NULL', col, col);
    END IF;
  END LOOP;
END $$;

-- 2. Backfill the email identity for users that were inserted manually.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name   = 'identities'
      AND column_name  = 'provider_id'
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      u.id,
      u.id::text,
      jsonb_build_object(
        'sub', u.id::text,
        'email', u.email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(), now(), now()
    FROM auth.users u
    WHERE u.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.identities i
        WHERE i.user_id = u.id AND i.provider = 'email'
      )
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      u.id,
      jsonb_build_object(
        'sub', u.id::text,
        'email', u.email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(), now(), now()
    FROM auth.users u
    WHERE u.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.identities i
        WHERE i.user_id = u.id AND i.provider = 'email'
      )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 3. Make sure every seeded user has a profile row with the right role.
--    `profiles.role` is TEXT in some versions of the schema and user_role enum
--    in others, so cast to whatever the column actually is.
DO $$
DECLARE
  v_role_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_role_type
  FROM pg_attribute a
  JOIN pg_class c      ON c.oid = a.attrelid
  JOIN pg_namespace n  ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'profiles'
    AND a.attname = 'role'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_role_type IS NULL THEN
    RAISE NOTICE 'public.profiles(role) not found - skipping profile backfill';
  ELSE
    EXECUTE format($sql$
      INSERT INTO public.profiles (id, email, role, device_name)
      SELECT
        au.id,
        au.email,
        COALESCE(au.raw_user_meta_data->>'role', 'TERMINAL')::%s,
        au.raw_user_meta_data->>'device_name'
      FROM auth.users au
      WHERE au.email IS NOT NULL
      ON CONFLICT (id) DO UPDATE SET
        email       = EXCLUDED.email,
        role        = EXCLUDED.role,
        device_name = EXCLUDED.device_name
    $sql$, v_role_type);

    EXECUTE format(
      'UPDATE public.profiles SET role = %L::%s WHERE lower(email) = %L',
      'OWNER', v_role_type, 'owner@glasscosanitary.com'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'profile backfill skipped: %', SQLERRM;
END $$;
