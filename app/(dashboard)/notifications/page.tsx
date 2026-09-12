import { Bell } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { NotificationsList } from "@/components/notifications/NotificationsList";
import { getActiveDateReminders } from "@/lib/actions/date-reminders";
import { getMyAnniversaryLink } from "@/lib/actions/anniversary-links";
import { unreadCount, type DateReminder } from "@/lib/notifications/unread";

/**
 * The bell's destination. It pointed here long before this page existed, so
 * clicking it 404'd; the badge dot meanwhile rendered unconditionally, which
 * meant the bell advertised unread items and then failed to show them.
 *
 * getActiveDateReminders() already fails closed on every error path it knows
 * about (returning `{ data: [] }` rather than throwing), so this page shows the
 * empty state rather than an error when reminders cannot be loaded -- the same
 * behaviour the dashboard banner has had all along.
 */
/**
 * Rendered per request, declared rather than inferred.
 *
 * Next detects a dynamic route by letting the DynamicServerError that
 * `headers()` throws propagate during the build's static-render probe.
 * getActiveDateReminders() wraps its body in a catch-all that returns
 * `{ data: [] }` on anything unexpected (lib/actions/date-reminders.ts:251-255)
 * -- deliberately, so a reminders outage cannot take down the dashboard -- and
 * that catch swallows the signal. This page is the first PAGE-level caller of
 * that action, which is why the build logs "Unexpected error in
 * getActiveDateReminders" exactly once and only here.
 *
 * Next still marked the route dynamic without this line, but on a mechanism
 * that had already been broken once: if the inference ever falls the other way,
 * this page prerenders with an empty list baked in and shows "You're all caught
 * up" permanently, to everyone, with nothing failing. Saying it outright costs
 * one line and does not depend on an error surviving a catch-all.
 */
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const [{ data }, anniversaryLinkResult] = await Promise.all([
    getActiveDateReminders(),
    getMyAnniversaryLink(),
  ]);
  const reminders = (data ?? []) as DateReminder[];
  // Same "no `data` key on the error branch" shape as the dashboard layout's
  // own getMyAnniversaryLink() call -- an error here just means no request
  // to show, not zero reminders either.
  const anniversaryLink =
    "data" in anniversaryLinkResult ? anniversaryLinkResult.data : null;
  const unread = unreadCount(reminders, anniversaryLink);

  return (
    <div className="max-w-3xl mx-auto space-y-8 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Notifications", href: "/notifications" },
        ]}
      />

      <div>
        <Heading level="h1" className="flex items-center gap-3">
          <Bell className="w-7 h-7 text-primary" />
          Notifications
        </Heading>
        <Text variant="secondary" className="mt-1">
          {unread > 0 ? `${unread} unread` : "You're all caught up"}
        </Text>
      </div>

      <NotificationsList reminders={reminders} anniversaryLink={anniversaryLink} />
    </div>
  );
}
