-- =================================================================
-- Enable Realtime for Messages Table
-- Allows real-time updates in the chat window
-- =================================================================

-- Enable realtime for the messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Grant necessary permissions for realtime
GRANT SELECT ON messages TO authenticated;
