import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupGiftMocks } from "@/lib/mobile/test-group-gifts";
import { GIFT_SENTENCES } from "@/lib/gifts/sentences";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupGiftMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/messages", () => ({
  getMessages: (...a: unknown[]) => holder.current.getMessages(...a),
  sendMessage: (...a: unknown[]) => holder.current.sendMessage(...a),
}));
vi.mock("@/lib/actions/gifts", () => ({
  createGroupGift: (...a: unknown[]) => holder.current.createGroupGift(...a),
  getMyGroupGifts: (...a: unknown[]) => holder.current.getMyGroupGifts(...a),
  getGroupGiftById: (...a: unknown[]) => holder.current.getGroupGiftById(...a),
  getGroupGiftChoices: (...a: unknown[]) => holder.current.getGroupGiftChoices(...a),
}));

const { GET, POST } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { GIFT_IDS, groupGiftMocks } = await import("@/lib/mobile/test-group-gifts");

const url = "http://localhost/api/mobile/v1/group-gifts";
const ctx = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  bearer(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  holder.current = groupGiftMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/group-gifts", () => {
  it("answers 401 without a bearer, reading nothing", async () => {
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(401);
    expect(holder.current.getMyGroupGifts).not.toHaveBeenCalled();
  });

  it("answers the list fixture", async () => {
    const res = await GET(bearer(url), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-gifts"));
  });

  it("answers an empty list when the caller is in no gift", async () => {
    holder.current.getMyGroupGifts.mockResolvedValue({ data: [] });
    const res = await GET(bearer(url), ctx);
    expect([res.status, await res.json()]).toEqual([200, { groupGifts: [] }]);
  });

  it("answers 401 when the action says nobody is signed in", async () => {
    holder.current.getMyGroupGifts.mockResolvedValue({ data: [], error: "Not authenticated" });
    expect((await GET(bearer(url), ctx)).status).toBe(401);
  });

  it("answers 500 without the database's words when the read fails", async () => {
    holder.current.getMyGroupGifts.mockResolvedValue({ data: [], error: "connection reset" });
    const res = await GET(bearer(url), ctx);
    expect([res.status, (await res.json()).error]).toEqual([500, { code: "server_error", message: "Something went wrong. Please try again." }]);
  });
});

describe("POST /api/mobile/v1/group-gifts", () => {
  it("answers 401 without a bearer, starting nothing", async () => {
    const res = await POST(
      new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixture("group-gift-request")) }),
      ctx,
    );
    expect(res.status).toBe(401);
    expect(holder.current.createGroupGift).not.toHaveBeenCalled();
  });

  it("starts a gift from the request fixture and answers it", async () => {
    const res = await POST(post(fixture("group-gift-request")), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-gift"));
    expect(holder.current.createGroupGift.mock.calls).toEqual([[{
      name: "Anniversary weekend away",
      description: "Two nights at the coast.",
      group_id: "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e",
      recipient_ids: ["user_2dadABC", "user_2momABC"],
      target_amount: 600,
      is_active: true,
    }]]);
    expect(holder.current.getGroupGiftById.mock.calls).toEqual([[GIFT_IDS.weekend]]);
  });

  it("sends the action nothing from the body but the checked fields", async () => {
    const body = { ...fixture("group-gift-request"), isActive: false, is_active: false, created_by: "user_2momABC", id: "x" };
    expect((await POST(post(body), ctx)).status).toBe(200);
    expect(Object.keys(holder.current.createGroupGift.mock.calls[0][0]).sort())
      .toEqual(["description", "group_id", "is_active", "name", "recipient_ids", "target_amount"]);
    expect(holder.current.createGroupGift.mock.calls[0][0].is_active).toBe(true);
  });

  it("answers from the gift as it is read, not from the row the action returns", async () => {
    holder.current.createGroupGift.mockResolvedValue({
      data: { ...(await holder.current.createGroupGift()).data, name: "Wrong", target_user_id: "user_2momABC", email: "x@example.com" },
    });
    expect((await (await POST(post(fixture("group-gift-request")), ctx)).json()).groupGift.name).toBe("Anniversary weekend away");
  });

  it("answers 422 Choose who this gift is for. without calling the action", async () => {
    const { recipientIds: _ids, ...body } = fixture("group-gift-request");
    void _ids;
    const res = await POST(post(body), ctx);
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "Choose who this gift is for." }]);
    expect(holder.current.createGroupGift).not.toHaveBeenCalled();
  });

  it("answers the plain sentence for a body of another shape, without calling the action", async () => {
    for (const body of [[], "x", null]) {
      const res = await POST(post(body), ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "That request wasn't valid." }]);
    }
    const none = await POST(bearer(url, { method: "POST" }), ctx);
    expect(none.status).toBe(422);
    expect(holder.current.createGroupGift).not.toHaveBeenCalled();
  });

  it("passes the action's refusal on as 422", async () => {
    holder.current.createGroupGift.mockResolvedValue({ error: GIFT_SENTENCES.recipientNotAllowed });
    const res = await POST(post(fixture("group-gift-request")), ctx);
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: GIFT_SENTENCES.recipientNotAllowed }]);
    expect(holder.current.getGroupGiftById).not.toHaveBeenCalled();
  });

  it("answers 422 for a group the caller is not in, as the action says it", async () => {
    holder.current.createGroupGift.mockResolvedValue({ error: GIFT_SENTENCES.notInGroup });
    const res = await POST(post(fixture("group-gift-request")), ctx);
    expect([res.status, (await res.json()).error.message]).toEqual([422, GIFT_SENTENCES.notInGroup]);
  });

  it("answers 401 when the action says nobody is signed in", async () => {
    holder.current.createGroupGift.mockResolvedValue({ error: "Not authenticated" });
    expect((await POST(post(fixture("group-gift-request")), ctx)).status).toBe(401);
  });

  it("answers 500 without the database's words for anything else", async () => {
    holder.current.createGroupGift.mockResolvedValue({ error: "connection reset" });
    const res = await POST(post(fixture("group-gift-request")), ctx);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("connection");
    expect(holder.current.getGroupGiftById).not.toHaveBeenCalled();
  });

  it("answers 500 when the gift it has just made cannot be read", async () => {
    holder.current.getGroupGiftById.mockResolvedValue({ error: GIFT_SENTENCES.notThere });
    const res = await POST(post(fixture("group-gift-request")), ctx);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("not found");
  });
});
