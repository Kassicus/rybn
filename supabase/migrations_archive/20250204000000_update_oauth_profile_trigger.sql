-- Update user_profiles trigger to support OAuth authentication
-- OAuth users will have NULL username initially and set it after first login

-- Drop existing username constraint to allow NULL for OAuth users
ALTER TABLE user_profiles ALTER COLUMN username DROP NOT NULL;

-- Update the trigger function to handle OAuth users
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
  -- Detect if this is an OAuth user (has provider other than email)
  -- OAuth users have app_metadata with provider info
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
    NEW.raw_user_meta_data->>'full_name',  -- Google OAuth provides this
    NEW.raw_user_meta_data->>'name',       -- Some providers use 'name'
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
    RETURN NEW;
  EXCEPTION
    WHEN unique_violation THEN
      -- If username already exists, append random suffix and retry
      -- This only happens for email/password signups
      IF username_value IS NOT NULL THEN
        INSERT INTO user_profiles (id, username, display_name, email)
        VALUES (
          NEW.id,
          username_value || '_' || substr(md5(random()::text), 1, 6),
          display_name_value,
          NEW.email
        );
      ELSE
        -- For OAuth users, just set username to NULL
        INSERT INTO user_profiles (id, username, display_name, email)
        VALUES (
          NEW.id,
          NULL,
          display_name_value,
          NEW.email
        );
      END IF;
      RETURN NEW;
    WHEN OTHERS THEN
      -- Log any other errors
      RAISE WARNING 'Error creating user profile for %: %', NEW.id, SQLERRM;
      RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate the trigger to ensure it's properly attached
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile_on_signup();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION create_user_profile_on_signup() TO service_role;
GRANT EXECUTE ON FUNCTION create_user_profile_on_signup() TO authenticated;
