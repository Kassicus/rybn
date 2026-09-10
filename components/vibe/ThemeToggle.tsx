"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { useHydrated } from "@/hooks/useHydrated";

const ORDER = ["system", "light", "dark"] as const;
type Choice = (typeof ORDER)[number];

const LABEL: Record<Choice, string> = {
  system: "Theme: matching your system",
  light: "Theme: light",
  dark: "Theme: dark",
};

/**
 * Cycles system -> light -> dark. "System" is a real choice rather than an
 * absence of one, so it gets its own icon: a user who has never touched this
 * can still see that the app is following their OS.
 *
 * Renders a same-sized placeholder until hydration. The server cannot know
 * the resolved theme, so drawing an icon there would guarantee a mismatch --
 * and returning null instead would make the top bar reflow on every load.
 */
export function ThemeToggle() {
  const hydrated = useHydrated();
  const { theme, setTheme } = useTheme();

  if (!hydrated) {
    return <div className="h-9 w-9" aria-hidden="true" />;
  }

  const current = (ORDER as readonly string[]).includes(theme ?? "")
    ? (theme as Choice)
    : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = current === "system" ? Monitor : current === "dark" ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={LABEL[current]}
      aria-label={LABEL[current]}
      className="flex h-9 w-9 items-center justify-center rounded text-ink-soft transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
