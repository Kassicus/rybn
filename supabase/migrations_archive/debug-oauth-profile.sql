-- Debug script to check OAuth user profile creation
-- Run this in Supabase SQL Editor

-- 1. Check if the migration was applied (username should allow NULL)
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'user_profiles'
  AND column_name = 'username';

-- 2. Check if the trigger exists and its function
SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- 3. List all auth users (to find your OAuth user)
SELECT
  id,
  email,
  created_at,
  raw_app_meta_data->>'provider' as provider
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- 4. Check which users have profiles
SELECT
  au.id,
  au.email,
  au.raw_app_meta_data->>'provider' as provider,
  up.username,
  up.display_name,
  CASE
    WHEN up.id IS NULL THEN 'MISSING PROFILE'
    ELSE 'Has profile'
  END as status
FROM auth.users au
LEFT JOIN user_profiles up ON au.id = up.id
ORDER BY au.created_at DESC
LIMIT 10;

-- 5. If you need to manually create a profile for an OAuth user, use this:
-- (Replace USER_UUID_HERE and other values)
-- INSERT INTO user_profiles (id, username, display_name, email)
-- VALUES (
--   'USER_UUID_HERE',
--   NULL,  -- Will be set by user
--   'Display Name from Google',
--   'user@email.com'
-- );
