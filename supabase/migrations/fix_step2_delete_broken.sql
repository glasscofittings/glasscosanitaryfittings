-- Step 2: Delete broken seed data
DELETE FROM auth.users WHERE email LIKE '%@glasscosanitary.com';
