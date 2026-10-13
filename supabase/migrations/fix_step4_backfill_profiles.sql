-- Step 4: Backfill profiles
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
