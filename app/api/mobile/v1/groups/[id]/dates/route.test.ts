import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupMocks } from "@/lib/mobile/test-groups";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/occasions", () => ({
  createGroupDate: (...a: unknown[]) => holder.current.createGroupDate(...a),
  updateGroupDate: (...a: unknown[]) => holder.current.updateGroupDate(...a),
  deleteGroupDate: (...a: unknown[]) => holder.current.deleteGroupDate(...a),
}));
vi.mock("@/lib/mobile/group-reads", () => ({
  groupSummary: (...a: unknown[]) => holder.current.groupSummary(...a),
  callerRole: (...a: unknown[]) => holder.current.callerRole(...a),
  inviteCodeOf: (...a: unknown[]) => holder.current.inviteCodeOf(...a),
  groupNameOf: (...a: unknown[]) => holder.current.groupNameOf(...a),
  groupDateRow: (...a: unknown[]) => holder.current.groupDateRow(...a),
}));

const { POST } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { ELSEWHERE, groupMocks } = await import("@/lib/mobile/test-groups");
const { IDS } = await import("@/lib/mobile/test-shopping");

const url = (id: string) => `http://localhost/api/mobile/v1/groups/${id}/dates`;
const post = (body: unknown, id: string = IDS.rivera) =>
  bearer(url(id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string = IDS.rivera) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  holder.current = groupMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/mobile/v1/groups/[id]/dates", () => {
  it("answers 401 without a bearer, adding nothing", async () => {
    const res = await POST(new Request(url(IDS.rivera),
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixture("group-date-request")) }), ctx());
    expect(res.status).toBe(401);
    expect(holder.current.groupNameOf).not.toHaveBeenCalled();
    expect(holder.current.createGroupDate).not.toHaveBeenCalled();
  });

  it("adds the request fixture to the path's group and answers the date fixture", async () => {
    const upper = IDS.rivera.toUpperCase();
    const res = await POST(post(fixture("group-date-request"), upper), ctx(upper));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("group-date"));
    expect(holder.current.createGroupDate.mock.calls)
      .toEqual([[{ groupId: IDS.rivera, name: "Gran's 80th", occasionDate: "2027-03-14" }]]);
    expect(await holder.current.createGroupDate.mock.results[0].value).toEqual({ data: { id: "3f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f" } });
  });

  it("takes the group from the path and nothing else from the body but the name and the date", async () => {
    const body = { ...fixture("group-date-request"), groupId: IDS.bookClub, createdBy: "user_2momABC", kind: "birthday" };
    expect((await POST(post(body), ctx())).status).toBe(200);
    expect(holder.current.createGroupDate.mock.calls)
      .toEqual([[{ groupId: IDS.rivera, name: "Gran's 80th", occasionDate: "2027-03-14" }]]);
  });

  it("passes the name on as sent and answers it as the action stores it, trimmed", async () => {
    const res = await POST(post({ name: "  Gran's 80th ", date: "2027-03-14" }), ctx());
    expect((await res.json()).occasion.title).toBe("Gran's 80th");
    expect(holder.current.createGroupDate.mock.calls[0][0].name).toBe("  Gran's 80th ");
  });

  it("answers a name with hidden characters or a line break as the action stores it, on one line", async () => {
    const res = await POST(post({ name: "Gran's\n80th\u{200B}\u{202E}party", date: "2027-03-14" }), ctx());
    expect((await res.json()).occasion.title).toBe("Gran's 80th party");
    expect(holder.current.createGroupDate.mock.calls[0][0].name).toBe("Gran's\n80th\u{200B}\u{202E}party");
  });

  it.each(["Give this occasion a name", "Keep the name to 200 characters or fewer.", "Please enter a valid date (YYYY-MM-DD)"])(
    "answers %j as 422", async (message) => {
      holder.current.createGroupDate.mockResolvedValue({ error: message });
      const res = await POST(post(fixture("group-date-request")), ctx());
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
    });

  it("refuses a body with no name or no date with the website's sentence, adding nothing", async () => {
    for (const [body, message] of [
      [{ date: "2027-03-14" }, "Give this occasion a name"],
      [{ name: "Gran's 80th", date: 20270314 }, "Please enter a valid date (YYYY-MM-DD)"],
      [[], "That request wasn't valid."],
    ] as const) {
      const res = await POST(post(body), ctx());
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
    }
    expect(holder.current.createGroupDate).not.toHaveBeenCalled();
  });

  it("answers 404 for a group the caller cannot read, adding nothing", async () => {
    expect((await POST(post(fixture("group-date-request"), ELSEWHERE), ctx(ELSEWHERE))).status).toBe(404);
    expect(holder.current.groupNameOf).toHaveBeenCalledWith(ELSEWHERE);
    expect(holder.current.createGroupDate).not.toHaveBeenCalled();
  });

  it("answers 404 when the action finds the caller is not in the group", async () => {
    holder.current.createGroupDate.mockResolvedValue({ error: "You are not a member of this group" });
    const res = await POST(post(fixture("group-date-request")), ctx());
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/member/);
  });

  it("answers 404 for an id that is not a UUID, asking nothing", async () => {
    expect((await POST(post(fixture("group-date-request"), "x"), ctx("x"))).status).toBe(404);
    expect(holder.current.groupNameOf).not.toHaveBeenCalled();
    expect(holder.current.createGroupDate).not.toHaveBeenCalled();
  });

  it("answers 401 when the action says nobody is signed in", async () => {
    holder.current.createGroupDate.mockResolvedValue({ error: "Not authenticated" });
    expect((await POST(post(fixture("group-date-request")), ctx())).status).toBe(401);
  });

  it("answers 500 when the action fails", async () => {
    holder.current.createGroupDate.mockResolvedValue({ error: "Failed to create the occasion. Please try again." });
    const res = await POST(post(fixture("group-date-request")), ctx());
    expect([res.status, (await res.json()).error]).toEqual([500, { code: "server_error", message: "Something went wrong. Please try again." }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/groups"), expect.anything());
  });
});
