import { describe, it, expect, vi, beforeEach } from "vitest";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { WorldMocks } from "@/lib/mobile/test-shopping-mocks";

const holder = vi.hoisted(() => ({ current: undefined as unknown as WorldMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/occasions", () => ({ getUpcomingOccasions: (...a: unknown[]) => holder.current.getUpcomingOccasions(...a) }));
vi.mock("@/lib/actions/groups", () => ({
  getMyGroups: (...a: unknown[]) => holder.current.getMyGroups(...a),
  getGroupById: (...a: unknown[]) => holder.current.getGroupById(...a),
}));
vi.mock("@/lib/actions/wishlist", () => ({
  getUserWishlist: (...a: unknown[]) => holder.current.getUserWishlist(...a),
  getWishlistItem: (...a: unknown[]) => holder.current.getWishlistItem(...a),
  markAsPurchased: (...a: unknown[]) => holder.current.markAsPurchased(...a),
}));
vi.mock("@/lib/actions/claims", () => ({
  getActiveClaims: (...a: unknown[]) => holder.current.getActiveClaims(...a),
  releaseClaim: (...a: unknown[]) => holder.current.releaseClaim(...a),
}));
vi.mock("@/lib/actions/item-occasions", () => ({ getTagsForItems: (...a: unknown[]) => holder.current.getTagsForItems(...a) }));
vi.mock("@/lib/actions/profile", () => ({ getSharedGroups: (...a: unknown[]) => holder.current.getSharedGroups(...a) }));
vi.mock("@/lib/mobile/people-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mobile/people-live")>()),
  profiles: (...a: unknown[]) => holder.current.profiles(...a),
  groupMembers: (...a: unknown[]) => holder.current.groupMembers(...a),
  memberCounts: (...a: unknown[]) => holder.current.memberCounts(...a),
  visibleItemCounts: (...a: unknown[]) => holder.current.visibleItemCounts(...a),
  occasionRows: (...a: unknown[]) => holder.current.occasionRows(...a),
  linkedItems: (...a: unknown[]) => holder.current.linkedItems(...a),
}));
vi.mock("@/lib/mobile/gift-store-live", () => ({ createGiftStore: async () => holder.current.store }));
vi.mock("@/lib/supabase/signed-image", () => ({
  withSignedGiftPhotos: (...a: unknown[]) => holder.current.withSignedGiftPhotos(...a),
  withSignedGiftPhoto: (...a: unknown[]) => holder.current.withSignedGiftPhoto(...a),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: holder.current.rpc }) }));
vi.mock("@/lib/claims/active", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claims/active")>()),
  todayISO: () => holder.current.todayISO(),
}));

const { GET, PUT, DELETE } = await import("./route");
const { bearer, hideItem, oven, worldMocks, worldStore } = await import("@/lib/mobile/test-shopping-mocks");
const { memoryGiftStore } = await import("@/lib/mobile/test-gift-store");
const { reconcileGifts } = await import("@/lib/mobile/reconcile");
const { SHOPPING_RULES } = await import("@/lib/mobile/shopping-rules");
const { IDS, SAM, TODAY, world } = await import("@/lib/mobile/test-shopping");

