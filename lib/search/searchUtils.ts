import { SearchResult, SearchResultType } from "./searchEngine";

/** A PostgREST `or` filter: either column contains the text, matched without regard to case. The text is a quoted value, whatever characters it holds. */
export function eitherContains(columnA: string, columnB: string, query: string): string {
  // Inside PostgREST's double quotes a backslash and a double quote are each
  // written with a backslash before them.
  const pattern = `%${query.toLowerCase()}%`.replace(/[\\"]/g, (char) => `\\${char}`);
  return `${columnA}.ilike."${pattern}",${columnB}.ilike."${pattern}"`;
}

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
