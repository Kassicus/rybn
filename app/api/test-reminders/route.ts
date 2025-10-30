import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Test endpoint to verify date reminders database setup
 * GET /api/test-reminders
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({
        error: "Not authenticated",
        userError: userError?.message
      }, { status: 401 });
    }

    // Test 1: Check if date_notifications table exists
    const { data: tableCheck, error: tableError } = await supabase
      .from('date_notifications')
      .select('id')
      .limit(1);

    // Test 2: Try calling the function
    const { data: functionResult, error: functionError } = await supabase
      .rpc('get_dates_today_for_user', { p_user_id: user.id });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email
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
