import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import { KEYS, tagging } from "@/lib/mobile/test-wishlist";

const ensureProfile = vi.fn();
const getUpcomingOccasions = vi.fn();
const tagWrite = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/actions/occasions", () => ({ getUpcomingOccasions: (...a: unknown[]) => getUpcomingOccasions(...a) }));
vi.mock("@/lib/actions/item-occasions", () => ({
  getTagsForItems: (...a: unknown[]) => tagWrite("getTagsForItems", ...a),
  tagItemForMyOccasion: (...a: unknown[]) => tagWrite("tagItemForMyOccasion", ...a),
  tagItemForGroupDate: (...a: unknown[]) => tagWrite("tagItemForGroupDate", ...a),
  untagItem: (...a: unknown[]) => tagWrite("untagItem", ...a),
}));
vi.mock("@/lib/actions/wishlist", () => ({}));
vi.mock("@/lib/actions/groups", () => ({}));
vi.mock("@/lib/actions/profile", () => ({}));
vi.mock("@/lib/supabase/signed-image", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("no database in tests");
  },
}));

const { GET } = await import("./route");

const url = "http://localhost/api/mobile/v1/wishlist/occasions";
const get = (headers: Record<string, string> = { authorization: "Bearer test-token" }) => new Request(url, { headers });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  ensureProfile.mockResolvedValue("user_2abcDEF");
  getUpcomingOccasions.mockResolvedValue({ data: tagging().upcoming });
});

describe("GET /api/mobile/v1/wishlist/occasions", () => {
  it("answers the dates the caller may tag an item for, in the fixture's shape, never cached", async () => {
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(fixture("wishlist-occasions"));
    expect(getUpcomingOccasions).toHaveBeenCalledWith(365);
  });
  it("titles the caller's own birthday 'Your birthday'", async () => {
    const { occasions } = await (await GET(get(), ctx)).json();
    expect(occasions.find((o: { key: string }) => o.key === KEYS.samBirthday).title).toBe("Your birthday");
  });
  it("offers a group date with its name and its group", async () => {
    const { occasions } = await (await GET(get(), ctx)).json();
    expect(occasions.find((o: { key: string }) => o.key === KEYS.xmas)).toMatchObject(
      { kind: "group_date", title: "Christmas 2026", group: { id: "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e", name: "Rivera Family" } });
  });
  it("never offers someone else's birthday", async () => {
    const text = await (await GET(get(), ctx)).text();
    expect(text).not.toMatch(/user_2momABC|user_2prySHA|Mom|Priya/);
  });
  it("writes nothing", async () => {
    await GET(get(), ctx);
    expect(tagWrite).not.toHaveBeenCalled();
  });
  it("answers 401 without a bearer, asking nothing", async () => {
    const res = await GET(get({}), ctx);
    expect(res.status).toBe(401);
    expect(getUpcomingOccasions).not.toHaveBeenCalled();
  });
  it("answers 401 when the action says nobody is signed in", async () => {
    getUpcomingOccasions.mockResolvedValue({ error: "Not authenticated" });
    expect((await GET(get(), ctx)).status).toBe(401);
  });
  it("answers 500 without the database's words when the dates cannot be read", async () => {
    getUpcomingOccasions.mockResolvedValue({ error: "Failed to load upcoming occasions." });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed to load/);
  });
});
