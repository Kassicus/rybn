"use server";

import { createHash, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendDateReminderEmail } from "@/lib/resend/send";
import { formatMonthDay } from "@/lib/utils/dates";

import { getUserId } from "@/lib/auth/require-auth";

/**
 * Whether the caller presented CRON_SECRET.
 *
 * Digest-then-compare, not `===`. This decides access on an endpoint anyone
 * can POST to, so a byte-by-byte comparison is a timing oracle for the secret.
 * Hashing both sides first makes them 32 bytes each, which also stops
 * timingSafeEqual from leaking the secret's length through the early return.
 *
 * Fails CLOSED when CRON_SECRET is unset. An unconfigured deployment must send
 * no mail rather than let anyone trigger it.
 */
function presentsCronSecret(provided: string | undefined | null): boolean {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error(
      "checkAndSendDateReminders: CRON_SECRET is not configured -- refusing to run"
    );
    return false;
  }

  if (!provided) {
    return false;
  }

  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest()
  );
}

/**
 * Check for upcoming dates and send reminders.
 *
 * THE SECRET IS CHECKED HERE, not only in the route that calls this.
 *
 * This file is "use server", so every export is a publicly reachable HTTP
 * endpoint whether or not any component references it. This particular one
 * runs on the SERVICE-ROLE client and reads every user's email address,
 * display name, birthdate, group names and Clerk id, then mails them -- so
 * with no identity check it was a full unauthenticated read of the user table
 * plus an open mail relay. The CRON_SECRET check lived on
 * /api/cron/check-date-reminders, i.e. on ONE CALLER, and a guard on a caller
 * guards only that caller.
 *
 * Which is why the secret is a parameter rather than something read from the
 * request: a server action has no request to inspect. Passing it makes the
 * authorisation explicit at every call site and impossible to forget by adding
 * a second one.
 *
 * @param cronSecret - CRON_SECRET, proving this is a scheduled invocation
 * @param daysAhead - How many days ahead to check (default: 1 for tomorrow)
 * @returns Object with counts of notifications sent and any errors
 */
export async function checkAndSendDateReminders(
  cronSecret: string | undefined,
  daysAhead: number = 1
) {
  if (!presentsCronSecret(cronSecret)) {
    console.error("checkAndSendDateReminders: rejected unauthorised invocation");
    return { error: "Not authorized", sent: 0 };
  }

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
    const userId = await getUserId();

    if (!userId) {
      return { error: "Not authenticated", data: [] };
    }

    // Get today's date reminders that haven't been dismissed
    const { data: reminders, error: remindersError } = await supabase
      .rpc('get_dates_today_for_user', { p_user_id: userId });

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
  const userId = await getUserId();

  if (!userId) {
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
    .eq('notified_user_id', userId); // Ensure user can only dismiss their own notifications

  if (updateError) {
    console.error('Error dismissing reminder:', updateError);
    return { error: updateError.message };
  }

  return { success: true };
}

/**
 * Manually trigger reminder check (for testing).
 *
 * Has no callers; /api/cron/check-date-reminders does the same job with a
 * URL you can open. Kept as the programmatic form, but it is a second door
 * onto the same service-role read, so it carries the same lock: NODE_ENV was
 * never a check, it was a hope that NODE_ENV is what you think it is on the
 * host you are deployed to. The secret is what decides.
 */
export async function manualTriggerReminders(
  cronSecret: string | undefined,
  daysAhead: number = 1
) {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Manual trigger only available in development' };
  }

  return await checkAndSendDateReminders(cronSecret, daysAhead);
}
