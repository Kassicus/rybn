"use client";

import { useEffect, useRef } from "react";
import { SearchResult, SearchResultType } from "@/lib/search/searchEngine";
import { SearchResultItem } from "./SearchResultItem";
import { Loader2 } from "lucide-react";

interface SearchResultsProps {
  results: SearchResult[];
  groupedResults: Record<string, SearchResult[]>;
  isLoading: boolean;
  isEmpty: boolean;
  query: string;
  onClose: () => void;
  onResultClick: () => void;
}

const TYPE_LABELS: Record<SearchResultType, string> = {
  person: "People",
  group: "Groups",
  wishlist: "Wishlist Items",
  gift: "Group Gifts",
  exchange: "Exchanges",
  tracked_gift: "Gift Tracker",
};

const TYPE_ORDER: SearchResultType[] = ["person", "group", "exchange", "wishlist", "gift", "tracked_gift"];

export function SearchResults({
  results,
  groupedResults,
  isLoading,
  isEmpty,
  query,
  onClose,
  onResultClick,
}: SearchResultsProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (!query || query.length < 2) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 right-0 mt-2 bg-light-background border border-light-border rounded-lg shadow-lg max-h-[500px] overflow-y-auto z-50"
      role="listbox"
      aria-label="Search results"
    >
      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-light-text-secondary" />
          <span className="ml-2 text-sm text-light-text-secondary">Searching...</span>
        </div>
      )}

      {/* Empty State */}
      {isEmpty && !isLoading && (
        <div className="py-8 px-4 text-center">
          <p className="text-sm text-light-text-primary">
            No results found for &quot;{query}&quot;
          </p>
          <p className="text-xs text-light-text-secondary mt-1">
            Try searching for people, groups, gifts, or exchanges
          </p>
        </div>
      )}

      {/* Results */}
      {!isLoading && results.length > 0 && (
        <div className="py-2">
          {TYPE_ORDER.map((type) => {
            const typeResults = groupedResults[type];
            if (!typeResults || typeResults.length === 0) return null;

            return (
              <div key={type} className="mb-3 last:mb-0">
                {/* Category Header */}
                <div className="px-3 py-1.5 text-xs font-semibold text-light-text-secondary uppercase tracking-wider">
                  {TYPE_LABELS[type]} ({typeResults.length})
                </div>

                {/* Results List */}
                <div className="space-y-0.5">
                  {typeResults.map((result) => (
                    <SearchResultItem
                      key={`${result.type}-${result.id}`}
                      result={result}
                      onClick={() => {
                        onResultClick();
                        onClose();
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Footer with result count */}
          <div className="px-3 py-2 border-t border-light-border mt-2 text-center">
            <p className="text-xs text-light-text-tertiary">
              Showing {results.length} result{results.length !== 1 ? 's' : ''} • Press ESC to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
