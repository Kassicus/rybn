"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/useHydrated";

export function ThemeToggle() {
  // Rendering nothing until hydration keeps the server markup (which cannot
  // know the theme) from disagreeing with the client.
  const mounted = useHydrated();
  const { theme, setTheme } = useTheme();

  if (!mounted) {
    return null;
  }

  return (
    <Button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      variant="tertiary"
      size="small"
      className="h-8 w-8 p-0"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </Button>
  );
}
