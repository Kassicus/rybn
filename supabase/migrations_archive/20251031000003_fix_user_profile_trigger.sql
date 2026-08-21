-- Fix user profile creation trigger to prevent duplicate insertion errors
-- The issue: UNIQUE constraint on email can cause conflicts during profile creation

-- STEP 1: Drop the UNIQUE constraint on email
-- (email is already unique in auth.users, we don't need it duplicated here)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_email_key;

-- STEP 2: Update the trigger function to be more defensive
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
  -- Check if profile already exists FIRST (defensive check)
  IF EXISTS (SELECT 1 FROM user_profiles WHERE id = NEW.id) THEN
    -- Profile already exists, just update the email if needed
    UPDATE user_profiles
    SET email = NEW.email
    WHERE id = NEW.id AND email IS DISTINCT FROM NEW.email;
    RETURN NEW;
  END IF;

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
      -- Check which constraint was violated
      IF username_value IS NOT NULL THEN
        -- Likely username conflict, append random suffix
        BEGIN
          INSERT INTO user_profiles (id, username, display_name, email)
          VALUES (
            NEW.id,
            username_value || '_' || substr(md5(random()::text), 1, 6),
            display_name_value,
            NEW.email
          );
        EXCEPTION
          WHEN OTHERS THEN
            -- If still failing, this profile might already exist
            -- Just update it instead
            UPDATE user_profiles
            SET email = NEW.email,
                display_name = display_name_value
            WHERE id = NEW.id;
        END;
      ELSE
        -- OAuth user, insert with NULL username
        BEGIN
          INSERT INTO user_profiles (id, username, display_name, email)
          VALUES (NEW.id, NULL, display_name_value, NEW.email);
        EXCEPTION
          WHEN OTHERS THEN
            -- Profile already exists, update it
            UPDATE user_profiles
            SET email = NEW.email,
                display_name = display_name_value
            WHERE id = NEW.id;
        END;
      END IF;
    WHEN OTHERS THEN
      -- Log the error but don't fail the auth flow
      RAISE WARNING 'Error creating user profile for user %: %', NEW.id, SQLERRM;
      -- Try to update existing profile as fallback
      UPDATE user_profiles
      SET email = NEW.email,
          display_name = display_name_value
      WHERE id = NEW.id;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 3: Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile_on_signup();

-- STEP 4: Grant permissions
GRANT EXECUTE ON FUNCTION create_user_profile_on_signup() TO service_role;
GRANT EXECUTE ON FUNCTION create_user_profile_on_signup() TO authenticated;
