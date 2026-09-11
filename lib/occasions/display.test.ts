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

  it("uses the given name for a group date", () => {
    expect(occasionLabel(make({
      kind: "group_date", name: "Christmas 2026",
      celebrantId: null, celebrantUsername: null, celebrantDisplayName: null,
      groupId: "g1", groupName: "The Suchows",
    }))).toBe("Christmas 2026");
  });
});

describe("daysUntil", () => {
  it("counts whole days ahead", () => {
    expect(daysUntil("2026-10-29", new Date("2026-10-22T12:00:00Z"))).toBe(7);
  });

  it("returns 0 for today", () => {
    expect(daysUntil("2026-10-29", new Date("2026-10-29T23:00:00Z"))).toBe(0);
  });

  // A date string is a calendar day, not an instant. Comparing it against a
  // local-time Date must not slip a day either side of midnight.
  it("is not thrown off by time of day", () => {
    expect(daysUntil("2026-10-29", new Date("2026-10-28T00:30:00Z"))).toBe(1);
    expect(daysUntil("2026-10-29", new Date("2026-10-28T23:30:00Z"))).toBe(1);
  });
});
