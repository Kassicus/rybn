"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { X, Cake, Heart } from "lucide-react";
import { dismissDateReminder } from "@/lib/actions/date-reminders";
import { formatMonthDay } from "@/lib/utils/dates";

interface DateReminderBannerProps {
  reminders: Array<{
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
  }>;
}

export function DateReminderBanner({ reminders }: DateReminderBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState<string | null>(null);

  // Filter out dismissed reminders
  const activeReminders = reminders.filter(
    (r) => !r.banner_dismissed && !dismissedIds.has(r.notification_id)
  );

  if (activeReminders.length === 0) {
    return null;
  }

  const handleDismiss = async (notificationId: string) => {
    setIsLoading(notificationId);

    try {
      const result = await dismissDateReminder(notificationId);

      if (result.error) {
        console.error("Failed to dismiss reminder:", result.error);
        return;
      }

      // Add to local dismissed set for immediate UI update
      setDismissedIds((prev) => new Set([...prev, notificationId]));
    } catch (error) {
      console.error("Error dismissing reminder:", error);
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      {activeReminders.map((reminder) => {
        const isBirthday = reminder.field_name === "birthday";
        const Icon = isBirthday ? Cake : Heart;
        const celebrantName = reminder.celebrant_display_name || reminder.celebrant_username;
        const dateLabel = isBirthday ? "Birthday" : "Anniversary";

        return (
          <Alert
            key={reminder.notification_id}
            className="border-blue-500 bg-blue-50"
          >
            <Icon className="h-4 w-4 text-blue-600" />
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <AlertTitle className="text-blue-900">
                  {dateLabel} Reminder
                </AlertTitle>
                <AlertDescription className="text-blue-800">
                  <strong>{celebrantName}</strong> from your{" "}
                  <strong>{reminder.group_name}</strong> group has a special day today!
                  <br />
                  <span className="text-sm">
                    {dateLabel}: {formatMonthDay(reminder.celebration_date)}
                  </span>
                </AlertDescription>
                <div className="flex gap-2 pt-2">
                  <Link
                    href={`/wishlist/${reminder.celebrant_id}`}
                    className="text-sm font-medium text-blue-700 hover:text-blue-800 underline"
                  >
                    View Wishlist
                  </Link>
                  <span className="text-blue-400">•</span>
                  <Link
                    href={`/profile/${reminder.celebrant_id}`}
                    className="text-sm font-medium text-blue-700 hover:text-blue-800 underline"
                  >
                    View Profile
                  </Link>
                </div>
              </div>
              <Button
                variant="tertiary"
                size="small"
                onClick={() => handleDismiss(reminder.notification_id)}
                disabled={isLoading === reminder.notification_id}
                className="text-blue-600 hover:text-blue-700 h-8 w-8 p-0"
                aria-label="Dismiss reminder"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Alert>
        );
      })}
    </div>
  );
}
