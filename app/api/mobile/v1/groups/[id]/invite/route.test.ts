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

const { GET } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { groupMocks } = await import("@/lib/mobile/test-groups");
const { IDS } = await import("@/lib/mobile/test-shopping");

const get = (id: string) => bearer(`http://localhost/api/mobile/v1/groups/${id}/invite`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const OTHER = "0f1e2d3c-4b5a-4968-8776-655443322110";

beforeEach(() => {
  holder.current = groupMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/groups/[id]/invite", () => {
  it("answers the invite fixture to a member", async () => {
    const upper = IDS.rivera.toUpperCase();
    const res = await GET(get(upper), ctx(upper));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("invite"));
    expect(holder.current.inviteCodeOf.mock.calls).toEqual([[IDS.rivera]]);
  });

  it("answers 404 when the group cannot be read, and for an id that is not a UUID without asking", async () => {
    const res = await GET(get(OTHER), ctx(OTHER));
    expect([res.status, (await res.json()).error.code]).toEqual([404, "not_found"]);
    expect(holder.current.inviteCodeOf).toHaveBeenCalledWith(OTHER);
    holder.current.inviteCodeOf.mockClear();
    expect((await GET(get("x"), ctx("x"))).status).toBe(404);
    expect(holder.current.inviteCodeOf).not.toHaveBeenCalled();
  });

  it("answers 500, not the database's words, when the code cannot be read", async () => {
    holder.current.inviteCodeOf.mockRejectedValue(new Error("inviteCodeOf failed: boom"));
    const res = await GET(get(IDS.rivera), ctx(IDS.rivera));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/boom|inviteCodeOf/);
  });
});
