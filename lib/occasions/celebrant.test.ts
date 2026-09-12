import { describe, it, expect } from "vitest";
import {
  occasionCelebrantIds,
  isOccasionFor,
  occasionFor,
  occasionInvolvesAny,
} from "./celebrant";
import type { UpcomingOccasion } from "./display";

/**
 * FINDING I2. Six surfaces asked "is this occasion this person's" with a bare
 * `celebrantId === userId`. A confirmed couple's anniversary is stored under
 * ONE celebrant -- always user_a, the lexicographically smaller id -- so that
 * comparison is false for the NON-canonical partner on their own anniversary,
 * and the feature removed their own occasion from their own surfaces:
 *
 *   - lib/occasions/taggable.ts: no tag option for their own anniversary;
 *   - app/(dashboard)/wishlist/page.tsx: no "your anniversary is in N days";
 *   - .../wishlist/user/[userId]/page.tsx: no anniversary header for a giver
 *     opening their list, and a null occasion label on existing claims;
 *   - .../wishlist/[itemId]/page.tsx: claimOccasionKind null, so a claim made
 *     from the item detail page was created UNSCOPED and never auto-released;
 *   - .../groups/[groupId]/page.tsx: the couple vanished from a group where
 *     only the non-canonical partner is a member;
 *   - components/occasions/hrefFor.ts: their own anniversary linked to their
 *     partner's wishlist.
 *
 * Every one of those now routes through this module, so these tests are the
 * falsifiability floor for the whole class: deleting
 * `|| occasion.partnerId === userId` from isOccasionFor reproduces all six.
 * What they do NOT cover is whether each individual call site actually calls
 * these helpers -- the pages are async Server Components wired to Clerk and
 * next/cache, which this harness (vitest, `**\/*.test.ts`, node environment,
 * no React testing library) cannot render. That is why the predicate was
 * extracted rather than fixed six times in place: one tested definition, six
 * one-line call sites a reader can check by eye.
 */

const CANON = "user_aaa";
const PARTNER = "user_zzz";
const STRANGER = "user_mmm";

/** A confirmed couple's collapsed anniversary, as get_upcoming_occasions
 *  emits it to a viewer who can see both partners' dates. */
function sharedAnniversary(
  over: Partial<UpcomingOccasion> = {}
): UpcomingOccasion {
  return {
    occasionId: "occ-shared",
    kind: "anniversary",
    name: null,
    occasionDate: "2026-06-12",
    celebrantId: CANON,
    celebrantUsername: "alex",
    celebrantDisplayName: "Alex",
    groupId: null,
    groupName: null,
    partnerId: PARTNER,
    partnerUsername: "sam",
    partnerDisplayName: "Sam",
    ...over,
  };
}

/** An ordinary, unshared birthday -- partner columns null, as every
 *  non-couple row carries them. */
function birthday(over: Partial<UpcomingOccasion> = {}): UpcomingOccasion {
  return {
    ...sharedAnniversary(),
    occasionId: "occ-bday",
    kind: "birthday",
    partnerId: null,
    partnerUsername: null,
    partnerDisplayName: null,
    ...over,
  };
}

function groupDate(over: Partial<UpcomingOccasion> = {}): UpcomingOccasion {
  return {
    ...sharedAnniversary(),
    occasionId: "occ-group",
    kind: "group_date",
    name: "Christmas 2026",
    celebrantId: null,
    celebrantUsername: null,
    celebrantDisplayName: null,
    groupId: "group-1",
    groupName: "The Family",
    partnerId: null,
    partnerUsername: null,
    partnerDisplayName: null,
    ...over,
  };
}

