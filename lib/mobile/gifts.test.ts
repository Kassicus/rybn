import { describe, it, expect } from "vitest";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import { fixture } from "./test-fixtures";
import { IDS, TODAY, world } from "./test-shopping";
import { RULES } from "./wishlist";
import { SHOPPING_RULES } from "./shopping-rules";
import {
  buildGiftList,
  buildGiftViews,
  giftSeason,
  heldItemIds,
  parseGiftBody,
  parseStepBody,
  planStep,
  recipientNames,
  type GiftRow,
  type StepDirection,
  type StepFacts,
  type StepPlan,
} from "./gifts";

const w = world(), views = w.giftViews(), view = (id: string, vs = views) => vs.find((v) => v.gift.id === id)!;
const base: StepFacts = { status: "planned", fromList: true, itemLinked: true, itemHidden: false, held: true, occasionDate: "2026-12-25", today: TODAY };
const hidden: Partial<StepFacts> = { itemLinked: false, itemHidden: true };
const withRows = (change: (r: GiftRow) => GiftRow, ctx = w.giftContext()) => buildGiftViews(w.giftRows().map(change), ctx);

describe("planStep (§5.3, D6, D7, D13)", () => {
  it.each<[string, Partial<StepFacts>, StepDirection, StepPlan]>([
    ["Claimed → Ordered marks the item bought", {}, "forward", { ok: true, to: "ordered", markBought: true }],
    ["Ordered → Claimed marks it not bought", { status: "ordered" }, "back", { ok: true, to: "planned", markBought: false }],
    ["Ordered → Arrived touches nothing else", { status: "ordered" }, "forward", { ok: true, to: "arrived", markBought: null }],
    ["Given → Wrapped", { status: "given" }, "back", { ok: true, to: "wrapped", markBought: null }],
    ["a hand-added gift never touches an item", { fromList: false, itemLinked: false, held: false }, "forward", { ok: true, to: "ordered", markBought: null }],
    ["an item that has gone is never touched", { itemLinked: false, held: false }, "forward", { ok: true, to: "ordered", markBought: null }], // Review Focus 5
    ["an item that has gone is never touched going back either", { status: "ordered", itemLinked: false, held: false }, "back", { ok: true, to: "planned", markBought: null }],
    ["an item that cannot be seen is not marked ordered", hidden, "forward", { ok: false, message: SHOPPING_RULES.itemHiddenForward }],
    ["an item that cannot be seen is not marked ordered, held or not", { ...hidden, held: false }, "forward", { ok: false, message: SHOPPING_RULES.itemHiddenForward }],
    ["an item that cannot be seen keeps its gift at Ordered", { ...hidden, status: "ordered" }, "back", { ok: false, message: SHOPPING_RULES.itemHiddenBack }],
    ["an item that cannot be seen: Ordered → Arrived goes ahead and touches nothing", { ...hidden, status: "ordered" }, "forward", { ok: true, to: "arrived", markBought: null }],
    ["an item that cannot be seen: Arrived → Ordered goes ahead and touches nothing", { ...hidden, status: "arrived" }, "back", { ok: true, to: "ordered", markBought: null }],
    ["refused when the claim is no longer held", { held: false }, "forward", { ok: false, message: SHOPPING_RULES.notHeld }],
    ["back below Ordered refused once the date has passed", { status: "ordered", occasionDate: "2026-11-10" }, "back", { ok: false, message: SHOPPING_RULES.pastOccasion }],
    ["back below Ordered allowed on the day itself", { status: "ordered", occasionDate: TODAY }, "back", { ok: true, to: "planned", markBought: false }],
    ["D13 holds for a hand-added gift too", { status: "ordered", fromList: false, itemLinked: false, held: false, occasionDate: "2026-11-10" }, "back", { ok: false, message: SHOPPING_RULES.pastOccasion }],
    ["Arrived → Ordered is fine after the date", { status: "arrived", occasionDate: "2026-11-10" }, "back", { ok: true, to: "ordered", markBought: null }],
    ["nothing after Given", { status: "given" }, "forward", { ok: false, message: SHOPPING_RULES.lastStep }],
    ["nothing before the first step", {}, "back", { ok: false, message: SHOPPING_RULES.firstStep }],
  ])("%s", (_, facts, direction, plan) => expect(planStep({ ...base, ...facts }, direction)).toEqual(plan));
});
describe("buildGiftViews", () => {
  it("matches the gift fixture", () => expect(view(IDS.giftScarf).gift).toEqual(fixture("gift").gift));
  it("matches every gift in the gifts fixture", () => {
    for (const group of fixture("gifts").groups) for (const g of group.gifts) expect(view(g.id).gift).toEqual(g);
  });
  it("sends the named fields only", () => expect(Object.keys(view(IDS.giftScarf).gift).sort()).toEqual(["canGoBack", "canGoForward",
    "canRelease", "canRemove", "description", "fromList", "held", "id", "imagePath", "imageUrl", "itemGone", "itemId", "itemNotBought",
    "link", "name", "notes", "occasion", "person", "price", "recipientName", "seasonYear", "status", "updatedAt"]));
  it("is for the item's owner, whatever its recipient is called", () => {
    const ctx = w.giftContext(); ctx.recipients.set(IDS.recipientMom, { id: IDS.recipientMom, name: "Mum", person_id: null });
    const v = view(IDS.giftScarf, buildGiftViews(w.giftRows(), ctx));
    expect([v.personId, v.gift.person?.name, v.gift.recipientName]).toEqual(["user_2momABC", "Mom", "Mum"]);
  });
  it("says the item has gone once it is deleted, and still counts it as from a list", () => {
    const ctx = w.giftContext(); ctx.held.delete(IDS.scarf);
    const g = view(IDS.giftScarf, withRows((r) => (r.id === IDS.giftScarf ? { ...r, wishlist_item_id: null } : r), ctx)).gift;
    expect(g).toMatchObject({ fromList: true, itemGone: true, held: false, canGoForward: true, canRelease: false, canRemove: true, itemId: null });
  });
  it("treats an item the caller can no longer see as gone, and offers no Mark ordered while it is held at Claimed", () => {
    const ctx = w.giftContext(); ctx.items.delete(IDS.scarf);
    const v = view(IDS.giftScarf, buildGiftViews(w.giftRows(), ctx));
    expect(v.gift).toMatchObject({ itemGone: true, held: true, imageUrl: null, canGoForward: false, canGoBack: false, canRelease: true, canRemove: false });
    expect(v.itemHidden).toBe(true);
  });
  it("keeps a gift whose item can no longer be seen at Ordered: no Undo, and it can be removed though its claim is held", () => {
    const ctx = w.giftContext(); ctx.items.delete(IDS.catan);
    expect(view(IDS.giftCatan, buildGiftViews(w.giftRows(), ctx)).gift).toMatchObject(
      { status: "ordered", itemGone: true, held: true, canGoForward: true, canGoBack: false, canRelease: false, canRemove: true });
  });
  it("lets a deleted item's gift step both ways, and says it is not hidden", () => {
    const ctx = w.giftContext(); ctx.held.delete(IDS.catan);
    const v = view(IDS.giftCatan, withRows((r) => (r.id === IDS.giftCatan ? { ...r, wishlist_item_id: null } : r), ctx));
    expect(v.gift).toMatchObject({ itemGone: true, canGoForward: true, canGoBack: true, canRemove: true });
    expect(v.itemHidden).toBe(false);
  });
  it("says No longer held at Claimed: no step forward, no release, and it can be removed", () => {
    const ctx = w.giftContext(); ctx.held.clear();
    expect(view(IDS.giftScarf, buildGiftViews(w.giftRows(), ctx)).gift).toMatchObject(
      { status: "claimed", held: false, itemGone: false, canGoForward: false, canRelease: false, canRemove: true });
  });
  it("says the item is not marked bought when the site un-marked it after Ordered", () => {
    const ctx = w.giftContext(); ctx.items.set(IDS.catan, { ...ctx.items.get(IDS.catan)!, purchased: false });
    expect(view(IDS.giftCatan, buildGiftViews(w.giftRows(), ctx)).gift.itemNotBought).toBe(true);
  });
  it("offers no Undo at Ordered once the occasion's date has passed", () =>
    expect(view(IDS.giftCatan, buildGiftViews(w.giftRows(), { ...w.giftContext(), today: "2026-12-26" })).gift.canGoBack).toBe(false));
  it("never offers release once the item is marked bought", () => {
    const ctx = w.giftContext(); ctx.items.set(IDS.scarf, { ...ctx.items.get(IDS.scarf)!, purchased: true });
    expect(view(IDS.giftScarf, buildGiftViews(w.giftRows(), ctx)).gift.canRelease).toBe(false);
  });
  it("prefers the gift's own picture and falls back to the item's", () => {
    expect(view(IDS.giftPhotoBook).gift.imageUrl).toBe(w.signedGiftPhoto("user_2abcDEF/1794500000000-p4b8.jpg"));
    expect(view(IDS.giftScarf).gift).toMatchObject({ imagePath: null,
      imageUrl: "https://example.supabase.co/storage/v1/object/sign/wishlist-images/user_2momABC/1793100000000-s2c4.jpg?token=fixture" });
    const own = view(IDS.giftScarf, withRows((r) => (r.id === IDS.giftScarf
      ? { ...r, photo_url: w.signedGiftPhoto("user_2abcDEF/1-own.jpg"), photo_path: "user_2abcDEF/1-own.jpg" } : r))).gift;
    expect([own.imageUrl, own.imagePath]).toEqual([w.signedGiftPhoto("user_2abcDEF/1-own.jpg"), "user_2abcDEF/1-own.jpg"]);
  });
});
describe("giftSeason", () => {
  it("is the occasion's year", () => expect(giftSeason("2027-01-14", "2026-12-02T10:00:00+00:00")).toBe(2027));
  it("is the year it was added, in UTC, when it has no occasion, whatever the machine's zone", () => {
    const zone = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";   // there it is still 31 December
      expect(giftSeason(null, "2026-12-31T23:30:00-05:00")).toBe(2027);
    } finally {
      if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
    }
  });
});
describe("held claims", () => {
  const claim = (purchased: boolean, date: string | null) => ({ itemId: "i1", occasionId: "o1", occasionDate: date, owner: null,
    item: { id: "i1", ownerId: "u", title: "t", description: null, url: null, price: null, imageValue: null, purchased } });
  it("lapses after the occasion's date when the item is not bought", () => {
    expect(heldItemIds([claim(false, "2026-11-10")], TODAY).size).toBe(0);
    expect(heldItemIds([claim(false, TODAY)], TODAY).has("i1")).toBe(true);
  });
  it("is kept after the date when the item is bought", () => expect(heldItemIds([claim(true, "2026-11-10")], TODAY).has("i1")).toBe(true));
});
describe("a gift's person", () => {
  it("is dropped when the owner is not in the profiles", () => {
    const ctx = w.giftContext(); ctx.profiles = new Map([...w.profiles].filter(([id]) => id !== "user_2momABC"));
    const v = view(IDS.giftScarf, buildGiftViews(w.giftRows(), ctx));
    expect([v.personId, v.gift.person]).toEqual([null, null]);
  });
});
describe("typed-name groups", () => {
  it("come after the people, in name order", () => {
    const hat = w.giftRows().find((r) => r.id === IDS.giftHat)!;
    const rows = [{ ...hat, id: "g0", recipient_id: "r0" }, { ...hat, id: "g1", recipient_id: "r1" }];
    const ctx = w.giftContext();
    ctx.recipients = new Map(rows.map((r, i) => [r.recipient_id, { id: r.recipient_id, name: i === 0 ? "Zed" : "Abe", person_id: null }]));
    const typed = buildGiftViews(rows, ctx);
    const all = [...views.filter((v) => v.personId !== null), ...typed];
    const names = buildGiftList({ views: all, season: null, currentYear: 2026, choices: fixture("gifts").choices }).groups.map((g) => g.name);
    expect(names).toEqual(["Alex Rivera", "Mom", "Abe", "Zed"]);
  });
});
describe("buildGiftList", () => {
  const choices = fixture("gifts").choices;
  it("matches the gifts fixture", () => expect(buildGiftList({ views, season: null, currentYear: 2026, choices })).toEqual(fixture("gifts")));
  it("answers another season", () => {
    const answer = buildGiftList({ views, season: 2025, currentYear: 2026, choices });
    expect(answer.groups.map((g) => [g.name, g.gifts.map((x) => x.name)])).toEqual([["Grandpa Joe", ["Wool gloves"]]]);
    expect(answer.counts.given).toBe(1);
  });
  it("offers next year's season for a gift filed under next January's birthday", () => {      // Review Focus 3
    const moved = withRows((r) => (r.id === IDS.giftPhotoBook ? { ...r, occasion_id: IDS.momBirthday } : r));
    expect(buildGiftList({ views: moved, season: null, currentYear: 2026, choices }).seasons).toEqual([2027, 2026, 2025]);
    expect(buildGiftList({ views: moved, season: 2027, currentYear: 2026, choices }).groups.map((g) => g.name)).toEqual(["Mom"]);
  });
  it("leaves archived gifts out", () => {
    const archived = withRows((r) => (r.id === IDS.giftHat ? { ...r, is_archived: true } : r));
    expect(buildGiftList({ views: archived, season: null, currentYear: 2026, choices }).groups.map((g) => g.name)).toEqual(["Alex Rivera", "Mom"]);
  });
});
describe("recipientNames", () => {
  it("names a recipient after the person, and gives the name for a clash", () =>
    expect(recipientNames("Mom")).toEqual({ plain: "Mom", fromList: "Mom (from their list)" }));
  it("keeps both within the tracker's 100 characters", () => {
    const n = recipientNames("a".repeat(150));
    expect([[...n.plain].length, [...n.fromList].length, n.fromList.endsWith(" (from their list)")]).toEqual([100, 100, true]);
  });
  it("counts an emoji as one character, as the database does", () => expect([...recipientNames("🎁".repeat(100)).fromList]).toHaveLength(100));
});
describe("parseGiftBody", () => {
  const request = fixture("gift-request");
  it("accepts the request fixture", () => expect(parseGiftBody(request)).toEqual({ ok: true, body: request }));
  it("accepts a typed name instead of a person", () =>
    expect(parseGiftBody({ ...request, person: null, recipientName: "  Grandpa Joe " })).toMatchObject({ ok: true, body: { person: null, recipientName: "Grandpa Joe" } }));
  it.each([
    ["neither person nor name", { ...request, person: null }, SHOPPING_RULES.chooseWho],
    ["both", { ...request, recipientName: "Dad" }, SHOPPING_RULES.chooseWho],
    ["a blank name only", { ...request, person: null, recipientName: "  " }, SHOPPING_RULES.chooseWho],
    ["a 101-character recipient", { ...request, person: null, recipientName: "a".repeat(101) }, SHOPPING_RULES.recipientTooLong],
    ["no gift name", { ...request, name: " " }, RULES.nameMissing],
    ["a 1001-character description", { ...request, description: "a".repeat(1001) }, SHOPPING_RULES.descriptionTooLong],
    ["a javascript link", { ...request, link: "javascript:alert(1)" }, RULES.linkNotWeb],
    ["a negative price", { ...request, price: -1 }, RULES.price],
    ["a picture value that is not text", { ...request, imagePath: 5 }, INVALID_IMAGE_ERROR],
    ["an occasion that is not text", { ...request, occasion: 7 }, SHOPPING_RULES.chooseOccasion],
    ["1001 characters of notes", { ...request, notes: "a".repeat(1001) }, RULES.notesTooLong],
    ["a list", [], RULES.request],
    ["a control character in the name", { ...request, name: "a\u0007b" }, RULES.characters],
    ["a 201-character name", { ...request, name: "a".repeat(201) }, RULES.nameTooLong],
    ["a 2049-character link", { ...request, link: "https://www.example.com/" + "a".repeat(2030) }, RULES.linkTooLong],
    ["101 emoji as a typed recipient", { ...request, person: null, recipientName: "🎁".repeat(101) }, SHOPPING_RULES.recipientTooLong],
  ])("refuses %s with a sentence", (_, raw, message) => expect(parseGiftBody(raw)).toEqual({ ok: false, message }));
  it("accepts 100 emoji as a typed recipient, as the database does", () =>
    expect(parseGiftBody({ ...request, person: null, recipientName: "🎁".repeat(100) })).toMatchObject({ ok: true }));
});
describe("parseStepBody", () => {
  it("accepts the step fixture", () => expect(parseStepBody(fixture("step-request"))).toEqual({ ok: true, direction: "forward", from: "claimed" }));
  it.each([undefined, {}, { direction: "sideways", from: "claimed" }, { direction: "forward" }, { direction: "forward", from: "sent" }])("refuses %j", (raw) => expect(parseStepBody(raw)).toEqual({ ok: false, message: RULES.request }));
});
