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

const get = (id: string) => bearer(`http://localhost/api/mobile/v1/groups/${id}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  holder.current = worldMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/groups/[id]", () => {
  it("answers the group fixture, never cached", async () => {
    const res = await GET(get(IDS.rivera), ctx(IDS.rivera));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(fixture("group"));
  });

  it("never sends an invite code, an email or the group's settings", async () =>
    expect(await (await GET(get(IDS.rivera), ctx(IDS.rivera))).text()).not.toMatch(/SECRET12|invite|settings|@example\.com/));

  it.each(["Group not found", "You are not a member of this group"])("answers 404 for %s", async (error) => {
    holder.current.getGroupById.mockResolvedValue({ error });
    expect((await GET(get(IDS.rivera), ctx(IDS.rivera))).status).toBe(404);
  });

  it("answers 401 when nobody is signed in", async () => {
    holder.current.getGroupById.mockResolvedValue({ error: "Not authenticated" });
    expect((await GET(get(IDS.rivera), ctx(IDS.rivera))).status).toBe(401);
  });

  it("answers 500, logging the failure but not its words, for any other error", async () => {
    holder.current.getGroupById.mockResolvedValue({ error: "Failed to load group. Please try again." });
    const res = await GET(get(IDS.rivera), ctx(IDS.rivera));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/group/i);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/groups"), expect.anything());
  });

  it("answers 404 for an id that is not a UUID, asking nothing", async () => {
    expect((await GET(get("x"), ctx("x"))).status).toBe(404);
    expect(holder.current.getGroupById).not.toHaveBeenCalled();
  });

  it("files a website claim before saying whether a member has a gift", async () => {
    const { store } = holder.current;
    const dad = world().people.dad;
    const hasGift = (body: { members: { person: { id: string }; hasGift: boolean }[] }) =>
      body.members.find((x) => x.person.id === dad.id)!.hasGift;
    expect(hasGift(fixture("group"))).toBe(false);
    // The oven is Dad's in this test, as the database would say.
    const linked = holder.current.linkedItems.getMockImplementation()!;
    holder.current.linkedItems.mockImplementation(async (ids: string[], viewer: string) => {
      const all: Map<string, { ownerId: string }> = await linked(ids, viewer);
      const oven = all.get(IDS.dutchOven);
      if (oven) all.set(IDS.dutchOven, { ...oven, ownerId: dad.id } as never);
      return all;
    });
    store.addClaim(oven({ owner: dad, occasionId: IDS.xmas, occasionDate: "2026-12-25" }, { ownerId: dad.id }));
    const body = await (await GET(get(IDS.rivera), ctx(IDS.rivera))).json();
    expect(store.writes).toContain("insertGift:Le Creuset Dutch oven");
    expect(hasGift(body)).toBe(true);
  });

  it("never says the caller has a gift for themselves, even if a recipient is linked to them", async () => {
    const w = world();
    const mine = "cccccccc-0000-4000-8000-000000000003";
    holder.current.store = memoryGiftStore(SAM, { claims: w.claims,
      gifts: [...w.gifts.map((g) => ({ ...g, user_id: SAM })),
        { ...w.gifts[1], id: "cccccccc-0000-4000-8000-000000000004", recipient_id: mine, name: "For me", status: "planned" as const,
          is_archived: false, user_id: SAM }],
      recipients: [...w.recipients.map((r) => ({ ...r, user_id: SAM })), { id: mine, name: "Sam Rivera", person_id: SAM, user_id: SAM }] });
    const body = await (await GET(get(IDS.rivera), ctx(IDS.rivera))).json();
    expect(body.members.find((x: { isYou: boolean }) => x.isYou).hasGift).toBe(false);
  });

  it("shows a member nothing of the gifts or claims others have filed for them", async () => {   // §5.5
    // Dad's own tracker holds a gift for Sam; Sam's store must never surface it, and claims are never read
    const w = world();
    holder.current.store = memoryGiftStore(SAM, { claims: w.claims,
      gifts: [...w.gifts.map((g) => ({ ...g, user_id: SAM })), { ...w.gifts[1], id: "cccccccc-0000-4000-8000-000000000001",
        recipient_id: "cccccccc-0000-4000-8000-000000000002", name: "For Sam", user_id: "user_2dadABC" }],
      recipients: [...w.recipients.map((r) => ({ ...r, user_id: SAM })),
        { id: "cccccccc-0000-4000-8000-000000000002", name: "Sam Rivera", person_id: SAM, user_id: "user_2dadABC" }] });
    const body = await (await GET(get(IDS.rivera), ctx(IDS.rivera))).json();
    expect(body).toEqual(fixture("group"));
    expect(body.members.find((x: { isYou: boolean }) => x.isYou).hasGift).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/For Sam|claimedBy|purchased|out_of_stock/);
    expect(holder.current.getActiveClaims).not.toHaveBeenCalled();
  });

  it("counts a member's items as the caller may see them, asking only about this group's members", async () => {
    await GET(get(IDS.rivera), ctx(IDS.rivera));
    expect(holder.current.visibleItemCounts).toHaveBeenCalledWith(
      expect.arrayContaining(world().members.get(IDS.rivera)!.map((p) => p.id)));
  });
});
