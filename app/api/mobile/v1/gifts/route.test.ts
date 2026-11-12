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

const { GET, POST } = await import("./route");
const { bearer, worldMocks } = await import("@/lib/mobile/test-shopping-mocks");
const { SHOPPING_RULES } = await import("@/lib/mobile/shopping-rules");
const { IDS, world } = await import("@/lib/mobile/test-shopping");

const ctx = { params: Promise.resolve({}) };
const get = (q: string) => bearer(`http://localhost/api/mobile/v1/gifts${q}`);
const post = (body: unknown) =>
  bearer("http://localhost/api/mobile/v1/gifts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const request = () => fixture("gift-request");

beforeEach(() => {
  holder.current = worldMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/gifts", () => {
  it("answers the gifts fixture", async () => expect(await (await GET(get(""), ctx)).json()).toEqual(fixture("gifts")));
  it("answers another season", async () => expect((await (await GET(get("?season=2025"), ctx)).json()).groups.map((g: { name: string }) => g.name)).toEqual(["Grandpa Joe"]));
  it("refuses a season that is not a year", async () => {
    for (const q of ["?season=abc", "?season=26", "?season=20266", "?season="]) expect((await GET(get(q), ctx)).status).toBe(422);
  });
  it("never sends another person's claim or an email", async () => expect(await (await GET(get(""), ctx)).text()).not.toMatch(/claimedBy|email|@example\.com|SECRET12/));
  it("carries no recipient id and no user id, and is never cached", async () => {
    const res = await GET(get(""), ctx);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toMatch(/recipient_id|recipientId|user_id|userId|claimed_by|out_of_stock/);
  });
  it("answers 401 when the groups cannot be read for want of a sign-in, and 500 for any other failure", async () => {
    holder.current.getMyGroups.mockResolvedValue({ error: "Not authenticated" });
    expect((await GET(get(""), ctx)).status).toBe(401);
    holder.current.getMyGroups.mockResolvedValue({ error: "connection reset" });
    const res = await GET(get(""), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/connection/);
  });
});

describe("POST /api/mobile/v1/gifts", () => {
  it("adds the request fixture for Dad at Planned, under a new recipient named Dad", async () => {
    const body = await (await POST(post(request()), ctx)).json();
    expect(body.gift).toMatchObject({ name: "Leather wallet", status: "planned", fromList: false, recipientName: "Dad",
      person: { id: "user_2dadABC", name: "Dad" }, occasion: { key: IDS.xmasKey }, notes: "Brown, not black", price: 45 });
    expect(Object.keys(body)).toEqual(["gift"]);
  });
  it("files the gift under the year of its occasion", async () => {
    const body = await (await POST(post({ ...request(), person: "user_2momABC", occasion: "birthday:user_2momABC:2027" }), ctx)).json();
    expect([body.gift.occasion.key, body.gift.seasonYear]).toEqual(["birthday:user_2momABC:2027", 2027]);
  });
  it("files a gift with no occasion under this year", async () => {
    const body = await (await POST(post({ ...request(), occasion: null }), ctx)).json();
    expect([body.gift.occasion, body.gift.seasonYear]).toEqual([null, 2026]);
  });
  it("files a typed name under the caller's recipient of that name", async () => {
    const body = await (await POST(post({ ...request(), person: null, recipientName: "Grandpa Joe", occasion: null }), ctx)).json();
    expect(body.gift).toMatchObject({ recipientName: "Grandpa Joe", person: null });
    expect(holder.current.store.allRecipients().filter((r) => r.name === "Grandpa Joe")).toHaveLength(1);
  });
  it("makes a recipient for a typed name that is new", async () => {
    const body = await (await POST(post({ ...request(), person: null, recipientName: "Aunt May", occasion: IDS.xmasKey }), ctx)).json();
    expect(body.gift).toMatchObject({ recipientName: "Aunt May", person: null, occasion: { key: IDS.xmasKey } });
    expect(holder.current.store.allRecipients().filter((r) => r.name === "Aunt May")).toHaveLength(1);
  });
  it("offers a typed name only the group dates", async () => {
    const res = await POST(post({ ...request(), person: null, recipientName: "Aunt May", occasion: "birthday:user_2momABC:2027" }), ctx);
    expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
    expect(holder.current.store.writes).toEqual([]);
  });
  it("refuses someone outside the caller's groups", async () => {
    holder.current.getSharedGroups.mockResolvedValue({ data: [] });
    expect((await (await POST(post(request()), ctx)).json()).error.message).toBe("Choose who it's for.");
    expect(holder.current.store.writes).toEqual([]);
  });
  it("refuses the caller as the person, and an id that is not a person", async () => {
    for (const person of ["user_2abcDEF", "not a person!"]) {
      const res = await POST(post({ ...request(), person }), ctx);
      expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseWho]);
    }
    expect(holder.current.getSharedGroups).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });
  it("refuses an occasion that does not involve the person, creating no recipient", async () => {
    const res = await POST(post({ ...request(), occasion: "birthday:user_2momABC:2027" }), ctx);
    expect([res.status, (await res.json()).error.message]).toEqual([422, SHOPPING_RULES.chooseOccasion]);
    expect(holder.current.store.writes).toEqual([]);
  });
  it("refuses a picture in someone else's folder, and one that names the wrong place, writing nothing", async () => {   // requirement 2
    for (const imagePath of ["user_someoneElse/1794500000000-a.jpg", "gift-photos/user_2abcDEF/1794500000000-a.jpg", "user_2abcDEF/../x.jpg"]) {
      const res = await POST(post({ ...request(), imagePath }), ctx);
      expect([res.status, (await res.json()).error.message]).toEqual([422, INVALID_IMAGE_ERROR]);
    }
    expect(holder.current.store.writes).toEqual([]);
  });
  it("keeps the caller's own picture and answers its path and address", async () => {
    const path = "user_2abcDEF/1794500000000-p4b8.jpg";
    const body = await (await POST(post({ ...request(), imagePath: path }), ctx)).json();
    expect([body.gift.imagePath, body.gift.imageUrl]).toEqual([path, world().signedGiftPhoto(path)]);
  });
  it("refuses a body that is not a gift", async () => {
    for (const body of [{}, "x", null, { ...request(), name: "" }, { ...request(), person: null, recipientName: null }]) {
      expect((await POST(post(body), ctx)).status).toBe(422);
    }
    expect(holder.current.store.writes).toEqual([]);
  });
  it("takes no recipient or user from the body", async () => {   // requirement 1
    const body = await (await POST(post({ ...request(), recipient_id: IDS.recipientAlex, recipientId: IDS.recipientAlex, userId: "user_2dadABC", user_id: "user_2dadABC" }), ctx)).json();
    expect(body.gift.recipientName).toBe("Dad");
    const stored = holder.current.store.allGifts().find((g) => g.id === body.gift.id)!;
    expect(stored.recipient_id).not.toBe(IDS.recipientAlex);
    expect(stored.user_id).toBe("user_2abcDEF");
    expect(JSON.stringify(body)).not.toMatch(/recipient_id|recipientId|user_id|userId/);
  });
  it("answers 500 without database words when the gift cannot be stored", async () => {
    holder.current.store.insertGift = async () => { throw new Error("insertGift failed: duplicate key"); };
    const res = await POST(post(request()), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/duplicate/);
  });
});
