import { describe, it, expect } from "vitest";
import {
  ALL_KINDS,
  VISIBILITY_INVALID,
  fieldKinds,
  isMixed,
  newFieldPrivacy,
  readStoredChoice,
  visibleToSchema,
} from "./visibility";

/**
 * A profile field's setting is the kinds of group named under
 * visibleToGroupTypes, unless restrictToGroup ties it to one group, which
 * can_view_field() checks first. These read that shape the way the database
 * does, and check a person's choice before it is stored.
 */

const TIED = "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e";

describe("fieldKinds", () => {
  it.each([
    [{ visibleToGroupTypes: ["friends", "family"], restrictToGroup: null }, ["family", "friends"]],
    [{ visibleToGroupTypes: ["family", "nonsense", "family"] }, ["family"]],
    [{}, []],
    ["not an object", []],
    [{ visibleToGroupTypes: ["family"], restrictToGroup: TIED }, null],
  ])("fieldKinds(%j) is %j", (privacy, kinds) => {
    expect(fieldKinds(privacy)).toEqual(kinds);
  });
});

describe("isMixed", () => {
  it("is mixed only when some field differs from the choice", () => {
    expect(isMixed(["family"], [{ visibleToGroupTypes: ["family"] }])).toBe(false);
    expect(
      isMixed(["family"], [{ visibleToGroupTypes: ["family"] }, { visibleToGroupTypes: ["friends"] }])
    ).toBe(true);
    expect(
      isMixed(["family"], [
        { visibleToGroupTypes: ["family"] },
        { visibleToGroupTypes: ["family"], restrictToGroup: TIED },
      ])
    ).toBe(true);
    expect(isMixed(["family"], [])).toBe(false);
    // The same kinds in another order, or named twice, are the same setting.
    expect(
      isMixed(["friends", "family"], [{ visibleToGroupTypes: ["family", "friends", "family"] }])
    ).toBe(false);
  });
});

describe("visibleToSchema", () => {
  it("checks a choice at the door", () => {
    expect(visibleToSchema.parse(["work", "family"])).toEqual(["family", "work"]);
    expect(visibleToSchema.parse([])).toEqual([]);
    for (const refused of [["club"], "family", null]) {
      const result = visibleToSchema.safeParse(refused);
      expect(result.success, JSON.stringify(refused)).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([VISIBILITY_INVALID]);
    }
  });
});

describe("newFieldPrivacy", () => {
  it("is the choice, in order, tied to no group", () => {
    expect(newFieldPrivacy(["work", "family"])).toEqual({
      visibleToGroupTypes: ["family", "work"],
      restrictToGroup: null,
    });
    expect(ALL_KINDS).toEqual(["family", "friends", "work", "custom"]);
  });
});

describe("readStoredChoice", () => {
  /** Just enough of a Supabase client for one maybeSingle() read. */
  function clientAnswering(response: { data: unknown; error: unknown }) {
    const reads: unknown[][] = [];
    const chain = {
      select: (...args: unknown[]) => (reads.push(["select", ...args]), chain),
      eq: (...args: unknown[]) => (reads.push(["eq", ...args]), chain),
      maybeSingle: async () => response,
    };
    const client = {
      from: (table: string) => (reads.push(["from", table]), chain),
    } as unknown as Parameters<typeof readStoredChoice>[0];
    return { client, reads };
  }

  it("answers the person's row in order, all four with no row, and an error as Failed to load settings", async () => {
    const stored = clientAnswering({
      data: { visible_to_group_types: ["work", "family"] },
      error: null,
    });
    expect(await readStoredChoice(stored.client, "user_123")).toEqual({
      choice: ["family", "work"],
    });
    expect(stored.reads).toEqual([
      ["from", "profile_visibility"],
      ["select", "visible_to_group_types"],
      ["eq", "user_id", "user_123"],
    ]);

    const none = clientAnswering({ data: null, error: null });
    expect(await readStoredChoice(none.client, "user_123")).toEqual({
      choice: ["family", "friends", "work", "custom"],
    });

    const failed = clientAnswering({ data: null, error: { message: "permission denied" } });
    expect(await readStoredChoice(failed.client, "user_123")).toEqual({
      error: "Failed to load settings",
    });
  });
});