const NOBODY = "44444444-4444-4444-8444-444444444444";
const DADS_GIFT = "55555555-5555-4555-8555-555555555555";
const url = (id: string) => `http://localhost/api/mobile/v1/gifts/${id}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => bearer(url(id));
const del = (id: string = IDS.giftPhotoBook) => bearer(url(id), { method: "DELETE" });
const put = (body: unknown, id: string = IDS.giftScarf) =>
  bearer(url(id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const scarfBody = (over = {}) => ({ person: "user_2momABC", recipientName: null, name: "Cashmere scarf", description: "Grey, the long one",
  link: "https://www.example.com/cashmere-scarf", price: 89, imagePath: null, occasion: IDS.xmasKey, notes: null, ...over });
const photoBookBody = (over = {}) => ({ person: "user_2momABC", recipientName: null, name: "Photo book", description: "Our trip to Lisbon",
  link: null, price: 35, imagePath: "user_2abcDEF/1794500000000-p4b8.jpg", occasion: IDS.xmasKey, notes: null, ...over });

/** Sam's world, plus a gift that belongs to Dad (a different caller's row, which Sam's store must never show). */
function storeWithDadsGift(createdOfPhotoBook?: string) {
  const w = world();
  return memoryGiftStore(SAM, {
    claims: w.claims,
    gifts: [
      ...w.gifts.map((g) => ({
        ...g, user_id: SAM,
        created_at: g.id === IDS.giftPhotoBook && createdOfPhotoBook ? createdOfPhotoBook : g.created_at,
      })),
      { ...w.gifts[4], id: DADS_GIFT, user_id: "user_2dadABC", name: "Dad's secret", wishlist_item_id: null, from_list: false },
    ],
    recipients: w.recipients.map((r) => ({ ...r, user_id: SAM })),
  });
}
const giftRow = (id: string) => holder.current.store.allGifts().find((g) => g.id === id)!;

beforeEach(() => {
  holder.current = worldMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/gifts/[id]", () => {
  it("answers the gift fixture", async () => expect(await (await GET(get(IDS.giftScarf), ctx(IDS.giftScarf))).json()).toEqual(fixture("gift")));
  it("answers 404 for a gift that is not the caller's", async () => expect((await GET(get(NOBODY), ctx(NOBODY))).status).toBe(404));
  it("answers another person's gift exactly as one that does not exist", async () => {   // requirement 1
    holder.current.store = storeWithDadsGift();
    const theirs = await GET(get(DADS_GIFT), ctx(DADS_GIFT));
    const none = await GET(get(NOBODY), ctx(NOBODY));
    expect([theirs.status, await theirs.json()]).toEqual([none.status, await none.json()]);
    expect(theirs.status).toBe(404);
  });
  it("answers 404 for an id that is not a UUID", async () => expect((await GET(get("x"), ctx("x"))).status).toBe(404));
  it("reads an upper-case gift id as the same gift", async () => {                                   // Minor 7
    const upper = IDS.giftScarf.toUpperCase();
    expect(await (await GET(get(upper), ctx(upper))).json()).toEqual(fixture("gift"));
  });
  it("offers a typed name's gift only the group dates", async () => {
    const body = await (await GET(get(IDS.giftHat), ctx(IDS.giftHat))).json();
    expect(body.occasions.map((o: { key: string }) => o.key)).toEqual([IDS.xmasKey]);
  });
  it("carries no recipient id and no user id", async () =>
    expect(await (await GET(get(IDS.giftScarf), ctx(IDS.giftScarf))).text()).not.toMatch(/recipient_id|recipientId|user_id|userId|claimedBy/));
});

describe("PUT /api/mobile/v1/gifts/[id]", () => {
  it("changes the notes", async () => expect((await (await PUT(put(scarfBody({ notes: "Wrap in red" })), ctx(IDS.giftScarf))).json()).gift.notes).toBe("Wrap in red"));
  it("keeps an occasion that has passed when it is not being changed", async () => {                  // Review Focus 4
    holder.current.getUpcomingOccasions.mockResolvedValue({ data: [] });          // Christmas no longer upcoming
    const res = await PUT(put(scarfBody({ notes: "Wrap in red" })), ctx(IDS.giftScarf));
    expect(res.status).toBe(200); expect(holder.current.rpc).not.toHaveBeenCalled();
  });
  it("moves a gift from a list and its claim together", async () => {                                // D12
    holder.current.rpc.mockResolvedValue({ data: null, error: null });
    const body = await (await PUT(put(scarfBody({ occasion: "birthday:user_2momABC:2027" })), ctx(IDS.giftScarf))).json();
    expect(holder.current.rpc).toHaveBeenCalledWith("set_claim_occasion", { p_item_id: IDS.scarf, p_occasion_id: IDS.momBirthday });
    expect([body.gift.occasion.key, body.gift.seasonYear]).toEqual(["birthday:user_2momABC:2027", 2027]);
    expect([giftRow(IDS.giftScarf).occasion_id, giftRow(IDS.giftScarf).season_year]).toEqual([IDS.momBirthday, 2027]);
  });
  it("answers 401 when the database says nobody is signed in, updating nothing", async () => {
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "28000", message: "not signed in" } });
    const res = await PUT(put(scarfBody({ occasion: "birthday:user_2momABC:2027" })), ctx(IDS.giftScarf));
    expect(res.status).toBe(401);
    expect(holder.current.store.writes).toEqual([]);
  });
  it("answers not held before reading anyone's occasions, so a failing read cannot make it a 500", async () => {
    holder.current.store = worldStore([world().claims[1]]);          // the scarf's claim is gone
    holder.current.getUpcomingOccasions.mockResolvedValue({ error: "connection reset" });
    holder.current.getSharedGroups.mockResolvedValue({ error: "connection reset" });
    const res = await PUT(put(scarfBody({ occasion: "birthday:user_2momABC:2027" })), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "You no longer hold this item."]);
  });
  it("moves a gift from a list to No occasion, keeping the year it was added", async () => {
    const body = await (await PUT(put(scarfBody({ occasion: null })), ctx(IDS.giftScarf))).json();
    expect(holder.current.rpc).toHaveBeenCalledWith("set_claim_occasion", { p_item_id: IDS.scarf, p_occasion_id: null });
    expect([body.gift.occasion, body.gift.seasonYear]).toEqual([null, 2026]);
    expect([giftRow(IDS.giftScarf).occasion_id, giftRow(IDS.giftScarf).season_year]).toEqual([null, 2026]);
  });
  it("refuses an occasion that is not among the owner's, before asking the database", async () => {
    const res = await PUT(put(scarfBody({ occasion: "birthday:user_2prySHA:2027" })), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
    expect(holder.current.rpc).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });
  it("refuses to move a gift whose claim is no longer held, without asking the database", async () => {   // §5.3a
    holder.current.store = worldStore([world().claims[1]]);          // the scarf's claim is gone
    const res = await PUT(put(scarfBody({ occasion: "birthday:user_2momABC:2027" })), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "You no longer hold this item."]);
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });
  it.each([["you no longer hold that item", "You no longer hold this item."], ["that occasion is not available", "Choose one of the occasions shown."]])(
    "answers the database's %j as a sentence, even though the view said held, and updates nothing", async (message, sentence) => {   // requirement 5
      holder.current.rpc.mockResolvedValue({ data: null, error: { code: "22023", message } });
      const before = giftRow(IDS.giftScarf);
      const res = await PUT(put(scarfBody({ occasion: "birthday:user_2momABC:2027", notes: "Wrap in red" })), ctx(IDS.giftScarf));
      expect([res.status, (await res.json()).error.message]).toEqual([422, sentence]);
      expect(holder.current.store.writes).toEqual([]);
      expect(giftRow(IDS.giftScarf)).toEqual(before);
    });
  it("answers 500 without its words for any other database refusal, updating nothing", async () => {
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "something nobody planned for" } });
    const res = await PUT(put(scarfBody({ occasion: "birthday:user_2momABC:2027" })), ctx(IDS.giftScarf));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/nobody planned/);
    expect(holder.current.store.writes).toEqual([]);
  });
  it("saves the notes of a gift from a list whose person can't be seen, keeping its recipient", async () => {
    // Mom has left Sam's groups: no profile, so the scarf's view has personId null and the app sends her typed name
    holder.current.profiles.mockImplementation(async (ids: string[]) =>
      new Map([...world().profiles].filter(([id]) => id !== "user_2momABC" && ids.includes(id))));
    const res = await PUT(put(scarfBody({ person: null, recipientName: "Mom", notes: "Wrap in red" })), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).gift.notes]).toEqual([200, "Wrap in red"]);
    expect(holder.current.store.allGifts().find((g) => g.id === IDS.giftScarf)!.recipient_id).toBe(IDS.recipientMom);
  });
  it("saves only the notes of a gift filed from an item with an odd link and an emoji-heavy title", async () => {   // Minor 3
    holder.current.store.addClaim(oven({}, { url: "ftp://files.example.com/dutch-oven", title: `${"\u{1F372}".repeat(150)} Dutch oven` }));
    await reconcileGifts(holder.current.store, TODAY);
    const id = holder.current.store.allGifts().find((g) => g.wishlist_item_id === IDS.dutchOven)!.id;
    const shown = (await (await GET(get(id), ctx(id))).json()).gift;
    const res = await PUT(put({ person: shown.person?.id ?? null, recipientName: shown.person ? null : shown.recipientName, name: shown.name,
      description: shown.description, link: shown.link, price: shown.price, imagePath: shown.imagePath, occasion: shown.occasion?.key ?? null,
      notes: "Wrap it" }, id), ctx(id));
    expect([res.status, (await res.json()).gift?.notes]).toEqual([200, "Wrap it"]);
  });
  it("ignores a different person in the body for a gift from a list", async () => {
    expect((await PUT(put(scarfBody({ person: "user_2dadABC" })), ctx(IDS.giftScarf))).status).toBe(200);
    expect(holder.current.store.allGifts().find((g) => g.id === IDS.giftScarf)!.recipient_id).toBe(IDS.recipientMom);
  });

  describe("a hand-added gift", () => {
    it("moves to another person of the caller's groups, under a recipient made for them", async () => {
      const body = await (await PUT(put(photoBookBody({ person: "user_2dadABC", occasion: IDS.xmasKey }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook))).json();
      expect(body.gift).toMatchObject({ recipientName: "Dad", person: { id: "user_2dadABC" } });
      expect(holder.current.rpc).not.toHaveBeenCalled();
    });
    it("saves the notes of a gift for someone who is no longer in the caller's groups, keeping its recipient", async () => {
      holder.current.getSharedGroups.mockResolvedValue({ data: [] });
      const res = await PUT(put(photoBookBody({ notes: "Ask Mom first" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([res.status, (await res.json()).gift.notes]).toEqual([200, "Ask Mom first"]);
      expect(giftRow(IDS.giftPhotoBook).recipient_id).toBe(IDS.recipientMom);
    });
    it("saves the notes of a gift for a typed name without making anything", async () => {
      const res = await PUT(put(photoBookBody({ person: null, recipientName: "Mom", notes: "x" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect(res.status).toBe(200);
      expect(giftRow(IDS.giftPhotoBook).recipient_id).toBe(IDS.recipientMom);
      expect(holder.current.store.allRecipients()).toHaveLength(world().recipients.length);
    });
    it("moves to a typed name", async () => {
      const body = await (await PUT(put(photoBookBody({ person: null, recipientName: "Grandpa Joe" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook))).json();
      expect(body.gift).toMatchObject({ recipientName: "Grandpa Joe", person: null });
      expect(giftRow(IDS.giftPhotoBook).recipient_id).toBe(IDS.recipientJoe);
    });
    it("refuses a person outside the caller's groups, and the caller, writing nothing", async () => {
      holder.current.getSharedGroups.mockResolvedValue({ data: [] });
      const res = await PUT(put(photoBookBody({ person: "user_2dadABC" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseWho]);
      const own = await PUT(put(photoBookBody({ person: SAM }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect(own.status).toBe(422);
      expect(holder.current.store.writes).toEqual([]);
    });
    it("refuses to keep an occasion that is not one of the new person's, writing nothing", async () => {   // Minor 16
      // Priya shares only the book club with Sam, so the family's Christmas is not one of hers.
      const res = await PUT(put(photoBookBody({ person: "user_2prySHA", occasion: IDS.xmasKey }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
      expect(holder.current.store.writes).toEqual([]);
      expect(giftRow(IDS.giftPhotoBook)).toMatchObject({ recipient_id: IDS.recipientMom, occasion_id: IDS.xmas });
    });
    it("keeps the occasion when it is one of the new person's", async () => {
      const res = await PUT(put(photoBookBody({ person: "user_2dadABC", occasion: IDS.xmasKey }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([res.status, (await res.json()).gift.occasion?.key]).toEqual([200, IDS.xmasKey]);
    });
    it("saves the notes of a gift under a typed name stored with a trailing space, keeping its recipient", async () => {   // Minor 18
      const w = world();
      const nana = { id: "bbbbbbbb-0000-4000-8000-0000000000c1", name: "Nana ", person_id: null };
      holder.current.store = memoryGiftStore(SAM, {
        claims: w.claims,
        gifts: w.gifts.map((g) => ({ ...g, user_id: SAM, recipient_id: g.id === IDS.giftPhotoBook ? nana.id : g.recipient_id })),
        recipients: [...w.recipients, nana].map((r) => ({ ...r, user_id: SAM })),
      });
      const res = await PUT(put(photoBookBody({ person: null, recipientName: "Nana ", notes: "Ask first" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([res.status, (await res.json()).gift?.recipientName]).toEqual([200, "Nana "]);
      expect(giftRow(IDS.giftPhotoBook).recipient_id).toBe(nana.id);
      expect(holder.current.store.allRecipients()).toHaveLength(w.recipients.length + 1);
    });
    it("refuses an occasion that does not involve the new person, and creates no recipient", async () => {
      const res = await PUT(put(photoBookBody({ person: "user_2dadABC", occasion: "birthday:user_2momABC:2027" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
      expect(holder.current.store.writes).toEqual([]);
    });
    it("keeps the year it was added when moved to No occasion", async () => {                              // requirement 3
      holder.current.store = storeWithDadsGift("2025-12-20T09:00:00.000000+00:00");
      const body = await (await PUT(put(photoBookBody({ occasion: null }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook))).json();
      expect([body.gift.occasion, body.gift.seasonYear]).toEqual([null, 2025]);
      expect(giftRow(IDS.giftPhotoBook).season_year).toBe(2025);
    });
    it("goes to next year when moved to an occasion next January", async () => {                          // requirement 3
      holder.current.store = storeWithDadsGift("2025-12-20T09:00:00.000000+00:00");
      const body = await (await PUT(put(photoBookBody({ occasion: "birthday:user_2momABC:2027" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook))).json();
      expect([body.gift.occasion.key, body.gift.seasonYear]).toEqual(["birthday:user_2momABC:2027", 2027]);
      expect(giftRow(IDS.giftPhotoBook).season_year).toBe(2027);
      expect(giftRow(IDS.giftPhotoBook).occasion_id).toBe(IDS.momBirthday);
      expect(holder.current.rpc).not.toHaveBeenCalled();
    });
    it("leaves the year alone when the occasion is not changed", async () => {
      const before = giftRow(IDS.giftPhotoBook);
      await PUT(put(photoBookBody({ notes: "Ask Mom first" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([giftRow(IDS.giftPhotoBook).season_year, giftRow(IDS.giftPhotoBook).occasion_id]).toEqual([before.season_year, before.occasion_id]);
    });
  });

  it("refuses a picture in someone else's folder, or one that names the wrong place, writing nothing", async () => {   // requirement 2
    for (const imagePath of ["user_someoneElse/1794500000000-a.jpg", "gift-photos/user_2abcDEF/1794500000000-a.jpg", "user_2abcDEF/../x.jpg"]) {
      const res = await PUT(put(photoBookBody({ imagePath }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
      expect([res.status, (await res.json()).error.message]).toEqual([422, INVALID_IMAGE_ERROR]);
    }
    expect(holder.current.store.writes).toEqual([]);
    expect(giftRow(IDS.giftPhotoBook).photo_url).toBe("user_2abcDEF/1794500000000-p4b8.jpg");
  });
  it("replaces the picture with the caller's own, and drops it when none is sent", async () => {
    const own = "user_2abcDEF/1794600000000-n3w1.jpg";
    await PUT(put(photoBookBody({ imagePath: own }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
    expect(giftRow(IDS.giftPhotoBook).photo_url).toBe(own);
    await PUT(put(photoBookBody({ imagePath: null }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
    expect(giftRow(IDS.giftPhotoBook).photo_url).toBeNull();
  });
  it("answers 404 for another person's gift, as for one that does not exist, and writes nothing", async () => {   // requirement 1
    holder.current.store = storeWithDadsGift();
    const before = giftRow(DADS_GIFT);
    const theirs = await PUT(put(scarfBody({ notes: "mine now", occasion: null }), DADS_GIFT), ctx(DADS_GIFT));
    const none = await PUT(put(scarfBody({ notes: "mine now", occasion: null }), NOBODY), ctx(NOBODY));
    expect([theirs.status, await theirs.json()]).toEqual([none.status, await none.json()]);
    expect(theirs.status).toBe(404);
    expect(holder.current.store.writes).toEqual([]);
    expect(giftRow(DADS_GIFT)).toEqual(before);
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });
  it("takes no recipient or user from the body", async () => {   // requirement 1
    const res = await PUT(put(photoBookBody({ recipient_id: IDS.recipientAlex, recipientId: IDS.recipientAlex, user_id: "user_2dadABC", userId: "user_2dadABC" }), IDS.giftPhotoBook), ctx(IDS.giftPhotoBook));
    expect(res.status).toBe(200);
    expect(giftRow(IDS.giftPhotoBook).recipient_id).toBe(IDS.recipientMom);
    expect(giftRow(IDS.giftPhotoBook).user_id).toBe(SAM);
  });
  it("refuses a body that is not a gift, and an id that is not a UUID", async () => {
    expect((await PUT(put({}), ctx(IDS.giftScarf))).status).toBe(422);
    expect((await PUT(put(scarfBody(), "x"), ctx("x"))).status).toBe(404);
    expect(holder.current.store.writes).toEqual([]);
  });
});

describe("DELETE /api/mobile/v1/gifts/[id]", () => {
  it("deletes a hand-added gift", async () => {
    const res = await DELETE(del(), ctx(IDS.giftPhotoBook));
    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftPhotoBook);
  });
  it("refuses a gift whose claim is held: release it instead", async () => {
    expect((await (await DELETE(del(IDS.giftScarf), ctx(IDS.giftScarf))).json()).error.message).toBe("Release this claim instead.");
    expect(holder.current.store.allGifts().map((g) => g.id)).toContain(IDS.giftScarf);
  });
  it("deletes a gift past Claimed whose item can no longer be seen, leaving its claim as the record it was bought", async () => {   // Important 1
    hideItem(holder.current, IDS.catan);
    const res = await DELETE(del(IDS.giftCatan), ctx(IDS.giftCatan));
    expect(res.status).toBe(204);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftCatan);
    expect(holder.current.releaseClaim).not.toHaveBeenCalled();
    expect((await holder.current.store.activeClaims()).map((c) => c.itemId)).toContain(IDS.catan);
  });
  it("still refuses a held gift at Claimed whose item can no longer be seen: release it instead", async () => {
    hideItem(holder.current, IDS.scarf);
    const res = await DELETE(del(IDS.giftScarf), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "Release this claim instead."]);
    expect(holder.current.store.allGifts().map((g) => g.id)).toContain(IDS.giftScarf);
  });
  it("still refuses a held gift past Claimed whose item can be seen", async () => {
    const res = await DELETE(del(IDS.giftCatan), ctx(IDS.giftCatan));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "Release this claim instead."]);
    expect(holder.current.store.allGifts().map((g) => g.id)).toContain(IDS.giftCatan);
  });
  it("removes a gift from a list whose claim is no longer held", async () => {
    holder.current.store = worldStore([world().claims[1]]);          // the scarf's claim is gone
    expect((await DELETE(del(IDS.giftScarf), ctx(IDS.giftScarf))).status).toBe(204);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftScarf);
  });
  it("answers 204 for a gift that is not there, or an id that is not a UUID", async () => {
    expect((await DELETE(del(NOBODY), ctx(NOBODY))).status).toBe(204);
    expect((await DELETE(del("x"), ctx("x"))).status).toBe(204);
    expect(holder.current.store.writes).toEqual([]);
  });
  it("answers 204 for another person's gift and deletes nothing", async () => {   // requirement 1
    holder.current.store = storeWithDadsGift();
    expect((await DELETE(del(DADS_GIFT), ctx(DADS_GIFT))).status).toBe(204);
    expect(holder.current.store.writes).toEqual([]);
    expect(holder.current.store.allGifts().map((g) => g.id)).toContain(DADS_GIFT);
  });
});
