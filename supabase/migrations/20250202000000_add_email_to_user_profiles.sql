-- Add email column to user_profiles table
-- This makes it easier to query users by email for invitations

-- 1. Add email column
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

-- 2. Populate email column for existing users from auth.users
UPDATE user_profiles up
SET email = au.email
FROM auth.users au
WHERE up.id = au.id
  AND up.email IS NULL;

-- 3. Update the trigger function to include email
CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, username, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- If username already exists, append random suffix
    INSERT INTO user_profiles (id, username, display_name, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)) || '_' || substr(md5(random()::text), 1, 6),
      COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
      NEW.email
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
