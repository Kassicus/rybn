import { describe, it, expect, vi, beforeEach } from "vitest";
import { GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupGiftMocks } from "@/lib/mobile/test-group-gifts";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupGiftMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/gifts", () => ({
  getGroupGiftById: (...a: unknown[]) => holder.current.getGroupGiftById(...a),
  getAvailableGroupMembers: (...a: unknown[]) => holder.current.getAvailableGroupMembers(...a),
  addMembersToGroupGift: (...a: unknown[]) => holder.current.addMembersToGroupGift(...a),
}));

const { GET, POST } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { GIFT_IDS, groupGiftMocks, seenWeekendWithGran } = await import("@/lib/mobile/test-group-gifts");

const url = (id: string) => `http://localhost/api/mobile/v1/group-gifts/${id}/people`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id: string = GIFT_IDS.weekend) =>
  bearer(url(id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const message = async (res: Response) => [res.status, (await res.json()).error] as const;

beforeEach(() => {
  holder.current = groupGiftMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/group-gifts/{id}/people", () => {
  it("answers who can be added, by name", async () => {
    const { getAvailableGroupMembers } = holder.current;
    // The action answers in no particular order; the route sorts by name.
    const rows = (await getAvailableGroupMembers()).data.reverse();
    getAvailableGroupMembers.mockResolvedValue({ data: rows });
    getAvailableGroupMembers.mockClear();
    const res = await GET(bearer(url(GIFT_IDS.weekend.toUpperCase())), ctx(GIFT_IDS.weekend.toUpperCase()));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-gift-people"));
    expect(getAvailableGroupMembers.mock.calls).toEqual([[GIFT_IDS.weekend]]);
  });

  it("answers 401 without a bearer", async () => {
    expect((await GET(new Request(url(GIFT_IDS.weekend)), ctx(GIFT_IDS.weekend))).status).toBe(401);
    expect(holder.current.getAvailableGroupMembers).not.toHaveBeenCalled();
  });

  it("answers 422 to a member who did not make the gift", async () => {
    holder.current.getAvailableGroupMembers.mockResolvedValue({ error: GIFT_SENTENCES.onlyMakerAdds });
    expect(await message(await GET(bearer(url(GIFT_IDS.weekend)), ctx(GIFT_IDS.weekend)))).toEqual([
      422,
      { code: "invalid", message: "Only the person who made this group gift can add people." },
    ]);
  });

  it("answers the same 404 for a gift that is not there and an id that is not a UUID", async () => {
    holder.current.getAvailableGroupMembers.mockResolvedValue({ error: GIFT_SENTENCES.notThere });
    const gone = await GET(bearer(url(GIFT_IDS.coach)), ctx(GIFT_IDS.coach));
    const notUuid = await GET(bearer(url("x")), ctx("x"));
    expect([gone.status, notUuid.status]).toEqual([404, 404]);
    expect(await gone.text()).toBe(await notUuid.text());
    expect(holder.current.getAvailableGroupMembers).toHaveBeenCalledTimes(1);
  });

  it("answers 500 without the database's words for any other error", async () => {
    holder.current.getAvailableGroupMembers.mockResolvedValue({ error: "connection reset" });
    const res = await GET(bearer(url(GIFT_IDS.weekend)), ctx(GIFT_IDS.weekend));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("connection");
  });
});

describe("POST /api/mobile/v1/group-gifts/{id}/people", () => {
  it("answers 401 without a bearer, adding nobody", async () => {
    const res = await POST(
      new Request(url(GIFT_IDS.weekend), { method: "POST", body: JSON.stringify(fixture("add-people-request")) }),
      ctx(GIFT_IDS.weekend),
    );
    expect(res.status).toBe(401);
    expect(holder.current.addMembersToGroupGift).not.toHaveBeenCalled();
  });

  it("adds the request fixture's people and answers the gift", async () => {
    holder.current.getGroupGiftById.mockResolvedValue({ data: seenWeekendWithGran() });
    const res = await POST(post(fixture("add-people-request"), GIFT_IDS.weekend.toUpperCase()), ctx(GIFT_IDS.weekend.toUpperCase()));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-gift-added"));
    expect(holder.current.addMembersToGroupGift.mock.calls).toEqual([[GIFT_IDS.weekend, ["user_2grnABC"]]]);
    expect(holder.current.getGroupGiftById.mock.calls).toEqual([[GIFT_IDS.weekend]]);
  });

  it("adds nobody and answers one sentence for a named person", async () => {
    holder.current.addMembersToGroupGift.mockResolvedValue({ error: GIFT_SENTENCES.cannotAdd });
    const res = await POST(post({ ids: ["user_2grnABC", "user_2momABC"] }), ctx(GIFT_IDS.weekend));
    expect(await message(res)).toEqual([
      422,
      { code: "invalid", message: "One of those people can't be added to this gift." },
    ]);
    expect(holder.current.getGroupGiftById).not.toHaveBeenCalled();
  });

  it("answers 422 to a member who did not make the gift", async () => {
    holder.current.addMembersToGroupGift.mockResolvedValue({ error: GIFT_SENTENCES.onlyMakerAdds });
    expect(await message(await POST(post(fixture("add-people-request")), ctx(GIFT_IDS.weekend)))).toEqual([
      422,
      { code: "invalid", message: "Only the person who made this group gift can add people." },
    ]);
  });

  it("answers 404 for a gift that is not there, and an id that is not a UUID asks nothing", async () => {
    holder.current.addMembersToGroupGift.mockResolvedValue({ error: GIFT_SENTENCES.notThere });
    const gone = await POST(post(fixture("add-people-request")), ctx(GIFT_IDS.weekend));
    const notUuid = await POST(post(fixture("add-people-request"), "x"), ctx("x"));
    expect([gone.status, notUuid.status]).toEqual([404, 404]);
    expect(await gone.text()).toBe(await notUuid.text());
    expect(holder.current.addMembersToGroupGift).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty list, fifty-one ids, and an id that is not a person's", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `user_${i}`);
    for (const ids of [[], [...fifty, "user_50"], ["not an id"], [""], [7]]) {
      expect(await message(await POST(post({ ids }), ctx(GIFT_IDS.weekend)))).toEqual([
        422,
        { code: "invalid", message: "One of those people can't be added to this gift." },
      ]);
    }
    expect(holder.current.addMembersToGroupGift).not.toHaveBeenCalled();
  });

  it("takes fifty ids", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `user_${i}`);
    expect((await POST(post({ ids: fifty }), ctx(GIFT_IDS.weekend))).status).toBe(200);
    expect(holder.current.addMembersToGroupGift.mock.calls[0][1]).toEqual(fifty);
  });

  it("answers the plain sentence for a body of another shape", async () => {
    for (const body of [{}, { ids: "user_2grnABC" }, { ids: null }, [], "x", null]) {
      expect(await message(await POST(post(body), ctx(GIFT_IDS.weekend)))).toEqual([
        422,
        { code: "invalid", message: "That request wasn't valid." },
      ]);
    }
    expect(holder.current.addMembersToGroupGift).not.toHaveBeenCalled();
  });

  it("answers 500 without the database's words when an add meets a duplicate row", async () => {
    holder.current.addMembersToGroupGift.mockResolvedValue({ error: 'duplicate key value violates unique constraint "group_gift_members_pkey"' });
    const res = await POST(post(fixture("add-people-request")), ctx(GIFT_IDS.weekend));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("duplicate");
    expect(holder.current.getGroupGiftById).not.toHaveBeenCalled();
  });
});
