#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  console.error('Need: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('🔄 Adding email_preferences column to user_profiles...\n');

const sql = `
-- Add email_preferences column to user_profiles table
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS email_preferences JSONB DEFAULT '{
  "email_group_invites": true,
  "email_date_reminders": true,
  "email_gift_updates": true,
  "email_exchange_notifications": true,
  "email_marketing": false
}'::jsonb;

-- Add a comment to document the column
COMMENT ON COLUMN user_profiles.email_preferences IS 'User email notification preferences in JSONB format';

-- Create an index for faster JSON queries on email preferences
CREATE INDEX IF NOT EXISTS idx_user_profiles_email_preferences
ON user_profiles USING GIN (email_preferences);
`;

try {
  const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql });

  if (error) {
    // If exec_sql doesn't exist, try direct SQL execution
    const { error: directError } = await supabase.from('user_profiles').select('email_preferences').limit(1);

    if (directError && directError.message.includes('does not exist')) {
      console.log('⚠️  Column does not exist yet. We need to run the migration via Supabase dashboard.\n');
      console.log('📋 Copy this SQL and run it in Supabase Dashboard > SQL Editor:\n');
      console.log('─'.repeat(60));
      console.log(sql);
      console.log('─'.repeat(60));
      console.log('\n🔗 Dashboard URL: https://supabase.com/dashboard');
      process.exit(1);
    } else {
      console.log('✅ Column already exists or migration not needed!');
    }
  } else {
    console.log('✅ Migration completed successfully!');
  }
} catch (err) {
  console.error('❌ Error:', err.message);
  console.log('\n📋 Please run this SQL manually in Supabase Dashboard:\n');
  console.log('─'.repeat(60));
  console.log(sql);
  console.log('─'.repeat(60));
  console.log('\n🔗 Dashboard URL: https://supabase.com/dashboard');
}
