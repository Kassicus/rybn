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

const { PUT, DELETE } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { GRAN_80TH, groupMocks } = await import("@/lib/mobile/test-groups");
const { IDS } = await import("@/lib/mobile/test-shopping");

/** A group Sam is not in, and a date nobody can see. */
const ELSEWHERE = "6c5d4e3f-2a1b-4c0d-9e8f-7a6b5c4d3e2f";
const GONE = "8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d";

const url = (id: string, dateId: string) => `http://localhost/api/mobile/v1/groups/${id}/dates/${dateId}`;
const SAVE = { name: "Gran's 80th birthday", date: "2027-03-15" };
const put = (body: unknown, id: string = IDS.rivera, dateId: string = GRAN_80TH) =>
  bearer(url(id, dateId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const del = (id: string = IDS.rivera, dateId: string = GRAN_80TH) => bearer(url(id, dateId), { method: "DELETE" });
const ctx = (id: string = IDS.rivera, dateId: string = GRAN_80TH) => ({ params: Promise.resolve({ id, dateId }) });

beforeEach(() => {
  holder.current = groupMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT /api/mobile/v1/groups/[id]/dates/[dateId]", () => {
  it("answers 401 without a bearer, writing nothing", async () => {
    const res = await PUT(new Request(url(IDS.rivera, GRAN_80TH),
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(SAVE) }), ctx());
    expect(res.status).toBe(401);
    expect(holder.current.groupDateRow).not.toHaveBeenCalled();
    expect(holder.current.updateGroupDate).not.toHaveBeenCalled();
  });

  it("saves a new name and date and answers the occasion", async () => {
    const [group, date] = [IDS.rivera.toUpperCase(), GRAN_80TH.toUpperCase()];
    const res = await PUT(put({ ...SAVE, groupId: IDS.bookClub, createdBy: "user_2momABC" }, group, date), ctx(group, date));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const { occasion } = fixture("group-date");
    expect(await res.json()).toEqual({ occasion: { ...occasion, title: "Gran's 80th birthday", date: "2027-03-15" } });
    expect(holder.current.updateGroupDate.mock.calls)
      .toEqual([[GRAN_80TH, { name: "Gran's 80th birthday", occasionDate: "2027-03-15" }]]);
    expect(holder.current.groupDateRow.mock.calls).toEqual([[GRAN_80TH]]);
  });

  it("answers 404 for a date in another group, writing nothing", async () => {
    // Christmas 2026 is Rivera Family's; Sam is in Book Club too
    const res = await PUT(put(SAVE, IDS.bookClub, IDS.xmas), ctx(IDS.bookClub, IDS.xmas));
    expect(res.status).toBe(404);
    expect(holder.current.updateGroupDate).not.toHaveBeenCalled();
  });

  it("answers 404 for a date the caller cannot see, writing nothing", async () => {
    expect((await PUT(put(SAVE, IDS.rivera, GONE), ctx(IDS.rivera, GONE))).status).toBe(404);
    expect(holder.current.updateGroupDate).not.toHaveBeenCalled();
  });

  it("answers 404 for a date that is not the caller's to change", async () => {
    // The database decides: the route asks the action whatever the group page marked
    holder.current.updateGroupDate.mockResolvedValue({ error: "That occasion no longer exists, or is not yours to edit" });
    const res = await PUT(put(SAVE), ctx());
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/yours/);
    expect(holder.current.updateGroupDate).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for a group the caller cannot read, writing nothing", async () => {
    expect((await PUT(put(SAVE, ELSEWHERE), ctx(ELSEWHERE))).status).toBe(404);
    expect(holder.current.groupDateRow).not.toHaveBeenCalled();
    expect(holder.current.updateGroupDate).not.toHaveBeenCalled();
  });

  it.each(["Give this occasion a name", "Keep the name to 200 characters or fewer.", "Please enter a valid date (YYYY-MM-DD)"])(
    "answers %j as 422", async (message) => {
      holder.current.updateGroupDate.mockResolvedValue({ error: message });
      const res = await PUT(put(SAVE), ctx());
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
    });

  it("refuses a body with no name or no date with the website's sentence, writing nothing", async () => {
    for (const [body, message] of [
      [{ date: "2027-03-15" }, "Give this occasion a name"],
      [{ name: "Gran's 80th birthday" }, "Please enter a valid date (YYYY-MM-DD)"],
      ["Gran's 80th birthday", "That request wasn't valid."],
    ] as const) {
      const res = await PUT(put(body), ctx());
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
    }
    expect(holder.current.updateGroupDate).not.toHaveBeenCalled();
  });

  it("answers 404 for ids that are not UUIDs, asking nothing", async () => {
    for (const [id, dateId] of [["x", GRAN_80TH], [IDS.rivera, "x"]]) {
      expect((await PUT(put(SAVE, id, dateId), ctx(id, dateId))).status).toBe(404);
    }
    expect(holder.current.groupNameOf).not.toHaveBeenCalled();
    expect(holder.current.groupDateRow).not.toHaveBeenCalled();
    expect(holder.current.updateGroupDate).not.toHaveBeenCalled();
  });

  it("answers 401 when the action says nobody is signed in, and 500 without its words for any other failure", async () => {
    holder.current.updateGroupDate.mockResolvedValueOnce({ error: "Not authenticated" });
    expect((await PUT(put(SAVE), ctx())).status).toBe(401);
    holder.current.updateGroupDate.mockResolvedValueOnce({ error: "Failed to update the occasion. Please try again." });
    const res = await PUT(put(SAVE), ctx());
    expect([res.status, (await res.json()).error]).toEqual([500, { code: "server_error", message: "Something went wrong. Please try again." }]);
  });
});

