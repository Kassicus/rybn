-- Verify that our constraints and cleanup were applied correctly

-- Check for duplicate group_members
SELECT
  user_id,
  group_id,
  COUNT(*) as count
FROM group_members
GROUP BY user_id, group_id
HAVING COUNT(*) > 1;

-- Check for duplicate pending invitations
SELECT
  group_id,
  email,
  COUNT(*) as count
FROM invitations
WHERE accepted = false
GROUP BY group_id, email
HAVING COUNT(*) > 1;

-- Verify unique constraint exists on group_members
SELECT
  conname as constraint_name,
  contype as type,
  'Group members constraint' as table_ref
FROM pg_constraint
WHERE conname = 'group_members_user_group_unique';

-- Verify partial unique index exists on invitations
SELECT
  indexname as index_name,
  'Invitations pending constraint' as table_ref
FROM pg_indexes
WHERE indexname = 'invitations_group_email_unique_pending';