describe("occasionCelebrantIds", () => {
  it("returns both halves of a collapsed couple, canonical first", () => {
    expect(occasionCelebrantIds(sharedAnniversary())).toEqual([CANON, PARTNER]);
  });

  it("returns only the celebrant for an unshared occasion", () => {
    expect(occasionCelebrantIds(birthday())).toEqual([CANON]);
  });

  it("returns nothing for a group_date, which belongs to a group", () => {
    expect(occasionCelebrantIds(groupDate())).toEqual([]);
  });

  // Falsifiable by: returning `[celebrantId, partnerId]` unfiltered, which
  // puts nulls in the array and makes the group_date case `[null, null]`
  // rather than `[]` -- verified by making that change, which fails the
  // group_date and unshared cases here and, downstream, lets
  // occasionInvolvesAny match a Set that somehow held a null.
  // NOT caught: ordering beyond canonical-first, which nothing depends on.
});

describe("isOccasionFor", () => {
  it("matches the celebrant", () => {
    expect(isOccasionFor(sharedAnniversary(), CANON)).toBe(true);
  });

  // THE ASSERTION THIS MODULE EXISTS FOR. Deleting
  // `|| occasion.partnerId === userId` from isOccasionFor fails exactly this
  // test and the three below that depend on it -- verified by making that
  // deletion and re-running: 5 failures across this file, hrefFor.test.ts and
  // taggable.test.ts, and zero elsewhere. That is the whole of finding I2's
  // read side, so a green suite with that clause removed would mean these
  // tests were decorative.
  it("matches the NON-canonical partner of a collapsed couple -- finding I2", () => {
    expect(isOccasionFor(sharedAnniversary(), PARTNER)).toBe(true);
  });

  it("does not match a third party", () => {
    expect(isOccasionFor(sharedAnniversary(), STRANGER)).toBe(false);
  });

  it("does not match on an unshared occasion's null partnerId", () => {
    // The reason userId is guarded rather than compared directly: partnerId
    // is null on every unshared row, so a nullish viewer id compared with
    // `===` would match all of them. Falsifiable by deleting the `if
    // (!userId) return false` guard, which makes both of these true.
    expect(isOccasionFor(birthday(), null)).toBe(false);
    expect(isOccasionFor(birthday(), undefined)).toBe(false);
  });

  it("never matches a group_date, which has no celebrant at all", () => {
    expect(isOccasionFor(groupDate(), CANON)).toBe(false);
  });
});

describe("occasionFor", () => {
  it("finds the non-canonical partner's own collapsed anniversary in a list", () => {
    const list = [birthday({ celebrantId: STRANGER }), sharedAnniversary()];
    expect(occasionFor(list, PARTNER)).toBe(list[1]);
  });

  it("preserves the caller's ordering -- first match wins, not soonest date", () => {
    // get_upcoming_occasions returns soonest-first, so "first match" IS
    // "their next occasion" for every caller that passes an unmodified
    // listing. Pinned here so a later "helpful" re-sort inside this helper
    // would fail rather than silently change what every page shows: the
    // LATER date is placed first and must still be the one returned.
    const later = birthday({ occasionDate: "2026-12-01" });
    const sooner = sharedAnniversary({ occasionDate: "2026-06-12" });
    expect(occasionFor([later, sooner], CANON)).toBe(later);
  });

  it("returns null when nothing in the list is theirs", () => {
    expect(occasionFor([groupDate(), birthday()], STRANGER)).toBeNull();
  });
});

describe("occasionInvolvesAny", () => {
  it("admits a couple when only the NON-canonical partner is a member", () => {
    // The group-page case. Before finding I2's fix the couple's anniversary
    // disappeared from a group whose only member of the two was the
    // non-canonical partner.
    expect(occasionInvolvesAny(sharedAnniversary(), new Set([PARTNER]))).toBe(
      true
    );
  });

  it("admits a couple when only the canonical partner is a member", () => {
    expect(occasionInvolvesAny(sharedAnniversary(), new Set([CANON]))).toBe(
      true
    );
  });

  it("refuses a group containing neither partner", () => {
    expect(occasionInvolvesAny(sharedAnniversary(), new Set([STRANGER]))).toBe(
      false
    );
  });

  it("refuses a group_date, which the caller filters on groupId instead", () => {
    expect(
      occasionInvolvesAny(groupDate(), new Set([CANON, PARTNER, STRANGER]))
    ).toBe(false);
  });
});
