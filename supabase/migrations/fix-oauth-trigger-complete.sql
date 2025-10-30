-- COMPLETE FIX: Ensure OAuth users get profiles automatically
-- Run this entire script in Supabase SQL Editor

-- STEP 1: Ensure username column allows NULL
ALTER TABLE user_profiles ALTER COLUMN username DROP NOT NULL;

-- STEP 2: Drop the old trigger (if it exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- STEP 3: Create the proper trigger function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  username_value TEXT;
  display_name_value TEXT;
  is_oauth_user BOOLEAN;
BEGIN
  -- Detect if this is an OAuth user
  is_oauth_user := (
    NEW.raw_app_meta_data->>'provider' IS NOT NULL
    AND NEW.raw_app_meta_data->>'provider' != 'email'
  );

  -- For OAuth users: leave username NULL (they'll set it later)
  -- For email/password: extract from metadata or email
  IF is_oauth_user THEN
    username_value := NULL;
  ELSE
    username_value := COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    );
  END IF;

  -- Extract display name from OAuth full_name or metadata
  display_name_value := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'display_name',
    split_part(NEW.email, '@', 1)
  );

  -- Check if profile already exists (safety check)
  IF EXISTS (SELECT 1 FROM user_profiles WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Try to insert the user profile
  BEGIN
    INSERT INTO user_profiles (id, username, display_name, email)
    VALUES (
      NEW.id,
      username_value,
      display_name_value,
      NEW.email
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- If username already exists, append random suffix and retry
      IF username_value IS NOT NULL THEN
        INSERT INTO user_profiles (id, username, display_name, email)
        VALUES (
          NEW.id,
          username_value || '_' || substr(md5(random()::text), 1, 6),
          display_name_value,
          NEW.email
        );
      ELSE
        -- For OAuth users with NULL username, just insert
        INSERT INTO user_profiles (id, username, display_name, email)
        VALUES (NEW.id, NULL, display_name_value, NEW.email);
      END IF;
    WHEN OTHERS THEN
      -- Log the error but don't fail the auth flow
      RAISE WARNING 'Error creating user profile for user %: %', NEW.id, SQLERRM;
      RAISE WARNING 'User data: provider=%, email=%', NEW.raw_app_meta_data->>'provider', NEW.email;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 4: Grant execute permission
GRANT EXECUTE ON FUNCTION create_user_profile_on_signup() TO service_role;
GRANT EXECUTE ON FUNCTION create_user_profile_on_signup() TO authenticated;

-- STEP 5: Create the trigger (this is the critical part that was missing!)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile_on_signup();

-- STEP 6: Verify the trigger was created
SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- STEP 7: Verify username allows NULL
SELECT
  column_name,
  is_nullable,
  '✅ Username can be NULL' as status
FROM information_schema.columns
WHERE table_name = 'user_profiles'
  AND column_name = 'username'
  AND is_nullable = 'YES';

-- You should see:
-- 1. The trigger listed with event_manipulation = 'INSERT' on 'users' table
-- 2. is_nullable = 'YES' for username column
