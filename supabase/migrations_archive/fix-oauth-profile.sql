-- Fix script: Create missing profiles for OAuth users
-- Run this in Supabase SQL Editor AFTER running debug-oauth-profile.sql

-- Step 1: First, ensure username column allows NULL
ALTER TABLE user_profiles ALTER COLUMN username DROP NOT NULL;

-- Step 2: Create profiles for any OAuth users missing them
-- This will safely create profiles for users who don't have one
INSERT INTO user_profiles (id, username, display_name, email)
SELECT
  au.id,
  NULL as username,  -- OAuth users set this later
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    split_part(au.email, '@', 1)
  ) as display_name,
  au.email
FROM auth.users au
LEFT JOIN user_profiles up ON au.id = up.id
WHERE up.id IS NULL  -- Only create for users without profiles
  AND au.raw_app_meta_data->>'provider' IS NOT NULL  -- Only OAuth users
  AND au.raw_app_meta_data->>'provider' != 'email';  -- Not email/password users

-- Step 3: Verify the fix - should show no missing profiles
SELECT
  au.id,
  au.email,
  au.raw_app_meta_data->>'provider' as provider,
  up.username,
  up.display_name,
  CASE
    WHEN up.id IS NULL THEN '⚠️ STILL MISSING PROFILE'
    ELSE '✅ Has profile'
  END as status
FROM auth.users au
LEFT JOIN user_profiles up ON au.id = up.id
WHERE au.raw_app_meta_data->>'provider' IS NOT NULL
  AND au.raw_app_meta_data->>'provider' != 'email'
ORDER BY au.created_at DESC;
