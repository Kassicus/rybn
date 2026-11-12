import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture, groupRows, rowFor } from "@/lib/mobile/test-fixtures";
import { IDS } from "@/lib/mobile/test-shopping";
import { KEYS, TAG_IDS, tagging, tagsFor } from "@/lib/mobile/test-wishlist";
import { formDataFromBody } from "@/lib/mobile/wishlist";

const ensureProfile = vi.fn();
const getWishlistItem = vi.fn();
const updateWishlistItem = vi.fn();
const deleteWishlistItem = vi.fn();
const getMyGroups = vi.fn();
const getUpcomingOccasions = vi.fn();
const getTagsForItems = vi.fn();
const tagItemForMyOccasion = vi.fn();
const tagItemForGroupDate = vi.fn();
const untagItem = vi.fn();
const occasionRows = vi.fn();
const profiles = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/actions/wishlist", () => ({
  getWishlistItem: (id: string) => getWishlistItem(id),
  updateWishlistItem: (id: string, form: unknown) => updateWishlistItem(id, form),
  deleteWishlistItem: (id: string) => deleteWishlistItem(id),
}));
vi.mock("@/lib/actions/groups", () => ({ getMyGroups: () => getMyGroups() }));
vi.mock("@/lib/actions/occasions", () => ({ getUpcomingOccasions: (...a: unknown[]) => getUpcomingOccasions(...a) }));
vi.mock("@/lib/actions/item-occasions", () => ({
  getTagsForItems: (...a: unknown[]) => getTagsForItems(...a),
  tagItemForMyOccasion: (...a: unknown[]) => tagItemForMyOccasion(...a),
  tagItemForGroupDate: (...a: unknown[]) => tagItemForGroupDate(...a),
  untagItem: (...a: unknown[]) => untagItem(...a),
}));
vi.mock("@/lib/mobile/people-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mobile/people-live")>()),
  occasionRows: (...a: unknown[]) => occasionRows(...a),
  profiles: (...a: unknown[]) => profiles(...a),
}));
vi.mock("@/lib/actions/profile", () => ({}));
vi.mock("@/lib/supabase/signed-image", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("no database in tests");
  },
}));

const { PUT, DELETE } = await import("./route");

const ID = "5f0c2a9e-8d1b-4c3e-9f6a-2b7d4e1c8a90";
const headers = { authorization: "Bearer test-token" };
const url = `http://localhost/api/mobile/v1/wishlist/${ID}`;
const put = (body: unknown) => new Request(url, { method: "PUT", headers, body: JSON.stringify(body) });
const del = () => new Request(url, { method: "DELETE", headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const mine = () => ({ data: rowFor(fixture("wishlist-item").item), currentUserId: "user_2abcDEF" });
const tagWrites = () => [...tagItemForMyOccasion.mock.calls, ...tagItemForGroupDate.mock.calls, ...untagItem.mock.calls];
/** The item as it stands, with these tags. */
const taggedFor = (occasionIds: string[]) =>
  getTagsForItems.mockImplementation(async (ids: string[]) => tagsFor({ [ID]: occasionIds }, ids));
const saving = (occasions: string[]) => put({ ...fixture("wishlist-item-request"), occasions });
const keysOf = async (res: Response) => (await res.json()).item.occasions.map((o: { key: string }) => o.key);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  ensureProfile.mockResolvedValue("user_2abcDEF");
  const t = tagging();
  getUpcomingOccasions.mockResolvedValue({ data: t.upcoming });
  getTagsForItems.mockImplementation(async (ids: string[]) => tagsFor(t.tags, ids));
  occasionRows.mockImplementation(async (ids: string[]) => t.occasionRows.filter((r) => ids.includes(r.id)));
  profiles.mockResolvedValue(new Map());
  tagItemForMyOccasion.mockImplementation(async () => ({ data: { occasionId: TAG_IDS.samBirthday } }));
  tagItemForGroupDate.mockImplementation(async (_: string, occasionId: string) => ({ data: { occasionId } }));
  untagItem.mockResolvedValue({ ok: true });
});

