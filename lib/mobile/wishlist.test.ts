import { describe, it, expect } from "vitest";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import { fixture, groupRows, rowFor } from "./test-fixtures";
import {
  RULES,
  formDataFromBody,
  isOneOfMyGroups,
  mobileGroups,
  mobileItem,
  parseWishlistBody,
  utcSeconds,
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
    for (const bad of [null, "x", {}, { visibleToGroupTypes: "family" }])
      expect(mobileItem({ ...rowFor(one.item), privacy_settings: bad }, []).privacy).toEqual({ kind: "private" });
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

describe("isOneOfMyGroups", () => {
  it("checks only a one-group choice", () => {
    expect(isOneOfMyGroups({ kind: "group", groupId: groups.groups[0].id }, groups.groups)).toBe(true);
    expect(isOneOfMyGroups({ kind: "group", groupId: "99999999-9999-4999-8999-999999999999" }, groups.groups)).toBe(false);
    expect(isOneOfMyGroups({ kind: "groups" }, [])).toBe(true);
  });
});
