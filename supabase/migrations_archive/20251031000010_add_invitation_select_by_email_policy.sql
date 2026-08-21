-- Add RLS policy to allow users to view invitations sent to their email
-- This is needed for the accept invitation flow

CREATE POLICY "Users can view invitations to their email"
  ON invitations FOR SELECT
  USING (
    email IN (
      SELECT email FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Verify the policy was created
SELECT
  policyname,
  cmd as command,
  '✅ Policy created' as status
FROM pg_policies
WHERE tablename = 'invitations'
  AND policyname = 'Users can view invitations to their email';
