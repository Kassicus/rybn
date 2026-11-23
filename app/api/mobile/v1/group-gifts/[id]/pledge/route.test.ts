import { describe, it, expect, vi, beforeEach } from "vitest";
import { GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupGiftMocks } from "@/lib/mobile/test-group-gifts";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupGiftMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/gifts", () => ({
  getGroupGiftById: (...a: unknown[]) => holder.current.getGroupGiftById(...a),
  updateMyContribution: (...a: unknown[]) => holder.current.updateMyContribution(...a),
}));

const { PUT } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { GIFT_IDS, groupGiftMocks } = await import("@/lib/mobile/test-group-gifts");

const url = (id: string) => `http://localhost/api/mobile/v1/group-gifts/${id}/pledge`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (body: unknown, id: string = GIFT_IDS.weekend) =>
  bearer(url(id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  holder.current = groupGiftMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT /api/mobile/v1/group-gifts/{id}/pledge", () => {
  it("answers 401 without a bearer, saving nothing", async () => {
    const res = await PUT(
      new Request(url(GIFT_IDS.weekend), { method: "PUT", body: JSON.stringify(fixture("pledge-request")) }),
      ctx(GIFT_IDS.weekend),
    );
    expect(res.status).toBe(401);
    expect(holder.current.updateMyContribution).not.toHaveBeenCalled();
  });

  it("saves the request fixture and answers the gift", async () => {
    const res = await PUT(put(fixture("pledge-request"), GIFT_IDS.weekend.toUpperCase()), ctx(GIFT_IDS.weekend.toUpperCase()));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-gift"));
    expect(holder.current.updateMyContribution.mock.calls).toEqual([
      [GIFT_IDS.weekend, { contribution_amount: 120, has_paid: false }],
    ]);
    expect(holder.current.getGroupGiftById.mock.calls).toEqual([[GIFT_IDS.weekend]]);
  });

  it("takes 0, the largest amount and a paid pledge", async () => {
    for (const body of [{ amount: 0, paid: true }, { amount: 1000000, paid: true }, { amount: 80.5, paid: false }]) {
      expect((await PUT(put(body), ctx(GIFT_IDS.weekend))).status).toBe(200);
    }
    expect(holder.current.updateMyContribution.mock.calls.map((c) => c[1])).toEqual([
      { contribution_amount: 0, has_paid: true },
      { contribution_amount: 1000000, has_paid: true },
      { contribution_amount: 80.5, has_paid: false },
    ]);
  });

  it("sends the action nothing from the body but the two checked fields", async () => {
    await PUT(put({ ...fixture("pledge-request"), user_id: "user_2momABC", group_gift_id: "x" }), ctx(GIFT_IDS.weekend));
    expect(Object.keys(holder.current.updateMyContribution.mock.calls[0][1]).sort()).toEqual(["contribution_amount", "has_paid"]);
  });

  it("answers the amount sentence for each bad amount", async () => {
    const { amount: _a, ...noAmount } = fixture("pledge-request");
    void _a;
    for (const body of [
      { ...fixture("pledge-request"), amount: -5 },
      { ...fixture("pledge-request"), amount: 1000000.01 },
      { ...fixture("pledge-request"), amount: "80" },
      { ...fixture("pledge-request"), amount: null },
      noAmount,
    ]) {
      const res = await PUT(put(body), ctx(GIFT_IDS.weekend));
      expect([res.status, (await res.json()).error]).toEqual([
        422,
        { code: "invalid", message: "Enter an amount from 0 to 1,000,000." },
      ]);
    }
    expect(holder.current.updateMyContribution).not.toHaveBeenCalled();
  });

  it("answers That request wasn't valid. when paid is not a boolean", async () => {
    const { paid: _p, ...noPaid } = fixture("pledge-request");
    void _p;
    for (const body of [{ ...fixture("pledge-request"), paid: "yes" }, { ...fixture("pledge-request"), paid: null }, noPaid, [], "x"]) {
      const res = await PUT(put(body), ctx(GIFT_IDS.weekend));
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "That request wasn't valid." }]);
    }
    expect(holder.current.updateMyContribution).not.toHaveBeenCalled();
  });

  it("answers 404 for someone the gift is for, saying nothing more, and an id that is not a UUID asks nothing", async () => {
    holder.current.updateMyContribution.mockResolvedValue({ error: GIFT_SENTENCES.notThere });
    const res = await PUT(put(fixture("pledge-request")), ctx(GIFT_IDS.weekend));
    expect([res.status, (await res.json()).error]).toEqual([404, { code: "not_found", message: "That isn't there any more." }]);
    expect(holder.current.getGroupGiftById).not.toHaveBeenCalled();

    holder.current.updateMyContribution.mockClear();
    const bad = await PUT(put(fixture("pledge-request"), "x"), ctx("x"));
    expect(bad.status).toBe(404);
    expect(holder.current.updateMyContribution).not.toHaveBeenCalled();
  });

  it("answers 401 when the action says nobody is signed in", async () => {
    holder.current.updateMyContribution.mockResolvedValue({ error: "Not authenticated" });
    expect((await PUT(put(fixture("pledge-request")), ctx(GIFT_IDS.weekend))).status).toBe(401);
  });

  it("answers 500 without the database's words for anything else", async () => {
    holder.current.updateMyContribution.mockResolvedValue({ error: "connection reset" });
    const res = await PUT(put(fixture("pledge-request")), ctx(GIFT_IDS.weekend));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("connection");
  });
});
