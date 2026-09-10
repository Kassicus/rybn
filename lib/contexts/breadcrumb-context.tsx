"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

interface BreadcrumbContextValue {
  items: BreadcrumbItem[];
  history: BreadcrumbItem[];
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
  registerPage: (item: BreadcrumbItem) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | undefined>(
  undefined
);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([]);
  const [history, setHistory] = useState<BreadcrumbItem[]>([]);
  const pathname = usePathname();
  // Reset the trail when the user lands back on the dashboard. Adjusting
  // during render rather than from an effect: React re-runs this component
  // before committing, so children never paint a frame of stale history.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (pathname === "/dashboard") {
      setHistory([]);
    }
  }

  // Track navigation history based on actual route changes
  const registerPage = useCallback((item: BreadcrumbItem) => {
    setHistory((prev) => {
      // Check if we're navigating back to a page already in history
      const existingIndex = prev.findIndex((h) => h.href === item.href);

      if (existingIndex !== -1) {
        // User navigated back - truncate history to that point
        return prev.slice(0, existingIndex + 1);
      }

      // New page - add to history
      // Avoid duplicate consecutive entries
      if (prev.length > 0 && prev[prev.length - 1].href === item.href) {
        return prev;
      }

      return [...prev, item];
    });
  }, []);

  const setBreadcrumbs = useCallback((newItems: BreadcrumbItem[]) => {
    setItems(newItems);
  }, []);

  return (
    <BreadcrumbContext.Provider value={{ items, history, setBreadcrumbs, registerPage }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbContext() {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error(
      "useBreadcrumbContext must be used within BreadcrumbProvider"
    );
  }
  return context;
}
