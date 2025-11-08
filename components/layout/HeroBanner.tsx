"use client";

import { Heading, Text } from "@/components/ui/text";
import { Gift, Calendar, Users } from "lucide-react";

interface HeroBannerProps {
  userName?: string;
  stats?: {
    upcomingEvents?: number;
    activeGifts?: number;
    groupCount?: number;
  };
}

export function HeroBanner({ userName, stats }: HeroBannerProps) {
  const greeting = getGreeting();

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-8 mb-8 border border-primary/20">
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl -z-10" />

      <div className="relative z-10">
        <Heading level="h2" className="mb-2">
          {greeting}, {userName || "there"}!
        </Heading>
        <Text variant="secondary" size="lg" className="mb-6 max-w-2xl">
          Ready to make someone's day special?
        </Text>

        {/* Quick Stats */}
        {stats && (
          <div className="flex flex-wrap gap-6">
            {stats.upcomingEvents !== undefined && stats.upcomingEvents > 0 && (
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <Text className="font-medium text-light-text-primary">
                    {stats.upcomingEvents}
                  </Text>
                  <Text variant="secondary" size="sm">
                    {stats.upcomingEvents === 1 ? "upcoming event" : "upcoming events"}
                  </Text>
                </div>
              </div>
            )}

            {stats.activeGifts !== undefined && stats.activeGifts > 0 && (
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Gift className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <Text className="font-medium text-light-text-primary">
                    {stats.activeGifts}
                  </Text>
                  <Text variant="secondary" size="sm">
                    {stats.activeGifts === 1 ? "active gift" : "active gifts"}
                  </Text>
                </div>
              </div>
            )}

            {stats.groupCount !== undefined && stats.groupCount > 0 && (
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <Text className="font-medium text-light-text-primary">
                    {stats.groupCount}
                  </Text>
                  <Text variant="secondary" size="sm">
                    {stats.groupCount === 1 ? "group" : "groups"}
                  </Text>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  } else if (hour < 18) {
    return "Good afternoon";
  } else {
    return "Good evening";
  }
}
