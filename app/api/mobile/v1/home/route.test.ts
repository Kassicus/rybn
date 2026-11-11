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
const { IDS, SAM, world } = await import("@/lib/mobile/test-shopping");

const get = () => bearer("http://localhost/api/mobile/v1/home");
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  holder.current = worldMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/home", () => {
  it("answers the home fixture, never cached", async () => {
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(fixture("home"));
  });

  it("looks a year ahead", async () => {
    await GET(get(), ctx);
    expect(holder.current.getUpcomingOccasions).toHaveBeenCalledWith(365);
  });

  it("files a website claim before counting", async () => {
    holder.current.store.addClaim(oven({ occasionId: IDS.xmas, occasionDate: "2026-12-25" }));
    expect((await (await GET(get(), ctx)).json()).occasions[0].people[4].giftCount).toBe(3);
  });

  it("answers when a claimed item's picture is on rybn's own storage host", async () => {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
    holder.current.store.addClaim(oven({ occasionId: IDS.xmas, occasionDate: "2026-12-25" },
      { imageValue: `https://${host}/storage/v1/object/sign/wishlist-images/user_2momABC/x.jpg?token=t` }));
    expect((await GET(get(), ctx)).status).toBe(200);
  });

  it("never reads claims or purchases on anyone's items, the caller's included", async () => {   // §5.5
    const text = await (await GET(get(), ctx)).text();
    expect(holder.current.getActiveClaims).not.toHaveBeenCalled();
    expect(holder.current.getUserWishlist).not.toHaveBeenCalled();
    expect(text).not.toMatch(/purchased|claimedBy|out_of_stock|email|@example\.com/);
  });

  it("shows a person nothing of the gifts others have filed for them, or of anyone's claims", async () => {   // §5.5
    // Dad's own tracker holds a gift for Sam, and Dad holds the Kindle: Sam's store must never surface either.
    const w = world();
    const { memoryGiftStore } = await import("@/lib/mobile/test-gift-store");
    holder.current.store = memoryGiftStore(SAM, {
      claims: w.claims,
      gifts: [...w.gifts.map((g) => ({ ...g, user_id: SAM })), { ...w.gifts[1], id: "cccccccc-0000-4000-8000-000000000001",
        recipient_id: "cccccccc-0000-4000-8000-000000000002", name: "For Sam", occasion_id: IDS.xmas, status: "planned" as const, user_id: "user_2dadABC" }],
      recipients: [...w.recipients.map((r) => ({ ...r, user_id: SAM })),
        { id: "cccccccc-0000-4000-8000-000000000002", name: "Sam Rivera", person_id: SAM, user_id: "user_2dadABC" }],
    });
    const body = await (await GET(get(), ctx)).json();
    expect(body).toEqual(fixture("home"));
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/For Sam|claimedBy|purchased|out_of_stock|invite/);
    expect(holder.current.getActiveClaims).not.toHaveBeenCalled();
  });

  it("answers 401 when the occasions action says nobody is signed in", async () => {
    holder.current.getUpcomingOccasions.mockResolvedValue({ error: "Not authenticated" });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 500 and logs a failure without its words", async () => {
    holder.current.getUpcomingOccasions.mockResolvedValue({ error: "Failed to load upcoming occasions." });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/occasions/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/home"), expect.anything());
  });

  it("pins a linked couple's anniversary when the caller shares a group with one partner only", async () => {
    // Dad and Zed are a linked couple. The caller is in a group with Dad and not with Zed, so profiles() does not
    // return Zed. get_upcoming_occasions still hands the collapsed row to the caller, with Zed as partner.
    const zed = "user_2zedXYZ";
    const couple = {
      occasionId: "bbbbbbbb-2222-4222-8222-000000000001", kind: "anniversary" as const, name: null, occasionDate: "2027-03-01",
      celebrantId: world().people.dad.id, celebrantUsername: "luis", celebrantDisplayName: "Dad", groupId: null, groupName: null,
      partnerId: zed, partnerUsername: "zed", partnerDisplayName: "Zed Partner",
    };
    holder.current.getUpcomingOccasions.mockResolvedValue({ data: [...world().upcoming, couple] });
    const body = await (await GET(get(), ctx)).json();
    const anniversary = body.occasions.find((o: { occasion: { kind: string } }) => o.occasion.kind === "anniversary");
    expect(anniversary).toEqual({
      occasion: { key: "anniversary:user_2dadABC:2027", kind: "anniversary", title: "Dad & Zed Partner's Anniversary", date: "2027-03-01", group: null },
      people: [
        { person: { id: "user_2dadABC", name: "Dad", username: "luis", avatarUrl: null }, giftCount: 0 },
        { person: { id: zed, name: "Zed Partner", username: "zed", avatarUrl: null }, giftCount: 0 },
      ],
      started: 0,
      total: 2,
    });
  });
});
