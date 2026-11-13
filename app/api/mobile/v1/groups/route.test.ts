import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupMocks } from "@/lib/mobile/test-groups";
import type { WorldMocks } from "@/lib/mobile/test-shopping-mocks";

const holder = vi.hoisted(() => ({ current: undefined as unknown as WorldMocks & GroupMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/occasions", () => ({ getUpcomingOccasions: (...a: unknown[]) => holder.current.getUpcomingOccasions(...a) }));
vi.mock("@/lib/actions/groups", () => ({
  getMyGroups: (...a: unknown[]) => holder.current.getMyGroups(...a),
  getGroupById: (...a: unknown[]) => holder.current.getGroupById(...a),
  createGroup: (...a: unknown[]) => holder.current.createGroup(...a),
  leaveGroup: (...a: unknown[]) => holder.current.leaveGroup(...a),
  deleteGroup: (...a: unknown[]) => holder.current.deleteGroup(...a),
}));
vi.mock("@/lib/actions/invitations", () => ({
  joinGroupByCode: (...a: unknown[]) => holder.current.joinGroupByCode(...a),
  sendGroupInvitation: (...a: unknown[]) => holder.current.sendGroupInvitation(...a),
}));
vi.mock("@/lib/mobile/group-reads", () => ({
  groupSummary: (...a: unknown[]) => holder.current.groupSummary(...a),
  callerRole: (...a: unknown[]) => holder.current.callerRole(...a),
  inviteCodeOf: (...a: unknown[]) => holder.current.inviteCodeOf(...a),
  groupNameOf: (...a: unknown[]) => holder.current.groupNameOf(...a),
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

const { GET, POST } = await import("./route");
const { bearer, worldMocks } = await import("@/lib/mobile/test-shopping-mocks");
const { GARCIA, groupMocks } = await import("@/lib/mobile/test-groups");

const get = () => bearer("http://localhost/api/mobile/v1/groups");
const post = (body: unknown) => bearer("http://localhost/api/mobile/v1/groups",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  holder.current = { ...worldMocks(), ...groupMocks() };
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/groups", () => {
  it("answers the group-list fixture: named fields and a member count, never invite codes", async () => {
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(fixture("group-list"));
    expect(text).not.toMatch(/SECRET12|invite/);
  });

  it("answers 500 for a database error", async () => {
    holder.current.getMyGroups.mockResolvedValue({ error: "boom", data: [] });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/boom/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/groups"), expect.anything());
  });

  it("asks for each group's member count once, by id", async () => {
    await GET(get(), ctx);
    expect(holder.current.memberCounts).toHaveBeenCalledTimes(1);
    expect(holder.current.memberCounts).toHaveBeenCalledWith(expect.arrayContaining([
      "2b8f6c4a-1e3d-4f5a-9b7c-0d1e2f3a4b5c", "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e"]));
  });

  it("says nothing of gifts, claims or anyone's items", async () => {   // §5.5
    const text = await (await GET(get(), ctx)).text();
    expect(holder.current.getActiveClaims).not.toHaveBeenCalled();
    expect(holder.current.getUserWishlist).not.toHaveBeenCalled();
    expect(holder.current.getTagsForItems).not.toHaveBeenCalled();
    expect(holder.current.linkedItems).not.toHaveBeenCalled();
    expect(holder.current.visibleItemCounts).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
    expect(text).not.toMatch(/gift|claimedBy|purchased|out_of_stock|email|@example\.com|SECRET12|invite/);
  });
});

describe("POST /api/mobile/v1/groups", () => {
  it("answers 401 without a bearer, creating nothing", async () => {
    const res = await POST(new Request("http://localhost/api/mobile/v1/groups",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixture("group-request")) }), ctx);
    expect(res.status).toBe(401);
    expect(holder.current.createGroup).not.toHaveBeenCalled();
    expect(holder.current.groupSummary).not.toHaveBeenCalled();
  });

  it("creates the request fixture and answers the created fixture", async () => {
    const res = await POST(post(fixture("group-request")), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(holder.current.createGroup).toHaveBeenCalledWith({ name: "Garcia Cousins", description: "Cousins on Dad's side", type: "family" });
    expect(holder.current.groupSummary).toHaveBeenCalledWith(GARCIA);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(fixture("group-created"));
    expect(text).not.toMatch(/SECRET12|invite|created_by|settings/);
  });

  it("passes on only the name, description and kind, never a creator, code or id the body names", async () => {
    await POST(post({ ...fixture("group-request"), created_by: "user_2prySHA", invite_code: "AAA-AAA-AAA", id: GARCIA }), ctx);
    expect(holder.current.createGroup.mock.calls).toEqual([[fixture("group-request")]]);
  });

  it("takes a null description as none, leaving it out of what it passes on", async () => {
    await POST(post({ name: "Garcia Cousins", description: null, type: "family" }), ctx);
    const [[input]] = holder.current.createGroup.mock.calls;
    expect([input, Object.keys(input)]).toEqual([{ name: "Garcia Cousins", type: "family" }, ["name", "type"]]);
  });

  it("refuses a blank name with the website's sentence, creating nothing", async () => {
    const res = await POST(post({ name: "  ", type: "family" }), ctx);
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "Group name is required" }]);
    expect(holder.current.createGroup).not.toHaveBeenCalled();
    expect(holder.current.groupSummary).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a group's with the plain sentence", async () => {
    for (const body of [[], "Garcia Cousins", null]) {
      const res = await POST(post(body), ctx);
      expect([res.status, (await res.json()).error.message]).toEqual([422, "That request wasn't valid."]);
    }
    expect(holder.current.createGroup).not.toHaveBeenCalled();
  });

  it("answers 500, not the website's words, when createGroup fails", async () => {
    holder.current.createGroup.mockResolvedValue({ error: "Failed to create group. Please try again." });
    const res = await POST(post(fixture("group-request")), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed to create|group/i);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/groups"), expect.anything());
    expect(holder.current.groupSummary).not.toHaveBeenCalled();
  });

  it("answers 401 when the action says nobody is signed in, and 500 when the new group cannot be read", async () => {
    holder.current.createGroup.mockResolvedValueOnce({ error: "Not authenticated" });
    expect((await POST(post(fixture("group-request")), ctx)).status).toBe(401);
    holder.current.groupSummary.mockResolvedValue(null);
    const res = await POST(post(fixture("group-request")), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/SECRET12|invite|Garcia/);
  });
});
