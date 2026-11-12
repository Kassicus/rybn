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

const { POST } = await import("./route");
const { bearer, worldMocks, worldStore } = await import("@/lib/mobile/test-shopping-mocks");
const { memoryGiftStore } = await import("@/lib/mobile/test-gift-store");
const { IDS, SAM, world } = await import("@/lib/mobile/test-shopping");

const NOBODY = "44444444-4444-4444-8444-444444444444";
const DADS_GIFT = "55555555-5555-4555-8555-555555555555";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id: string = IDS.giftScarf) =>
  bearer(`http://localhost/api/mobile/v1/gifts/${id}/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const statusOf = (id: string) => holder.current.store.allGifts().find((g) => g.id === id)!.status;

beforeEach(() => {
  holder.current = worldMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/mobile/v1/gifts/[id]/step", () => {
  it("marks the item bought and answers the gift at Ordered", async () => {                         // D6
    holder.current.markAsPurchased.mockResolvedValue({ data: {} });
    const res = await POST(post(fixture("step-request")), ctx(IDS.giftScarf));
    const body = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(holder.current.markAsPurchased).toHaveBeenCalledWith(IDS.scarf, true);
    expect([body.gift.status, body.gift.canGoBack, body.gift.canRelease]).toEqual(["ordered", true, false]);
    expect(Object.keys(body)).toEqual(["gift"]);
  });
  it("un-marks the item stepping back to Claimed", async () => {
    await holder.current.store.updateGift(IDS.giftScarf, { status: "ordered" });
    holder.current.markAsPurchased.mockResolvedValue({ data: {} });
    const body = await (await POST(post({ direction: "back", from: "ordered" }), ctx(IDS.giftScarf))).json();
    expect(holder.current.markAsPurchased).toHaveBeenCalledWith(IDS.scarf, false);
    expect(body.gift.status).toBe("claimed");
  });
  it("un-marks Catan stepping back from Ordered", async () => {
    holder.current.markAsPurchased.mockResolvedValue({ data: {} });
    const body = await (await POST(post({ direction: "back", from: "ordered" }, IDS.giftCatan), ctx(IDS.giftCatan))).json();
    expect(holder.current.markAsPurchased).toHaveBeenCalledWith(IDS.catan, false);
    expect(body.gift.status).toBe("claimed");
  });
  it("refuses to step back below Ordered after the date, touching nothing", async () => {          // D13
    holder.current.todayISO.mockReturnValue("2026-12-26");
    const res = await POST(post({ direction: "back", from: "ordered" }), ctx(IDS.giftCatan));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "That occasion has passed, so it stays at Ordered."]);
    expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });
  it("refuses with the reason when the item can't be marked, leaving the gift as it was", async () => {   // §5.3
    holder.current.markAsPurchased.mockResolvedValue({ error: "Only the person who claimed this item can mark it purchased" });
    const res = await POST(post(fixture("step-request")), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "You no longer hold this item."]);
    expect(holder.current.store.allGifts().find((g) => g.id === IDS.giftScarf)!.status).toBe("planned");
  });
  it("refuses, without asking the website, a gift whose claim is no longer held", async () => {
    holder.current.store = worldStore([world().claims[1]]);          // the scarf's claim is gone
    const res = await POST(post(fixture("step-request")), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).error.message]).toEqual([422, "You no longer hold this item."]);
    expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
  });
  it("answers 401 when the website says nobody is signed in, and 500 without its words for any other failure", async () => {
    holder.current.markAsPurchased.mockResolvedValue({ error: "Not authenticated" });
    expect((await POST(post(fixture("step-request")), ctx(IDS.giftScarf))).status).toBe(401);
    holder.current.markAsPurchased.mockResolvedValue({ error: "connection reset by peer" });
    const res = await POST(post(fixture("step-request")), ctx(IDS.giftScarf));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/connection/);
    expect(statusOf(IDS.giftScarf)).toBe("planned");
  });
  it("steps a gift whose item can no longer be seen without marking it", async () => {              // Review Focus 5
    holder.current.linkedItems.mockResolvedValue(new Map([[IDS.catan, world().linkedItems.get(IDS.catan)!]]));   // the scarf is hidden
    const body = await (await POST(post(fixture("step-request")), ctx(IDS.giftScarf))).json();
    expect(body.gift.status).toBe("ordered"); expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
  });
  it("steps a gift whose item the owner deleted without marking it, and back again", async () => {   // Review Focus 5
    holder.current.linkedItems.mockResolvedValue(new Map());
    const forward = await (await POST(post({ direction: "forward", from: "claimed" }), ctx(IDS.giftScarf))).json();
    expect([forward.gift.itemGone, forward.gift.status]).toEqual([true, "ordered"]);
    const back = await (await POST(post({ direction: "back", from: "ordered" }), ctx(IDS.giftScarf))).json();
    expect(back.gift.status).toBe("claimed");
    expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
  });
  it("steps a hand-added gift by its status alone", async () => {
    const body = await (await POST(post({ direction: "forward", from: "ordered" }, IDS.giftPhotoBook), ctx(IDS.giftPhotoBook))).json();
    expect(body.gift.status).toBe("arrived");
    expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
  });
  it("refuses a step past the ends", async () => {
    const last = await POST(post({ direction: "forward", from: "given" }, IDS.giftHat), ctx(IDS.giftHat));
    expect([last.status, (await last.json()).error.message]).toEqual([422, "That gift has already been given."]);
    const first = await POST(post({ direction: "back", from: "claimed" }), ctx(IDS.giftScarf));
    expect([first.status, (await first.json()).error.message]).toEqual([422, "That's already the first step."]);
  });
  it("refuses a body that is not a step", async () => {
    for (const body of [{ direction: "up", from: "claimed" }, { direction: "forward" }, { direction: "forward", from: "sent" }, {}, "forward", null]) expect((await POST(post(body), ctx(IDS.giftScarf))).status).toBe(422);
    expect(holder.current.store.writes).toEqual([]);
  });
  it("answers 404 for a gift that is not there, or an id that is not a UUID", async () => {
    expect((await POST(post(fixture("step-request"), NOBODY), ctx(NOBODY))).status).toBe(404);
    expect((await POST(post(fixture("step-request"), "x"), ctx("x"))).status).toBe(404);
    expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
  });
  it("answers another person's gift exactly as one that does not exist, and writes nothing", async () => {   // requirement 1
    const w = world();
    holder.current.store = memoryGiftStore(SAM, {
      claims: w.claims,
      gifts: [...w.gifts.map((g) => ({ ...g, user_id: SAM })),
        { ...w.gifts[4], id: DADS_GIFT, user_id: "user_2dadABC", name: "Dad's secret", wishlist_item_id: null, from_list: false }],
      recipients: w.recipients.map((r) => ({ ...r, user_id: SAM })),
    });
    const theirs = await POST(post(fixture("step-request"), DADS_GIFT), ctx(DADS_GIFT));
    const none = await POST(post(fixture("step-request"), NOBODY), ctx(NOBODY));
    expect([theirs.status, await theirs.json()]).toEqual([none.status, await none.json()]);
    expect(theirs.status).toBe(404);
    expect(holder.current.store.writes).toEqual([]);
    expect(statusOf(DADS_GIFT)).toBe("ordered");
    expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
  });

  it("answers the gift as it is, touching nothing, when it is no longer where the app saw it", async () => {
    const res = await POST(post({ direction: "forward", from: "ordered" }), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).gift.status]).toEqual([200, "claimed"]);
    expect(holder.current.markAsPurchased).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
    expect(statusOf(IDS.giftScarf)).toBe("planned");
  });
  it("moves one step when two requests arrive together", async () => {    // requirement 4
    holder.current.markAsPurchased.mockResolvedValue({ data: {} });
    const [a, b] = await Promise.all([
      POST(post(fixture("step-request")), ctx(IDS.giftScarf)),
      POST(post(fixture("step-request")), ctx(IDS.giftScarf)),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([(await a.json()).gift.status, (await b.json()).gift.status]).toEqual(["ordered", "ordered"]);
    expect(statusOf(IDS.giftScarf)).toBe("ordered");
  });
  it("answers the gift as another request left it when its own conditional write finds it moved", async () => {
    holder.current.markAsPurchased.mockResolvedValue({ data: {} });
    const store = holder.current.store;
    const write = store.updateGift.bind(store);
    let raced = false;
    store.updateGift = async (id, patch, expect) => {
      if (!raced && expect) {            // another request gets in between this one's read and its write
        raced = true;
        await write(id, { status: "ordered" });
      }
      return write(id, patch, expect);
    };
    const res = await POST(post(fixture("step-request")), ctx(IDS.giftScarf));
    expect([res.status, (await res.json()).gift.status]).toEqual([200, "ordered"]);
    expect(statusOf(IDS.giftScarf)).toBe("ordered");
    expect(store.writes.filter((w) => w.startsWith("updateGift"))).toHaveLength(1);
  });
  it("answers 404 when the gift is gone by the time its write is made", async () => {
    const store = holder.current.store;
    const write = store.updateGift.bind(store);
    store.updateGift = async (id, patch, expect) => {
      await store.deleteGift(id);
      return write(id, patch, expect);
    };
    expect((await POST(post({ direction: "forward", from: "ordered" }, IDS.giftPhotoBook), ctx(IDS.giftPhotoBook))).status).toBe(404);
  });

  it("says nothing of an owner in what it answers or logs", async () => {   // §5.5
    vi.mocked(console.error).mockClear();
    holder.current.markAsPurchased.mockResolvedValue({ error: "Only the person who claimed this item can mark it purchased" });
    const refused = await POST(post(fixture("step-request")), ctx(IDS.giftScarf));
    holder.current.markAsPurchased.mockResolvedValue({ data: {} });
    const ok = await POST(post(fixture("step-request")), ctx(IDS.giftScarf));
    for (const text of [await refused.text(), await ok.text()]) {
      expect(text).not.toMatch(/claimedBy|claimed_by|out_of_stock|purchased|email|invite|user_id|recipient_id/);
    }
    expect(console.error).not.toHaveBeenCalled();
  });
});
