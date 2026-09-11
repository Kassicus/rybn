/**
 * Occasion-aware ordering for a VIEWER's wishlist list (Task 5). Pure logic,
 * no React, no I/O -- same shape as lib/occasions/taggable.ts (Task 4).
 */

/**
 * Splits an already-sorted list into "tagged for the occasion in view" and
 * everything else, preserving the order the caller established.
 *
 * A partition rather than a sort comparator, deliberately: the viewer has
 * already chosen a sort in SortableWishlistItems, and occasion relevance is a
 * grouping applied ON TOP of that choice rather than a replacement for it.
 * Folding it into the comparator would silently override whatever the viewer
 * picked.
 */
export function partitionByOccasion<T extends { id: string }>(
  items: T[],
  taggedIds: Set<string>
): { tagged: T[]; rest: T[] } {
  const tagged: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (taggedIds.has(item.id) ? tagged : rest).push(item);
  }
  return { tagged, rest };
}

/**
 * The item ids tagged for ONE occasion, from the all-tags map the action
 * returns.
 *
 * This exists as a named function rather than an inline expression because
 * the wrong version is so easy to write: taking every key of the map treats
 * "has any tag" as "is for this occasion", and would surface a Christmas-
 * tagged item to somebody looking at a birthday list.
 *
 * A null occasionId means the occasion has no materialized row -- a derived
 * birthday nobody has tagged anything for. Nothing can be tagged for it, so
 * the empty Set is the honest answer and the list renders as it always did.
 */
export function itemsTaggedFor(
  tagsByItem: Record<string, string[]>,
  occasionId: string | null
): Set<string> {
  if (occasionId === null) return new Set();

  const ids = new Set<string>();
  for (const [itemId, occasionIds] of Object.entries(tagsByItem)) {
    if (occasionIds.includes(occasionId)) ids.add(itemId);
  }
  return ids;
}
