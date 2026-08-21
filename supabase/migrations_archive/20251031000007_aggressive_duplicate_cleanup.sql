-- Aggressive cleanup of all duplicates and re-application of constraints
-- This should fix any lingering "cannot coerce to single JSON object" errors

-- STEP 1: Clean up duplicate group_members more aggressively
-- Delete ALL duplicates and keep only the first one (by ctid)
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH duplicates AS (
    SELECT user_id, group_id, COUNT(*) as cnt
    FROM group_members
    GROUP BY user_id, group_id
    HAVING COUNT(*) > 1
  ),
  rows_to_delete AS (
    SELECT gm.ctid
    FROM group_members gm
    INNER JOIN duplicates d ON gm.user_id = d.user_id AND gm.group_id = d.group_id
    WHERE gm.ctid NOT IN (
      SELECT MIN(gm2.ctid)
      FROM group_members gm2
      WHERE gm2.user_id = gm.user_id AND gm2.group_id = gm.group_id
    )
  )
  DELETE FROM group_members
  WHERE ctid IN (SELECT ctid FROM rows_to_delete);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % duplicate group_members rows', deleted_count;
END $$;

-- STEP 2: Clean up duplicate pending invitations
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH duplicates AS (
    SELECT group_id, email, COUNT(*) as cnt
    FROM invitations
    WHERE accepted = false
    GROUP BY group_id, email
    HAVING COUNT(*) > 1
  ),
  rows_to_delete AS (
    SELECT i.ctid
    FROM invitations i
    INNER JOIN duplicates d ON i.group_id = d.group_id AND i.email = d.email
    WHERE i.accepted = false
    AND i.ctid NOT IN (
      SELECT i2.ctid
      FROM invitations i2
      WHERE i2.group_id = i.group_id
        AND i2.email = i.email
        AND i2.accepted = false
      ORDER BY i2.created_at DESC
      LIMIT 1
    )
  )
  DELETE FROM invitations
  WHERE ctid IN (SELECT ctid FROM rows_to_delete);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % duplicate pending invitation rows', deleted_count;
END $$;

-- STEP 3: Drop and recreate the group_members unique constraint
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_user_group_unique;
ALTER TABLE group_members ADD CONSTRAINT group_members_user_group_unique UNIQUE (user_id, group_id);

-- STEP 4: Drop and recreate the invitations unique index
DROP INDEX IF EXISTS invitations_group_email_unique_pending;
CREATE UNIQUE INDEX invitations_group_email_unique_pending
ON invitations(group_id, email)
WHERE accepted = false;

-- STEP 5: Verify everything is clean
DO $$
DECLARE
  group_member_dupes INTEGER;
  invitation_dupes INTEGER;
BEGIN
  -- Check for duplicate group members
  SELECT COUNT(*)
  INTO group_member_dupes
  FROM (
    SELECT user_id, group_id, COUNT(*) as cnt
    FROM group_members
    GROUP BY user_id, group_id
    HAVING COUNT(*) > 1
  ) dupes;

  -- Check for duplicate pending invitations
  SELECT COUNT(*)
  INTO invitation_dupes
  FROM (
    SELECT group_id, email, COUNT(*) as cnt
    FROM invitations
    WHERE accepted = false
    GROUP BY group_id, email
    HAVING COUNT(*) > 1
  ) dupes;

  IF group_member_dupes > 0 THEN
    RAISE WARNING 'Still found % duplicate group_member combinations', group_member_dupes;
  ELSE
    RAISE NOTICE '✅ No duplicate group members found';
  END IF;

  IF invitation_dupes > 0 THEN
    RAISE WARNING 'Still found % duplicate pending invitation combinations', invitation_dupes;
  ELSE
    RAISE NOTICE '✅ No duplicate pending invitations found';
  END IF;
END $$;
