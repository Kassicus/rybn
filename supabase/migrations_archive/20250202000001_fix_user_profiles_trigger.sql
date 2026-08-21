-- Fix user_profiles trigger to handle email properly
-- This ensures the trigger works correctly with the new email column

-- Drop and recreate the trigger function with proper error handling
CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER AS $$
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

  -- Try to insert the user profile
  BEGIN
    INSERT INTO user_profiles (id, username, display_name, email)
    VALUES (
      NEW.id,
      username_value,
      display_name_value,
      NEW.email
    );
    RETURN NEW;
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
      RETURN NEW;
    WHEN OTHERS THEN
      -- Log any other errors
      RAISE WARNING 'Error creating user profile for %: %', NEW.id, SQLERRM;
      RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile_on_signup();
