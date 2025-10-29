"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendDateReminderEmail } from "@/lib/resend/send";
import { formatMonthDay } from "@/lib/utils/dates";

/**
 * Check for upcoming dates and send reminders
 * This should be called by a cron job or scheduled task
 *
 * @param daysAhead - How many days ahead to check (default: 1 for tomorrow)
 * @returns Object with counts of notifications sent and any errors
 */
export async function checkAndSendDateReminders(daysAhead: number = 1) {
  // Use admin client for service-level operations
  const supabase = createAdminClient();

  const currentYear = new Date().getFullYear();

  // Get upcoming dates that need notifications
  const { data: upcomingDates, error: queryError } = await supabase
    .rpc('get_upcoming_dates_for_notifications', {
      days_ahead: daysAhead,
      target_year: currentYear,
    });

  if (queryError) {
    console.error('Error fetching upcoming dates:', queryError);
    return { error: queryError.message, sent: 0 };
  }

  if (!upcomingDates || upcomingDates.length === 0) {
    return { sent: 0, message: 'No upcoming dates found' };
  }

  let sentCount = 0;
  const errors: Array<{ email: string; error: string }> = [];

  // Process each notification
  for (const dateInfo of upcomingDates) {
    try {
      // Create notification record first
      const { data: notification, error: notificationError } = await supabase
        .from('date_notifications')
        .insert({
          notified_user_id: dateInfo.notified_user_id,
          celebrant_id: dateInfo.celebrant_id,
          field_name: dateInfo.field_name,
          group_id: dateInfo.group_id,
          celebration_date: dateInfo.celebration_date,
          notification_year: currentYear,
          email_sent: false,
          banner_shown: true,
        })
        .select()
        .single();

      if (notificationError) {
        console.error('Error creating notification:', notificationError);
        errors.push({
          email: dateInfo.notified_user_email,
          error: notificationError.message,
        });
        continue;
      }

      // Send email
      try {
        await sendDateReminderEmail({
          toEmail: dateInfo.notified_user_email,
          recipientName: dateInfo.notified_user_email.split('@')[0], // Fallback, could be improved
          celebrantName: dateInfo.celebrant_username,
          celebrantUsername: dateInfo.celebrant_username,
          celebrantUserId: dateInfo.celebrant_id,
          dateType: dateInfo.field_name as 'birthday' | 'anniversary',
          celebrationDate: formatMonthDay(dateInfo.field_value),
          groupName: dateInfo.group_name,
          groupType: dateInfo.group_type,
        });

        // Update notification record to mark email as sent
        await supabase
          .from('date_notifications')
          .update({
            email_sent: true,
            email_sent_at: new Date().toISOString(),
          })
          .eq('id', notification.id);

        sentCount++;
      } catch (emailError) {
        console.error('Error sending reminder email:', emailError);
        errors.push({
          email: dateInfo.notified_user_email,
          error: emailError instanceof Error ? emailError.message : 'Failed to send email',
        });
      }
    } catch (error) {
      console.error('Error processing date reminder:', error);
      errors.push({
        email: dateInfo.notified_user_email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    sent: sentCount,
    total: upcomingDates.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Get active date reminders for the current user
 * Shows banners for dates happening today
 */
export async function getActiveDateReminders() {
  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "Not authenticated", data: [] };
    }

    // Get today's date reminders that haven't been dismissed
    const { data: reminders, error: remindersError } = await supabase
      .rpc('get_dates_today_for_user', { p_user_id: user.id });

    if (remindersError) {
      // Check if this is a "function does not exist" error (migration not run)
      const errorMessage = remindersError.message || '';

      if (errorMessage.includes('function') && errorMessage.includes('does not exist')) {
        console.warn('Date reminders feature not yet set up. Please run the database migration.');
        return { data: [] }; // Return empty array silently
      }

      console.error('Error fetching date reminders:', remindersError);
      return { data: [] }; // Return empty array to prevent UI crash
    }

    return { data: reminders || [] };
  } catch (error) {
    console.error('Unexpected error in getActiveDateReminders:', error);
    return { data: [] }; // Fail gracefully
  }
}

/**
 * Dismiss a date reminder banner
 */
export async function dismissDateReminder(notificationId: string) {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Update notification to mark banner as dismissed
  const { error: updateError } = await supabase
    .from('date_notifications')
    .update({
      banner_dismissed: true,
      banner_dismissed_at: new Date().toISOString(),
    })
    .eq('id', notificationId)
    .eq('notified_user_id', user.id); // Ensure user can only dismiss their own notifications

  if (updateError) {
    console.error('Error dismissing reminder:', updateError);
    return { error: updateError.message };
  }

  return { success: true };
}

/**
 * Manually trigger reminder check (for testing)
 * Only available in development
 */
export async function manualTriggerReminders(daysAhead: number = 1) {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Manual trigger only available in development' };
  }

  return await checkAndSendDateReminders(daysAhead);
}
