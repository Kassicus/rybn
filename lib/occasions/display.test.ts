import { describe, it, expect } from "vitest";
import { occasionLabel, daysUntil, type UpcomingOccasion } from "./display";

function make(over: Partial<UpcomingOccasion> = {}): UpcomingOccasion {
  return {
    occasionId: null,
    kind: "birthday",
    name: null,
    occasionDate: "2026-10-29",
    celebrantId: "user_1",
    celebrantUsername: "mom",
    celebrantDisplayName: "Mom",
    groupId: null,
    groupName: null,
    partnerId: null,
    partnerUsername: null,
    partnerDisplayName: null,
    ...over,
  };
}

describe("occasionLabel", () => {
  it("uses the celebrant's display name for a birthday", () => {
    expect(occasionLabel(make())).toBe("Mom's Birthday");
  });

  it("falls back to the username when there is no display name", () => {
    expect(occasionLabel(make({ celebrantDisplayName: null })))
      .toBe("mom's Birthday");
  });

  // Possessive of a name already ending in s. Getting this wrong is the kind
  // of detail that makes an app feel unfinished.
  it("does not double the s on a name ending in s", () => {
    expect(occasionLabel(make({ celebrantDisplayName: "Chris" })))
      .toBe("Chris' Birthday");
  });

  // Display names are free-text: a name ending in an UPPERCASE "S" must get
  // the same treatment as one ending in lowercase "s". A case-sensitive
  // check here let "CHRIS" through as "CHRIS's Birthday" -- the exact
  // doubled-s the rule exists to prevent.
  it("does not double the s on a name ending in an uppercase S", () => {
    expect(occasionLabel(make({ celebrantDisplayName: "CHRIS" })))
      .toBe("CHRIS' Birthday");
  });

  it("uses the given name for a group date", () => {
    expect(occasionLabel(make({
      kind: "group_date", name: "Christmas 2026",
      celebrantId: null, celebrantUsername: null, celebrantDisplayName: null,
      groupId: "g1", groupName: "The Suchows",
    }))).toBe("Christmas 2026");
  });
});

describe("occasionLabel (shared anniversary)", () => {
  const base = {
    occasionId: "o1", kind: "anniversary" as const, name: null,
    occasionDate: "2026-06-12", celebrantId: "u1",
    celebrantUsername: "alex", celebrantDisplayName: "Alex",
    groupId: null, groupName: null,
    partnerId: null, partnerUsername: null, partnerDisplayName: null,
  };

  it("names both partners when the viewer can see both", () => {
    // Fails if the partner fields are ignored -- the single-name label is what
    // shipped before, so it is the wrong answer that looks right.
    expect(occasionLabel({ ...base, partnerId: "u2",
      partnerUsername: "sam", partnerDisplayName: "Sam" }))
      .toBe("Alex & Sam's Anniversary");
  });

  it("falls back to the single name when there is no partner", () => {
    expect(occasionLabel(base)).toBe("Alex's Anniversary");
  });

  it("applies the possessive to the SECOND name only", () => {
    // "Alex & Chris' Anniversary", not "Alex' & Chris' " or "Alex & Chris's".
    // The existing rule is case-insensitive because display names are free text.
    expect(occasionLabel({ ...base, partnerId: "u2",
      partnerUsername: "chris", partnerDisplayName: "CHRIS" }))
      .toBe("Alex & CHRIS' Anniversary");
  });
});

// daysUntil reads `today` through LOCAL calendar accessors (getFullYear/
// getMonth/getDate), so these fixtures are built with the LOCAL Date
// constructor (new Date(y, m, d, h, min)) rather than a UTC ISO string. A
// UTC-string fixture parses to an instant whose *local* wall-clock reading
// can differ from what the string looks like, which would silently test the
// wrong thing. The suite runs under TZ=America/New_York (vitest.config.ts)
// specifically so these fixtures exercise a real, multi-hour UTC offset --
// under TZ=UTC, local and UTC accessors agree on every instant and this
// whole class of bug is untestable.
describe("daysUntil", () => {
  it("counts whole days ahead", () => {
    expect(daysUntil("2026-10-29", new Date(2026, 9, 22, 12, 0))).toBe(7);
  });

  it("returns 0 for today", () => {
    expect(daysUntil("2026-10-29", new Date(2026, 9, 29, 23, 0))).toBe(0);
  });

  // A date string is a calendar day, not an instant. Comparing it against a
  // local-time Date must not slip a day either side of midnight.
  it("is not thrown off by time of day", () => {
    expect(daysUntil("2026-10-29", new Date(2026, 9, 28, 0, 30))).toBe(1);
    expect(daysUntil("2026-10-29", new Date(2026, 9, 28, 23, 30))).toBe(1);
  });

  // Pins the review's IMPORTANT-1 regression: daysUntil used to read
  // `today` with getUTCFullYear/getUTCMonth/getUTCDate. Under
  // America/New_York (UTC-4 in October), 23:30 local on Oct 28 is already
  // 03:30 UTC on Oct 29 -- so the UTC accessors saw "Oct 29" and reported 0
  // days until an Oct-29 occasion ("Today"), when the viewer's own clock
  // still read Oct 28 and should see 1 ("Tomorrow"). Every evening after
  // UTC's rollover (~8pm Eastern), every US viewer saw a day count one too
  // low. Local accessors must read Oct 28 here and return 1.
  it("reads today's calendar day from its own local clock, not UTC", () => {
    expect(daysUntil("2026-10-29", new Date(2026, 9, 28, 23, 30))).toBe(1);
  });
});
