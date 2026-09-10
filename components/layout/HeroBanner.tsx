"use client";

import { useHydrated } from "@/hooks/useHydrated";
import { Heading, Text } from "@/components/ui/text";

interface HeroBannerProps {
  userName?: string;
  stats?: {
    upcomingEvents?: number;
    activeGifts?: number;
    groupCount?: number;
  };
}

type Stat = { value: number; label: (n: number) => string };
type MaybeStat = { value: number | undefined; label: (n: number) => string };

export function HeroBanner({ userName, stats }: HeroBannerProps) {
  // getGreeting() reads the clock, so it cannot run while rendering on the
  // server: the two sides can straddle a boundary like noon and disagree.
  const greeting = useHydrated() ? getGreeting() : "Hello";

  // Zeroes are omitted rather than shown: an empty dashboard should not open
  // with three noughts.
  const candidates: MaybeStat[] = [
    { value: stats?.upcomingEvents, label: (n) => (n === 1 ? "upcoming event" : "upcoming events") },
    { value: stats?.activeGifts, label: (n) => (n === 1 ? "active gift" : "active gifts") },
    { value: stats?.groupCount, label: (n) => (n === 1 ? "group" : "groups") },
  ];
  const shown = candidates.filter(
    (s): s is Stat => typeof s.value === "number" && s.value > 0
  );

  return (
    <div className="relative overflow-hidden rounded-xl border border-hero-line bg-hero p-8 dark:rounded-none dark:border-0 dark:p-0 md:p-10 dark:md:p-0">
      {/* Two soft washes behind the copy, light mode only. Over a dark
          ground a large blur reads as banding, not atmosphere. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-accent/20 blur-3xl dark:hidden"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 right-36 h-52 w-52 rounded-full bg-gold/15 blur-3xl dark:hidden"
      />

      <div className="relative flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <Heading level="h2" className="font-display text-hero-ink">
            {greeting}, {userName || "there"}
          </Heading>
          <Text size="lg" className="max-w-2xl text-hero-soft">
            Ready to make someone&apos;s day special?
          </Text>
        </div>

        {shown.length > 0 && (
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            {shown.map((stat) => (
              <div key={stat.label(stat.value)} className="flex flex-col gap-1">
                <span className="font-display text-3xl font-semibold leading-none text-hero-stat">
                  {stat.value}
                </span>
                <Text size="sm" className="text-hero-soft">
                  {stat.label(stat.value)}
                </Text>
              </div>
            ))}
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