describe("PUT /api/mobile/v1/wishlist/[id]", () => {
  it("replaces the caller's item, its tags already the ones sent", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture("wishlist-item"));
    expect(updateWishlistItem).toHaveBeenCalledWith(ID, formDataFromBody(fixture("wishlist-item-request")));
    expect(getTagsForItems).toHaveBeenCalledWith([ID]);
    expect(tagWrites()).toEqual([]);
  });
  it("leaves the tags alone when the body has no occasions, and answers them", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    taggedFor([IDS.xmas]);
    const { occasions: _, ...request } = fixture("wishlist-item-request");
    const res = await PUT(put(request), ctx(ID));
    expect(res.status).toBe(200);
    expect(await keysOf(res)).toEqual([KEYS.xmas]);
    expect(tagWrites()).toEqual([]);
  });
  it("removes every tag for an empty list", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    const res = await PUT(saving([]), ctx(ID));
    expect(await keysOf(res)).toEqual([]);
    expect(untagItem.mock.calls.sort()).toEqual([[ID, IDS.xmas], [ID, TAG_IDS.samBirthday]].sort());
    expect(tagItemForMyOccasion).not.toHaveBeenCalled();
    expect(tagItemForGroupDate).not.toHaveBeenCalled();
  });
  it("adds one and removes another in one save", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    taggedFor([IDS.xmas]);
    const res = await PUT(saving([KEYS.samBirthday]), ctx(ID));
    expect(await keysOf(res)).toEqual([KEYS.samBirthday]);
    expect(tagItemForMyOccasion).toHaveBeenCalledWith(ID, "birthday");
    expect(untagItem).toHaveBeenCalledWith(ID, IDS.xmas);
    expect(tagItemForGroupDate).not.toHaveBeenCalled();
  });
  it("keeps a passed tag the item is sent back with", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    taggedFor([IDS.xmas, TAG_IDS.xmas2025]);
    const res = await PUT(saving([KEYS.xmas2025, KEYS.xmas]), ctx(ID));
    expect(await keysOf(res)).toEqual([KEYS.xmas2025, KEYS.xmas]);
    expect(tagWrites()).toEqual([]);
  });
  it("answers 422 for a date that is not one of the caller's and writes nothing, not even the item", async () => {
    getWishlistItem.mockResolvedValue(mine());
    for (const key of ["birthday:user_2momABC:2027", KEYS.xmas2025, "group_date:99999999-9999-4999-8999-999999999999"]) {
      const res = await PUT(saving([KEYS.xmas, key]), ctx(ID));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toEqual({ code: "invalid", message: "Choose one of your dates." });
    }
    expect(updateWishlistItem).not.toHaveBeenCalled();
    expect(tagWrites()).toEqual([]);
  });
  it("still answers the item when a tag cannot be written after the item was, its occasions telling the truth", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    taggedFor([IDS.xmas, TAG_IDS.samBirthday]);
    untagItem.mockResolvedValue({ error: "Failed to remove this tag. Please try again." });
    const res = await PUT(saving([KEYS.xmas]), ctx(ID));
    expect(res.status).toBe(200);
    // Christmas was kept; the birthday could not be removed, so it is still there.
    expect(await keysOf(res)).toEqual([KEYS.samBirthday, KEYS.xmas]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`untagging ${ID} from ${KEYS.samBirthday}`),
      "Failed to remove this tag. Please try again.");
  });
  it("answers what stands when an added date is deleted in between", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    taggedFor([TAG_IDS.samBirthday]);
    tagItemForGroupDate.mockResolvedValue({ error: "That occasion no longer exists, or is not yours to tag" });
    const res = await PUT(saving([KEYS.samBirthday, KEYS.xmas]), ctx(ID));
    expect(res.status).toBe(200);
    expect(await keysOf(res)).toEqual([KEYS.samBirthday]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`tagging ${ID} for ${KEYS.xmas}`),
      "That occasion no longer exists, or is not yours to tag");
  });
  it("counts a tag that is already gone as removed", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    untagItem.mockResolvedValue({ error: "That tag no longer exists, or is not yours to remove" });
    const res = await PUT(saving([KEYS.xmas]), ctx(ID));
    expect(await keysOf(res)).toEqual([KEYS.xmas]);
    expect(console.error).not.toHaveBeenCalled();
  });
  it("answers 500 without the database's words when the item's tags cannot be read, and writes nothing", async () => {
    getWishlistItem.mockResolvedValue(mine());
    getTagsForItems.mockResolvedValue({ error: "Failed to load tags. Please try again." });
    const res = await PUT(put(fixture("wishlist-item-request")), ctx(ID));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed to load/);
    expect(updateWishlistItem).not.toHaveBeenCalled();
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
  it("answers 404 for another person's item and changes nothing, its tags included", async () => {
    getWishlistItem.mockResolvedValue({ ...mine(), data: { ...mine().data, user_id: "user_other" } });
    for (const occasions of [[], [KEYS.xmas]]) {
      const res = await PUT(saving(occasions), ctx(ID));
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
    expect(updateWishlistItem).not.toHaveBeenCalled();
    expect(getTagsForItems).not.toHaveBeenCalled();
    expect(tagWrites()).toEqual([]);
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
  it("answers 500 for a database error from the update, and writes no tags", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ error: "boom" });
    expect((await PUT(saving([]), ctx(ID))).status).toBe(500);
    expect(tagWrites()).toEqual([]);
  });
  it("answers 404 when the item vanished between the lookup and the update, and writes no tags", async () => {
    getWishlistItem.mockResolvedValueOnce(mine()).mockResolvedValueOnce({ error: "no rows", notFound: true });
    updateWishlistItem.mockResolvedValue({ error: "JSON object requested, multiple (or no) rows returned" });
    const res = await PUT(saving([]), ctx(ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(tagWrites()).toEqual([]);
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
