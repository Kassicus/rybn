"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Cake, Heart, Check, X, BellOff, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { Heading, Text } from "@/components/ui/text";
import { dismissDateReminder } from "@/lib/actions/date-reminders";
import {
  confirmAnniversaryLink,
  declineAnniversaryLink,
  type AnniversaryLink,
} from "@/lib/actions/anniversary-links";
import { formatMonthDay } from "@/lib/utils/dates";
import { isIncomingAnniversaryRequest, type DateReminder } from "@/lib/notifications/unread";

interface NotificationsListProps {
  reminders: DateReminder[];
  /**
   * The caller's own anniversary link, if any. Only rendered here when it is
   * an INCOMING pending request (isIncomingAnniversaryRequest) -- a request
   * the caller sent themselves lives on the profile page
   * (components/profile/AnniversaryPartner.tsx), and a confirmed link has
   * nothing left to act on from a notifications list.
   */
  anniversaryLink?: AnniversaryLink | null;
}

/**
 * The full list behind the bell. DateReminderBanner shows the same reminders
 * as a dismissable banner on every dashboard page; this shows all of them,
 * including ones already dismissed, so dismissing from the banner does not
 * make a notification unfindable -- it marks it read.
 *
 * Same icon vocabulary (Cake / Heart) DateReminderBanner and
 * UpcomingOccasions already use, so the three surfaces do not each invent
 * their own visual language for the same two occasion kinds.
 */
export function NotificationsList({
  reminders,
  anniversaryLink = null,
}: NotificationsListProps) {
  const router = useRouter();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [linkActionLoading, setLinkActionLoading] = useState(false);
  const [linkActionError, setLinkActionError] = useState<string | null>(null);

  const handleDismiss = async (notificationId: string) => {
    setIsLoading(notificationId);
    try {
      const result = await dismissDateReminder(notificationId);
      if (result.error) {
        console.error("Failed to dismiss reminder:", result.error);
        return;
      }
      setDismissedIds((prev) => new Set([...prev, notificationId]));
    } catch (error) {
      console.error("Error dismissing reminder:", error);
    } finally {
      setIsLoading(null);
    }
  };

  const showRequest = isIncomingAnniversaryRequest(anniversaryLink);
  const partnerLabel =
    anniversaryLink?.partnerDisplayName ||
    anniversaryLink?.partnerUsername ||
    "Your partner";

  // Either action retires the request from this list -- confirm applies it,
  // decline (available to either participant since Task 3's correction)
  // withdraws it. router.refresh() re-runs the server components on this
  // route, which is also how the bell's badge (computed in the dashboard
  // layout from this same getMyAnniversaryLink() call) stops claiming an
  // unread request that was just handled.
  const handleConfirmLink = async () => {
    if (!anniversaryLink) return;
    setLinkActionLoading(true);
    setLinkActionError(null);
    const result = await confirmAnniversaryLink(anniversaryLink.id);
    setLinkActionLoading(false);
    if ("error" in result) {
      setLinkActionError(result.error);
      return;
    }
    router.refresh();
  };

  const handleDeclineLink = async () => {
    if (!anniversaryLink) return;
    setLinkActionLoading(true);
    setLinkActionError(null);
    const result = await declineAnniversaryLink(anniversaryLink.id);
    setLinkActionLoading(false);
    if ("error" in result) {
      setLinkActionError(result.error);
      return;
    }
    router.refresh();
  };

  if (reminders.length === 0 && !showRequest) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mb-4">
          <BellOff className="w-8 h-8 text-primary" />
        </div>
        <Heading level="h3" className="mb-2">
          Nothing new
        </Heading>
        <Text variant="secondary" className="max-w-sm">
          Birthdays and anniversaries in your groups show up here on the day.
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showRequest && anniversaryLink && (
        // Stacks below sm: for the same reason the group member / gift
        // exchange participant cards do (76c1214): a name plus two buttons
        // cannot share a row at 375px. min-w-0 on the text block, shrink-0
        // on the icon well.
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-primary-200 bg-primary-50 sm:flex-row sm:items-start">
          <div className="shrink-0 w-10 h-10 rounded-full bg-white flex items-center justify-center">
            <HeartHandshake className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {/* No truncate: the partner's name is embedded in a full
                sentence here rather than isolated, so there's no
                fixed-length token to clip -- it wraps instead. */}
            <Text>
              <span className="font-medium">{partnerLabel}</span> wants to
              share an anniversary with you
            </Text>
            {/* Load-bearing, not decoration: confirming OVERWRITES the
                accepting partner's own anniversary date, so the consequence
                is stated outright, naming the date, before either button is
                pressable. */}
            <Text size="sm">
              {partnerLabel} says your shared anniversary is{" "}
              {formatMonthDay(anniversaryLink.agreedDate)}. Confirming will
              set your anniversary to that date.
            </Text>
            {linkActionError && (
              <Text size="sm" className="text-error">
                {linkActionError}
              </Text>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="small"
                onClick={handleConfirmLink}
                loading={linkActionLoading}
              >
                <Check className="w-4 h-4" />
                Confirm
              </Button>
              <Button
                variant="tertiary"
                size="small"
                onClick={handleDeclineLink}
                loading={linkActionLoading}
              >
                <X className="w-4 h-4" />
                Decline
              </Button>
            </div>
          </div>
        </div>
      )}

      {reminders.map((reminder) => {
        const isRead =
          reminder.banner_dismissed || dismissedIds.has(reminder.notification_id);
        const name =
          reminder.celebrant_display_name || reminder.celebrant_username;
        const isBirthday = reminder.field_name === "birthday";
        const Icon = isBirthday ? Cake : Heart;

        return (
          <div
            key={reminder.notification_id}
            className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
              isRead
                ? "border-light-border bg-transparent"
                : "border-primary-200 bg-primary-50"
            }`}
          >
            <div
              className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                isRead ? "bg-light-background-hover" : "bg-white"
              }`}
            >
              <Icon
                className={`w-5 h-5 ${
                  isRead ? "text-light-text-secondary" : "text-primary"
                }`}
              />
            </div>

            <div className="flex-1 min-w-0">
              <Text className={isRead ? "text-light-text-secondary" : ""}>
                <Link href={`/profile/${reminder.celebrant_id}`}>{name}</Link>
                {isBirthday ? "'s birthday is" : "'s anniversary is"}{" "}
                {formatMonthDay(reminder.celebration_date)}
              </Text>
              <Text variant="secondary" className="text-sm mt-0.5">
                in {reminder.group_name}
              </Text>
              <div className="mt-2">
                <Link href={`/wishlist/user/${reminder.celebrant_id}`}>
                  View their wishlist
                </Link>
              </div>
            </div>

            {!isRead && (
              <Button
                variant="tertiary"
                size="small"
                onClick={() => handleDismiss(reminder.notification_id)}
                disabled={isLoading === reminder.notification_id}
                aria-label="Mark as read"
              >
                <Check className="w-4 h-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
