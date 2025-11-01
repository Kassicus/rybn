-- Add UPDATE and DELETE policies for invitations table
-- This allows group members to resend/update invitations

-- STEP 1: Add UPDATE policy - allow group members to update invitations they sent
CREATE POLICY "Invitation senders can update their invitations"
  ON invitations FOR UPDATE
  USING (invited_by = auth.uid())
  WITH CHECK (invited_by = auth.uid());

-- STEP 2: Add DELETE policy - allow users to delete invitations they sent
CREATE POLICY "Invitation senders can delete their invitations"
  ON invitations FOR DELETE
  USING (invited_by = auth.uid());

-- STEP 3: Add another UPDATE policy - allow the invited user to accept the invitation
CREATE POLICY "Invited users can accept invitations"
  ON invitations FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Verify policies were created
SELECT
  schemaname,
  tablename,
  policyname,
  cmd as command,
  '✅ Policy created' as status
FROM pg_policies
WHERE tablename = 'invitations'
  AND policyname IN (
    'Invitation senders can update their invitations',
    'Invitation senders can delete their invitations',
    'Invited users can accept invitations'
  )
ORDER BY policyname;
