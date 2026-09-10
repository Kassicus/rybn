import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUserId } from '@/lib/auth/require-auth';

/**
 * Test endpoint to verify date reminders database setup
 * GET /api/test-reminders
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get current user
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json({
        error: "Not authenticated"
      }, { status: 401 });
    }

    // Email lives on the profile row now; Clerk's auth() only returns ids.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    // Test 1: Check if date_notifications table exists
    const { error: tableError } = await supabase
      .from('date_notifications')
      .select('id')
      .limit(1);

    // Test 2: Try calling the function
    const { data: functionResult, error: functionError } = await supabase
      .rpc('get_dates_today_for_user', { p_user_id: userId });

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        email: profile?.email ?? null
      },
      tests: {
        tableExists: !tableError,
        tableError: tableError ? {
          message: tableError.message,
          code: (tableError as any).code,
          details: (tableError as any).details,
          hint: (tableError as any).hint
        } : null,
        functionWorks: !functionError,
        functionError: functionError ? {
          message: functionError.message,
          code: (functionError as any).code,
          details: (functionError as any).details,
          hint: (functionError as any).hint
        } : null,
        functionResult: functionResult
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Unexpected error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
