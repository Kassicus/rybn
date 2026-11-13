import { describe, it, expect } from "vitest";
import { fixture, groupRows } from "./test-fixtures";
import { CODE, RIVERA_DESCRIPTION, roleIn } from "./test-groups";
import { IDS, SAM, world } from "./test-shopping";
import { RULES } from "./wishlist";
import { SHOPPING_RULES } from "./shopping-rules";
import { buildGiftViews } from "./gifts";
import type { GroupRole } from "./groups";
import { mobileOccasion, occasionsInvolving, sharedGroupIds } from "./occasions";
import {
  buildChoices,
  buildGroupList,
  buildGroupPage,
  buildHome,
  buildPersonList,
  claimRefusal,
  mobileListItem,
  orderListRows,
  parseClaimBody,
} from "./shopping";

const w = world(), views = w.giftViews();
const homeInput = { callerId: SAM, upcoming: w.upcoming, members: w.members, profiles: w.profiles, views };
const refile = (id: string, occasionId: string | null) => buildGiftViews(
  w.giftRows().map((r) => (r.id === id ? { ...r, occasion_id: occasionId } : r)), w.giftContext());

describe("buildHome", () => {
  it("matches the home fixture", () => expect(buildHome(homeInput)).toEqual(fixture("home")));
  it("counts only gifts filed under that occasion (§5.4)", () => {
    const answer = buildHome({ ...homeInput, views: refile(IDS.giftPhotoBook, IDS.momBirthday) });
    expect(answer.occasions[0].people[4].giftCount).toBe(1);
    expect(answer.occasions[1]).toMatchObject({ started: 1, people: [{ giftCount: 1 }] });
  });
  it("counts nothing for a birthday with no row yet", () => {
    expect(buildHome(homeInput).occasions[2].started).toBe(0);
    const ctx = w.giftContext(); ctx.recipients.set(IDS.recipientJoe, { id: IDS.recipientJoe, name: "Priya", person_id: "user_2prySHA" });
    const priyas = buildGiftViews(w.giftRows(), ctx).filter((v) => v.personId === "user_2prySHA");
    expect(priyas.length).toBeGreaterThan(0);
    expect(priyas.every((v) => v.occasionId === null)).toBe(true);
    expect(buildHome({ ...homeInput, views: [...views, ...priyas] }).occasions[2]).toMatchObject({ started: 0, people: [{ giftCount: 0 }] });
  });
  it("never counts last year's Christmas toward this year's", () => {
    const answer = buildHome({ ...homeInput, views: refile(IDS.giftScarf, "22222222-2222-4222-8222-222222222222") });
    expect(answer.occasions[0].people[4].giftCount).toBe(1);
  });
  it("leaves archived gifts out", () => {
    const archived = buildGiftViews(w.giftRows().map((r) => (r.id === IDS.giftCatan ? { ...r, is_archived: true } : r)), w.giftContext());
    expect(buildHome({ ...homeInput, views: archived }).occasions[0]).toMatchObject({ started: 1 });
  });
});
describe("buildGroupList", () => {
  it("matches the group-list fixture, never an invite code", () => {
    const answer = buildGroupList(groupRows(), w.memberCounts);
    expect(answer).toEqual(fixture("group-list"));
    expect(JSON.stringify(answer)).not.toMatch(/SECRET12|invite/);
  });
});
describe("buildGroupPage", () => {
  const rivera = w.members.get(IDS.rivera)!;
  const input = { callerId: SAM, group: { id: IDS.rivera, name: "Rivera Family", type: "family" as const, description: RIVERA_DESCRIPTION },
    members: rivera, roles: new Map(rivera.map((p) => [p.id, roleIn(IDS.rivera, p.id)])),
    itemCounts: w.itemCounts, upcoming: w.upcoming, profiles: w.profiles, views,
    makers: new Map<string, string | null>([[IDS.xmas, SAM]]) };
  it("matches the group fixture", () => expect(buildGroupPage(input)).toEqual(fixture("group")));
  it("offers a change only on a date the caller made, or to an owner or admin", () => {
    const changes = (role: GroupRole, maker: string | null) => buildGroupPage({ ...input,
      roles: new Map([...input.roles, [SAM, role]]), makers: new Map([[IDS.xmas, maker]]) }).occasions.map((o) => o.change);
    const xmas = { id: IDS.xmas };
    // Christmas 2026 first, then Mom's Birthday, which is nobody's to change
    expect(changes("member", SAM)).toEqual([xmas, null]);
    expect(changes("member", w.people.dad.id)).toEqual([null, null]);
    expect(changes("admin", w.people.dad.id)).toEqual([xmas, null]);
    expect(changes("owner", w.people.dad.id)).toEqual([xmas, null]);
    // A maker whose account is gone, or a date whose maker was not read
    expect(changes("member", null)).toEqual([null, null]);
    expect(changes("admin", null)).toEqual([xmas, null]);
    expect(buildGroupPage({ ...input, makers: new Map() }).occasions.map((o) => o.change)).toEqual([null, null]);
  });
  it("offers no change to a caller the roles do not name, as the database lets only a member change a date", () => {
    const roles = new Map([...input.roles].filter(([id]) => id !== SAM));
    expect(buildGroupPage({ ...input, roles }).occasions.map((o) => o.change)).toEqual([null, null]);
  });
  it("sends a date's row id and nothing else about who made it", () => {
    const page = buildGroupPage({ ...input, roles: new Map([...input.roles, [SAM, "admin" as const]]),
      makers: new Map([[IDS.xmas, "user_2gonABC"]]) });
    expect(page.occasions.map((o) => o.change && Object.keys(o.change))).toEqual([["id"], null]);
    expect(JSON.stringify(page)).not.toContain("user_2gonABC");
  });
  it("offers no change on a birthday, whoever made its row", () => {
    const makers = new Map<string, string | null>([[IDS.xmas, SAM], [IDS.momBirthday, SAM]]);
    expect(buildGroupPage({ ...input, makers, roles: new Map([...input.roles, [SAM, "owner" as const]]) })
      .occasions.map((o) => [o.occasion.kind, o.change])).toEqual([["group_date", { id: IDS.xmas }], ["birthday", null]]);
  });
  it("reads anyone the roles do not name as a member, the caller included", () => {
    const page = buildGroupPage({ ...input, roles: new Map([[w.people.mom.id, "owner" as const]]) });
    expect([page.group.role, page.members.map((m) => m.role)]).toEqual(["member", ["member", "member", "member", "member", "owner", "member"]]);
    expect(buildGroupPage({ ...input, roles: new Map([[SAM, "admin" as const]]) }).group.role).toBe("admin");
  });
  it("sends the group's description as stored, none as null, and nothing else of the group's", () => {
    expect(buildGroupPage({ ...input, group: { ...input.group, description: null } }).group.description).toBeNull();
    const row = { ...input.group, invite_code: CODE, settings: {}, created_by: SAM };
    expect(Object.keys(buildGroupPage({ ...input, group: row }).group)).toEqual(["id", "name", "type", "description", "role"]);
  });
  it("never ticks the caller, even with a gift that is not yet given for them", () => {
    const ctx = w.giftContext(); ctx.recipients.set(IDS.recipientJoe, { id: IDS.recipientJoe, name: "Sam", person_id: SAM });
    const own = buildGiftViews(w.giftRows().map((r) => (r.id === IDS.giftHat ? { ...r, status: "ordered" as const } : r)), ctx);
    expect(own.some((v) => v.personId === SAM && v.status !== "given" && !v.archived)).toBe(true);
    expect(buildGroupPage({ ...input, views: own }).members.find((m) => m.isYou)!.hasGift).toBe(false);
  });
  it("ticks only a person with a gift not yet given, and never the caller", () => {
    const given = buildGiftViews(w.giftRows().map((r) => (r.id === IDS.giftCatan ? { ...r, status: "given" as const } : r)), w.giftContext());
    expect(buildGroupPage({ ...input, views: given }).members.map((m) => m.hasGift)).toEqual([false, false, false, false, true, false]);
  });
});
describe("list items", () => {
  const tagged = new Set([IDS.dutchOven, IDS.scarf]);
  const items = orderListRows(w.momItems, tagged).map((r) => mobileListItem(r, w.activeClaims[r.id], SAM, tagged.has(r.id)));
  it("matches the person-wishlist items: tagged first, then by priority, then newest", () => expect(items).toEqual(fixture("person-wishlist").items));
  it("turns a price of zero or less into none", () => {
    for (const price of [0, -5, null]) expect(mobileListItem({ ...w.momItems[1], price }, undefined, SAM, false).price).toBeNull();
    expect(mobileListItem({ ...w.momItems[1], price: 0.5 }, undefined, SAM, false).price).toBe(0.5);
  });
  it("counts no priority as medium in the ordering", () => {
    const rows = [
      { ...w.momItems[0], priority: null, created_at: "2026-12-01T10:00:00.000000+00:00" },   // kindle
      { ...w.momItems[3], priority: "medium" as const },                                      // scarf, older
      w.momItems[1], w.momItems[2],                                                          // oven must-have, gloves low
    ];
    expect(orderListRows(rows, new Set()).map((r) => r.id)).toEqual([IDS.dutchOven, IDS.kindle, IDS.scarf, IDS.gloves]);
    expect(mobileListItem(rows[0], undefined, SAM, false).priority).toBe("medium");
  });
  it("puts what is tagged for the occasion in view ahead of higher priorities", () =>
    expect(orderListRows(w.momItems, new Set([IDS.scarf])).map((r) => r.id)).toEqual([IDS.scarf, IDS.dutchOven, IDS.kindle, IDS.gloves]));
  it("reads Taken for an item bought with no claim", () =>
    expect(mobileListItem({ ...w.momItems[1], purchased: true }, undefined, SAM, false).state).toBe("taken"));
  it("never says who holds it or who marked it out of stock", () =>
    expect(JSON.stringify(items)).not.toMatch(/user_2dadABC|claimedBy|out_of_stock|purchased/));
  it("sends an owner's own items with no claim state at all", () => {                         // §5.5
    const own = { ...w.momItems[1], user_id: SAM };
    const plain = mobileListItem(own, undefined, SAM, false);
    expect(mobileListItem({ ...own, purchased: true, out_of_stock_marked_by: "user_2dadABC" }, { claimedBy: "user_2momABC" }, SAM, true)).toEqual(plain);
    expect(plain).toMatchObject({ state: "available", outOfStock: false, tagged: false });
  });
});
describe("buildPersonList", () => {
  const input = { callerId: SAM, person: w.people.mom, upcoming: w.upcoming, sharedGroupIds: sharedGroupIds("user_2momABC", w.members),
    occasionKey: IDS.xmasKey as string | null, rows: w.momItems, claims: w.activeClaims, tags: w.tags, views };
  it("matches the person-wishlist fixture", () => expect(buildPersonList(input)).toEqual(fixture("person-wishlist")));
  it("lists the items tagged for Mom's birthday first when that is in view", () => {
    const answer = buildPersonList({ ...input, occasionKey: "birthday:user_2momABC:2027" });
    expect(answer.items.map((i) => [i.id, i.tagged])).toEqual([[IDS.scarf, true], [IDS.dutchOven, false], [IDS.kindle, false], [IDS.gloves, false]]);
  });
  it("gives the gift fixture's occasions: the ones that involve Mom", () => expect(
    occasionsInvolving("user_2momABC", w.upcoming, sharedGroupIds("user_2momABC", w.members)).map(mobileOccasion)).toEqual(fixture("gift").occasions));
  it("puts gifts for the occasion in view first", () => expect(buildPersonList({ ...input, occasionKey: "birthday:user_2momABC:2027",
    views: refile(IDS.giftPhotoBook, IDS.momBirthday) }).gifts.map((g) => g.name)).toEqual(["Photo book", "Cashmere scarf"]));
  it("ignores an occasion that does not involve the person", () => {
    const answer = buildPersonList({ ...input, occasionKey: "birthday:user_2prySHA:2027" });
    expect([answer.occasion, answer.items.filter((i) => i.tagged).length, answer.gifts.length]).toEqual([null, 0, 2]);
  });
  it("leaves given gifts off the top", () => expect(buildPersonList({ ...input, views: buildGiftViews(w.giftRows().map((r) =>
    (r.id === IDS.giftPhotoBook ? { ...r, status: "given" as const } : r)), w.giftContext()) }).gifts.map((g) => g.name)).toEqual(["Cashmere scarf"]));
  it("answers the caller's own list with their items alone", () => {                              // §5.5
    const own = buildPersonList({ ...input, person: w.people.sam, rows: w.momItems.map((r) => ({ ...r, user_id: SAM })) });
    expect([own.occasion, own.occasions, own.gifts]).toEqual([null, [], []]);
    expect(own.items.every((i) => i.state === "available" && !i.outOfStock && !i.tagged)).toBe(true);
  });
});
describe("buildChoices", () => {
  it("matches the gifts fixture's choices", () =>
    expect(buildChoices({ callerId: SAM, upcoming: w.upcoming, members: w.members })).toEqual(fixture("gifts").choices));
});
describe("claims at the door", () => {
  it("accepts the request fixture, and No occasion", () => {
    expect(parseClaimBody(fixture("claim-request"))).toEqual({ ok: true, body: { occasion: IDS.xmasKey } });
    expect(parseClaimBody({ occasion: null })).toEqual({ ok: true, body: { occasion: null } });
  });
  it.each([[{}, SHOPPING_RULES.chooseOccasion], [{ occasion: 5 }, SHOPPING_RULES.chooseOccasion], [[], RULES.request], [undefined, RULES.request]])(
    "refuses %j", (raw, message) => expect(parseClaimBody(raw)).toEqual({ ok: false, message }));
  it.each([
    ["that item is not available to claim", SHOPPING_RULES.notAvailable], ["you cannot claim your own item", SHOPPING_RULES.ownItem],
    ["that item has already been purchased", SHOPPING_RULES.alreadyBought], ["somebody has already claimed that item", SHOPPING_RULES.alreadyClaimed],
    ["that occasion is not available", SHOPPING_RULES.chooseOccasion], ["something new", SHOPPING_RULES.notAvailable],
  ])("says %j as a sentence", (message, sentence) => expect(claimRefusal(message)).toBe(sentence));
});
