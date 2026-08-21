-- Fix duplicate group members issue
-- This prevents "cannot coerce to single JSON object" errors

-- STEP 1: Remove duplicate group_members entries (keep the oldest one for each user+group combo)
DELETE FROM group_members gm1
WHERE gm1.ctid NOT IN (
  SELECT MIN(gm2.ctid)
  FROM group_members gm2
  GROUP BY gm2.user_id, gm2.group_id
);

-- STEP 2: Add unique constraint to prevent future duplicates
-- This ensures each user can only be in a group once
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'group_members_user_group_unique'
  ) THEN
    ALTER TABLE group_members
    ADD CONSTRAINT group_members_user_group_unique
    UNIQUE (user_id, group_id);
  END IF;
END $$;

-- STEP 3: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_group_members_user_group
ON group_members(user_id, group_id);

-- Verify the constraint was created
SELECT
  conname as constraint_name,
  contype as constraint_type,
  '✅ Unique constraint added successfully' as status
FROM pg_constraint
WHERE conname = 'group_members_user_group_unique';
