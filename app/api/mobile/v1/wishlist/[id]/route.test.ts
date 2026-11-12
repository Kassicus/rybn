import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture, groupRows, rowFor } from "@/lib/mobile/test-fixtures";
import { IDS, world } from "@/lib/mobile/test-shopping";
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
  it("saves an item that already carries 25 tags with one more: only new dates count toward 20", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    const t = tagging();
    const passed = Array.from({ length: 25 }, (_, i) => ({ id: `55555555-0000-4000-8000-${String(i).padStart(12, "0")}`,
      kind: "group_date" as const, name: `Christmas ${2000 + i}`, occasion_date: `${2000 + i}-12-25`, celebrant_id: null,
      partner_id: null, group_id: IDS.rivera, groups: { name: "Rivera Family" } }));
    occasionRows.mockImplementation(async (ids: string[]) => [...t.occasionRows, ...passed].filter((r) => ids.includes(r.id)));
    taggedFor(passed.map((r) => r.id));
    const res = await PUT(saving([...passed.map((r) => `group_date:${r.id}`), KEYS.xmas]), ctx(ID));
    expect(res.status).toBe(200);
    expect(await keysOf(res)).toHaveLength(26);
    expect(tagItemForGroupDate.mock.calls).toEqual([[ID, IDS.xmas]]);
    expect(untagItem).not.toHaveBeenCalled();
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
  it("never removes a tag it cannot name: an empty list leaves a date the caller can no longer see", async () => {
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    taggedFor([TAG_IDS.xmas2025]);
    occasionRows.mockResolvedValue([]);
    const res = await PUT(saving([]), ctx(ID));
    expect(res.status).toBe(200);
    expect(await keysOf(res)).toEqual([]);
    expect(untagItem).not.toHaveBeenCalled();
  });
  it("answers 500 and writes nothing when the dates cannot be read, also for a body without occasions", async () => {
    getWishlistItem.mockResolvedValue(mine());
    getUpcomingOccasions.mockResolvedValue({ error: "Failed to load upcoming occasions." });
    const { occasions: _, ...request } = fixture("wishlist-item-request");
    const res = await PUT(put(request), ctx(ID));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed to load/);
    expect(updateWishlistItem).not.toHaveBeenCalled();
    expect(tagWrites()).toEqual([]);
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

describe("PUT /api/mobile/v1/wishlist/[id], a tag for one of the caller's own dates", () => {
  // A couple's anniversary is stored once, under one partner. Here the item is tagged for that row (STORED), while the
  // caller is offered their own anniversary with no row yet (OFFERED); tagging it lands on the stored row.
  const STORED_ROW = "44444444-4444-4444-8444-444444444444";
  const STORED = "anniversary:user_2alxABC:2027";
  const OFFERED = "anniversary:user_2abcDEF:2027";
  const storedRow = { id: STORED_ROW, kind: "anniversary" as const, name: null, occasion_date: "2027-03-08",
    celebrant_id: "user_2alxABC", partner_id: "user_2abcDEF", group_id: null, groups: null };
  const offered = { occasionId: null, kind: "anniversary" as const, name: null, occasionDate: "2027-03-08",
    celebrantId: "user_2abcDEF", celebrantUsername: "sam", celebrantDisplayName: "Sam Rivera", groupId: null, groupName: null,
    partnerId: null, partnerUsername: null, partnerDisplayName: null };
  const anniversaryAt = (key: string) => ({ key, kind: "anniversary", title: "Your anniversary", date: "2027-03-08", group: null });

  beforeEach(() => {
    const t = tagging();
    getWishlistItem.mockResolvedValue(mine());
    updateWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    getUpcomingOccasions.mockResolvedValue({ data: [...t.upcoming, offered] });
    occasionRows.mockImplementation(async (ids: string[]) => [...t.occasionRows, storedRow].filter((r) => ids.includes(r.id)));
    taggedFor([STORED_ROW]);
  });

  it("lists a tag once when tagging for a date lands on one the item already has", async () => {
    tagItemForMyOccasion.mockResolvedValue({ data: { occasionId: STORED_ROW } });
    const res = await PUT(saving([STORED, OFFERED]), ctx(ID));
    expect(res.status).toBe(200);
    expect((await res.json()).item.occasions).toEqual([anniversaryAt(STORED)]);
    expect(tagItemForMyOccasion).toHaveBeenCalledWith(ID, "anniversary");
  });
  it("finishes every removal before it adds, and names the date the tag landed on from its row", async () => {
    let removed = false;
    let removedBeforeAdding: boolean | undefined;
    untagItem.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      removed = true;
      return { ok: true };
    });
    tagItemForMyOccasion.mockImplementation(async () => {
      removedBeforeAdding = removed;
      return { data: { occasionId: STORED_ROW } };
    });
    const res = await PUT(saving([OFFERED]), ctx(ID));
    expect(res.status).toBe(200);
    expect(removedBeforeAdding).toBe(true);
    expect(untagItem).toHaveBeenCalledWith(ID, STORED_ROW);
    expect((await res.json()).item.occasions).toEqual([anniversaryAt(STORED)]);
  });
  it("names a date made on the spot from the row it was made as", async () => {
    getUpcomingOccasions.mockResolvedValue({ data: world().upcoming });
    taggedFor([]);
    const res = await PUT(saving([KEYS.samBirthday]), ctx(ID));
    expect(await keysOf(res)).toEqual([KEYS.samBirthday]);
    expect(occasionRows).toHaveBeenLastCalledWith([TAG_IDS.samBirthday]);
  });
  it("names it as offered, and logs, when that row cannot be read", async () => {
    getUpcomingOccasions.mockResolvedValue({ data: world().upcoming });
    taggedFor([]);
    occasionRows.mockImplementation(async (ids: string[]) => {
      if (ids.length > 0) throw new Error("occasionRows failed: timeout");
      return [];
    });
    const res = await PUT(saving([KEYS.samBirthday]), ctx(ID));
    expect(res.status).toBe(200);
    expect((await res.json()).item.occasions).toEqual([
      { key: KEYS.samBirthday, kind: "birthday", title: "Your birthday", date: "2026-11-30", group: null }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`reading what ${ID} was just tagged for`), expect.any(Error));
  });
  it("after 'already tagged' for one of the caller's own dates, answers the item's tags as read again", async () => {
    tagItemForMyOccasion.mockResolvedValue({ error: "You've already tagged this item for that occasion" });
    const res = await PUT(saving([OFFERED]), ctx(ID));
    expect(res.status).toBe(200);
    expect(getTagsForItems).toHaveBeenCalledTimes(2);
    expect((await res.json()).item.occasions).toEqual([anniversaryAt(STORED)]);
  });
  it("answers what it worked out, and logs, when reading the tags again fails", async () => {
    tagItemForMyOccasion.mockResolvedValue({ error: "You've already tagged this item for that occasion" });
    let reads = 0;
    getTagsForItems.mockImplementation(async (ids: string[]) =>
      (reads++ === 0 ? tagsFor({ [ID]: [STORED_ROW] }, ids) : { error: "Failed to load tags. Please try again." }));
    const res = await PUT(saving([OFFERED]), ctx(ID));
    expect(res.status).toBe(200);
    expect(await keysOf(res)).toEqual([OFFERED]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`reading ${ID}'s tags again`), expect.anything());
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
