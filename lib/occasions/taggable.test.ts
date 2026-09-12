import { describe, it, expect } from "vitest";
import {
  taggableOccasions,
  untaggedOccasions,
  resolveTagTarget,
  resolveTaggedChips,
} from "./taggable";
import type { UpcomingOccasion } from "./display";

const USER = "user-1";
const OTHER = "user-2";

function birthday(over: Partial<UpcomingOccasion> = {}): UpcomingOccasion {
  return {
    occasionId: null,
    kind: "birthday",
    name: null,
    occasionDate: "2026-10-24",
    celebrantId: USER,
    celebrantUsername: "kason",
    celebrantDisplayName: "Kason",
    groupId: null,
    groupName: null,
    partnerId: null,
    partnerUsername: null,
    partnerDisplayName: null,
    ...over,
  };
}

function groupDate(over: Partial<UpcomingOccasion> = {}): UpcomingOccasion {
  return {
    occasionId: "occ-group-1",
    kind: "group_date",
    name: "Christmas 2026",
    occasionDate: "2026-12-25",
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

describe("taggableOccasions", () => {
  it("keeps the caller's own derived birthday/anniversary", () => {
    const mine = birthday();
    expect(taggableOccasions([mine], USER)).toEqual([mine]);
  });

  it("drops another celebrant's derived occasion -- tagItemForMyOccasion has no way to target it", () => {
    const moms = birthday({ celebrantId: OTHER, celebrantDisplayName: "Mom" });
    expect(taggableOccasions([moms], USER)).toEqual([]);
  });

  it("keeps every group_date regardless of celebrantId (always null)", () => {
    const gd = groupDate();
    expect(taggableOccasions([gd], USER)).toEqual([gd]);
  });

  it("filters a mixed list down to mine + all group dates", () => {
    const mine = birthday();
    const moms = birthday({ celebrantId: OTHER, celebrantDisplayName: "Mom" });
    const gd = groupDate();
    expect(taggableOccasions([mine, moms, gd], USER)).toEqual([mine, gd]);
  });

  // FINDING I2, the tagging half -- the check that would have caught the
  // whole class. A confirmed couple's anniversary is stored under the
  // canonical (user_a) partner, so for the OTHER partner
  // `celebrantId === userId` is false and their own anniversary vanished
  // from their own tag picker: they could not tag a single item for it.
  //
  // Falsifiable by: reverting taggableOccasions to
  // `o.celebrantId === userId` -- verified by making that edit, which fails
  // this test while every other test in this file keeps passing. The
  // existing "keeps the caller's own" test uses a celebrant-side fixture and
  // cannot see this bug.
  //
  // This test and the I1 database fix had to land together. Admitting the
  // partner here makes resolveTagTarget return { via: "my", kind:
  // "anniversary" }, which routes to tagItemForMyOccasion ->
  // get_or_create_occasion. Until 20260912000015 that function inserted
  // unconditionally under the caller, so this option would have materialized
  // a SECOND occasion row for the couple -- the exact defect the feature
  // exists to remove, fired on every couple rather than only when privacy
  // narrowed.
  it("keeps the NON-canonical partner's own collapsed anniversary", () => {
    const shared = birthday({
      kind: "anniversary",
      celebrantId: OTHER,
      celebrantDisplayName: "Alex",
      partnerId: USER,
      partnerUsername: "kason",
      partnerDisplayName: "Kason",
    });
    expect(taggableOccasions([shared], USER)).toEqual([shared]);
  });

  it("still drops a couple's anniversary from a third party's picker", () => {
    // The companion to the test above: admitting the partner must not admit
    // everybody. Without this, "keeps the partner's own" would also pass an
    // implementation that returned every anniversary to every caller.
    const shared = birthday({
      kind: "anniversary",
      celebrantId: OTHER,
      partnerId: "user-3",
      partnerUsername: "sam",
      partnerDisplayName: "Sam",
    });
    expect(taggableOccasions([shared], USER)).toEqual([]);
  });
});

describe("untaggedOccasions", () => {
  it("keeps a never-materialized birthday even though occasionId is null", () => {
    const mine = birthday();
    expect(untaggedOccasions([mine], [])).toEqual([mine]);
  });

  it("drops a group date whose id is already in taggedOccasionIds", () => {
    const gd = groupDate({ occasionId: "occ-1" });
    expect(untaggedOccasions([gd], ["occ-1"])).toEqual([]);
  });

  it("keeps a group date whose id is not tagged yet", () => {
    const gd = groupDate({ occasionId: "occ-1" });
    expect(untaggedOccasions([gd], ["occ-other"])).toEqual([gd]);
  });

  it("drops a materialized birthday once its id appears in taggedOccasionIds", () => {
    const mine = birthday({ occasionId: "occ-bday-2026" });
    expect(untaggedOccasions([mine], ["occ-bday-2026"])).toEqual([]);
  });
});

describe("resolveTagTarget", () => {
  it("routes an unmaterialized birthday through tagItemForMyOccasion (by kind, not id)", () => {
    expect(resolveTagTarget(birthday({ occasionId: null, kind: "birthday" }))).toEqual({
      via: "my",
      kind: "birthday",
    });
  });

  it("routes a materialized anniversary through tagItemForMyOccasion too -- still by kind", () => {
    expect(
      resolveTagTarget(birthday({ occasionId: "occ-1", kind: "anniversary" }))
    ).toEqual({ via: "my", kind: "anniversary" });
  });

  it("routes a group date through tagItemForGroupDate, by id", () => {
    expect(resolveTagTarget(groupDate({ occasionId: "occ-group-1" }))).toEqual({
      via: "group",
      occasionId: "occ-group-1",
    });
  });

  it("returns null for a group_date impossibly missing its id", () => {
    expect(resolveTagTarget(groupDate({ occasionId: null }))).toBeNull();
  });
});

describe("resolveTaggedChips", () => {
  it("resolves a tagged id to its label and date when the occasion is still available", () => {
    const mine = birthday({ occasionId: "occ-bday-2026", celebrantDisplayName: "Kason" });
    expect(resolveTaggedChips(["occ-bday-2026"], [mine])).toEqual([
      { occasionId: "occ-bday-2026", label: "Kason's Birthday", dateLabel: "October 24th" },
    ]);
  });

  it("falls back to a generic chip when the tagged occasion has aged out of availableOccasions", () => {
    // e.g. a past group_date, or a derived birthday now materialized under a
    // different id for next year -- see the doc comment in taggable.ts.
    expect(resolveTaggedChips(["occ-stale"], [])).toEqual([
      { occasionId: "occ-stale", label: "Past occasion", dateLabel: null },
    ]);
  });

  it("preserves the order and count of taggedOccasionIds, including duplicates against one list", () => {
    const gd = groupDate({ occasionId: "occ-group-1" });
    const mine = birthday({ occasionId: "occ-bday-2026" });
    const result = resolveTaggedChips(["occ-group-1", "occ-bday-2026"], [gd, mine]);
    expect(result.map((r) => r.occasionId)).toEqual(["occ-group-1", "occ-bday-2026"]);
  });
});
