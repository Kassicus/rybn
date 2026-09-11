/**
 * The single definition of an ACTIVE claim.
 *
 * The rule is stated in _planning/2026-09-10-gift-giving-occasions-design.md:260-267
 * and again in 20260911100002_claim_rpcs.sql's header, and before this module
 * existed it was written out FOUR separate times -- in claim_wishlist_item()'s
 * lapsed-release, in getActiveClaims(), in markAsPurchased()'s authorization
 * lookup, and implicitly in the wishlist_claims_one_active index. Two of those
 * four disagreed with each other about purchased items, which is the ordinary
 * end state of every fulfilled gift, so the disagreement was not an edge case.
 *
 * The SQL copy has to stay where it is -- it runs inside the RPC. This module
 * is the one copy every TypeScript caller shares, so a future change is made
 * once rather than found in three places.
 */

/** Exactly what deciding activity needs -- nothing about who claimed it. */
export type ClaimActivityInput = {
  /** null means unscoped: the claim carries no occasion. */
  occasionId: string | null;
  /** ISO YYYY-MM-DD, or null when this viewer cannot see the occasion's date. */
  occasionDate: string | null;
  /** Whether the claimed ITEM has been marked purchased. */
  itemPurchased: boolean;
};

/**
 * `today` is passed in rather than read here so the caller decides the clock
 * once per request instead of per row -- a batch spanning midnight would
 * otherwise apply two different "todays" within one result.
 *
 * Both dates are ISO 8601 (YYYY-MM-DD), where lexicographic and chronological
 * order coincide, so a plain string compare is correct and needs no Date
 * parsing. Postgres's `current_date` is evaluated in the session TimeZone,
 * which this project has set to UTC -- the same zone todayISO() reads. That
 * agreement is by configuration, not construction: if the database's TimeZone
 * ever moves off UTC, this comparison and claim_rpcs.sql:102 will disagree for
 * the hours between the two midnights.
 */
export function isClaimActive(
  claim: ClaimActivityInput,
  today: string,
): boolean {
  // Purchase is terminal, and it outranks the date. claim_wishlist_item()
  // refuses a new claim on a purchased item (claim_rpcs.sql:50-52) BEFORE
  // reaching its lapsed-release, so a claim on a purchased item is never
  // released no matter how long ago its occasion passed -- it is the standing
  // record of who bought the thing. Checking this first is what makes the read
  // path agree with the RPC about that row.
  if (claim.itemPurchased) return true;

  // Unscoped claims never lapse -- there is no date to pass. This is what
  // backfilled claims (20260911100003) and every claim made without an
  // occasion in view rely on.
  if (claim.occasionId === null) return true;

  // occasion_id is set but the date did not resolve: the occasion is invisible
  // to THIS caller under the celebrant's own date privacy (can_view_field),
  // which is a separate gate from the item's privacy_settings that already
  // admitted the claim row. Nothing to compare, so the claim stays active --
  // fail open. Showing an item as claimed when it is not costs a little
  // confusion; showing it as available when somebody holds it costs two people
  // buying the same gift, which is the failure claiming exists to prevent.
  if (claim.occasionDate === null) return true;

  // `>=`, not `>`: an occasion dated TODAY has not passed. An off-by-one here
  // releases a claim on the morning of the birthday.
  return claim.occasionDate >= today;
}

/** The clock, in the same shape and zone the comparison above assumes. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
