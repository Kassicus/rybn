import { describe, it, expect, vi, beforeEach } from "vitest";
import { GARCIA, GRAN_80TH } from "./test-groups";
import { IDS, SAM } from "./test-shopping";

const fromSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();
const maybeSingleSpy = vi.fn();
/** What a query awaited without maybeSingle (a list) answers. */
const listSpy = vi.fn();
const memberCountsSpy = vi.fn();
const inChunksSpy = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (...args: unknown[]) => {
      fromSpy(...args);
      const chain = {
        select: (...a: unknown[]) => {
          selectSpy(...a);
          return chain;
        },
        eq: (...a: unknown[]) => {
          eqSpy(...a);
          return chain;
        },
        in: (...a: unknown[]) => {
          inSpy(...a);
          return chain;
        },
        maybeSingle: () => maybeSingleSpy(),
        then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(listSpy()).then(resolve, reject),
      };
      return chain;
    },
  }),
}));
vi.mock("./people-live", () => ({
  memberCounts: (...a: unknown[]) => memberCountsSpy(...a),
  // One chunk: people-live's own tests cover the chunking.
  inChunks: (ids: string[], ask: (chunk: string[]) => Promise<unknown[]>) => {
    inChunksSpy(ids);
    return ask([...new Set(ids)]);
  },
}));

const { callerRole, groupDateMakers, groupDateRow, groupNameOf, groupSummary, inviteCodeOf } = await import("./group-reads");

const found = (data: unknown) => maybeSingleSpy.mockResolvedValue({ data, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  memberCountsSpy.mockResolvedValue(new Map([[GARCIA, 1]]));
});

describe("a group's dates", () => {
  it("reads a group date's id and group, and only a group date", async () => {
    found({ id: GRAN_80TH, group_id: IDS.rivera });
    expect(await groupDateRow(GRAN_80TH)).toEqual({ id: GRAN_80TH, groupId: IDS.rivera });
    expect(fromSpy.mock.calls).toEqual([["occasions"]]);
    expect(selectSpy.mock.calls).toEqual([["id, group_id"]]);
    expect(eqSpy.mock.calls).toEqual([["id", GRAN_80TH], ["kind", "group_date"]]);
  });

  it("answers null for a date the caller cannot see, or one in no group", async () => {
    found(null);
    expect(await groupDateRow(GRAN_80TH)).toBeNull();
    found({ id: GRAN_80TH, group_id: null });
    expect(await groupDateRow(GRAN_80TH)).toBeNull();
  });

  it("reads who made each group date, asking only about group dates, never another column", async () => {
    listSpy.mockReturnValue({ data: [{ id: IDS.xmas, created_by: SAM }, { id: GRAN_80TH, created_by: null }], error: null });
    expect(await groupDateMakers([IDS.xmas, GRAN_80TH, IDS.xmas])).toEqual(new Map([[IDS.xmas, SAM], [GRAN_80TH, null]]));
    expect(fromSpy.mock.calls).toEqual([["occasions"]]);
    expect(selectSpy.mock.calls).toEqual([["id, created_by"]]);
    expect(inSpy.mock.calls).toEqual([["id", [IDS.xmas, GRAN_80TH]]]);
    expect(eqSpy.mock.calls).toEqual([["kind", "group_date"]]);
    expect(inChunksSpy).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for no dates", async () => {
    expect(await groupDateMakers([])).toEqual(new Map());
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("throws on a database error naming the read: groupDateMakers", async () => {
    listSpy.mockReturnValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(groupDateMakers([IDS.xmas])).rejects.toThrow(/^groupDateMakers failed: boom$/);
    await expect(groupDateMakers([IDS.xmas])).rejects.toMatchObject({ code: "XX000" });
  });
});

it("reads a group's summary with named columns and counts its members", async () => {
  found({ id: GARCIA, name: "Garcia Cousins", type: "family" });
  expect(await groupSummary(GARCIA)).toEqual({ id: GARCIA, name: "Garcia Cousins", type: "family", memberCount: 1 });
  expect(fromSpy).toHaveBeenCalledWith("groups");
  expect(selectSpy).toHaveBeenCalledWith("id, name, type");
  expect(eqSpy).toHaveBeenCalledWith("id", GARCIA);
  expect(eqSpy).toHaveBeenCalledTimes(1);
  expect(memberCountsSpy).toHaveBeenCalledWith([GARCIA]);
});

it("answers null for a group stored with an empty name, as GET /groups leaves it out", async () => {
  found({ id: GARCIA, name: "", type: "family" });
  expect(await groupSummary(GARCIA)).toBeNull();
  expect(memberCountsSpy).not.toHaveBeenCalled();
});

it("reads the caller's role in a group", async () => {
  found({ role: "owner" });
  expect(await callerRole(GARCIA, "user_2abcDEF")).toBe("owner");
  expect(fromSpy).toHaveBeenCalledWith("group_members");
  expect(selectSpy).toHaveBeenCalledWith("role");
  expect(eqSpy.mock.calls).toEqual([["group_id", GARCIA], ["user_id", "user_2abcDEF"]]);
  found({ role: "moderator" });
  expect(await callerRole(GARCIA, "user_2abcDEF")).toBe("member");
});

it("reads the invite code and the name, and nothing else", async () => {
  found({ invite_code: "K7P-MXR-4TQ" });
  expect(await inviteCodeOf(GARCIA)).toBe("K7P-MXR-4TQ");
  found({ name: "Garcia Cousins" });
  expect(await groupNameOf(GARCIA)).toBe("Garcia Cousins");
  expect(fromSpy.mock.calls).toEqual([["groups"], ["groups"]]);
  expect(selectSpy.mock.calls).toEqual([["invite_code"], ["name"]]);
  expect(eqSpy.mock.calls).toEqual([["id", GARCIA], ["id", GARCIA]]);
  expect(memberCountsSpy).not.toHaveBeenCalled();
});

describe("a group the caller cannot see, and a failed read", () => {
  it("answers null for a group the caller cannot see", async () => {
    found(null);
    expect(await groupSummary(GARCIA)).toBeNull();
    expect(await callerRole(GARCIA, "user_2abcDEF")).toBeNull();
    expect(await inviteCodeOf(GARCIA)).toBeNull();
    expect(await groupNameOf(GARCIA)).toBeNull();
    expect(memberCountsSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["groupSummary", () => groupSummary(GARCIA)],
    ["callerRole", () => callerRole(GARCIA, "user_2abcDEF")],
    ["inviteCodeOf", () => inviteCodeOf(GARCIA)],
    ["groupNameOf", () => groupNameOf(GARCIA)],
    ["groupDateRow", () => groupDateRow(GRAN_80TH)],
  ])("throws on a database error naming the read: %s", async (name, read) => {
    maybeSingleSpy.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(read()).rejects.toThrow(new RegExp(`^${name} failed: boom$`));
    await expect(read()).rejects.toMatchObject({ code: "XX000" });
    expect(memberCountsSpy).not.toHaveBeenCalled();
  });
});
