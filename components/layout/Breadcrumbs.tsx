"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useBreadcrumbContext } from "@/lib/contexts/breadcrumb-context";

export function Breadcrumbs() {
  const { items } = useBreadcrumbContext();

  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden md:block mb-6">
      <ol className="flex items-center gap-2 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.href} className="flex items-center gap-2">
              {index > 0 && (
                <ChevronRight className="w-4 h-4 text-light-text-secondary flex-shrink-0" />
              )}
              {isLast ? (
                <span className="text-light-text-primary font-medium truncate max-w-[200px]">
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
