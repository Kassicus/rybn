import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupMocks } from "@/lib/mobile/test-groups";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/groups", () => ({
  createGroup: (...a: unknown[]) => holder.current.createGroup(...a),
  leaveGroup: (...a: unknown[]) => holder.current.leaveGroup(...a),
  deleteGroup: (...a: unknown[]) => holder.current.deleteGroup(...a),
}));
vi.mock("@/lib/actions/invitations", () => ({
  joinGroupByCode: (...a: unknown[]) => holder.current.joinGroupByCode(...a),
  sendGroupInvitation: (...a: unknown[]) => holder.current.sendGroupInvitation(...a),
}));
vi.mock("@/lib/mobile/group-reads", () => ({
  groupSummary: (...a: unknown[]) => holder.current.groupSummary(...a),
  callerRole: (...a: unknown[]) => holder.current.callerRole(...a),
  inviteCodeOf: (...a: unknown[]) => holder.current.inviteCodeOf(...a),
  groupNameOf: (...a: unknown[]) => holder.current.groupNameOf(...a),
}));

const { POST } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { groupMocks } = await import("@/lib/mobile/test-groups");
const { IDS } = await import("@/lib/mobile/test-shopping");

const post = (body: unknown) => bearer("http://localhost/api/mobile/v1/groups/join",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) };
const rivera = () => fixture("group-list").groups.find((g: { id: string }) => g.id === IDS.rivera);

beforeEach(() => {
  holder.current = groupMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/mobile/v1/groups/join", () => {
  it("answers 401 without a bearer, joining nothing", async () => {
    const res = await POST(new Request("http://localhost/api/mobile/v1/groups/join",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixture("join-request")) }), ctx);
    expect(res.status).toBe(401);
    expect(holder.current.joinGroupByCode).not.toHaveBeenCalled();
    expect(holder.current.groupSummary).not.toHaveBeenCalled();
  });

  it("joins and answers the group's summary", async () => {
    const res = await POST(post(fixture("join-request")), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(holder.current.joinGroupByCode).toHaveBeenCalledWith("K7P-MXR-4TQ");
    expect(holder.current.groupSummary).toHaveBeenCalledWith(IDS.rivera);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ group: rivera() });
    expect(text).not.toMatch(/K7P|invite|code/i);
  });

  it("passes the code as the app sent it", async () => {
    await POST(post({ code: "k7p mxr 4tq", group: IDS.bookClub, userId: "user_2prySHA" }), ctx);
    expect(holder.current.joinGroupByCode.mock.calls).toEqual([["k7p mxr 4tq"]]);
  });

  it("refuses a body with no code as the website refuses a bad one, joining nothing", async () => {
    for (const body of [{}, { code: 7 }, [], null]) {
      const res = await POST(post(body), ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "Invalid invite code" }]);
    }
    expect(holder.current.joinGroupByCode).not.toHaveBeenCalled();
  });

  it("refuses a code longer than 64 characters as a bad code, before the action", async () => {
    const res = await POST(post({ code: "K7P-MXR-4TQ ".repeat(6) }), ctx);
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "Invalid invite code" }]);
    expect(holder.current.joinGroupByCode).not.toHaveBeenCalled();
  });

  it.each(["Invalid invite code", "You are already a member of this group", "Your account is still being set up. Please try again."])(
    "answers %j as 422", async (message) => {
      holder.current.joinGroupByCode.mockResolvedValue({ error: message });
      const res = await POST(post(fixture("join-request")), ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
      expect(holder.current.groupSummary).not.toHaveBeenCalled();
    });

  it("answers 401 when nobody is signed in, and 500 for anything else", async () => {
    holder.current.joinGroupByCode.mockResolvedValueOnce({ error: "Not authenticated" });
    expect((await POST(post(fixture("join-request")), ctx)).status).toBe(401);
    holder.current.joinGroupByCode.mockResolvedValueOnce({ error: "Failed to join group. Please try again." });
    const res = await POST(post(fixture("join-request")), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed to join|group/i);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/groups/join"), expect.anything());
  });

  it("answers 500 when the group joined cannot be read", async () => {
    holder.current.groupSummary.mockResolvedValue(null);
    expect((await POST(post(fixture("join-request")), ctx)).status).toBe(500);
  });
});
