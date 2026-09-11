"use client";

import { useState } from "react";
import { Cake, Heart, Check, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { Heading, Text } from "@/components/ui/text";
import { dismissDateReminder } from "@/lib/actions/date-reminders";
import { formatMonthDay } from "@/lib/utils/dates";
import type { DateReminder } from "@/lib/notifications/unread";

interface NotificationsListProps {
  reminders: DateReminder[];
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
export function NotificationsList({ reminders }: NotificationsListProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState<string | null>(null);

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

  if (reminders.length === 0) {
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
