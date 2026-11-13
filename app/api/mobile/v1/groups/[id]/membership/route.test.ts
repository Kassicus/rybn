import { describe, it, expect, vi, beforeEach } from "vitest";
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

const { DELETE } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { groupMocks } = await import("@/lib/mobile/test-groups");
const { IDS } = await import("@/lib/mobile/test-shopping");

const del = (id: string) => bearer(`http://localhost/api/mobile/v1/groups/${id}/membership`, { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  holder.current = groupMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("DELETE /api/mobile/v1/groups/[id]/membership", () => {
  it("leaves and answers 204", async () => {
    const upper = IDS.rivera.toUpperCase();
    const res = await DELETE(del(upper), ctx(upper));
    expect([res.status, res.headers.get("cache-control"), await res.text()]).toEqual([204, "no-store", ""]);
    expect(holder.current.leaveGroup.mock.calls).toEqual([[IDS.rivera]]);
  });

  it("answers the owner's refusal as 422 with the website's sentence", async () => {
    const message = "Owners cannot leave the group. Transfer ownership or delete the group.";
    holder.current.leaveGroup.mockResolvedValue({ error: message });
    const res = await DELETE(del(IDS.rivera), ctx(IDS.rivera));
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
  });

  it("answers 404 for a group the caller is not in, and for an id that is not a UUID", async () => {
    holder.current.leaveGroup.mockResolvedValue({ error: "You are not a member of this group" });
    expect((await DELETE(del(IDS.rivera), ctx(IDS.rivera))).status).toBe(404);
    holder.current.leaveGroup.mockClear();
    expect((await DELETE(del("x"), ctx("x"))).status).toBe(404);
    expect(holder.current.leaveGroup).not.toHaveBeenCalled();
  });

  it("answers 401 when nobody is signed in, and 500 without the website's words for anything else", async () => {
    holder.current.leaveGroup.mockResolvedValueOnce({ error: "Not authenticated" });
    expect((await DELETE(del(IDS.rivera), ctx(IDS.rivera))).status).toBe(401);
    holder.current.leaveGroup.mockResolvedValueOnce({ error: "Failed to rotate the group's invite code. Please try again." });
    const res = await DELETE(del(IDS.rivera), ctx(IDS.rivera));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/rotate|invite/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/membership"), expect.anything());
  });
});
