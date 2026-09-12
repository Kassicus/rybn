import { describe, it, expect } from "vitest";
import { hrefFor } from "./hrefFor";
import type { UpcomingOccasion } from "@/lib/occasions/display";

const CANON = "user_aaa";
const PARTNER = "user_zzz";
const STRANGER = "user_mmm";

function occasion(over: Partial<UpcomingOccasion> = {}): UpcomingOccasion {
  return {
    occasionId: "occ-1",
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

describe("hrefFor", () => {
  it("sends a giver to the celebrant's wishlist", () => {
    expect(hrefFor(occasion(), STRANGER)).toBe(`/wishlist/user/${CANON}`);
  });

  it("sends the celebrant to their own list, skipping the self-redirect", () => {
    expect(hrefFor(occasion(), CANON)).toBe("/wishlist");
  });

  // FINDING I2, the routing half. A collapsed couple's anniversary is stored
  // under the canonical (user_a) partner, so `celebrantId === viewerId` is
  // false for the OTHER partner -- and clicking their own anniversary in
  // "Coming up" took them to their partner's wishlist instead of their own.
  //
  // Falsifiable by: reverting hrefFor to `o.celebrantId === viewerId`, which
  // makes this return `/wishlist/user/user_aaa` -- verified by making that
  // edit and re-running, which fails this test and leaves the two above
  // passing. That asymmetry is the point: the celebrant-side cases cannot
  // see this bug at all.
  it("sends the NON-canonical partner to their own list too", () => {
    expect(hrefFor(occasion(), PARTNER)).toBe("/wishlist");
  });

  it("sends a group_date to its group", () => {
    expect(
      hrefFor(occasion({ kind: "group_date", groupId: "group-1" }), CANON)
    ).toBe("/groups/group-1");
  });

  it("falls back to the dashboard when there is nothing to link to", () => {
    // Not reachable through any row the database hands back
    // (celebrated_shape forces celebrant_id non-null for a birthday or
    // anniversary, group_date_shape forces group_id non-null for a group
    // date), so this pins the defensive floor rather than a real case.
    expect(
      hrefFor(
        occasion({ kind: "group_date", groupId: null, celebrantId: null }),
        CANON
      )
    ).toBe("/dashboard");
  });

  it("never matches a null viewer against an unshared occasion's null partnerId", () => {
    // A logged-out render passes viewerId: null. partnerId is null on every
    // unshared row, so a naive comparison would route every one of them to
    // "/wishlist".
    expect(hrefFor(occasion({ partnerId: null }), null)).toBe(
      `/wishlist/user/${CANON}`
    );
  });
});
