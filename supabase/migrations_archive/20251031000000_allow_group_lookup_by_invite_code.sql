-- Fix: Allow authenticated users to view groups by invite code
-- This is necessary for the joinGroupByCode function to work
-- Users need to be able to look up a group by invite code BEFORE they become members

CREATE POLICY "Authenticated users can view groups by invite code"
  ON groups FOR SELECT
  TO authenticated
  USING (true);
