import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture, groupRows, rowFor } from "@/lib/mobile/test-fixtures";
import { formDataFromBody } from "@/lib/mobile/wishlist";

const ensureProfile = vi.fn();
const getWishlistItem = vi.fn();
const updateWishlistItem = vi.fn();
const deleteWishlistItem = vi.fn();
const getMyGroups = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/actions/wishlist", () => ({
  getWishlistItem: (id: string) => getWishlistItem(id),
  updateWishlistItem: (id: string, form: unknown) => updateWishlistItem(id, form),
  deleteWishlistItem: (id: string) => deleteWishlistItem(id),
}));
vi.mock("@/lib/actions/groups", () => ({ getMyGroups: () => getMyGroups() }));

const { PUT, DELETE } = await import("./route");

const ID = "5f0c2a9e-8d1b-4c3e-9f6a-2b7d4e1c8a90";
const headers = { authorization: "Bearer test-token" };
const url = `http://localhost/api/mobile/v1/wishlist/${ID}`;
const put = (body: unknown) => new Request(url, { method: "PUT", headers, body: JSON.stringify(body) });
const del = () => new Request(url, { method: "DELETE", headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const mine = () => ({ data: rowFor(fixture("wishlist-item").item), currentUserId: "user_2abcDEF" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  ensureProfile.mockResolvedValue("user_2abcDEF");
});

describe("PUT /api/mobile/v1/wishlist/[id]", () => {
  it("replaces the caller's item", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture("wishlist-item"));
    expect(updateWishlistItem).toHaveBeenCalledWith(ID, formDataFromBody(fixture("wishlist-item-request")));
  });
  it("names the group for a one-group choice", async () => {
    const rivera = fixture("groups").groups.find((g: { name: string }) => g.name === "Rivera Family");
    getWishlistItem.mockResolvedValue(mine());
    getMyGroups.mockResolvedValue({ data: groupRows() });
    updateWishlistItem.mockResolvedValue({
      data: { ...rowFor(fixture("wishlist-item").item), privacy_settings: { visibleToGroupTypes: [], restrictToGroup: rivera.id } },
    });
    const res = await PUT(put({ ...fixture("wishlist-item-request"), privacy: { kind: "group", groupId: rivera.id } }), ctx(ID));
    expect((await res.json()).item.privacySummary).toBe("Only Rivera Family");
  });
  it("answers 404 for another person's item and changes nothing", async () => {
    getWishlistItem.mockResolvedValue({ ...mine(), data: { ...mine().data, user_id: "user_other" } });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(updateWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 404 when the item is gone", async () => {
    getWishlistItem.mockResolvedValue({ error: "JSON object requested, multiple (or no) rows returned", notFound: true });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(404);
    expect(updateWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 401 when nobody is signed in", async () => {
    getWishlistItem.mockResolvedValue({ error: "Not authenticated", notFound: true });
    expect((await PUT(put(fixture("wishlist-item-request")), ctx(ID))).status).toBe(401);
  });
  it("never sends purchased after editing an item someone bought", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: { ...rowFor(fixture("wishlist-item").item), purchased: true } });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(await res.text()).not.toMatch(/purchased/);
  });
  it("answers 500 when the lookup fails for another reason", async () => {
    getWishlistItem.mockResolvedValue({ error: "timeout", notFound: false });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/timeout/);
  });
  it("answers 500 for a database error from the update", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ error: "boom" });
    expect((await PUT(put(fixture("wishlist-item-request")), ctx(ID))).status).toBe(500);
  });
  it("answers 404 when the item vanished between the lookup and the update", async () => {
    getWishlistItem.mockResolvedValueOnce(mine()).mockResolvedValueOnce({ error: "no rows", notFound: true });
    updateWishlistItem.mockResolvedValue({ error: "JSON object requested, multiple (or no) rows returned" });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
  it("answers 500 without the database's words when the update fails and the item is still there", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ error: "deadlock detected" });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/deadlock/);
  });
  it("answers 500 without the database's words when loading the groups fails, and writes nothing", async () => {
    getMyGroups.mockResolvedValue({ error: "connection reset by peer" });
    const res = await PUT(
      put({ ...fixture("wishlist-item-request"), privacy: { kind: "group", groupId: "99999999-9999-4999-8999-999999999999" } }),
      ctx(ID),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/connection reset/);
    expect(updateWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 404 for an id that is not a UUID, without reading or writing", async () => {
    const res = await PUT(put(fixture("wishlist-item-request")), ctx("not-a-uuid"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(getWishlistItem).not.toHaveBeenCalled();
    expect(updateWishlistItem).not.toHaveBeenCalled();
  });
  it("checks the body before reading the item", async () => {
    const res = await PUT(put({ ...fixture("wishlist-item-request"), title: "" }), ctx(ID));
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Give it a name.");
    expect(getWishlistItem).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/mobile/v1/wishlist/[id]", () => {
  it("deletes the caller's item and answers 204", async () => {
    getWishlistItem.mockResolvedValue(mine());
    deleteWishlistItem.mockResolvedValue({ success: true });
    const res = await DELETE(del(), ctx(ID));
    expect(res.status).toBe(204);
    expect(deleteWishlistItem).toHaveBeenCalledWith(ID);
  });
  it("answers 204 for an id that is not a UUID, without reading or deleting", async () => {
    expect((await DELETE(del(), ctx("not-a-uuid"))).status).toBe(204);
    expect(getWishlistItem).not.toHaveBeenCalled();
    expect(deleteWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 204 when it is already gone, deleting nothing", async () => {
    getWishlistItem.mockResolvedValue({ error: "no rows", notFound: true });
    expect((await DELETE(del(), ctx(ID))).status).toBe(204);
    expect(deleteWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 204 for another person's item and deletes nothing", async () => {
    getWishlistItem.mockResolvedValue({ ...mine(), data: { ...mine().data, user_id: "user_other" } });
    expect((await DELETE(del(), ctx(ID))).status).toBe(204);
    expect(deleteWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 401 when nobody is signed in", async () => {
    getWishlistItem.mockResolvedValue({ error: "Not authenticated", notFound: true });
    expect((await DELETE(del(), ctx(ID))).status).toBe(401);
    expect(deleteWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 500 when the lookup fails for another reason", async () => {
    getWishlistItem.mockResolvedValue({ error: "timeout", notFound: false });
    expect((await DELETE(del(), ctx(ID))).status).toBe(500);
    expect(deleteWishlistItem).not.toHaveBeenCalled();
  });
  it("answers 500 for a database error", async () => {
    getWishlistItem.mockResolvedValue(mine());
    deleteWishlistItem.mockResolvedValue({ error: "boom" });
    expect((await DELETE(del(), ctx(ID))).status).toBe(500);
  });
});
