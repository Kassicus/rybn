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
 *
 * Task 9 adds a second source of unread: an incoming, still-pending
 * anniversary link request (getMyAnniversaryLink()). Both the bell (the
 * dashboard layout) and the page (NotificationsList) run it through
 * isIncomingAnniversaryRequest()/unreadCount() below rather than each
 * re-deriving "is this something the user still needs to act on" -- the same
 * one-shared-filter reasoning this module already existed for.
 */

import type { AnniversaryLink } from "@/lib/actions/anniversary-links";

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

/**
 * True when `link` is sitting in the caller's OWN queue to act on: pending,
 * and not the request they themselves sent. A link the caller initiated has
 * nothing to confirm or decline from their side, and a confirmed link has
 * nothing left to act on at all -- neither counts as unread here.
 */
export function isIncomingAnniversaryRequest(
  link: AnniversaryLink | null | undefined,
): boolean {
  return !!link && link.status === "pending" && !link.initiatedByMe;
}

export function unreadCount(
  reminders: Array<{ banner_dismissed: boolean }> | null | undefined,
  anniversaryLink?: AnniversaryLink | null,
): number {
  return (
    unreadReminders(reminders ?? []).length +
    (isIncomingAnniversaryRequest(anniversaryLink) ? 1 : 0)
  );
}
