import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  acceptInvitation: (...a: unknown[]) => holder.current.acceptInvitation(...a),
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

const ACCEPT = "http://localhost/api/mobile/v1/invitations/accept";
const TOKEN: string = fixture("invitation-accept-request").token;
const INVALID = "This invitation is invalid or has expired";

const post = (body: unknown) => bearer(ACCEPT,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) };
const rivera = () => fixture("group-list").groups.find((g: { id: string }) => g.id === IDS.rivera);

// The token is compared, never printed: the checks below that touch it fail with true or false, or with a count, so
// neither a test's name nor its failure shows the fixture's token.
/** For each call of the action, whether it was handed the fixture's token. */
const sentTheToken = () => holder.current.acceptInvitation.mock.calls.map(([token]) => token === TOKEN);
const accepts = () => holder.current.acceptInvitation.mock.calls.length;

const SPIED = ["error", "warn", "log", "info"] as const;

/** Everything the route wrote to the console: each argument of each call, an Error with its stack and cause. */
function logged(): string {
  return SPIED.flatMap((method) => vi.mocked(console[method]).mock.calls.flat())
    .map((arg: unknown) => arg instanceof Error
      ? `${arg.name} ${arg.message} ${arg.stack} ${String(arg.cause)}`
      : typeof arg === "string" ? arg : JSON.stringify(arg))
    .join(" ");
}

beforeEach(() => {
  holder.current = groupMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  for (const method of SPIED) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/mobile/v1/invitations/accept", () => {
  it("accepts the request fixture's token and answers the group as the join route does", async () => {
    const res = await POST(post(fixture("invitation-accept-request")), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(sentTheToken()).toEqual([true]);
    expect(holder.current.groupSummary).toHaveBeenCalledWith(IDS.rivera);
    expect(await res.json()).toEqual({ group: rivera() });
  });

  it.each([INVALID, "Your account is still being set up. Please try again."])("answers %j as 422", async (message) => {
    holder.current.acceptInvitation.mockResolvedValue({ error: message });
    const res = await POST(post(fixture("invitation-accept-request")), ctx);
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
    expect(holder.current.groupSummary).not.toHaveBeenCalled();
  });

  it("refuses a token that is not 64 characters of 0-9 and a-f before calling the action", async () => {
    for (const token of [TOKEN.toUpperCase(), TOKEN.slice(1), TOKEN + "0", "z".repeat(64), 64]) {
      const res = await POST(post({ token }), ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: INVALID }]);
    }
    expect(accepts()).toBe(0);
  });

  it("never writes the token to a log or an answer, for a refusal and for a throw", async () => {
    const answered = async (body: unknown) => {
      const res = await POST(post(body), ctx);
      const text = await res.text();
      expect(text.toLowerCase().includes(TOKEN)).toBe(false);
      expect(logged().toLowerCase().includes(TOKEN)).toBe(false);
      return res.status;
    };

    // (a) The action refuses it.
    holder.current.acceptInvitation.mockResolvedValueOnce({ error: INVALID });
    expect(await answered({ token: TOKEN })).toBe(422);

    // (b) It is sent upper-cased, and refused at the door.
    expect(await answered({ token: TOKEN.toUpperCase() })).toBe(422);
    expect(sentTheToken()).toEqual([true]);

    // (c) The action throws with the token in its text. The fault is logged, without it.
    const errorsBefore = vi.mocked(console.error).mock.calls.length;
    holder.current.acceptInvitation.mockRejectedValueOnce(new Error(`connect ECONNREFUSED while accepting ${TOKEN}`));
    expect(await answered({ token: TOKEN })).toBe(500);
    expect(vi.mocked(console.error).mock.calls.length).toBeGreaterThan(errorsBefore);
  });

  it("answers 401 when nobody is signed in, and 500 for anything else", async () => {
    holder.current.acceptInvitation.mockResolvedValueOnce({ error: "Not authenticated" });
    expect((await POST(post(fixture("invitation-accept-request")), ctx)).status).toBe(401);
    holder.current.acceptInvitation.mockResolvedValueOnce({ error: "Failed to accept invitation. Please try again." });
    const res = await POST(post(fixture("invitation-accept-request")), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/Failed to accept/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/invitations/accept"), expect.anything());
  });

  it("answers 500 when the group joined cannot be read", async () => {
    holder.current.groupSummary.mockResolvedValue(null);
    expect((await POST(post(fixture("invitation-accept-request")), ctx)).status).toBe(500);
  });

  it("answers 401 without a bearer, accepting nothing", async () => {
    const res = await POST(new Request(ACCEPT,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixture("invitation-accept-request")) }), ctx);
    expect(res.status).toBe(401);
    expect(accepts()).toBe(0);
    expect(holder.current.groupSummary).not.toHaveBeenCalled();
  });
});
