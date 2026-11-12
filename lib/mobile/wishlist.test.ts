import { describe, it, expect, vi } from "vitest";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import { occasionKey } from "./occasions";
import { fixture, groupRows, rowFor } from "./test-fixtures";
import { IDS, SAM, world } from "./test-shopping";
import { KEYS, tagging } from "./test-wishlist";
import {
  RULES,
  formDataFromBody,
  isOneOfMyGroups,
  mobileGroups,
  mobileItem,
  parseWishlistBody,
  tagChoices,
  utcSeconds,
  wishlistOccasion,
  type MobileItem,
  type WishlistBody,
} from "./wishlist";

const list = fixture("wishlist"), one = fixture("wishlist-item"), groups = fixture("groups"), request = fixture("wishlist-item-request");

describe("mobileItem", () => {
  it("matches the item fixture", () => expect(mobileItem(rowFor(one.item), groups.groups)).toEqual(one.item));
  it("matches the list fixture, one item of each privacy kind", () =>
    expect({ items: list.items.map((i: MobileItem) => mobileItem(rowFor(i), groups.groups)) }).toEqual(list));
  it("sends the twelve named fields and nothing else", () => {
    const item = mobileItem(rowFor(one.item), groups.groups);
    expect(Object.keys(item).sort()).toEqual(["category", "createdAt", "description", "id", "imagePath", "imageUrl",
      "price", "priority", "privacy", "privacySummary", "title", "url"]);
    expect(JSON.stringify(item)).not.toMatch(/purchased|out_of_stock|user_id|privacy_settings|visibleToGroupTypes/);
  });
  it("sends a missing priority as medium", () => expect(mobileItem({ ...rowFor(one.item), priority: null }, []).priority).toBe("medium"));
  it("sends a zero price as no price", () => expect(mobileItem({ ...rowFor(one.item), price: 0 }, []).price).toBeNull());
  it("says 'Only one group' for a group the caller has left", () => {
    const row = { ...rowFor(one.item), privacy_settings: { visibleToGroupTypes: [], restrictToGroup: "99999999-9999-4999-8999-999999999999" } };
    expect(mobileItem(row, groups.groups).privacySummary).toBe("Only one group");
  });
  it("reads privacy_settings it cannot understand as private", () => {
    for (const bad of [null, "x", [], {}, { visibleToGroupTypes: "family" }])
      expect(mobileItem({ ...rowFor(one.item), privacy_settings: bad }, []).privacy).toEqual({ kind: "private" });
  });
});

describe("mobileItem, a restrictToGroup that is neither null nor text", () => {
  it("reads the whole value as private instead of falling through to the types", () => {
    for (const bad of [5, true, {}, ["g"]]) {
      const row = { ...rowFor(one.item), privacy_settings: { visibleToGroupTypes: ["family", "friends"], restrictToGroup: bad } };
      expect(mobileItem(row, []).privacy).toEqual({ kind: "private" });
    }
  });
  it("still reads an absent restrictToGroup as the types", () => {
    const row = { ...rowFor(one.item), privacy_settings: { visibleToGroupTypes: ["family"] } };
    expect(mobileItem(row, []).privacy).toEqual({ kind: "legacyTypes", types: ["family"] });
  });
});

describe("mobileItem, a picture whose address could not be signed", () => {
  it("matches the unsigned item fixture", () => {
    const row = { ...rowFor(one.item), image_url: null };
    expect(mobileItem(row, groups.groups)).toEqual(fixture("wishlist-item-unsigned").item);
  });
});

describe("utcSeconds", () => {
  it.each([
    ["2026-11-11T18:04:13.123456+00:00", "2026-11-11T18:04:13Z"],
    ["2026-11-11T20:04:13+02:00", "2026-11-11T18:04:13Z"],
    ["2026-11-11T18:04:13.999+00:00", "2026-11-11T18:04:13Z"],
    ["2026-11-11T18:04:13Z", "2026-11-11T18:04:13Z"],
  ])("%s → %s", (input, out) => expect(utcSeconds(input)).toBe(out));
});

describe("mobileGroups", () => {
  it("matches the groups fixture: named fields only, sorted by name", () => expect({ groups: mobileGroups(groupRows()) }).toEqual(groups));
  it("sorts with the English locale, whatever the machine's", () => {
    const spy = vi.spyOn(String.prototype, "localeCompare");
    mobileGroups(groupRows());
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.every((c) => c[1] === "en")).toBe(true);
    spy.mockRestore();
  });
  it("drops a membership whose group it cannot see", () =>
    expect(mobileGroups([{ myRole: "member", joinedAt: "2026-01-02T00:00:00+00:00" }, ...groupRows()])).toHaveLength(2));
});

