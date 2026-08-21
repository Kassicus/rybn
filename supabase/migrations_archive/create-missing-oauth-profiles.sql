-- Create profiles for existing OAuth users who don't have one yet
-- Run this in Supabase SQL Editor

-- STEP 1: Check which OAuth users are missing profiles
SELECT
  au.id,
  au.email,
  au.raw_app_meta_data->>'provider' as provider,
  au.raw_user_meta_data->>'full_name' as google_name,
  CASE
    WHEN up.id IS NULL THEN '❌ MISSING PROFILE'
    ELSE '✅ Has profile'
  END as status
FROM auth.users au
LEFT JOIN user_profiles up ON au.id = up.id
WHERE au.raw_app_meta_data->>'provider' = 'google'
ORDER BY au.created_at DESC;

-- STEP 2: Create the missing profiles
INSERT INTO user_profiles (id, username, display_name, email)
SELECT
  au.id,
  NULL as username,  -- OAuth users will set this on /set-username page
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    split_part(au.email, '@', 1)
  ) as display_name,
  au.email
FROM auth.users au
LEFT JOIN user_profiles up ON au.id = up.id
WHERE up.id IS NULL  -- Only for users without profiles
  AND au.raw_app_meta_data->>'provider' = 'google';

-- STEP 3: Verify it worked - should now show "Has profile"
SELECT
  au.id,
  au.email,
  up.username,
  up.display_name,
  '✅ Profile created successfully' as status
FROM auth.users au
JOIN user_profiles up ON au.id = up.id
WHERE au.raw_app_meta_data->>'provider' = 'google'
ORDER BY au.created_at DESC;
