-- =================================================================
-- Gift Groups & Messaging System Migration
-- Creates gift_groups, gift_group_members, and messages tables
-- =================================================================

-- Gift coordination groups
CREATE TABLE IF NOT EXISTS gift_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  target_user_id UUID REFERENCES auth.users(id),
  target_amount DECIMAL(10, 2),
  current_amount DECIMAL(10, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gift group members
CREATE TABLE IF NOT EXISTS gift_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_group_id UUID REFERENCES gift_groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  contribution_amount DECIMAL(10, 2) DEFAULT 0,
  has_paid BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gift_group_id, user_id)
);

-- Messages for gift groups
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_group_id UUID REFERENCES gift_groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  attachment_url TEXT,
  is_edited BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_gift_groups_group_id ON gift_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_gift_groups_target_user ON gift_groups(target_user_id);
CREATE INDEX IF NOT EXISTS idx_gift_groups_created_by ON gift_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_gift_groups_is_active ON gift_groups(is_active);

CREATE INDEX IF NOT EXISTS idx_gift_group_members_gift_group ON gift_group_members(gift_group_id);
CREATE INDEX IF NOT EXISTS idx_gift_group_members_user ON gift_group_members(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_gift_group ON messages(gift_group_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- Enable RLS
ALTER TABLE gift_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- =================================================================
-- RLS Policies for gift_groups
-- =================================================================

-- Users can view gift groups they're members of
CREATE POLICY "Users can view gift groups they're members of"
  ON gift_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM gift_group_members
      WHERE gift_group_members.gift_group_id = gift_groups.id
      AND gift_group_members.user_id = auth.uid()
    )
  );

-- Users can create gift groups in groups they're members of
CREATE POLICY "Users can create gift groups in their groups"
  ON gift_groups FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = gift_groups.group_id
      AND group_members.user_id = auth.uid()
    )
  );

-- Users can update gift groups they created
CREATE POLICY "Users can update gift groups they created"
  ON gift_groups FOR UPDATE
  USING (auth.uid() = created_by);

-- Users can delete gift groups they created
CREATE POLICY "Users can delete gift groups they created"
  ON gift_groups FOR DELETE
  USING (auth.uid() = created_by);

-- =================================================================
-- RLS Policies for gift_group_members
-- =================================================================

-- Users can view members of gift groups they're in
CREATE POLICY "Users can view gift group members"
  ON gift_group_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM gift_group_members AS ggm
      WHERE ggm.gift_group_id = gift_group_members.gift_group_id
      AND ggm.user_id = auth.uid()
    )
  );

-- Gift group creators can add members
CREATE POLICY "Gift group creators can add members"
  ON gift_group_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM gift_groups
      WHERE gift_groups.id = gift_group_members.gift_group_id
      AND gift_groups.created_by = auth.uid()
    )
  );

-- Users can update their own membership (contributions, payment status)
CREATE POLICY "Users can update their own membership"
  ON gift_group_members FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can leave gift groups (delete their membership)
CREATE POLICY "Users can leave gift groups"
  ON gift_group_members FOR DELETE
  USING (auth.uid() = user_id);

-- Gift group creators can remove members
CREATE POLICY "Gift group creators can remove members"
  ON gift_group_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM gift_groups
      WHERE gift_groups.id = gift_group_members.gift_group_id
      AND gift_groups.created_by = auth.uid()
    )
  );

-- =================================================================
-- RLS Policies for messages
-- =================================================================

-- Users can view messages in gift groups they're members of
CREATE POLICY "Users can view messages in their gift groups"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM gift_group_members
      WHERE gift_group_members.gift_group_id = messages.gift_group_id
      AND gift_group_members.user_id = auth.uid()
    )
  );

-- Users can send messages to gift groups they're members of
CREATE POLICY "Users can send messages to their gift groups"
  ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM gift_group_members
      WHERE gift_group_members.gift_group_id = messages.gift_group_id
      AND gift_group_members.user_id = auth.uid()
    )
  );

-- Users can update their own messages
CREATE POLICY "Users can update their own messages"
  ON messages FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own messages
CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (auth.uid() = user_id);

-- =================================================================
-- Triggers
-- =================================================================

-- Update gift_groups updated_at
CREATE TRIGGER update_gift_groups_updated_at
  BEFORE UPDATE ON gift_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update messages updated_at
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to update current_amount in gift_groups when contributions change
CREATE OR REPLACE FUNCTION update_gift_group_current_amount()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE gift_groups
  SET current_amount = (
    SELECT COALESCE(SUM(contribution_amount), 0)
    FROM gift_group_members
    WHERE gift_group_id = COALESCE(NEW.gift_group_id, OLD.gift_group_id)
  )
  WHERE id = COALESCE(NEW.gift_group_id, OLD.gift_group_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to update current_amount automatically
CREATE TRIGGER update_gift_group_amount_on_contribution
  AFTER INSERT OR UPDATE OR DELETE ON gift_group_members
  FOR EACH ROW
  EXECUTE FUNCTION update_gift_group_current_amount();

-- =================================================================
-- Constraints
-- =================================================================

ALTER TABLE gift_groups ADD CONSTRAINT valid_target_amount
  CHECK (target_amount IS NULL OR target_amount >= 0);

ALTER TABLE gift_groups ADD CONSTRAINT valid_current_amount
  CHECK (current_amount >= 0);

ALTER TABLE gift_group_members ADD CONSTRAINT valid_contribution_amount
  CHECK (contribution_amount IS NULL OR contribution_amount >= 0);

ALTER TABLE gift_groups ADD CONSTRAINT name_length
  CHECK (char_length(name) >= 1 AND char_length(name) <= 200);

ALTER TABLE messages ADD CONSTRAINT content_length
  CHECK (char_length(content) >= 1 AND char_length(content) <= 5000);

-- =================================================================
-- Comments
-- =================================================================

COMMENT ON TABLE gift_groups IS
'Gift coordination groups for pooling money toward a gift for someone';

COMMENT ON TABLE gift_group_members IS
'Members of gift coordination groups with their contribution amounts';

COMMENT ON TABLE messages IS
'Private messages within gift coordination groups';

COMMENT ON COLUMN gift_groups.target_user_id IS
'The user this gift is for (hidden from this user)';

COMMENT ON COLUMN gift_groups.target_amount IS
'Target contribution amount for the gift';

COMMENT ON COLUMN gift_groups.current_amount IS
'Current total contributions (auto-calculated)';

COMMENT ON COLUMN gift_group_members.contribution_amount IS
'Amount this member has committed to contribute';

COMMENT ON COLUMN gift_group_members.has_paid IS
'Whether this member has paid their contribution';