describe("parseWishlistBody", () => {
  it("accepts the request fixture", () => expect(parseWishlistBody(request)).toEqual({ ok: true, body: request }));
  it("fills what is left out with null and trims the name", () =>
    expect(parseWishlistBody({ title: "  Wool socks  ", priority: "low", privacy: { kind: "private" } })).toEqual({ ok: true,
      body: { title: "Wool socks", description: null, url: null, price: null, imagePath: null, priority: "low", category: null, privacy: { kind: "private" } } }));
  it("treats a zero price and an empty link as none", () => {
    const r = parseWishlistBody({ ...request, price: 0, url: "" });
    expect(r.ok && [r.body.price, r.body.url]).toEqual([null, null]);
  });
  it("trims the link before checking it", () => {
    const r = parseWishlistBody({ ...request, url: "  https://example.com/x  " });
    expect(r.ok && r.body.url).toBe("https://example.com/x");
  });
  it.each([
    ["a name of exactly 200 characters", { title: "a".repeat(200) }, "title", "a".repeat(200)],
    ["notes of exactly 1000 characters", { description: "a".repeat(1000) }, "description", "a".repeat(1000)],
    ["a category of exactly 50 characters", { category: "a".repeat(50) }, "category", "a".repeat(50)],
    ["a link of exactly 2048 characters", { url: "https://a.co/" + "a".repeat(2035) }, "url", "https://a.co/" + "a".repeat(2035)],
    ["an http link", { url: "http://example.com/x" }, "url", "http://example.com/x"],
  ])("accepts %s", (_, patch, key, stored) => {
    const r = parseWishlistBody({ ...request, ...patch });
    expect(r.ok && (r.body as unknown as Record<string, unknown>)[key]).toBe(stored);
  });
  it("accepts a price of exactly a million", () => {
    const r = parseWishlistBody({ ...request, price: 1000000 });
    expect(r.ok && r.body.price).toBe(1000000);
  });
  it("accepts notes with line breaks and a tab, stored unchanged", () => {
    const notes = "line one\r\nline two\n\tindented";
    const r = parseWishlistBody({ ...request, description: notes });
    expect(r.ok && r.body.description).toBe(notes);
  });
  it("ignores an unknown key and does not store it", () => {
    expect(parseWishlistBody({ ...request, purchased: true })).toEqual({ ok: true, body: request });
  });
  it("accepts 100 emoji, which is 200 UTF-16 units", () => expect(parseWishlistBody({ ...request, title: "🎁".repeat(100) }).ok).toBe(true));
  it.each([
    ["no name", { ...request, title: undefined }, RULES.nameMissing],
    ["a blank name", { ...request, title: "   " }, RULES.nameMissing],
    ["a 201-character name", { ...request, title: "a".repeat(201) }, RULES.nameTooLong],
    ["100 emoji and a letter", { ...request, title: "🎁".repeat(100) + "a" }, RULES.nameTooLong],
    ["1001 characters of notes", { ...request, description: "a".repeat(1001) }, RULES.notesTooLong],
    ["a 51-character category", { ...request, category: "a".repeat(51) }, RULES.categoryTooLong],
    ["an ftp link", { ...request, url: "ftp://example.com/x" }, RULES.linkNotWeb],
    ["a javascript link", { ...request, url: "javascript:alert(1)" }, RULES.linkNotWeb],
    ["a 2049-character link", { ...request, url: "https://a.co/" + "a".repeat(2036) }, RULES.linkTooLong],
    ["a negative price", { ...request, price: -1 }, RULES.price],
    ["a price of 1e300", { ...request, price: 1e300 }, RULES.price],
    ["a price just over a million", { ...request, price: 1000000.01 }, RULES.price],
    ["a title with a null character", { ...request, title: "a\u0000b" }, RULES.characters],
    ["a title with a line break", { ...request, title: "a\nb" }, RULES.characters],
    ["a category with a null character", { ...request, category: "a\u0000b" }, RULES.characters],
    ["notes with a null character", { ...request, description: "a\u0000b" }, RULES.characters],
    ["a link with a tab inside", { ...request, url: "h\tttps://example.com" }, RULES.characters],
    ["a link with a space inside", { ...request, url: "https://example.com/a b" }, RULES.characters],
    ["a price written as text", { ...request, price: "29.99" }, RULES.price],
    ["no priority", { ...request, priority: undefined }, RULES.priority],
    ["an unknown priority", { ...request, priority: "urgent" }, RULES.priority],
    ["no privacy", { ...request, privacy: undefined }, RULES.privacy],
    ["an unknown privacy kind", { ...request, privacy: { kind: "everyone" } }, RULES.privacy],
    ["a legacy choice with no types", { ...request, privacy: { kind: "legacyTypes", types: [] } }, RULES.privacy],
    ["one group with no group", { ...request, privacy: { kind: "group" } }, RULES.chooseGroup],
    ["a picture value that is not text", { ...request, imagePath: 5 }, INVALID_IMAGE_ERROR],
    ["nothing", undefined, RULES.request],
    ["a list", [], RULES.request],
  ])("refuses %s with a sentence", (_, raw, message) => expect(parseWishlistBody(raw)).toEqual({ ok: false, message }));
});

