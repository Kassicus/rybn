import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture, groupRows } from "@/lib/mobile/test-fixtures";

const ensureProfile = vi.fn();
const getMyGroups = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/actions/wishlist", () => ({
  getMyWishlist: vi.fn(),
  createWishlistItem: vi.fn(),
  updateWishlistItem: vi.fn(),
  getWishlistItem: vi.fn(),
  deleteWishlistItem: vi.fn(),
}));
vi.mock("@/lib/actions/groups", () => ({ getMyGroups: () => getMyGroups() }));

const { GET } = await import("./route");

const get = () => new Request("http://localhost/api/mobile/v1/groups", { headers: { authorization: "Bearer test-token" } });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  ensureProfile.mockResolvedValue("user_2abcDEF");
});

describe("GET /api/mobile/v1/groups", () => {
  it("answers the caller's groups in the fixture's shape, never invite codes", async () => {
    getMyGroups.mockResolvedValue({ data: groupRows() });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(fixture("groups"));
    expect(text).not.toMatch(/SECRET12|invite/);
  });
  it("answers 500 for a database error", async () => {
    getMyGroups.mockResolvedValue({ error: "boom", data: [] });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/boom/);
  });
});
