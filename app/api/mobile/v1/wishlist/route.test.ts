import { describe, it, expect, vi, beforeEach } from "vitest";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import { fixture, groupRows, rowFor } from "@/lib/mobile/test-fixtures";
import { IDS } from "@/lib/mobile/test-shopping";
import { KEYS, TAG_IDS, tagging, tagsFor } from "@/lib/mobile/test-wishlist";
import { formDataFromBody } from "@/lib/mobile/wishlist";

const ensureProfile = vi.fn();
const getMyWishlist = vi.fn();
const createWishlistItem = vi.fn();
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
  getMyWishlist: () => getMyWishlist(),
  createWishlistItem: (form: unknown) => createWishlistItem(form),
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

const { GET, POST } = await import("./route");

const headers = { authorization: "Bearer test-token" };
const get = () => new Request("http://localhost/api/mobile/v1/wishlist", { headers });
const post = (body: unknown) =>
  new Request("http://localhost/api/mobile/v1/wishlist", { method: "POST", headers, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) };
const tagWrites = () => [...tagItemForMyOccasion.mock.calls, ...tagItemForGroupDate.mock.calls, ...untagItem.mock.calls];

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

describe("GET /api/mobile/v1/wishlist", () => {
  const mocks = () => {
    getMyWishlist.mockResolvedValue({ data: fixture("wishlist").items.map(rowFor) });
    getMyGroups.mockResolvedValue({ data: groupRows() });
  };
  it("lists each item's occasions, a passed one read from its row, and reads only that row", async () => {
    mocks();
    const { items } = await (await GET(get(), ctx)).json();
    expect(items.find((i: { id: string }) => i.id === TAG_IDS.tree).occasions).toEqual([{ key: KEYS.xmas2025, kind: "group_date",
      title: "Christmas 2025", date: "2025-12-25", group: { id: IDS.rivera, name: "Rivera Family" } }]);
    expect(items.find((i: { id: string }) => i.id === TAG_IDS.socks).occasions).toEqual([]);
    expect(getTagsForItems).toHaveBeenCalledWith(fixture("wishlist").items.map((i: { id: string }) => i.id));
    expect(occasionRows).toHaveBeenCalledWith([TAG_IDS.xmas2025]);
    expect(tagWrites()).toEqual([]);
  });
  it("answers 500 without the database's words when the tags cannot be read, rather than say an item has none", async () => {
    mocks();
    getTagsForItems.mockResolvedValue({ error: "Failed to load tags. Please try again." });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed to load/);
  });
  describe("reads the dates only when a tag needs describing", () => {
    it("an empty list reads neither tags nor dates", async () => {
      getMyWishlist.mockResolvedValue({ data: [] });
      getMyGroups.mockResolvedValue({ data: groupRows() });
      const res = await GET(get(), ctx);
      expect(await res.json()).toEqual({ items: [] });
      expect(getTagsForItems).not.toHaveBeenCalled();
      expect(getUpcomingOccasions).not.toHaveBeenCalled();
    });
    it("a list whose items carry no tag reads the tags and not the dates, even when the dates could not be read", async () => {
      mocks();
      getTagsForItems.mockImplementation(async (ids: string[]) => tagsFor({}, ids));
      getUpcomingOccasions.mockResolvedValue({ error: "Failed to load upcoming occasions." });
      const res = await GET(get(), ctx);
      expect(res.status).toBe(200);
      const { items } = await res.json();
      expect(items.map((i: { occasions: unknown[] }) => i.occasions)).toEqual([[], [], [], []]);
      expect(getTagsForItems).toHaveBeenCalled();
      expect(getUpcomingOccasions).not.toHaveBeenCalled();
    });
    it("a list with a tagged item reads both, and titles its tag as the choice does, not as a stale row would", async () => {
      mocks();
      // The stored row of Sam's birthday still has the date from before he corrected it; the choice has the new one.
      occasionRows.mockImplementation(async (ids: string[]) => [...tagging().occasionRows]
        .map((r) => (r.id === TAG_IDS.samBirthday ? { ...r, occasion_date: "2026-11-28" } : r))
        .filter((r) => ids.includes(r.id)));
      const { items } = await (await GET(get(), ctx)).json();
      expect(getUpcomingOccasions).toHaveBeenCalled();
      expect(items.find((i: { id: string }) => i.id === TAG_IDS.tumbler).occasions[0]).toEqual(
        { key: KEYS.samBirthday, kind: "birthday", title: "Your birthday", date: "2026-11-30", group: null });
    });
  });
  describe("a long list", () => {
    const idFor = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const long = () => {
      const socks = fixture("wishlist").items.find((i: { id: string }) => i.id === TAG_IDS.socks);
      getMyWishlist.mockResolvedValue({ data: Array.from({ length: 250 }, (_, i) => ({ ...rowFor(socks), id: idFor(i) })) });
      getMyGroups.mockResolvedValue({ data: groupRows() });
      const tags = { [idFor(0)]: [IDS.xmas], [idFor(150)]: [IDS.xmas], [idFor(249)]: [IDS.xmas] };
      getTagsForItems.mockImplementation(async (ids: string[]) => tagsFor(tags, ids));
    };
    it("reads its tags in chunks of at most 100 items, and lists them all", async () => {
      long();
      const res = await GET(get(), ctx);
      expect(res.status).toBe(200);
      expect(getTagsForItems.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 50]);
      expect(getTagsForItems.mock.calls.flatMap(([ids]) => ids)).toEqual(Array.from({ length: 250 }, (_, i) => idFor(i)));
      const { items } = await res.json();
      const tagged = items.filter((i: { occasions: unknown[] }) => i.occasions.length > 0).map((i: { id: string }) => i.id);
      expect(tagged).toEqual([idFor(0), idFor(150), idFor(249)]);
    });
    it("answers 500 when any one chunk cannot be read", async () => {
      long();
      const read = getTagsForItems.getMockImplementation()!;
      // Only the chunk that starts at the 101st item fails.
      getTagsForItems.mockImplementation(async (ids: string[]) =>
        (ids[0] === idFor(100) ? { error: "Failed to load tags. Please try again." } : read(ids)));
      const res = await GET(get(), ctx);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toMatch(/Failed to load/);
    });
  });
  it("answers 500 when an item carries a tag and the dates cannot be read", async () => {
    mocks();
    getUpcomingOccasions.mockResolvedValue({ error: "Failed to load upcoming occasions." });
    expect((await GET(get(), ctx)).status).toBe(500);
  });
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
  it("adds the request fixture, tags it for each of its dates, and answers the item", async () => {
    createWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    const res = await POST(post(fixture("wishlist-item-request")), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture("wishlist-item"));
    expect(createWishlistItem).toHaveBeenCalledWith(formDataFromBody(fixture("wishlist-item-request")));
    expect(tagItemForMyOccasion).toHaveBeenCalledWith(TAG_IDS.tumbler, "birthday");
    expect(tagItemForGroupDate).toHaveBeenCalledWith(TAG_IDS.tumbler, IDS.xmas);
    expect(untagItem).not.toHaveBeenCalled();
  });
  it("with no occasions, or null, tags nothing and reads neither tags nor dates: the new item has none", async () => {
    createWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    getUpcomingOccasions.mockResolvedValue({ error: "Failed to load upcoming occasions." });
    const { occasions: _, ...without } = fixture("wishlist-item-request");
    for (const request of [without, { ...without, occasions: null }]) {
      const res = await POST(post(request), ctx);
      expect(res.status).toBe(200);
      expect((await res.json()).item.occasions).toEqual([]);
    }
    expect(tagWrites()).toEqual([]);
    expect(getUpcomingOccasions).not.toHaveBeenCalled();
    expect(getTagsForItems).not.toHaveBeenCalled();
  });
  it("with an empty list of occasions, reads no dates and no tags, and tags nothing", async () => {
    createWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    const res = await POST(post({ ...fixture("wishlist-item-request"), occasions: [] }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).item.occasions).toEqual([]);
    expect(getUpcomingOccasions).not.toHaveBeenCalled();
    expect(getTagsForItems).not.toHaveBeenCalled();
    expect(tagWrites()).toEqual([]);
  });
  it("answers 422 'Choose one of your dates.' for a date that is not one of the caller's, and writes nothing", async () => {
    const res = await POST(post({ ...fixture("wishlist-item-request"), occasions: [KEYS.xmas, "birthday:user_2momABC:2027"] }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toEqual({ code: "invalid", message: "Choose one of your dates." });
    expect(createWishlistItem).not.toHaveBeenCalled();
    expect(tagWrites()).toEqual([]);
  });
  it("answers 422 for a passed date: a new item is tagged for none", async () => {
    const res = await POST(post({ ...fixture("wishlist-item-request"), occasions: [KEYS.xmas2025] }), ctx);
    expect(res.status).toBe(422);
    expect(createWishlistItem).not.toHaveBeenCalled();
  });
  it("still answers the item when a tag cannot be written after it was added, saying what stands, and logs it", async () => {
    createWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    tagItemForGroupDate.mockResolvedValue({ error: "That occasion no longer exists, or is not yours to tag" });
    tagItemForMyOccasion.mockRejectedValue(new Error("fetch failed"));
    const res = await POST(post(fixture("wishlist-item-request")), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).item.occasions).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`tagging ${TAG_IDS.tumbler} for ${KEYS.xmas}`),
      "That occasion no longer exists, or is not yours to tag");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`tagging ${TAG_IDS.tumbler} for ${KEYS.samBirthday}`),
      expect.any(Error));
  });
  it("counts 'already tagged' as done", async () => {
    createWishlistItem.mockResolvedValue({ data: rowFor(fixture("wishlist-item").item) });
    tagItemForGroupDate.mockResolvedValue({ error: "You've already tagged this item for that occasion" });
    const res = await POST(post(fixture("wishlist-item-request")), ctx);
    expect(await res.json()).toEqual(fixture("wishlist-item"));
    expect(console.error).not.toHaveBeenCalled();
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
    expect(tagWrites()).toEqual([]);
    expect((await res.json()).error.message).toBe("Something went wrong. Please try again.");
  });
});
