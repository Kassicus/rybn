"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useBreadcrumbContext, type BreadcrumbItem } from "@/lib/contexts/breadcrumb-context";

export function Breadcrumbs() {
  const { items, history } = useBreadcrumbContext();

  // Smart display logic:
  // - If user has navigated (history > 1), show the actual navigation history
  // - Otherwise, show the hierarchical breadcrumbs from the current page
  // This ensures:
  // 1. Direct page visits show proper hierarchy (Dashboard > Section > Page)
  // 2. Navigation shows actual path taken (Page A > Page B > Page C)
  const displayItems: BreadcrumbItem[] =
    history.length > 1 ? history : items;

  if (displayItems.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden md:block mb-6">
      <ol className="flex items-center gap-2 text-sm">
        {displayItems.map((item, index) => {
          const isLast = index === displayItems.length - 1;
          return (
            <li key={`${item.href}-${index}`} className="flex items-center gap-2">
              {index > 0 && (
                <ChevronRight className="w-4 h-4 text-light-text-secondary flex-shrink-0" />
              )}
              {isLast ? (
                <span
                  className="text-light-text-primary font-medium truncate max-w-[200px]"
                  aria-current="page"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-light-text-secondary hover:text-primary transition-colors truncate max-w-[200px]"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
