-- Fix RLS and trigger to allow user profile creation during signup
-- The issue: During signup, the trigger cannot insert due to RLS policy

-- Option 1: Make the trigger function bypass RLS by using a service role approach
-- We'll create a function that inserts with elevated privileges

CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  username_value TEXT;
  display_name_value TEXT;
BEGIN
  -- Extract username and display name
  username_value := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );
  display_name_value := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    split_part(NEW.email, '@', 1)
  );

  -- Insert with elevated privileges (bypasses RLS because of SECURITY DEFINER)
  -- We need to explicitly check if profile exists first to avoid unique violations
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = NEW.id) THEN
    BEGIN
      INSERT INTO user_profiles (id, username, display_name, email)
      VALUES (NEW.id, username_value, display_name_value, NEW.email);
    EXCEPTION
      WHEN unique_violation THEN
        -- If username already exists, append random suffix and retry
        INSERT INTO user_profiles (id, username, display_name, email)
        VALUES (
          NEW.id,
          username_value || '_' || substr(md5(random()::text), 1, 6),
          display_name_value,
          NEW.email
        );
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions to the function
GRANT EXECUTE ON FUNCTION create_user_profile_on_signup() TO service_role;

-- Ensure the trigger is recreated
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile_on_signup();
