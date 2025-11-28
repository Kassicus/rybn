"use client";

import { useEffect } from "react";
import {
  useBreadcrumbContext,
  type BreadcrumbItem,
} from "@/lib/contexts/breadcrumb-context";

interface BreadcrumbSetterProps {
  items: BreadcrumbItem[];
}

export function BreadcrumbSetter({ items }: BreadcrumbSetterProps) {
  const { setBreadcrumbs } = useBreadcrumbContext();

  useEffect(() => {
    setBreadcrumbs(items);
    return () => setBreadcrumbs([]);
  }, [items, setBreadcrumbs]);

  return null;
}
