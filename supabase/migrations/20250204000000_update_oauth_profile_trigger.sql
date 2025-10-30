-- Update user_profiles trigger to support OAuth authentication
-- OAuth users will have NULL username initially and set it after first login

-- Drop existing username constraint to allow NULL for OAuth users
ALTER TABLE user_profiles ALTER COLUMN username DROP NOT NULL;

-- Update the trigger function to handle OAuth users
CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The trigger already exists, no need to recreate it
-- It will automatically use the updated function
