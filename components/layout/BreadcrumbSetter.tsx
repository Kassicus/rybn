"use client";

import { useEffect, useRef } from "react";
import {
  useBreadcrumbContext,
  type BreadcrumbItem,
} from "@/lib/contexts/breadcrumb-context";

interface BreadcrumbSetterProps {
  items: BreadcrumbItem[];
}

export function BreadcrumbSetter({ items }: BreadcrumbSetterProps) {
  const { setBreadcrumbs, registerPage } = useBreadcrumbContext();
  const hasRegistered = useRef(false);

  useEffect(() => {
    // Set the current page's breadcrumb items (for hierarchical display)
    setBreadcrumbs(items);

    // Register the current page in navigation history (only once per mount)
    // Use the last item as the current page
    if (items.length > 0 && !hasRegistered.current) {
      const currentPage = items[items.length - 1];
      registerPage(currentPage);
      hasRegistered.current = true;
    }

    // No cleanup - we don't clear breadcrumbs on unmount
    // This prevents the flash of empty breadcrumbs during navigation
  }, [items, setBreadcrumbs, registerPage]);

  return null;
}
