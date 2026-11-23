import { describe, it, expect, vi, beforeEach } from "vitest";
import { GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupGiftMocks } from "@/lib/mobile/test-group-gifts";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupGiftMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/gifts", () => ({
  getGroupGiftById: (...a: unknown[]) => holder.current.getGroupGiftById(...a),
  deleteGroupGift: (...a: unknown[]) => holder.current.deleteGroupGift(...a),
}));

const { GET, DELETE } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { GIFT_IDS, groupGiftMocks } = await import("@/lib/mobile/test-group-gifts");

const url = (id: string) => `http://localhost/api/mobile/v1/group-gifts/${id}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const gone = { error: GIFT_SENTENCES.notThere };

beforeEach(() => {
  holder.current = groupGiftMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/group-gifts/{id}", () => {
  it("answers the gift fixture, reading an upper-case id as the same gift", async () => {
    const res = await GET(bearer(url(GIFT_IDS.weekend.toUpperCase())), ctx(GIFT_IDS.weekend.toUpperCase()));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-gift"));
    expect(holder.current.getGroupGiftById.mock.calls).toEqual([[GIFT_IDS.weekend]]);
  });

  it("answers the same 404 for a gift the caller is not in, one they are named on, one that is gone, and an id that is not a UUID", async () => {
    holder.current.getGroupGiftById.mockResolvedValue(gone);
    const bodies: string[] = [];
    for (const id of [GIFT_IDS.teacher, GIFT_IDS.coach, "9d9d9d9d-0000-4000-8000-000000000000", "x"]) {
      const res = await GET(bearer(url(id)), ctx(id));
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    // "x" asks nothing; the other three each ask once.
    expect(holder.current.getGroupGiftById).toHaveBeenCalledTimes(3);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toEqual({ error: { code: "not_found", message: "That isn't there any more." } });
  });

  it("answers 401 without a bearer, on both methods", async () => {
    const get = await GET(new Request(url(GIFT_IDS.weekend)), ctx(GIFT_IDS.weekend));
    const del = await DELETE(new Request(url(GIFT_IDS.weekend), { method: "DELETE" }), ctx(GIFT_IDS.weekend));
    expect([get.status, del.status]).toEqual([401, 401]);
    expect(holder.current.getGroupGiftById).not.toHaveBeenCalled();
    expect(holder.current.deleteGroupGift).not.toHaveBeenCalled();
  });

  it("answers 500 without the database's words when the read fails", async () => {
    holder.current.getGroupGiftById.mockResolvedValue({ error: "connection reset" });
    const res = await GET(bearer(url(GIFT_IDS.weekend)), ctx(GIFT_IDS.weekend));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("connection");
  });
});

describe("DELETE /api/mobile/v1/group-gifts/{id}", () => {
  const del = (id: string) => bearer(url(id), { method: "DELETE" });

  it("deletes the gift and answers 204 with no body", async () => {
    const res = await DELETE(del(GIFT_IDS.weekend.toUpperCase()), ctx(GIFT_IDS.weekend.toUpperCase()));
    expect([res.status, await res.text()]).toEqual([204, ""]);
    expect(holder.current.deleteGroupGift.mock.calls).toEqual([[GIFT_IDS.weekend]]);
  });

  it("answers 422 Only the creator can delete this group gift to another member", async () => {
    holder.current.deleteGroupGift.mockResolvedValue({ error: GIFT_SENTENCES.onlyMakerDeletes });
    const res = await DELETE(del(GIFT_IDS.weekend), ctx(GIFT_IDS.weekend));
    expect([res.status, (await res.json()).error]).toEqual([
      422,
      { code: "invalid", message: "Only the creator can delete this group gift" },
    ]);
  });

  it("answers the same 404 for a gift the caller is not in, one they are named on, one that is gone, and an id that is not a UUID", async () => {
    holder.current.deleteGroupGift.mockResolvedValue(gone);
    const bodies: string[] = [];
    for (const id of [GIFT_IDS.teacher, GIFT_IDS.coach, "9d9d9d9d-0000-4000-8000-000000000000", "x"]) {
      const res = await DELETE(del(id), ctx(id));
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(holder.current.deleteGroupGift).toHaveBeenCalledTimes(3);
    expect(new Set(bodies).size).toBe(1);
  });

  it("answers 500 without the database's words for any other error", async () => {
    holder.current.deleteGroupGift.mockResolvedValue({ error: "foreign key violation" });
    const res = await DELETE(del(GIFT_IDS.weekend), ctx(GIFT_IDS.weekend));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("foreign");
  });
});
