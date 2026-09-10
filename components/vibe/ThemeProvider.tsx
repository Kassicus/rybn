"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ReactNode } from "react";
import { useHydrated } from "@/hooks/useHydrated";

interface RybnThemeProviderProps {
  children: ReactNode;
}

export function RybnThemeProvider({ children }: RybnThemeProviderProps) {
  // Prevent hydration mismatch
  const mounted = useHydrated();

  if (!mounted) {
    return <div suppressHydrationWarning>{children}</div>;
  }

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}
