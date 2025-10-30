-- =================================================================
-- Rename Gift Groups to Group Gifts Migration
-- Renames gift_groups -> group_gifts, gift_group_members -> group_gift_members
-- Updates all foreign keys, indexes, policies, and triggers
-- =================================================================

-- Step 1: Rename tables
ALTER TABLE gift_groups RENAME TO group_gifts;
ALTER TABLE gift_group_members RENAME TO group_gift_members;

-- Step 2: Rename foreign key column in messages table
ALTER TABLE messages RENAME COLUMN gift_group_id TO group_gift_id;

-- Step 3: Rename foreign key column in group_gift_members table
ALTER TABLE group_gift_members RENAME COLUMN gift_group_id TO group_gift_id;

-- Step 4: Rename indexes
-- group_gifts indexes (previously gift_groups)
ALTER INDEX idx_gift_groups_group_id RENAME TO idx_group_gifts_group_id;
ALTER INDEX idx_gift_groups_target_user RENAME TO idx_group_gifts_target_user;
ALTER INDEX idx_gift_groups_created_by RENAME TO idx_group_gifts_created_by;
ALTER INDEX idx_gift_groups_is_active RENAME TO idx_group_gifts_is_active;

-- group_gift_members indexes (previously gift_group_members)
ALTER INDEX idx_gift_group_members_gift_group RENAME TO idx_group_gift_members_group_gift;
ALTER INDEX idx_gift_group_members_user RENAME TO idx_group_gift_members_user;

-- messages indexes (gift_group -> group_gift)
ALTER INDEX idx_messages_gift_group RENAME TO idx_messages_group_gift;

-- Step 5: Rename triggers
ALTER TRIGGER update_gift_groups_updated_at ON group_gifts
  RENAME TO update_group_gifts_updated_at;

ALTER TRIGGER update_gift_group_amount_on_contribution ON group_gift_members
  RENAME TO update_group_gift_amount_on_contribution;

-- Step 6: Drop and recreate the trigger function with new references
DROP TRIGGER update_group_gift_amount_on_contribution ON group_gift_members;
DROP FUNCTION update_gift_group_current_amount();

CREATE OR REPLACE FUNCTION update_group_gift_current_amount()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE group_gifts
  SET current_amount = (
    SELECT COALESCE(SUM(contribution_amount), 0)
    FROM group_gift_members
    WHERE group_gift_id = COALESCE(NEW.group_gift_id, OLD.group_gift_id)
  )
  WHERE id = COALESCE(NEW.group_gift_id, OLD.group_gift_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_group_gift_amount_on_contribution
  AFTER INSERT OR UPDATE OR DELETE ON group_gift_members
  FOR EACH ROW
  EXECUTE FUNCTION update_group_gift_current_amount();

-- Step 7: Update table comments
COMMENT ON TABLE group_gifts IS
'Group gift coordination - pooling money together for a gift for someone';

COMMENT ON TABLE group_gift_members IS
'Members participating in a group gift with their contribution amounts';

COMMENT ON COLUMN group_gifts.target_user_id IS
'The user this group gift is for (hidden from this user)';

COMMENT ON COLUMN group_gifts.target_amount IS
'Target contribution amount for the group gift';

COMMENT ON COLUMN group_gifts.current_amount IS
'Current total contributions (auto-calculated)';

COMMENT ON COLUMN group_gift_members.contribution_amount IS
'Amount this member has committed to contribute';

COMMENT ON COLUMN group_gift_members.has_paid IS
'Whether this member has paid their contribution';

-- Note: RLS policies are automatically transferred when tables are renamed
-- Policy names remain unchanged but will reference the new table names
