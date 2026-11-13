import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { ProfileMocks } from "@/lib/mobile/test-profile";

const holder = vi.hoisted(() => ({ current: undefined as unknown as ProfileMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/profile", () => ({
  getMyProfile: (...a: unknown[]) => holder.current.getMyProfile(...a),
  updateProfile: (...a: unknown[]) => holder.current.updateProfile(...a),
  getSharedGroups: (...a: unknown[]) => holder.current.getSharedGroups(...a),
}));
vi.mock("@/lib/actions/settings", () => ({
  getMySettings: (...a: unknown[]) => holder.current.getMySettings(...a),
  updatePrivacySettings: (...a: unknown[]) => holder.current.updatePrivacySettings(...a),
}));
vi.mock("@/lib/mobile/profile-reads", () => ({
  personProfileRows: (...a: unknown[]) => holder.current.personProfileRows(...a),
}));

const { PUT } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { profileMocks } = await import("@/lib/mobile/test-profile");

const url = "http://localhost/api/mobile/v1/profile/visibility";
const ctx = { params: Promise.resolve({}) };
const put = (body: unknown) =>
  bearer(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const SENTENCE = "Choose which kinds of group can see your details.";

beforeEach(() => {
  holder.current = profileMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT /api/mobile/v1/profile/visibility", () => {
  it("answers 401 without a bearer, storing nothing", async () => {
    const res = await PUT(new Request(url, { method: "PUT", body: JSON.stringify(fixture("visibility-request")) }), ctx);
    expect(res.status).toBe(401);
    expect(holder.current.updatePrivacySettings).not.toHaveBeenCalled();
  });

  it("stores the choice and answers the visibility fixture", async () => {
    const res = await PUT(put(fixture("visibility-request")), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("visibility"));
    expect(holder.current.updatePrivacySettings.mock.calls).toEqual([[{ visible_to_group_types: ["family"] }]]);
  });

  it("stores the kinds in order, once each, and none for only you", async () => {
    const res = await PUT(put({ visibleTo: ["work", "family", "work"] }), ctx);
    expect(await res.json()).toEqual({ visibleTo: ["family", "work"] });
    const none = await PUT(put({ visibleTo: [] }), ctx);
    expect(await none.json()).toEqual({ visibleTo: [] });
    expect(holder.current.updatePrivacySettings.mock.calls)
      .toEqual([[{ visible_to_group_types: ["family", "work"] }], [{ visible_to_group_types: [] }]]);
  });

  it("takes nothing else from the body", async () => {
    await PUT(put({ visibleTo: ["family"], user_id: "user_2momABC", restrictToGroup: "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e" }), ctx);
    expect(holder.current.updatePrivacySettings.mock.calls).toEqual([[{ visible_to_group_types: ["family"] }]]);
  });

  it.each([{ visibleTo: ["club"] }, { visibleTo: "family" }, {}])("refuses %j with the sentence, storing nothing", async (body) => {
    const res = await PUT(put(body), ctx);
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: SENTENCE }]);
    expect(holder.current.updatePrivacySettings).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an object, or none, with the sentence, storing nothing", async () => {
    for (const request of [put([]), put(null), put(["family"]), bearer(url, { method: "PUT" })]) {
      const res = await PUT(request, ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: SENTENCE }]);
    }
    expect(holder.current.updatePrivacySettings).not.toHaveBeenCalled();
  });

  it("answers 401 when nobody is signed in, 422 for the action's refusal, and 500 when it fails", async () => {
    holder.current.updatePrivacySettings.mockResolvedValue({ data: null, error: "Not authenticated" });
    expect((await PUT(put(fixture("visibility-request")), ctx)).status).toBe(401);

    holder.current.updatePrivacySettings.mockResolvedValue({ data: null, error: SENTENCE });
    const refused = await PUT(put(fixture("visibility-request")), ctx);
    expect([refused.status, (await refused.json()).error]).toEqual([422, { code: "invalid", message: SENTENCE }]);

    holder.current.updatePrivacySettings.mockResolvedValue({ data: null, error: "Failed to update privacy settings" });
    const failed = await PUT(put(fixture("visibility-request")), ctx);
    expect([failed.status, (await failed.json()).error]).toEqual([500, { code: "server_error", message: "Something went wrong. Please try again." }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/profile/visibility"), expect.anything());
  });
});
