"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ReactNode } from "react";

interface RybnThemeProviderProps {
  children: ReactNode;
}

/**
 * Theme root. Follows the operating system by default and can be overridden
 * from the toggle in the top bar; the choice persists per browser.
 *
 * No mounted-gate here, deliberately. The previous version rendered children
 * OUTSIDE the provider until hydration, which defeated the whole mechanism:
 * next-themes injects a small blocking script that sets the class on <html>
 * before first paint, and skipping the provider on the server meant the page
 * painted light and then snapped to dark. Rendering the provider on both
 * sides is what makes the theme correct in the very first frame.
 *
 * `attribute="class"` pairs with `darkMode: "class"` in tailwind.config.ts.
 * The <html> element carries suppressHydrationWarning (see app/layout.tsx)
 * because that script edits it before React hydrates -- expected, not a bug.
 */
export function RybnThemeProvider({ children }: RybnThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