describe("DELETE /api/mobile/v1/groups/[id]/dates/[dateId]", () => {
  it("answers 401 without a bearer, deleting nothing", async () => {
    const res = await DELETE(new Request(url(IDS.rivera, GRAN_80TH), { method: "DELETE" }), ctx());
    expect(res.status).toBe(401);
    expect(holder.current.groupDateRow).not.toHaveBeenCalled();
    expect(holder.current.deleteGroupDate).not.toHaveBeenCalled();
  });

  it("deletes and answers 204", async () => {
    const [group, date] = [IDS.rivera.toUpperCase(), GRAN_80TH.toUpperCase()];
    const res = await DELETE(del(group, date), ctx(group, date));
    expect([res.status, res.headers.get("cache-control"), await res.text()]).toEqual([204, "no-store", ""]);
    expect(holder.current.groupDateRow.mock.calls).toEqual([[GRAN_80TH]]);
    expect(holder.current.deleteGroupDate.mock.calls).toEqual([[GRAN_80TH]]);
  });

  it("answers 404 for a date that is not the caller's to delete, and for ids that are not UUIDs", async () => {
    holder.current.deleteGroupDate.mockResolvedValue({ error: "That occasion no longer exists, or is not yours to delete" });
    expect((await DELETE(del(), ctx())).status).toBe(404);
    expect(holder.current.deleteGroupDate).toHaveBeenCalledTimes(1);
    for (const [id, dateId] of [["x", GRAN_80TH], [IDS.rivera, "x"]]) {
      expect((await DELETE(del(id, dateId), ctx(id, dateId))).status).toBe(404);
    }
    expect(holder.current.groupDateRow).toHaveBeenCalledTimes(1);
    expect(holder.current.deleteGroupDate).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for a date in another group, or one the caller cannot see, deleting nothing", async () => {
    expect((await DELETE(del(IDS.bookClub, IDS.xmas), ctx(IDS.bookClub, IDS.xmas))).status).toBe(404);
    expect((await DELETE(del(ELSEWHERE, GONE), ctx(ELSEWHERE, GONE))).status).toBe(404);
    expect(holder.current.deleteGroupDate).not.toHaveBeenCalled();
  });

  it("answers 401 when the action says nobody is signed in, and 500 without its words for any other failure", async () => {
    holder.current.deleteGroupDate.mockResolvedValueOnce({ error: "Not authenticated" });
    expect((await DELETE(del(), ctx())).status).toBe(401);
    holder.current.deleteGroupDate.mockResolvedValueOnce({ error: "Failed to delete the occasion. Please try again." });
    const res = await DELETE(del(), ctx());
    expect([res.status, (await res.json()).error]).toEqual([500, { code: "server_error", message: "Something went wrong. Please try again." }]);
  });
});
