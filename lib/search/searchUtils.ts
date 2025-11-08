import { SearchResult, SearchResultType } from "./searchEngine";

// Helper function to calculate relevance score
export function calculateRelevance(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerText === lowerQuery) return 3; // Exact match
  if (lowerText.startsWith(lowerQuery)) return 2; // Starts with
  if (lowerText.includes(lowerQuery)) return 1; // Contains
  return 0;
}

// Sort and limit results by relevance
export function sortAndLimitResults(results: SearchResult[], limit: number = 5): SearchResult[] {
  return results
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, limit);
}

// Group results by type
export function groupResultsByType(results: SearchResult[]): Record<SearchResultType, SearchResult[]> {
  return results.reduce((acc, result) => {
    if (!acc[result.type]) {
      acc[result.type] = [];
    }
    acc[result.type].push(result);
    return acc;
  }, {} as Record<SearchResultType, SearchResult[]>);
}
