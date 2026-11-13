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

const post = (body: unknown, id: string = IDS.rivera) => bearer(`http://localhost/api/mobile/v1/groups/${id}/invitations`,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string = IDS.rivera) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  holder.current = groupMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/mobile/v1/groups/[id]/invitations", () => {
  it("sends to the body's address with the path's group, and nothing else from the body", async () => {
    const body = { ...fixture("invitation-request"), groupName: "Hacked", groupId: "other", inviterName: "Rybn", token: "x" };
    const upper = IDS.rivera.toUpperCase();
    expect((await POST(post(body, upper), ctx(upper))).status).toBe(200);
    expect(holder.current.sendGroupInvitation.mock.calls).toEqual([[{ groupId: IDS.rivera, email: "gran@example.com" }]]);
  });

  it("answers the invitation fixture from the action's answer", async () => {
    const res = await POST(post(fixture("invitation-request")), ctx());
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(fixture("invitation"));
    expect(Object.keys(JSON.parse(text))).toEqual(["sent", "resent", "message"]);
  });

  it("answers its three fields and nothing else, whatever else an answer holds", async () => {
    // Fields beside the three the route reads, a token among them
    holder.current.sendGroupInvitation.mockResolvedValue({
      emailSent: true, isResend: false,
      data: { id: "a1b2c3d4-0001-4d00-8000-000000000001", email: "gran@example.com", token: "tok_secret", expires_at: "2026-11-19" },
    });
    const text = await (await POST(post(fixture("invitation-request")), ctx())).text();
    expect(JSON.parse(text)).toEqual(fixture("invitation"));
    expect(text).not.toMatch(/tok_secret|token|gran@example\.com|a1b2c3d4|data|expires/);
  });

  it("says when it was sent again, and when the email could not be sent", async () => {
    const sent = await holder.current.sendGroupInvitation({ groupId: IDS.rivera, email: "gran@example.com" });
    holder.current.sendGroupInvitation.mockResolvedValueOnce({ ...sent, isResend: true });
    expect(await (await POST(post(fixture("invitation-request")), ctx())).json())
      .toEqual({ sent: true, resent: true, message: "Invitation resent successfully!" });
    const warning = "The invitation is saved, but we couldn't send the email just now. Try resending it in a moment.";
    holder.current.sendGroupInvitation.mockResolvedValueOnce({ ...sent, emailSent: false, warning });
    const text = await (await POST(post(fixture("invitation-request")), ctx())).text();
    expect(JSON.parse(text)).toEqual({ sent: false, resent: false, message: warning });
    expect(text).not.toMatch(/tok_secret/);
  });

  it("refuses a body with no address with the website's sentence, sending nothing", async () => {
    for (const body of [{}, { email: 7 }, [], null]) {
      const res = await POST(post(body), ctx());
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "Please enter a valid email address" }]);
    }
    expect(holder.current.sendGroupInvitation).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that is not a UUID, sending nothing", async () => {
    expect((await POST(post(fixture("invitation-request"), "x"), ctx("x"))).status).toBe(404);
    expect(holder.current.sendGroupInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ["Rate limit exceeded. You can send up to 10 invitations per hour. Please try again later.", 422],
    ["This user is already a member of the group", 422],
    ["Please enter a valid email address", 422],
    ["You are not a member of this group", 404],
    ["Not authenticated", 401],
    ["Failed to create invitation. Please try again.", 500],
  ])("answers %j as %i", async (message, status) => {
    holder.current.sendGroupInvitation.mockResolvedValue({ error: message });
    const res = await POST(post(fixture("invitation-request")), ctx());
    const text = await res.text();
    expect(res.status).toBe(status);
    if (status === 422) expect(JSON.parse(text).error).toEqual({ code: "invalid", message });
    else expect(text).not.toContain(message);
  });
});
