-- =================================================================
-- Gift Exchange System Migration
-- Creates gift_exchanges and gift_exchange_participants tables
-- For coordinating gift exchanges (Secret Santa, White Elephant, etc.)
-- =================================================================

-- Gift exchange events
CREATE TABLE IF NOT EXISTS gift_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  exchange_type TEXT DEFAULT 'secret_santa' CHECK (exchange_type IN ('secret_santa', 'white_elephant', 'yankee_swap', 'custom')),
  budget_min DECIMAL(10, 2),
  budget_max DECIMAL(10, 2),
  exchange_date TIMESTAMPTZ,
  exchange_location TEXT,
  exchange_details TEXT,
  registration_deadline TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  assignments_generated BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gift exchange participants
CREATE TABLE IF NOT EXISTS gift_exchange_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id UUID REFERENCES gift_exchanges(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  opted_in BOOLEAN DEFAULT TRUE,
  assigned_to UUID REFERENCES auth.users(id),
  wishlist_shared BOOLEAN DEFAULT FALSE,
  gift_sent BOOLEAN DEFAULT FALSE,
  gift_received BOOLEAN DEFAULT FALSE,
  notes TEXT,
  preferences TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exchange_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_gift_exchanges_group_id ON gift_exchanges(group_id);
CREATE INDEX IF NOT EXISTS idx_gift_exchanges_created_by ON gift_exchanges(created_by);
CREATE INDEX IF NOT EXISTS idx_gift_exchanges_is_active ON gift_exchanges(is_active);
CREATE INDEX IF NOT EXISTS idx_gift_exchanges_exchange_date ON gift_exchanges(exchange_date);

CREATE INDEX IF NOT EXISTS idx_gift_exchange_participants_exchange ON gift_exchange_participants(exchange_id);
CREATE INDEX IF NOT EXISTS idx_gift_exchange_participants_user ON gift_exchange_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_gift_exchange_participants_assigned_to ON gift_exchange_participants(assigned_to);

-- Enable RLS
ALTER TABLE gift_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_exchange_participants ENABLE ROW LEVEL SECURITY;

-- =================================================================
-- RLS Policies for gift_exchanges
-- =================================================================

-- Users can view gift exchanges in groups they're members of
CREATE POLICY "Users can view gift exchanges in their groups"
  ON gift_exchanges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = gift_exchanges.group_id
      AND group_members.user_id = auth.uid()
    )
  );

-- Users can create gift exchanges in groups they're members of
CREATE POLICY "Users can create gift exchanges in their groups"
  ON gift_exchanges FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = gift_exchanges.group_id
      AND group_members.user_id = auth.uid()
    )
  );

-- Only creators can update gift exchanges
CREATE POLICY "Creators can update gift exchanges"
  ON gift_exchanges FOR UPDATE
  USING (auth.uid() = created_by);

-- Only creators can delete gift exchanges
CREATE POLICY "Creators can delete gift exchanges"
  ON gift_exchanges FOR DELETE
  USING (auth.uid() = created_by);

-- =================================================================
-- RLS Policies for gift_exchange_participants
-- =================================================================

-- Participants can view other participants in the same exchange
CREATE POLICY "Participants can view exchange participants"
  ON gift_exchange_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM gift_exchange_participants AS gep
      WHERE gep.exchange_id = gift_exchange_participants.exchange_id
      AND gep.user_id = auth.uid()
    )
  );

-- Users can join gift exchanges (creator can add others)
CREATE POLICY "Users can join gift exchanges"
  ON gift_exchange_participants FOR INSERT
  WITH CHECK (
    -- Either joining yourself or creator is adding you
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM gift_exchanges
      WHERE gift_exchanges.id = gift_exchange_participants.exchange_id
      AND gift_exchanges.created_by = auth.uid()
    )
  );

-- Users can update their own participation
CREATE POLICY "Users can update their own participation"
  ON gift_exchange_participants FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can leave gift exchanges
CREATE POLICY "Users can leave gift exchanges"
  ON gift_exchange_participants FOR DELETE
  USING (auth.uid() = user_id);

-- Creators can remove participants
CREATE POLICY "Creators can remove participants"
  ON gift_exchange_participants FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM gift_exchanges
      WHERE gift_exchanges.id = gift_exchange_participants.exchange_id
      AND gift_exchanges.created_by = auth.uid()
    )
  );

-- =================================================================
-- Triggers
-- =================================================================

-- Update gift_exchanges updated_at
CREATE TRIGGER update_gift_exchanges_updated_at
  BEFORE UPDATE ON gift_exchanges
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =================================================================
-- Constraints
-- =================================================================

ALTER TABLE gift_exchanges ADD CONSTRAINT valid_budget_range
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max);

ALTER TABLE gift_exchanges ADD CONSTRAINT valid_budget_min
  CHECK (budget_min IS NULL OR budget_min >= 0);

ALTER TABLE gift_exchanges ADD CONSTRAINT valid_budget_max
  CHECK (budget_max IS NULL OR budget_max >= 0);

ALTER TABLE gift_exchanges ADD CONSTRAINT name_length
  CHECK (char_length(name) >= 1 AND char_length(name) <= 200);

ALTER TABLE gift_exchange_participants ADD CONSTRAINT notes_length
  CHECK (notes IS NULL OR char_length(notes) <= 1000);

-- Prevent self-assignment
ALTER TABLE gift_exchange_participants ADD CONSTRAINT no_self_assignment
  CHECK (user_id != assigned_to OR assigned_to IS NULL);

-- =================================================================
-- Comments
-- =================================================================

COMMENT ON TABLE gift_exchanges IS
'Gift exchange events (Secret Santa, White Elephant, etc.) within groups';

COMMENT ON TABLE gift_exchange_participants IS
'Participants in gift exchange events with their assignments';

COMMENT ON COLUMN gift_exchanges.exchange_type IS
'Type of exchange: secret_santa, white_elephant, yankee_swap, or custom';

COMMENT ON COLUMN gift_exchanges.assignments_generated IS
'Whether assignments have been generated for this exchange';

COMMENT ON COLUMN gift_exchange_participants.assigned_to IS
'The user this participant should give a gift to (kept secret)';

COMMENT ON COLUMN gift_exchange_participants.wishlist_shared IS
'Whether this participant has shared their wishlist';

COMMENT ON COLUMN gift_exchange_participants.preferences IS
'Additional preferences or restrictions for gift giving';
