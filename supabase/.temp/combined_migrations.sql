-- Create enums
CREATE TYPE group_type AS ENUM ('family', 'friends', 'work', 'custom');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

-- Groups table
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type group_type NOT NULL DEFAULT 'custom',
  invite_code TEXT UNIQUE NOT NULL,
  settings JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Group members table
CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role member_role DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- Invitations table
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID REFERENCES auth.users(id) NOT NULL,
  accepted BOOLEAN DEFAULT FALSE,
  accepted_at TIMESTAMPTZ,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for groups
CREATE POLICY "Users can view groups they're members of"
  ON groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
      AND group_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Group owners and admins can update groups"
  ON groups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
      AND group_members.user_id = auth.uid()
      AND group_members.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Group owners can delete groups"
  ON groups FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
      AND group_members.user_id = auth.uid()
      AND group_members.role = 'owner'
    )
  );

-- RLS Policies for group_members
CREATE POLICY "Users can view members of their groups"
  ON group_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert group members"
  ON group_members FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Owners and admins can update member roles"
  ON group_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
      AND gm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Members can remove themselves, owners/admins can remove others"
  ON group_members FOR DELETE
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
      AND gm.role IN ('owner', 'admin')
    )
  );

-- RLS Policies for invitations
CREATE POLICY "Users can view invitations they sent"
  ON invitations FOR SELECT
  USING (invited_by = auth.uid());

CREATE POLICY "Group members can view group invitations"
  ON invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = invitations.group_id
      AND group_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Group members can create invitations"
  ON invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = invitations.group_id
      AND group_members.user_id = auth.uid()
    )
  );

-- Function to automatically set group creator as owner
CREATE OR REPLACE FUNCTION add_group_creator_as_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO group_members (group_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to add creator as owner
CREATE TRIGGER on_group_created
  AFTER INSERT ON groups
  FOR EACH ROW
  EXECUTE FUNCTION add_group_creator_as_owner();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on groups
CREATE TRIGGER update_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes for performance
CREATE INDEX idx_groups_created_by ON groups(created_by);
CREATE INDEX idx_groups_invite_code ON groups(invite_code);
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_invitations_group_id ON invitations(group_id);
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_email ON invitations(email);
-- =================================================================
-- User Profile System Migration
-- Creates user_profiles and profile_info tables with privacy controls
-- =================================================================

-- 1. Create privacy_level enum
DO $$ BEGIN
  CREATE TYPE privacy_level AS ENUM ('private', 'group', 'friends', 'family', 'public');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create profile_info table
CREATE TABLE IF NOT EXISTS profile_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value TEXT,
  privacy_settings JSONB NOT NULL DEFAULT '{"default": "private", "overrides": {}}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, field_name)
);

