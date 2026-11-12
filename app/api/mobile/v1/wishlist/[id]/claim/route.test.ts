import { describe, it, expect, vi, beforeEach } from "vitest";
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

const { POST, DELETE } = await import("./route");
const { bearer, hideItem, oven, worldMocks, worldStore } = await import("@/lib/mobile/test-shopping-mocks");
const { memoryGiftStore } = await import("@/lib/mobile/test-gift-store");
const { reconcileGifts } = await import("@/lib/mobile/reconcile");
const { SHOPPING_RULES } = await import("@/lib/mobile/shopping-rules");
const { IDS, SAM, world } = await import("@/lib/mobile/test-shopping");

const url = (id: string) => `http://localhost/api/mobile/v1/wishlist/${id}/claim`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id: string = IDS.dutchOven) =>
  bearer(url(id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const del = (id: string = IDS.scarf) => bearer(url(id), { method: "DELETE" });
const PRIYA_ITEM = "d0a1b2c3-0006-4a00-8000-000000000006";
const CELEBRATED = "33333333-3333-4333-8333-333333333333";

const claimed = (itemId: string, occasionId: string | null, occasionDate: string | null) => {
  holder.current.rpc.mockImplementation(async (fn: string) => {
    if (fn !== "claim_wishlist_item") return { data: CELEBRATED, error: null };
    holder.current.store.addClaim(oven({ itemId, occasionId, occasionDate }, { id: itemId }));
    return { data: "claim-1", error: null };
  });
};
const priyasItem = () => holder.current.getWishlistItem.mockResolvedValue({
  data: { ...world().momItems[0], id: PRIYA_ITEM, user_id: "user_2prySHA", title: "Bookshelf speakers", image_path: null },
  currentUserId: SAM,
});

beforeEach(() => {
  holder.current = worldMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/mobile/v1/wishlist/[id]/claim", () => {
  it("claims the Dutch oven for Christmas and answers its gift at Claimed", async () => {
    claimed(IDS.dutchOven, IDS.xmas, "2026-12-25");
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(holder.current.rpc).toHaveBeenCalledWith("claim_wishlist_item", { p_item_id: IDS.dutchOven, p_occasion_id: IDS.xmas });
    expect((await res.json()).gift).toMatchObject({ name: "Le Creuset Dutch oven", status: "claimed", fromList: true, held: true,
      canRelease: true, recipientName: "Mom", person: fixture("home").occasions[0].people[4].person, occasion: fixture("home").occasions[0].occasion });
  });

  it("makes a birthday's row first, with the item's owner as the celebrant", async () => {
    // Priya's item "Bookshelf speakers", Book Club shared; her birthday has no row yet
    priyasItem();
    claimed(PRIYA_ITEM, CELEBRATED, "2027-02-03");
    await POST(post({ occasion: "birthday:user_2prySHA:2027" }, PRIYA_ITEM), ctx(PRIYA_ITEM));
    expect(holder.current.rpc).toHaveBeenNthCalledWith(1, "get_or_create_celebrated_occasion", { p_celebrant_id: "user_2prySHA", p_kind: "birthday" });
    expect(holder.current.rpc).toHaveBeenNthCalledWith(2, "claim_wishlist_item", { p_item_id: PRIYA_ITEM, p_occasion_id: CELEBRATED });
  });

  it("claims with No occasion", async () => {
    claimed(IDS.dutchOven, null, null);
    const res = await POST(post({ occasion: null }), ctx(IDS.dutchOven));
    expect(holder.current.rpc).toHaveBeenCalledWith("claim_wishlist_item", { p_item_id: IDS.dutchOven, p_occasion_id: null });
    expect((await res.json()).gift).toMatchObject({ occasion: null, status: "claimed", held: true });
  });

  it("takes who owns the item from the database, never from the body", async () => {   // requirement 1
    claimed(IDS.dutchOven, IDS.xmas, "2026-12-25");
    const res = await POST(
      post({ ...fixture("claim-request"), person: "user_2prySHA", owner: "user_2prySHA", userId: "user_2prySHA", itemId: IDS.scarf, item: IDS.scarf }),
      ctx(IDS.dutchOven));
    expect(res.status).toBe(200);
    expect(holder.current.rpc).toHaveBeenCalledTimes(1);
    expect(holder.current.rpc).toHaveBeenCalledWith("claim_wishlist_item", { p_item_id: IDS.dutchOven, p_occasion_id: IDS.xmas });
    expect(holder.current.getWishlistItem).toHaveBeenCalledWith(IDS.dutchOven);
    expect((await res.json()).gift).toMatchObject({ itemId: IDS.dutchOven, recipientName: "Mom" });
    expect(holder.current.store.allRecipients().map((r) => r.person_id)).not.toContain("user_2prySHA");
  });

  it("refuses an occasion that does not involve the owner, before claiming", async () => {
    const res = await POST(post({ occasion: "birthday:user_2prySHA:2027" }), ctx(IDS.dutchOven));
    expect((await res.json()).error).toEqual({ code: "invalid", message: "Choose one of the occasions shown." });
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it("refuses a made-up key", async () => {
    const res = await POST(post({ occasion: "birthday:user_2momABC:1999" }), ctx(IDS.dutchOven));
    expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an occasion choice", async () => {
    for (const body of [{}, { occasion: 5 }, "x", null]) {
      const res = await POST(post(body), ctx(IDS.dutchOven));
      expect(res.status).toBe(422);
    }
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["that item is not available to claim", "That isn't available to claim any more."], ["that item has already been purchased", "Someone has already bought that."],
    ["somebody has already claimed that item", "Somebody claimed that a moment ago."], ["that occasion is not available", "Choose one of the occasions shown."],
    ["you cannot claim your own item", "That's on your own list."], ["something nobody planned for", "That isn't available to claim any more."],
  ])("answers %j as a sentence, files no gift and says nobody's name", async (message, sentence) => {
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "22023", message } });
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(JSON.parse(text).error.message).toBe(sentence);
    expect(text).not.toMatch(/user_2|claimed_?by|@|Dad|Luis/);   // §5.5: no refusal says who holds a claim
    expect(holder.current.store.writes).toEqual([]);
    expect(holder.current.store.allRecipients()).toHaveLength(world().recipients.length);
  });

  it("files nothing when a birthday row is made and the claim is then refused", async () => {
    priyasItem();
    holder.current.rpc.mockImplementation(async (fn: string) =>
      fn === "claim_wishlist_item" ? { data: null, error: { code: "22023", message: "somebody has already claimed that item" } } : { data: CELEBRATED, error: null });
    const res = await POST(post({ occasion: "birthday:user_2prySHA:2027" }, PRIYA_ITEM), ctx(PRIYA_ITEM));
    expect(res.status).toBe(422);
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 422 when the database refuses to make the birthday's row", async () => {
    priyasItem();
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "no visible birthday for that person" } });
    const res = await POST(post({ occasion: "birthday:user_2prySHA:2027" }, PRIYA_ITEM), ctx(PRIYA_ITEM));
    expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
    expect(holder.current.rpc).toHaveBeenCalledTimes(1);
  });

  it("answers 401, filing nothing, when the database says nobody is signed in as it claims", async () => {   // Minor 7
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "28000", message: "not signed in" } });
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    expect(res.status).toBe(401);
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 401 when the database says nobody is signed in as it makes a birthday's row", async () => {   // Minor 7
    priyasItem();
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "28000", message: "not signed in" } });
    const res = await POST(post({ occasion: "birthday:user_2prySHA:2027" }, PRIYA_ITEM), ctx(PRIYA_ITEM));
    expect(res.status).toBe(401);
    expect(holder.current.rpc).toHaveBeenCalledTimes(1);
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 500 and logs any other database error", async () => {
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/boom/);
    expect(console.error).toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 404 for an item that is gone or hidden, and for an id that is not a UUID", async () => {
    holder.current.getWishlistItem.mockResolvedValue({ error: "Item not found", notFound: true });
    expect((await POST(post(fixture("claim-request")), ctx(IDS.dutchOven))).status).toBe(404);
    holder.current.getWishlistItem.mockClear();
    expect((await POST(post(fixture("claim-request"), "x"), ctx("x"))).status).toBe(404);
    expect(holder.current.getWishlistItem).not.toHaveBeenCalled();
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it("answers 401 when nobody is signed in, and 500 when the item cannot be read", async () => {
    holder.current.getWishlistItem.mockResolvedValue({ error: "Not authenticated", notFound: true });
    expect((await POST(post(fixture("claim-request")), ctx(IDS.dutchOven))).status).toBe(401);
    holder.current.getWishlistItem.mockResolvedValue({ error: "connection reset", notFound: false });
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/connection/);
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it("refuses the caller's own item without asking the database", async () => {
    holder.current.getWishlistItem.mockResolvedValue({ data: { ...world().momItems[1], user_id: SAM }, currentUserId: SAM });
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "That's on your own list."]);
    expect(holder.current.rpc).not.toHaveBeenCalled();
    expect(holder.current.getUpcomingOccasions).not.toHaveBeenCalled();
    expect(holder.current.getSharedGroups).not.toHaveBeenCalled();
  });

  it("answers only the caller's own gift, naming nobody who holds a claim", async () => {   // §5.5
    claimed(IDS.dutchOven, IDS.xmas, "2026-12-25");
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    const text = await res.text();
    expect(Object.keys(JSON.parse(text))).toEqual(["gift"]);
    expect(text).not.toMatch(/user_2dadABC|user_2prySHA|claimedBy|claimed_by|out_of_stock|purchased|email|invite/);
  });

  it("releases the claim again when its gift cannot be made", async () => {
    holder.current.store = memoryGiftStore(SAM, { failInsertGift: new Error("insert failed") });
    claimed(IDS.dutchOven, IDS.xmas, "2026-12-25");
    const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/insert failed/);
    expect(holder.current.releaseClaim).toHaveBeenCalledWith(IDS.dutchOven);
  });

  it("still answers 500, logging both errors, when the release fails too", async () => {
    const first = new Error("insert failed");
    for (const failing of [
      () => holder.current.releaseClaim.mockRejectedValue(new Error("release threw")),
      () => holder.current.releaseClaim.mockResolvedValue({ error: "Failed to release this claim. Please try again." }),
    ]) {
      holder.current.store = memoryGiftStore(SAM, { failInsertGift: first });   // the claim is made afresh each time
      claimed(IDS.dutchOven, IDS.xmas, "2026-12-25");
      failing();
      vi.mocked(console.error).mockClear();
      const res = await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
      expect(res.status).toBe(500);
      expect(await res.text()).not.toMatch(/insert failed|release|Failed/);
      const logged = vi.mocked(console.error).mock.calls.flat();
      expect(logged).toContain(first);                                   // the first error is not hidden
      expect(logged.map(String).join(" ")).toMatch(/release threw|Failed to release/);
    }
  });

  it("answers the holder's retry with their gift, asking the database for no new claim", async () => {
    const res = await POST(post(fixture("claim-request"), IDS.scarf), ctx(IDS.scarf));
    expect(res.status).toBe(200);
    expect((await res.json()).gift).toMatchObject({ id: IDS.giftScarf, held: true, status: "claimed" });
    expect(holder.current.rpc).not.toHaveBeenCalled();
    expect(holder.current.store.allGifts()).toHaveLength(world().gifts.length);
  });

  it("leaves the season alone when the holder retries in the new year a claim made with no occasion last year", async () => {   // Minor 4
    holder.current.store.addClaim(oven({ occasionId: null, occasionDate: null, claimedAt: "2026-12-20T10:00:00.000000+00:00" }));
    holder.current.todayISO.mockReturnValue("2026-12-20");
    await reconcileGifts(holder.current.store, "2026-12-20");
    expect(holder.current.store.allGifts().find((g) => g.wishlist_item_id === IDS.dutchOven)?.season_year).toBe(2026);
    holder.current.store.writes.length = 0;
    holder.current.todayISO.mockReturnValue("2027-01-05");
    const res = await POST(post({ occasion: null }), ctx(IDS.dutchOven));
    expect([res.status, (await res.json()).gift.seasonYear]).toEqual([200, 2026]);
    expect(holder.current.store.writes).toEqual([]);
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it("files the gift of a held claim that was left without one", async () => {
    holder.current.store = memoryGiftStore(SAM, { claims: world().claims });
    const res = await POST(post(fixture("claim-request"), IDS.scarf), ctx(IDS.scarf));
    expect(res.status).toBe(200);
    expect((await res.json()).gift).toMatchObject({ name: "Cashmere scarf", status: "claimed", held: true, recipientName: "Mom" });
    expect(holder.current.store.allGifts().filter((g) => g.wishlist_item_id === IDS.scarf)).toHaveLength(1);
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it("leaves the claim's occasion alone when a retry names another", async () => {
    for (const occasion of ["birthday:user_2momABC:2027", null]) {
      const res = await POST(post({ occasion }, IDS.scarf), ctx(IDS.scarf));
      expect((await res.json()).gift.occasion.key).toBe(IDS.xmasKey);
    }
    expect(holder.current.rpc).not.toHaveBeenCalled();
    expect(holder.current.store.allGifts().find((g) => g.id === IDS.giftScarf)?.occasion_id).toBe(IDS.xmas);
  });

  it("refuses a group date whose day has passed, making no call", async () => {                    // Important 2a
    holder.current.todayISO.mockReturnValue("2026-12-26");
    holder.current.getUpcomingOccasions.mockResolvedValue({ data: world().upcoming.filter((o) => o.occasionId !== IDS.xmas) });
    const res = await POST(post({ occasion: IDS.xmasKey }), ctx(IDS.dutchOven));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "Choose one of the occasions shown."]);
    expect(holder.current.rpc).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("claims from a third person of the same name, under a numbered recipient of their own", async () => {   // Minor 2
    const third = { id: "user_2alxCCC", username: "alexc", display_name: "Alex", avatar_url: null };
    holder.current.store = memoryGiftStore(SAM, { recipients: [
      { id: "bbbbbbbb-0000-4000-8000-0000000000a1", name: "Alex", person_id: null },
      { id: "bbbbbbbb-0000-4000-8000-0000000000a2", name: "Alex (from their list)", person_id: "user_2alxBBB" },
    ].map((r) => ({ ...r, user_id: SAM })) });
    holder.current.profiles.mockImplementation(async (ids: string[]) => new Map(ids.includes(third.id) ? [[third.id, third]] : []));
    holder.current.getWishlistItem.mockResolvedValue({
      data: { ...world().momItems[0], id: PRIYA_ITEM, user_id: third.id, title: "Climbing shoes", image_path: null }, currentUserId: SAM });
    claimed(PRIYA_ITEM, null, null);
    const res = await POST(post({ occasion: null }, PRIYA_ITEM), ctx(PRIYA_ITEM));
    expect([res.status, (await res.json()).gift?.recipientName]).toEqual([200, "Alex (from their list) 2"]);
    expect(holder.current.store.allRecipients().filter((r) => r.person_id === third.id)).toHaveLength(1);
    expect(holder.current.releaseClaim).not.toHaveBeenCalled();
  });

  it("refuses a group date of a group the item's owner is not in, making no call", async () => {
    priyasItem();
    const res = await POST(post({ occasion: IDS.xmasKey }, PRIYA_ITEM), ctx(PRIYA_ITEM));
    expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
    expect(holder.current.rpc).not.toHaveBeenCalled();
  });

  it("answers 500 when making the birthday's row fails for any reason but a refusal", async () => {
    priyasItem();
    holder.current.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const res = await POST(post({ occasion: "birthday:user_2prySHA:2027" }, PRIYA_ITEM), ctx(PRIYA_ITEM));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/boom/);
    expect(holder.current.rpc).toHaveBeenCalledTimes(1);
    expect(holder.current.store.writes).toEqual([]);
  });

  it("files the gift with the item's stored image, never its signed address", async () => {
    holder.current.getWishlistItem.mockResolvedValue({ data: { ...world().momItems[1], image_url: "https://signed.example/oven?token=x",
      image_path: "https://www.example.com/oven.jpg" }, currentUserId: SAM });
    claimed(IDS.dutchOven, IDS.xmas, "2026-12-25");
    await POST(post(fixture("claim-request")), ctx(IDS.dutchOven));
    expect(holder.current.store.allGifts().find((g) => g.wishlist_item_id === IDS.dutchOven)?.photo_url).toBe("https://www.example.com/oven.jpg");
  });

  it("claims again for a gift no longer held, keeping the gift it has", async () => {
    holder.current.store = worldStore([world().claims[1]]);          // the scarf's claim is gone
    claimed(IDS.scarf, IDS.xmas, "2026-12-25");
    const body = await (await POST(post(fixture("claim-request"), IDS.scarf), ctx(IDS.scarf))).json();
    expect([body.gift.id, body.gift.held, holder.current.store.allGifts().length]).toEqual([IDS.giftScarf, true, 5]);
  });
});

describe("DELETE /api/mobile/v1/wishlist/[id]/claim", () => {
  it("releases the claim and removes its gift", async () => {
    holder.current.releaseClaim.mockResolvedValue({ ok: true });
    const res = await DELETE(del(), ctx(IDS.scarf));
    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(holder.current.releaseClaim).toHaveBeenCalledWith(IDS.scarf);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftScarf);
  });

  it("leaves a gift that was stepped on while the claim was being released", async () => {
    holder.current.releaseClaim.mockImplementation(async () => {
      await holder.current.store.updateGift(IDS.giftScarf, { status: "ordered" });   // a step lands between the two reads
      return { ok: true };
    });
    expect((await DELETE(del(), ctx(IDS.scarf))).status).toBe(204);
    expect(holder.current.store.allGifts().find((g) => g.id === IDS.giftScarf)?.status).toBe("ordered");
  });

  it("leaves a gift that was stepped on at the moment it was being removed", async () => {          // Minor 10
    holder.current.releaseClaim.mockResolvedValue({ ok: true });
    const store = holder.current.store;
    const remove = store.deleteGift.bind(store);
    store.deleteGift = async (...args) => {
      await store.updateGift(IDS.giftScarf, { status: "ordered" });   // a step lands between the last read and the delete
      return remove(...args);
    };
    expect((await DELETE(del(), ctx(IDS.scarf))).status).toBe(204);
    expect(holder.current.store.allGifts().find((g) => g.id === IDS.giftScarf)?.status).toBe("ordered");
  });

  it("answers 204 for the caller's own item before reading anything from it, whatever it says", async () => {   // Minor 1, §5.5
    holder.current.getWishlistItem.mockResolvedValue({ data: { ...world().momItems[3], user_id: SAM, purchased: true }, currentUserId: SAM });
    const res = await DELETE(del(), ctx(IDS.scarf));
    expect(res.status).toBe(204);
    expect(holder.current.releaseClaim).not.toHaveBeenCalled();
    expect(holder.current.rpc).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("refuses once the item is marked bought, releasing nothing", async () => {                    // D7
    holder.current.getWishlistItem.mockResolvedValue({ data: { ...world().momItems[3], purchased: true }, currentUserId: SAM });
    const res = await DELETE(del(), ctx(IDS.scarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "It's marked bought, so it can't be released."]);
    expect(holder.current.releaseClaim).not.toHaveBeenCalled();
    expect(holder.current.store.allGifts().map((g) => g.id)).toContain(IDS.giftScarf);
  });

  it("refuses a gift past Claimed", async () => {
    await holder.current.store.updateGift(IDS.giftScarf, { status: "ordered" });
    const res = await DELETE(del(), ctx(IDS.scarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "Step it back to Claimed before releasing it."]);
    expect(holder.current.releaseClaim).not.toHaveBeenCalled();
    expect(holder.current.store.allGifts().map((g) => g.id)).toContain(IDS.giftScarf);
  });

  it("answers 204 when nothing is held, removing the leftover gift", async () => {
    holder.current.releaseClaim.mockResolvedValue({ ok: false });
    expect((await DELETE(del(), ctx(IDS.scarf))).status).toBe(204);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftScarf);
  });

  it("answers 204 for an item that was never claimed, with no gift to remove", async () => {
    holder.current.releaseClaim.mockResolvedValue({ ok: false });
    const before = holder.current.store.allGifts().length;
    expect((await DELETE(del(IDS.kindle), ctx(IDS.kindle))).status).toBe(204);
    expect(holder.current.store.allGifts()).toHaveLength(before);
  });

  it("answers 204 for an item that is gone or no longer visible, still removing its gift", async () => {
    holder.current.getWishlistItem.mockResolvedValue({ error: "Item not found", notFound: true });
    holder.current.releaseClaim.mockResolvedValue({ ok: false });
    expect((await DELETE(del(), ctx(IDS.scarf))).status).toBe(204);
    expect(holder.current.releaseClaim).toHaveBeenCalledWith(IDS.scarf);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftScarf);
  });

  it("still releases a claim at Claimed whose item can no longer be seen, removing its gift", async () => {   // Important 1
    hideItem(holder.current, IDS.scarf);
    holder.current.releaseClaim.mockResolvedValue({ ok: true });
    expect((await DELETE(del(), ctx(IDS.scarf))).status).toBe(204);
    expect(holder.current.releaseClaim).toHaveBeenCalledWith(IDS.scarf);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftScarf);
  });

  it("reads an upper-case item id as the same item: it releases the claim and removes its gift", async () => {   // Minor 7
    holder.current.releaseClaim.mockResolvedValue({ ok: true });
    const upper = IDS.scarf.toUpperCase();
    expect((await DELETE(del(upper), ctx(upper))).status).toBe(204);
    expect(holder.current.getWishlistItem).toHaveBeenCalledWith(IDS.scarf);
    expect(holder.current.releaseClaim).toHaveBeenCalledWith(IDS.scarf);
    expect(holder.current.store.allGifts().map((g) => g.id)).not.toContain(IDS.giftScarf);
  });

  it("answers 204 for an id that is not a UUID, doing nothing", async () => {
    expect((await DELETE(del("x"), ctx("x"))).status).toBe(204);
    expect(holder.current.releaseClaim).not.toHaveBeenCalled();
    expect(holder.current.getWishlistItem).not.toHaveBeenCalled();
  });

  it("answers 401 when the release action says nobody is signed in", async () => {
    holder.current.releaseClaim.mockResolvedValue({ error: "Not authenticated" });
    expect((await DELETE(del(), ctx(IDS.scarf))).status).toBe(401);
    holder.current.getWishlistItem.mockResolvedValue({ error: "Not authenticated", notFound: true });
    expect((await DELETE(del(), ctx(IDS.scarf))).status).toBe(401);
  });

  it("answers 500 without its words when the release fails for any other reason", async () => {
    holder.current.releaseClaim.mockResolvedValue({ error: "Failed to release this claim. Please try again." });
    const res = await DELETE(del(), ctx(IDS.scarf));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed/);
    expect(holder.current.store.allGifts().map((g) => g.id)).toContain(IDS.giftScarf);
  });
});
