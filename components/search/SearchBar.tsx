"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { useSearch } from "@/hooks/useSearch";
import { SearchResults } from "./SearchResults";

interface SearchBarProps {
  placeholder?: string;
  className?: string;
}

export function SearchBar({
  placeholder = "Search wishlists, groups, gifts, people...",
  className = "",
}: SearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    query,
    setQuery,
    results,
    groupedResults,
    isLoading,
    isSearching,
    isEmpty,
  } = useSearch();

  // Open dropdown when there's a query and results or loading
  useEffect(() => {
    if (query.length >= 2) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [query, results]);

  const handleClear = () => {
    setQuery("");
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) {
        handleClear();
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative">
        {/* Search Icon */}
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-light-text-secondary pointer-events-none" />

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full h-10 pl-9 pr-9 bg-light-background-secondary border border-light-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-all placeholder:text-light-text-tertiary text-light-text-primary"
          aria-label="Search"
          aria-autocomplete="list"
          aria-controls="search-results"
          aria-expanded={isOpen}
        />

        {/* Loading/Clear Button */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          {isSearching && (
            <Loader2 className="h-4 w-4 animate-spin text-light-text-secondary" />
          )}
          {!isSearching && query && (
            <button
              onClick={handleClear}
              className="p-1 hover:bg-light-background-hover rounded-sm transition-colors"
              aria-label="Clear search"
              type="button"
            >
              <X className="h-4 w-4 text-light-text-secondary" />
            </button>
          )}
        </div>
      </div>

      {/* Results Dropdown */}
      {isOpen && (
        <SearchResults
          results={results}
          groupedResults={groupedResults}
          isLoading={isLoading}
          isEmpty={isEmpty}
          query={query}
          onClose={() => setIsOpen(false)}
          onResultClick={() => {
            setQuery("");
            setIsOpen(false);
          }}
        />
      )}
    </div>
  );
}