-- 4. Add constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'username_length') THEN
    ALTER TABLE user_profiles ADD CONSTRAINT username_length
      CHECK (char_length(username) >= 3 AND char_length(username) <= 30);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'username_format') THEN
    ALTER TABLE user_profiles ADD CONSTRAINT username_format
      CHECK (username ~ '^[a-zA-Z0-9_-]+$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bio_length') THEN
    ALTER TABLE user_profiles ADD CONSTRAINT bio_length
      CHECK (char_length(bio) <= 500);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_category') THEN
    ALTER TABLE profile_info ADD CONSTRAINT valid_category
      CHECK (category IN ('sizes', 'preferences', 'vehicles', 'personal', 'dates'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_privacy_settings') THEN
    ALTER TABLE profile_info ADD CONSTRAINT valid_privacy_settings
      CHECK (
        privacy_settings ? 'default' AND
        (privacy_settings->>'default')::privacy_level IS NOT NULL
      );
  END IF;
END $$;

-- 5. Create indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_profile_info_user_id ON profile_info(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_info_category ON profile_info(category);
CREATE INDEX IF NOT EXISTS idx_profile_info_user_category ON profile_info(user_id, category);
CREATE INDEX IF NOT EXISTS idx_profile_info_privacy_settings ON profile_info USING GIN(privacy_settings);
CREATE INDEX IF NOT EXISTS idx_profile_info_privacy_default ON profile_info ((privacy_settings->>'default'));

-- 6. Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_info ENABLE ROW LEVEL SECURITY;

-- 7. Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can view profiles of group members" ON user_profiles;
DROP POLICY IF EXISTS "Users can create their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can delete their own profile" ON user_profiles;

DROP POLICY IF EXISTS "Users can view their own profile info" ON profile_info;
DROP POLICY IF EXISTS "Users can view profile info based on privacy settings" ON profile_info;
DROP POLICY IF EXISTS "Users can create their own profile info" ON profile_info;
DROP POLICY IF EXISTS "Users can update their own profile info" ON profile_info;
DROP POLICY IF EXISTS "Users can delete their own profile info" ON profile_info;

-- 8. RLS Policies for user_profiles
CREATE POLICY "Users can view their own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can view profiles of group members"
  ON user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm1
      JOIN group_members gm2 ON gm1.group_id = gm2.group_id
      WHERE gm1.user_id = auth.uid()
      AND gm2.user_id = user_profiles.id
    )
  );

CREATE POLICY "Users can create their own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can delete their own profile"
  ON user_profiles FOR DELETE
  USING (auth.uid() = id);

-- 9. Helper function to get shared groups
CREATE OR REPLACE FUNCTION get_shared_groups(user_a UUID, user_b UUID)
RETURNS TABLE (
  group_id UUID,
  group_type group_type
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT g.id, g.type
  FROM groups g
  INNER JOIN group_members gm1 ON g.id = gm1.group_id
  INNER JOIN group_members gm2 ON g.id = gm2.group_id
  WHERE gm1.user_id = user_a
    AND gm2.user_id = user_b;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 10. Helper function to check if viewer can see a field
CREATE OR REPLACE FUNCTION can_view_field(
  field_owner_id UUID,
  viewer_id UUID,
  privacy_settings JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  shared_groups RECORD;
  override_level privacy_level;
  default_level privacy_level;
BEGIN
  -- Owner can always view their own fields
  IF field_owner_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Extract default privacy level
  default_level := (privacy_settings->>'default')::privacy_level;

  -- If public, return immediately
  IF default_level = 'public' THEN
    RETURN TRUE;
  END IF;

  -- If private with no overrides, return false
  IF default_level = 'private' AND
     (privacy_settings->'overrides' IS NULL OR
      jsonb_typeof(privacy_settings->'overrides') = 'null' OR
      privacy_settings->'overrides' = '{}'::jsonb) THEN
    RETURN FALSE;
  END IF;

  -- Check group-specific overrides and default level
  FOR shared_groups IN
    SELECT * FROM get_shared_groups(viewer_id, field_owner_id)
  LOOP
    -- Check for group-specific override
    override_level := (privacy_settings->'overrides'->>shared_groups.group_id::text)::privacy_level;

    IF override_level IS NOT NULL THEN
      -- Use override level for this specific group
      IF override_level = 'public' THEN
        RETURN TRUE;
      ELSIF override_level = 'private' THEN
        CONTINUE; -- Check other groups
      ELSIF override_level = 'group' THEN
        RETURN TRUE;
      ELSIF override_level = 'family' AND shared_groups.group_type = 'family' THEN
        RETURN TRUE;
      ELSIF override_level = 'friends' AND shared_groups.group_type = 'friends' THEN
        RETURN TRUE;
      END IF;
    ELSE
      -- Use default level
      IF default_level = 'group' THEN
        RETURN TRUE;
      ELSIF default_level = 'family' AND shared_groups.group_type = 'family' THEN
        RETURN TRUE;
      ELSIF default_level = 'friends' AND shared_groups.group_type = 'friends' THEN
        RETURN TRUE;
      END IF;
    END IF;
  END LOOP;

  -- If we got here, user can't view
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 11. RLS Policies for profile_info
CREATE POLICY "Users can view their own profile info"
  ON profile_info FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view profile info based on privacy settings"
  ON profile_info FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    can_view_field(user_id, auth.uid(), privacy_settings)
  );

CREATE POLICY "Users can create their own profile info"
  ON profile_info FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile info"
  ON profile_info FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own profile info"
  ON profile_info FOR DELETE
  USING (auth.uid() = user_id);

-- 12. Create trigger function for auto-creating user_profiles
CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- If username already exists, append random suffix
    INSERT INTO user_profiles (id, username, display_name)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)) || '_' || substr(md5(random()::text), 1, 6),
      COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 14. Create trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile_on_signup();

-- 15. Create update timestamp triggers
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
DROP TRIGGER IF EXISTS update_profile_info_updated_at ON profile_info;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profile_info_updated_at
  BEFORE UPDATE ON profile_info
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 16. Function to clean up privacy overrides when user leaves group
CREATE OR REPLACE FUNCTION cleanup_privacy_overrides_on_group_member_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Clean up profile_info overrides for the user who left
  UPDATE profile_info
  SET privacy_settings = jsonb_set(
    privacy_settings,
    '{overrides}',
    COALESCE(
      (privacy_settings->'overrides') - OLD.group_id::text,
      '{}'::jsonb
    )
  )
  WHERE user_id = OLD.user_id
    AND privacy_settings->'overrides' ? OLD.group_id::text;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 17. Trigger for cleanup on group member deletion
DROP TRIGGER IF EXISTS cleanup_privacy_on_group_member_delete ON group_members;

CREATE TRIGGER cleanup_privacy_on_group_member_delete
  BEFORE DELETE ON group_members
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_privacy_overrides_on_group_member_delete();

-- 18. Function to clean up privacy overrides when group is deleted
CREATE OR REPLACE FUNCTION cleanup_privacy_overrides_on_group_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Clean up all profile_info overrides for this group
  UPDATE profile_info
  SET privacy_settings = jsonb_set(
    privacy_settings,
    '{overrides}',
    COALESCE(
      (privacy_settings->'overrides') - OLD.id::text,
      '{}'::jsonb
    )
  )
  WHERE privacy_settings->'overrides' ? OLD.id::text;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 19. Trigger for cleanup on group deletion
DROP TRIGGER IF EXISTS cleanup_privacy_on_group_delete ON groups;

CREATE TRIGGER cleanup_privacy_on_group_delete
  BEFORE DELETE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_privacy_overrides_on_group_delete();

-- 20. Create profiles for existing users (if any)
INSERT INTO user_profiles (id, username, display_name)
SELECT
  au.id,
  COALESCE(
    au.raw_user_meta_data->>'username',
    split_part(au.email, '@', 1)
  ) || CASE
    WHEN EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.username = COALESCE(
        au.raw_user_meta_data->>'username',
        split_part(au.email, '@', 1)
      )
    ) THEN '_' || substr(md5(random()::text), 1, 6)
    ELSE ''
  END as username,
  COALESCE(
    au.raw_user_meta_data->>'display_name',
    split_part(au.email, '@', 1)
  ) as display_name
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM user_profiles up WHERE up.id = au.id
);
