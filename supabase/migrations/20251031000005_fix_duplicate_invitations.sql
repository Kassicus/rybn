-- Fix duplicate invitations issue
-- This prevents "cannot coerce to single JSON object" errors when inviting users

-- STEP 1: Delete old duplicate invitations (keep only the most recent for each group+email combo)
-- This handles the case where multiple invitations exist for the same email to the same group
DELETE FROM invitations i1
WHERE i1.ctid NOT IN (
  SELECT i2.ctid
  FROM invitations i2
  WHERE i2.group_id = i1.group_id
    AND i2.email = i1.email
  ORDER BY i2.created_at DESC
  LIMIT 1
)
AND EXISTS (
  SELECT 1
  FROM invitations i3
  WHERE i3.group_id = i1.group_id
    AND i3.email = i1.email
    AND i3.ctid != i1.ctid
);

-- STEP 2: Add unique constraint to prevent future duplicate invitations
-- This ensures each email can only have ONE pending invitation per group
-- We allow multiple only if they're accepted (historical record)
DO $$
BEGIN
  -- First, let's add a partial unique index for pending invitations only
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'invitations_group_email_unique_pending'
  ) THEN
    CREATE UNIQUE INDEX invitations_group_email_unique_pending
    ON invitations(group_id, email)
    WHERE accepted = false;
  END IF;
END $$;

-- STEP 3: Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_invitations_group_email
ON invitations(group_id, email, created_at DESC);

-- Verify the index was created
SELECT
  indexname as index_name,
  indexdef as definition,
  '✅ Unique constraint for pending invitations added' as status
FROM pg_indexes
WHERE indexname = 'invitations_group_email_unique_pending';