describe("formDataFromBody", () => {
  const body = (privacy: object) => (parseWishlistBody({ ...request, privacy }) as { body: WishlistBody }).body;
  it("turns the request fixture into what createWishlistItem takes", () =>
    expect(formDataFromBody(body({ kind: "groups" }))).toEqual({ title: "Stanley tumbler, 40 oz", description: null,
      url: "https://a.co/d/abc123", price: 29.99, image_url: "user_2abcDEF/1794400000000-k3j2.jpg", priority: "high",
      category: null, visible_to_group_types: ["family", "friends", "work", "custom"], restrict_to_group: null }));
  it("stores each privacy choice the way the site does", () => {
    expect(formDataFromBody(body({ kind: "group", groupId: "g-1" }))).toMatchObject({ visible_to_group_types: [], restrict_to_group: "g-1" });
    expect(formDataFromBody(body({ kind: "private" }))).toMatchObject({ visible_to_group_types: [], restrict_to_group: null });
    expect(formDataFromBody(body({ kind: "legacyTypes", types: ["friends", "family"] })))
      .toMatchObject({ visible_to_group_types: ["family", "friends"], restrict_to_group: null });
  });
});

describe("the dates an item can be tagged for", () => {
  const t = tagging();
  it("are the website's own, titled for the caller, matching the fixture", () =>
    expect({ occasions: tagChoices(t.upcoming, SAM).map((o) => wishlistOccasion(o, SAM)) }).toEqual(fixture("wishlist-occasions")));
  it("never include someone else's birthday", () =>
    expect(tagChoices(t.upcoming, SAM).map(occasionKey)).not.toContain("birthday:user_2momABC:2027"));
  it("come soonest first, whatever order they arrive in", () =>
    expect(tagChoices([...t.upcoming].reverse(), SAM).map(occasionKey)).toEqual([KEYS.samBirthday, KEYS.xmas]));
  it("offer the caller's birthday before it has a row", () =>
    expect(tagChoices(world().upcoming, SAM).map(occasionKey)).toEqual([KEYS.samBirthday, KEYS.xmas]));
});

describe("wishlistOccasion", () => {
  const w = world();
  const anniversary = (celebrant: string, partner: string | null): UpcomingOccasion => ({ occasionId: null, kind: "anniversary",
    name: null, occasionDate: "2027-03-08", celebrantId: celebrant, celebrantUsername: null, celebrantDisplayName: "Alex Rivera",
    groupId: null, groupName: null, partnerId: partner, partnerUsername: null, partnerDisplayName: partner === null ? null : "Sam Rivera" });
  it("titles the caller's own birthday 'Your birthday'", () =>
    expect(wishlistOccasion(w.upcoming[0], SAM)).toEqual(
      { key: KEYS.samBirthday, kind: "birthday", title: "Your birthday", date: "2026-11-30", group: null }));
  it("titles the caller's own anniversary 'Your anniversary', also when it is stored under their partner", () => {
    expect(wishlistOccasion(anniversary(SAM, null), SAM).title).toBe("Your anniversary");
    expect(wishlistOccasion(anniversary(w.people.alex.id, SAM), SAM).title).toBe("Your anniversary");
  });
  it("keeps a group date's name and its group", () =>
    expect(wishlistOccasion(w.upcoming[1], SAM)).toEqual(
      { key: KEYS.xmas, kind: "group_date", title: "Christmas 2026", date: "2026-12-25", group: { id: IDS.rivera, name: "Rivera Family" } }));
  it("keeps the site's title for anyone else's", () =>
    expect(wishlistOccasion(w.upcoming[2], SAM).title).toBe("Mom's Birthday"));
});

describe("isOneOfMyGroups", () => {
  it("checks only a one-group choice", () => {
    expect(isOneOfMyGroups({ kind: "group", groupId: groups.groups[0].id }, groups.groups)).toBe(true);
    expect(isOneOfMyGroups({ kind: "group", groupId: "99999999-9999-4999-8999-999999999999" }, groups.groups)).toBe(false);
    expect(isOneOfMyGroups({ kind: "groups" }, [])).toBe(true);
  });
});
