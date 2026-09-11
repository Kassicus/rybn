/**
 * What counts as an UNREAD notification, in one place.
 *
 * The bell's badge and the /notifications page have to agree about this or the
 * badge lies -- which is how the bell got into trouble in the first place: it
 * rendered its dot unconditionally, claiming something to see whether or not
 * anything was there, and then navigated to a route that did not exist.
 *
 * getActiveDateReminders() returns today's reminders INCLUDING ones already
 * dismissed, because DateReminderBanner filters them itself at render time
 * (components/reminders/DateReminderBanner.tsx:30-33). Anything counting raw
 * `.length` would therefore over-report the moment a banner is dismissed.
 */

/** The row shape get_dates_today_for_user() returns. */
export type DateReminder = {
  celebrant_id: string;
  celebrant_username: string;
  celebrant_display_name: string | null;
  field_name: string;
  celebration_date: string;
  group_id: string;
  group_name: string;
  group_type: string;
  notification_id: string;
  banner_dismissed: boolean;
};

/** Reminders the user has not dismissed yet -- the ones the badge speaks for. */
export function unreadReminders<T extends { banner_dismissed: boolean }>(
  reminders: T[],
): T[] {
  return reminders.filter((r) => !r.banner_dismissed);
}

export function unreadCount(
  reminders: Array<{ banner_dismissed: boolean }> | null | undefined,
): number {
  return unreadReminders(reminders ?? []).length;
}
