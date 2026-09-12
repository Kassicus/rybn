import type { UpcomingOccasion } from "@/lib/occasions/display";

/**
 * The two id columns that say WHOSE occasion a celebrated row is. Narrowed to
 * a Pick so these helpers can be handed anything carrying the pair, including
 * a row mapped straight off get_upcoming_occasions before it is widened into
 * a full UpcomingOccasion.
 */
export type CelebratedIds = Pick<UpcomingOccasion, "celebrantId" | "partnerId">;

/**
 * Every person a celebrated occasion belongs to -- the celebrant, and the
 * PARTNER when a confirmed couple's anniversary has been collapsed onto one
 * row. Empty for a group_date, which belongs to a group rather than to
 * anybody in particular.
 *
 * WHY THIS EXISTS AS A NAMED FUNCTION rather than an inline
 * `o.celebrantId === userId`, which is what six separate surfaces used before
 * it. A linked couple's anniversary is stored under ONE celebrant -- always
 * `user_a`, the lexicographically smaller id (20260912000016_canonical_
 * partner_date_authoritative.sql, the live body of
 * get_or_create_celebrated_occasion). That is a storage detail, not a
 * statement about whose anniversary it is: it is equally the NON-canonical
 * partner's. Keying "is this occasion this person's" on `celebrantId` alone
 * therefore removed the non-canonical partner's own anniversary from their
 * own surfaces -- their tag option vanished from the picker, their "your
 * anniversary is in N days" line disappeared, a giver opening their list got
 * no anniversary header and a null label on existing claims, a claim made
 * from the item detail page was created UNSCOPED and so never auto-released,
 * the couple's anniversary vanished from a group where only they were a
 * member, and their own occasion routed them to their partner's wishlist.
 *
 * The fix is one predicate in one place rather than six `|| partnerId ===`
 * clauses, because six places is how five of them stay right and one drifts.
 */
export function occasionCelebrantIds(occasion: CelebratedIds): string[] {
  const ids: string[] = [];
  if (occasion.celebrantId !== null) ids.push(occasion.celebrantId);
  if (occasion.partnerId !== null) ids.push(occasion.partnerId);
  return ids;
}

/**
 * Whether this occasion is `userId`'s own -- as celebrant, or as the
 * non-canonical half of a collapsed couple.
 *
 * A null/absent userId never matches. That is deliberate rather than
 * defensive: `partnerId` is null on every unshared occasion, so a nullish
 * userId compared with `===` would match every one of them.
 */
export function isOccasionFor(
  occasion: CelebratedIds,
  userId: string | null | undefined
): boolean {
  if (!userId) return false;
  return (
    occasion.celebrantId === userId || occasion.partnerId === userId
  );
}

/**
 * The first occasion in `occasions` belonging to `userId`, or null.
 *
 * "First" is the caller's ordering, not a re-sort: get_upcoming_occasions
 * returns soonest-first, so this is "their next occasion" on every surface
 * that calls it with an unmodified listing.
 */
export function occasionFor<T extends CelebratedIds>(
  occasions: T[],
  userId: string | null | undefined
): T | null {
  return occasions.find((occasion) => isOccasionFor(occasion, userId)) ?? null;
}

/**
 * Whether this occasion belongs to ANY of `userIds` -- the group-page
 * question ("does this belong on this group's page"), where membership is a
 * set rather than one viewer.
 *
 * A couple surfaces on a group page when EITHER partner is a member, which is
 * the same rule a single person's birthday already followed: the occasion
 * belongs on every group page its celebrant is in. Before this, a couple
 * whose only member in a given group was the non-canonical partner dropped
 * off that group's page entirely.
 */
export function occasionInvolvesAny(
  occasion: CelebratedIds,
  userIds: ReadonlySet<string>
): boolean {
  return occasionCelebrantIds(occasion).some((id) => userIds.has(id));
}
