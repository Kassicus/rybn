-- =================================================================
-- Fix RLS Infinite Recursion
-- Fixes circular dependencies in group_members and related policies
-- =================================================================

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view members of their groups" ON group_members;
DROP POLICY IF EXISTS "Users can view profiles of group members" ON user_profiles;
DROP POLICY IF EXISTS "Users can view profile info based on privacy settings" ON profile_info;

-- 1. Create a SECURITY DEFINER function to check group membership without RLS
CREATE OR REPLACE FUNCTION is_group_member(check_user_id UUID, check_group_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM group_members
    WHERE user_id = check_user_id
    AND group_id = check_group_id
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- 2. Recreate get_shared_groups with SECURITY DEFINER to bypass RLS
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- 3. Recreate can_view_field with SECURITY DEFINER
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- 4. Simplified group_members policy using SECURITY DEFINER function
-- This avoids recursion by using a function that bypasses RLS
CREATE POLICY "Users can view members of their groups"
  ON group_members FOR SELECT
  USING (
    -- Users can see their own memberships
    user_id = auth.uid()
    OR
    -- Or see other members in groups they belong to
    is_group_member(auth.uid(), group_id)
  );

-- 5. Recreate user_profiles policy
CREATE POLICY "Users can view profiles of group members"
  ON user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM get_shared_groups(auth.uid(), user_profiles.id)
    )
  );

-- 6. Recreate profile_info policy
CREATE POLICY "Users can view profile info based on privacy settings"
  ON profile_info FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    can_view_field(user_id, auth.uid(), privacy_settings)
  );

-- 7. Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION is_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_shared_groups(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_view_field(UUID, UUID, JSONB) TO authenticated;
