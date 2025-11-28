"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

interface BreadcrumbContextValue {
  items: BreadcrumbItem[];
  setBreadcrumbs: (items: BreadcrumbItem[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | undefined>(
  undefined
);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([]);

  const setBreadcrumbs = useCallback((newItems: BreadcrumbItem[]) => {
    setItems(newItems);
  }, []);

  return (
    <BreadcrumbContext.Provider value={{ items, setBreadcrumbs }}>
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
