import { describe, it, expect, vi, beforeEach } from "vitest";
import { GARCIA } from "./test-groups";

const fromSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
const maybeSingleSpy = vi.fn();
const memberCountsSpy = vi.fn();

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
        maybeSingle: () => maybeSingleSpy(),
      };
      return chain;
    },
  }),
}));
vi.mock("./people-live", () => ({ memberCounts: (...a: unknown[]) => memberCountsSpy(...a) }));

const { callerRole, groupNameOf, groupSummary, inviteCodeOf } = await import("./group-reads");

const found = (data: unknown) => maybeSingleSpy.mockResolvedValue({ data, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  memberCountsSpy.mockResolvedValue(new Map([[GARCIA, 1]]));
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
  ])("throws on a database error naming the read: %s", async (name, read) => {
    maybeSingleSpy.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(read()).rejects.toThrow(new RegExp(`^${name} failed: boom$`));
    await expect(read()).rejects.toMatchObject({ code: "XX000" });
    expect(memberCountsSpy).not.toHaveBeenCalled();
  });
});
