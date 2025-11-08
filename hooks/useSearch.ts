"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { searchSite, SearchResult } from "@/lib/search/searchEngine";

const DEBOUNCE_DELAY = 400; // 400ms debounce
const MIN_QUERY_LENGTH = 2;

export function useSearch(initialQuery: string = "") {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_DELAY);

    return () => clearTimeout(timer);
  }, [query]);

  // Use React Query for caching and state management
  const {
    data: results = [],
    isLoading,
    error,
    refetch,
  } = useQuery<SearchResult[]>({
    queryKey: ["search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.trim().length < MIN_QUERY_LENGTH) {
        return [];
      }
      return searchSite(debouncedQuery);
    },
    enabled: debouncedQuery.trim().length >= MIN_QUERY_LENGTH,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
  });

  // Group results by type for easy rendering
  const groupedResults = results.reduce(
    (acc, result) => {
      if (!acc[result.type]) {
        acc[result.type] = [];
      }
      acc[result.type].push(result);
      return acc;
    },
    {} as Record<string, SearchResult[]>
  );

  return {
    query,
    setQuery,
    results,
    groupedResults,
    isLoading: isLoading && debouncedQuery.trim().length >= MIN_QUERY_LENGTH,
    isSearching: query !== debouncedQuery, // True when typing but not yet searched
    error,
    refetch,
    hasResults: results.length > 0,
    isEmpty: debouncedQuery.trim().length >= MIN_QUERY_LENGTH && results.length === 0,
  };
}
