import { describe, it, expect } from "vitest";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { fixture } from "./test-fixtures";
import { IDS, SAM, world } from "./test-shopping";
import {
  homeOccasions,
  mobileOccasion,
  mobilePerson,
  occasionFromRow,
  occasionKey,
  occasionsInvolving,
  parseOccasionKey,
  sharedGroupIds,
  shoppingPeople,
  type PersonRow,
} from "./occasions";

const w = world(), home = fixture("home");
const couple = (a: PersonRow, b: PersonRow | null): UpcomingOccasion => ({ occasionId: null, kind: "anniversary", name: null,
  occasionDate: "2027-03-08", celebrantId: a.id, celebrantUsername: a.username, celebrantDisplayName: a.display_name, groupId: null,
  groupName: null, partnerId: b?.id ?? null, partnerUsername: b?.username ?? null, partnerDisplayName: b?.display_name ?? null });

describe("mobilePerson", () => {
  it("matches the fixture's people", () => expect(mobilePerson(w.people.mom)).toEqual(home.occasions[0].people[4].person));
  it("uses the display name, else the username, else Someone", () => {
    expect(mobilePerson(w.people.jordan).name).toBe("jordan");
    expect(mobilePerson({ ...w.people.dad, display_name: "  " }).name).toBe("luis");
    expect(mobilePerson({ ...w.people.dad, display_name: null, username: null }).name).toBe("Someone");
  });
  it("sends four named fields and never an email", () =>
    expect(Object.keys(mobilePerson({ ...w.people.mom, email: "mom@example.com" } as PersonRow)).sort()).toEqual(["avatarUrl", "id", "name", "username"]));
});
describe("occasion keys", () => {
  it("names a group date by its row, and a birthday by its person and year", () => expect(w.upcoming.map(occasionKey)).toEqual(
    ["birthday:user_2abcDEF:2026", "group_date:9c4b2e1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c", "birthday:user_2momABC:2027", "birthday:user_2prySHA:2027"]));
  it("is the same before and after a birthday has a row", () =>
    expect(occasionKey({ ...w.upcoming[3], occasionId: "11111111-1111-4111-8111-111111111111" })).toBe("birthday:user_2prySHA:2027"));
  it("parses what it builds", () => {
    expect(parseOccasionKey(IDS.xmasKey)).toEqual({ kind: "group_date", occasionId: IDS.xmas });
    expect(parseOccasionKey("anniversary:user_2momABC:2027")).toEqual({ kind: "anniversary", celebrantId: "user_2momABC", year: 2027 });
  });
  it.each(["", "group_date:not-a-uuid", "birthday:user_2momABC", "birthday:user_2momABC:27", "christmas:user_2momABC:2026",
    "birthday:user:2momABC:2027", `${"group_date:9c4b2e1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c"}:extra`])("refuses %j", (k) => expect(parseOccasionKey(k)).toBeNull());
});
describe("mobileOccasion", () => {
  it("matches the fixture's occasions", () =>
    expect(w.upcoming.slice(1).map(mobileOccasion)).toEqual(home.occasions.map((e: { occasion: unknown }) => e.occasion)));
  it("titles a couple's anniversary the site's way", () =>
    expect(mobileOccasion(couple(w.people.alex, w.people.sam)).title).toBe("Alex Rivera & Sam Rivera's Anniversary"));
  it("gives back the same occasion from a stored row", () =>
    expect(w.occasionRows.map((r) => mobileOccasion(occasionFromRow(r, w.profiles)))).toEqual([home.occasions[0].occasion, home.occasions[1].occasion]));
});
describe("Home's occasions (§4.2)", () => {
  it("leaves out the caller's own birthday", () => expect(homeOccasions(w.upcoming, SAM).map(occasionKey)).toEqual(
    [IDS.xmasKey, "birthday:user_2momABC:2027", "birthday:user_2prySHA:2027"]));
  it("shows the caller's own anniversary only with a linked partner, who is the one to shop for", () => {
    expect(homeOccasions([couple(w.people.sam, null)], SAM)).toEqual([]);
    const linked = couple(w.people.alex, w.people.sam);
    expect(homeOccasions([linked], SAM)).toEqual([linked]);
    expect(shoppingPeople(linked, SAM, w.members, w.profiles).map((p) => p.id)).toEqual(["user_2alxABC"]);
  });
  it("shops for everyone in a group date's group but the caller, by name", () =>
    expect(shoppingPeople(w.upcoming[1], SAM, w.members, w.profiles).map((p) => p.id)).toEqual(
      ["user_2alxABC", "user_2dadABC", "user_2grnABC", "user_2jrdABC", "user_2momABC"]));
  it("shops for both people of someone else's couple", () =>
    expect(shoppingPeople(couple(w.people.mom, w.people.dad), SAM, w.members, w.profiles).map((p) => p.id)).toEqual(["user_2dadABC", "user_2momABC"]));
});
describe("gaps", () => {
  it("builds a person from the occasion's own fields when their profile is missing", () => {
    const o = couple(w.people.mom, w.people.dad);
    const profiles = new Map([[w.people.dad.id, w.people.dad]]);   // Mom's profile is missing
    expect(shoppingPeople(o, SAM, w.members, profiles)).toEqual([
      w.people.dad, { id: "user_2momABC", username: "maria", display_name: "Mom", avatar_url: null }]);
  });
  it("builds a missing partner from the partner fields", () => {
    const o = couple(w.people.mom, w.people.dad);
    expect(shoppingPeople(o, SAM, w.members, new Map())).toEqual([
      { id: "user_2dadABC", username: "luis", display_name: "Dad", avatar_url: null },
      { id: "user_2momABC", username: "maria", display_name: "Mom", avatar_url: null }]);
  });
  it("refuses an upper-case UUID in an occasion key", () =>
    expect(parseOccasionKey("group_date:9C4B2E1A-7D3F-4E5A-8B6C-1D2E3F4A5B6C")).toBeNull());
});
describe("occasions that involve a person (§5.1)", () => {
  it("Mom: the family's Christmas and her birthday", () => expect(occasionsInvolving("user_2momABC", w.upcoming,
    sharedGroupIds("user_2momABC", w.members)).map(occasionKey)).toEqual([IDS.xmasKey, "birthday:user_2momABC:2027"]));
  it("Priya: her birthday, and no date of a group she is not in", () => expect(occasionsInvolving("user_2prySHA", w.upcoming,
    sharedGroupIds("user_2prySHA", w.members)).map(occasionKey)).toEqual(["birthday:user_2prySHA:2027"]));
  it("a shared anniversary involves the partner too", () =>
    expect(occasionsInvolving("user_2abcDEF", [couple(w.people.alex, w.people.sam)], new Set())).toHaveLength(1));
  it("reads shared groups from the memberships", () =>
    expect([...sharedGroupIds("user_2alxABC", w.members)].sort()).toEqual([IDS.bookClub, IDS.rivera].sort()));
});
