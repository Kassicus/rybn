import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupGiftMocks } from "@/lib/mobile/test-group-gifts";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupGiftMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/gifts", () => ({
  createGroupGift: (...a: unknown[]) => holder.current.createGroupGift(...a),
  getMyGroupGifts: (...a: unknown[]) => holder.current.getMyGroupGifts(...a),
  getGroupGiftById: (...a: unknown[]) => holder.current.getGroupGiftById(...a),
  getGroupGiftChoices: (...a: unknown[]) => holder.current.getGroupGiftChoices(...a),
}));

const { GET } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { groupGiftMocks, groupMateRows } = await import("@/lib/mobile/test-group-gifts");

const url = "http://localhost/api/mobile/v1/group-gifts/choices";
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  holder.current = groupGiftMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/group-gifts/choices", () => {
  it("answers the choices fixture", async () => {
    const res = await GET(bearer(url), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-gift-choices"));
  });

  it("answers 401 without a bearer, reading nothing", async () => {
    expect((await GET(new Request(url), ctx)).status).toBe(401);
    expect(holder.current.getGroupGiftChoices).not.toHaveBeenCalled();
  });

  it("answers people by name and no columns beyond a person's", async () => {
    const data = groupMateRows();
    holder.current.getGroupGiftChoices.mockResolvedValue({
      data: { groups: data.groups, people: [...data.people].reverse().map((p) => ({ ...p, email: "x@example.com" })) },
    });
    const text = await (await GET(bearer(url), ctx)).text();
    expect(text).not.toContain("email");
    expect(JSON.parse(text)).toEqual(fixture("group-gift-choices"));
  });

  it("answers no groups and nobody for a caller in no group", async () => {
    holder.current.getGroupGiftChoices.mockResolvedValue({ data: { groups: [], people: [] } });
    expect(await (await GET(bearer(url), ctx)).json()).toEqual({ groups: [], people: [] });
  });

  it("answers 401 when the action says nobody is signed in", async () => {
    holder.current.getGroupGiftChoices.mockResolvedValue({ error: "Not authenticated" });
    expect((await GET(bearer(url), ctx)).status).toBe(401);
  });

  it("answers 500 without the database's words when the read fails", async () => {
    holder.current.getGroupGiftChoices.mockResolvedValue({ error: "connection reset" });
    const res = await GET(bearer(url), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("connection");
  });
});
