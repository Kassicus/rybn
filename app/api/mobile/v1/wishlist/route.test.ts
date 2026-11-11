import { describe, it, expect, vi, beforeEach } from "vitest";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import { fixture, groupRows, rowFor } from "@/lib/mobile/test-fixtures";
import { formDataFromBody } from "@/lib/mobile/wishlist";

const ensureProfile = vi.fn();
const getMyWishlist = vi.fn();
const createWishlistItem = vi.fn();
const getMyGroups = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/actions/wishlist", () => ({
  getMyWishlist: () => getMyWishlist(),
  createWishlistItem: (form: unknown) => createWishlistItem(form),
}));
vi.mock("@/lib/actions/groups", () => ({ getMyGroups: () => getMyGroups() }));

const { GET, POST } = await import("./route");

const headers = { authorization: "Bearer test-token" };
const get = () => new Request("http://localhost/api/mobile/v1/wishlist", { headers });
const post = (body: unknown) =>
  new Request("http://localhost/api/mobile/v1/wishlist", { method: "POST", headers, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  ensureProfile.mockResolvedValue("user_2abcDEF");
});

describe("GET /api/mobile/v1/wishlist", () => {
  const mocks = () => {
    getMyWishlist.mockResolvedValue({ data: fixture("wishlist").items.map(rowFor) });
    getMyGroups.mockResolvedValue({ data: groupRows() });
  };
  it("answers the caller's list in the fixture's shape", async () => {
    mocks();
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(fixture("wishlist"));
  });
  it("never sends purchased, even when the row says so", async () => {
    mocks();
    const res = await GET(get(), ctx);
    expect(await res.text()).not.toMatch(/purchased/);
  });
  it("answers 401 when the action says nobody is signed in", async () => {
    getMyWishlist.mockResolvedValue({ error: "Not authenticated" });
    getMyGroups.mockResolvedValue({ data: [] });
    expect((await GET(get(), ctx)).status).toBe(401);
  });
  it("still lists every item when the groups cannot be loaded, naming no group", async () => {
    getMyWishlist.mockResolvedValue({ data: fixture("wishlist").items.map(rowFor) });
    getMyGroups.mockResolvedValue({ error: "connection reset by peer" });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/connection reset/);
    const { items } = JSON.parse(text);
    expect(items).toHaveLength(fixture("wishlist").items.length);
    const oneGroup = items.find((i: { privacy: { kind: string } }) => i.privacy.kind === "group");
    expect(oneGroup.privacySummary).toBe("Only one group");
    expect(console.error).toHaveBeenCalledWith("[mobile] wishlist: groups unavailable:", "connection reset by peer");
  });
  it("answers 401 when the groups read says nobody is signed in", async () => {
    getMyWishlist.mockResolvedValue({ data: [] });
    getMyGroups.mockResolvedValue({ error: "Not authenticated" });
    expect((await GET(get(), ctx)).status).toBe(401);
  });
  it("answers 500 and logs a database error without passing on its words", async () => {
    getMyWishlist.mockResolvedValue({ error: 'relation "wishlist_items" does not exist' });
    getMyGroups.mockResolvedValue({ data: groupRows() });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/relation/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/wishlist"), expect.anything());
  });
});

describe("POST /api/mobile/v1/wishlist", () => {
  it("adds the request fixture and answers the item", async () => {
    createWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    const res = await POST(post(fixture("wishlist-item-request")), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture("wishlist-item"));
    expect(createWishlistItem).toHaveBeenCalledWith(formDataFromBody(fixture("wishlist-item-request")));
  });
  it("answers 422 with the rule's sentence and adds nothing", async () => {
    const res = await POST(post({ ...fixture("wishlist-item-request"), title: " " }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toEqual({ code: "invalid", message: "Give it a name." });
    expect(createWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 422 'Choose one of your groups.' for a group the caller is not in", async () => {
    getMyGroups.mockResolvedValue({ data: groupRows() });
    const res = await POST(
      post({ ...fixture("wishlist-item-request"), privacy: { kind: "group", groupId: "99999999-9999-4999-8999-999999999999" } }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Choose one of your groups.");
    expect(createWishlistItem).not.toHaveBeenCalled();
  });
  it("accepts one of the caller's groups and names it", async () => {
    const rivera = fixture("groups").groups.find((g: { name: string }) => g.name === "Rivera Family");
    const privacy = { kind: "group", groupId: rivera.id };
    getMyGroups.mockResolvedValue({ data: groupRows() });
    createWishlistItem.mockResolvedValue({
      data: { ...rowFor(fixture("wishlist-item").item), privacy_settings: { visibleToGroupTypes: [], restrictToGroup: rivera.id } },
    });
    const res = await POST(post({ ...fixture("wishlist-item-request"), privacy }), ctx);
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item.privacy).toEqual(privacy);
    expect(item.privacySummary).toBe("Only Rivera Family");
  });
  it("answers 500 without the database's words when loading the groups fails, and writes nothing", async () => {
    getMyGroups.mockResolvedValue({ error: "connection reset by peer" });
    const res = await POST(
      post({ ...fixture("wishlist-item-request"), privacy: { kind: "group", groupId: "99999999-9999-4999-8999-999999999999" } }),
      ctx,
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/connection reset/);
    expect(createWishlistItem).not.toHaveBeenCalled();
  });
  it("loads the groups only for a one-group choice", async () => {
    createWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    await POST(post(fixture("wishlist-item-request")), ctx);
    expect(getMyGroups).not.toHaveBeenCalled();
  });
  it("refuses a picture in someone else's folder", async () => {
    const res = await POST(post({ ...fixture("wishlist-item-request"), imagePath: "user_someoneElse/1-a.jpg" }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe(INVALID_IMAGE_ERROR);
    expect(createWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 401 when the action says nobody is signed in", async () => {
    createWishlistItem.mockResolvedValue({ error: "Not authenticated" });
    expect((await POST(post(fixture("wishlist-item-request")), ctx)).status).toBe(401);
  });
  it("answers 500 for a database error from the action", async () => {
    createWishlistItem.mockResolvedValue({ error: 'new row violates check constraint "title_length"' });
    const res = await POST(post(fixture("wishlist-item-request")), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toBe("Something went wrong. Please try again.");
  });
});
