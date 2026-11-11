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

const { GET } = await import("./route");
const { bearer, oven, worldMocks } = await import("@/lib/mobile/test-shopping-mocks");
const { memoryGiftStore } = await import("@/lib/mobile/test-gift-store");
const { IDS, SAM, world } = await import("@/lib/mobile/test-shopping");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const mom = (q = `?occasion=${encodeURIComponent(IDS.xmasKey)}`) => bearer(`http://localhost/api/mobile/v1/people/user_2momABC/wishlist${q}`);

beforeEach(() => {
  holder.current = worldMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/people/[id]/wishlist", () => {
  it("answers the person-wishlist fixture for Christmas, never cached", async () => {
    const res = await GET(mom(), ctx("user_2momABC"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(fixture("person-wishlist"));
  });

  it("never says who holds an item or who marked it out of stock", async () =>
    expect(await (await GET(mom(), ctx("user_2momABC"))).text()).not.toMatch(/user_2dadABC|claimedBy|out_of_stock|purchased|email|@example\.com|invite/));

  it("answers the caller's own list with their items alone, never asking for claims or tags", async () => {   // §5.5
    holder.current.getUserWishlist.mockResolvedValue({ data: world().momItems.map((r) => ({ ...r, user_id: SAM, purchased: true })), currentUserId: SAM });
    const body = await (await GET(bearer("http://localhost/api/mobile/v1/people/user_2abcDEF/wishlist"), ctx(SAM))).json();
    expect([body.gifts, body.occasions, body.items.every((i: { state: string }) => i.state === "available")]).toEqual([[], [], true]);
    expect(holder.current.getActiveClaims).not.toHaveBeenCalled();
    expect(holder.current.getTagsForItems).not.toHaveBeenCalled();
  });

  it("shows nothing of the gifts another person has filed for the caller", async () => {   // §5.5
    // Mom's own tracker holds a gift for Sam. Sam's store is scoped to Sam, so it never surfaces.
    const w = world();
    holder.current.store = memoryGiftStore(SAM, { claims: w.claims,
      gifts: [...w.gifts.map((g) => ({ ...g, user_id: SAM })), { ...w.gifts[1], id: "cccccccc-0000-4000-8000-000000000001",
        recipient_id: "cccccccc-0000-4000-8000-000000000002", name: "For Sam", occasion_id: IDS.xmas, user_id: "user_2momABC" }],
      recipients: [...w.recipients.map((r) => ({ ...r, user_id: SAM })),
        { id: "cccccccc-0000-4000-8000-000000000002", name: "Sam Rivera", person_id: SAM, user_id: "user_2momABC" }] });
    const ownList = bearer("http://localhost/api/mobile/v1/people/user_2abcDEF/wishlist");
    expect(JSON.stringify(await (await GET(ownList, ctx(SAM))).json())).not.toMatch(/For Sam/);
    expect(await (await GET(mom(), ctx("user_2momABC"))).json()).toEqual(fixture("person-wishlist"));
  });

  it("ignores an occasion that does not involve the person", async () =>
    expect((await (await GET(mom(`?occasion=${encodeURIComponent("birthday:user_2prySHA:2027")}`), ctx("user_2momABC"))).json()).occasion).toBeNull());

  it("answers 404 for someone the caller cannot see", async () => {
    holder.current.profiles.mockResolvedValue(new Map());
    expect((await GET(mom(), ctx("user_2momABC"))).status).toBe(404);
  });

  it("files a website claim first, so it shows on top", async () => {
    holder.current.store.addClaim(oven({ occasionId: IDS.xmas, occasionDate: "2026-12-25" }));
    const body = await (await GET(mom(), ctx("user_2momABC"))).json();
    expect(body.gifts.map((g: { name: string }) => g.name)).toContain("Le Creuset Dutch oven");
  });

  it("answers 401 when nobody is signed in, and 500 for any other failure without its words", async () => {
    holder.current.getUserWishlist.mockResolvedValue({ error: "Not authenticated" });
    expect((await GET(mom(), ctx("user_2momABC"))).status).toBe(401);
    holder.current.getUserWishlist.mockResolvedValue({ error: "relation wishlist_items does not exist" });
    const res = await GET(mom(), ctx("user_2momABC"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/relation/);
    holder.current.getUserWishlist.mockResolvedValue({ data: [], currentUserId: SAM });
    holder.current.getActiveClaims.mockResolvedValue({ error: "Failed to load claims. Please try again." });
    expect((await GET(mom(), ctx("user_2momABC"))).status).toBe(500);
  });

  it("pins a linked couple's anniversary when the caller shares a group with one partner only", async () => {
    // Dad and Zed are a linked couple. The caller is in a group with Dad and not with Zed, so profiles() does not
    // return Zed, and the caller's upcoming list holds the collapsed row with Zed as partner.
    const zed = "user_2zedXYZ";
    const couple = {
      occasionId: "bbbbbbbb-2222-4222-8222-000000000001", kind: "anniversary" as const, name: null, occasionDate: "2027-03-01",
      celebrantId: world().people.dad.id, celebrantUsername: "luis", celebrantDisplayName: "Dad", groupId: null, groupName: null,
      partnerId: zed, partnerUsername: "zed", partnerDisplayName: "Zed Partner",
    };
    holder.current.getUpcomingOccasions.mockResolvedValue({ data: [...world().upcoming, couple] });
    const dad = await (await GET(bearer("http://localhost/api/mobile/v1/people/user_2dadABC/wishlist"), ctx("user_2dadABC"))).json();
    expect(dad.occasions.find((o: { kind: string }) => o.kind === "anniversary")).toEqual({
      key: "anniversary:user_2dadABC:2027", kind: "anniversary", title: "Dad & Zed Partner's Anniversary", date: "2027-03-01", group: null,
    });
    // Zed's own list: the caller cannot see Zed's profile, so there is no list to show.
    expect((await GET(bearer(`http://localhost/api/mobile/v1/people/${zed}/wishlist`), ctx(zed))).status).toBe(404);
  });
});
