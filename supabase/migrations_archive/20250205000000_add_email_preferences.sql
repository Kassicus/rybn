-- Add email_preferences column to user_profiles table
-- This column stores user preferences for email notifications

-- Add the column with a JSONB type and default values
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS email_preferences JSONB DEFAULT '{
  "email_group_invites": true,
  "email_date_reminders": true,
  "email_gift_updates": true,
  "email_exchange_notifications": true,
  "email_marketing": false
}'::jsonb;

-- Add a comment to document the column
COMMENT ON COLUMN user_profiles.email_preferences IS 'User email notification preferences in JSONB format';

-- Create an index for faster JSON queries on email preferences
CREATE INDEX IF NOT EXISTS idx_user_profiles_email_preferences
ON user_profiles USING GIN (email_preferences);
