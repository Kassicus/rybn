import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateGroupInput } from "@/lib/schemas/groups";
import { tidyGroupText } from "@/lib/utils/groups";

/**
 * createGroup checks what it is given before it reaches the database, with
 * the sentences the website's create form shows, and stores the name and
 * description on one line and trimmed.
 *
 * The caller's own client is used only for the invite-code probe (`rpc`); the
 * group itself is written with the admin client, whose `insert` is spied so a
 * test can read the exact row sent. `from` on the caller's client is spied too,
 * so "before the database" covers every way in.
 */

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  }),
}));

const insertSpy = vi.fn();
let insertAnswer: { data: unknown; error: unknown };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        insert: (payload: unknown) => {
          insertSpy(table, payload);
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => insertAnswer,
      };
      return chain;
    },
  }),
}));

const { createGroup, deleteGroup } = await import("./groups");

const GROUP_ID = "5a6b7c8d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";

/** Invisible characters, written as escapes, never typed. */
const ZWSP = "\u{200B}"; // zero-width space
const ZWNJ = "\u{200C}"; // zero-width non-joiner
const ZWJ = "\u{200D}"; // zero-width joiner
const RLO = "\u{202E}"; // right-to-left override
const HANGUL_FILLER = "\u{3164}"; // shows as a blank
const LS = "\u{2028}"; // line separator
const VS16 = "\u{FE0F}"; // emoji presentation selector
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`; // man, woman, girl
const RAINBOW = `\u{1F3F3}${VS16}${ZWJ}\u{1F308}`; // white flag, rainbow
const SCOTLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
const KEYCAP_ONE = `1${VS16}\u{20E3}`;
const PERSIAN_WORD = `\u{0645}\u{06CC}${ZWNJ}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}`;

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
  // The invite-code probe finds no group using the generated code.
  rpc.mockResolvedValue({ data: [], error: null });
  insertAnswer = {
    data: { id: GROUP_ID, name: "Garcia Cousins", type: "family" },
    error: null,
  };
});

describe("createGroup", () => {
  it.each([
    [{ name: "   ", type: "family" }, "Group name is required"],
    [{ name: "x".repeat(51), type: "family" }, "Group name must be less than 50 characters"],
    [
      { name: "Garcia Cousins", description: "x".repeat(201), type: "family" },
      "Description must be less than 200 characters",
    ],
    [{ name: "Garcia Cousins", type: "club" }, "Choose a kind of group."],
  ])("refuses %j with the website's sentence, before the database", async (input, sentence) => {
    const result = await createGroup(input as CreateGroupInput);

    expect(result).toEqual({ error: sentence });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  // A caller that is not the browser's form can send anything at all; each
  // field's refusal is still that field's sentence, never zod's own words.
  it.each([
    [{ type: "family" }, "Group name is required"],
    [{ name: 42, type: "family" }, "Group name is required"],
    [{ name: "Garcia Cousins", description: 7, type: "family" }, "Description must be less than 200 characters"],
    [{ name: "Garcia Cousins" }, "Choose a kind of group."],
    [{ name: "Garcia Cousins", type: 3 }, "Choose a kind of group."],
  ])("refuses %j, a value of the wrong kind, with the field's sentence", async (input, sentence) => {
    const result = await createGroup(input as unknown as CreateGroupInput);

    expect(result).toEqual({ error: sentence });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("answers Not authenticated when signed out, before checking anything", async () => {
    getUserId.mockResolvedValue(null);

    const result = await createGroup({ name: "   ", type: "family" });

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("stores the trimmed name, and no description for a blank one", async () => {
    const result = await createGroup({
      name: "  Garcia Cousins ",
      description: "  ",
      type: "family",
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [table, payload] = insertSpy.mock.calls[0];
    expect(table).toBe("groups");
    expect(payload).toMatchObject({
      name: "Garcia Cousins",
      description: null,
      type: "family",
      created_by: "user_123",
    });
    expect(result).toEqual({ data: insertAnswer.data });
  });

  it("stores a description trimmed", async () => {
    await createGroup({
      name: "Garcia Cousins",
      description: " Cousins on Dad's side\n",
      type: "friends",
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][1]).toMatchObject({
      name: "Garcia Cousins",
      description: "Cousins on Dad's side",
      type: "friends",
    });
  });

  it.each([[null], ["Garcia Cousins"], [[]], [undefined]])(
    "refuses %j, which is not an object, with the name's sentence",
    async (input) => {
      const result = await createGroup(input as unknown as CreateGroupInput);

      expect(result).toEqual({ error: "Group name is required" });
      expect(rpc).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    }
  );

  it("stores only the checked fields, with the caller as its creator and a generated code", async () => {
    await createGroup({
      name: "Garcia Cousins",
      type: "family",
      id: "x",
      invite_code: "AAA-AAA-AAA",
      created_by: "someone_else",
    } as unknown as CreateGroupInput);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, payload] = insertSpy.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual([
      "created_by",
      "description",
      "invite_code",
      "name",
      "type",
    ]);
    expect(payload.created_by).toBe("user_123");
    expect(payload.invite_code).not.toBe("AAA-AAA-AAA");
    expect(rpc).toHaveBeenCalledWith("find_group_by_invite_code", {
      p_invite_code: payload.invite_code,
    });
  });

  it("stores a name and description with each run of line breaks, control and invisible characters as one space", async () => {
    await createGroup({
      name: "Garcia\nCousins",
      description: `Cousins\ton Dad's${LS}side${ZWSP}`,
      type: "family",
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][1]).toMatchObject({
      name: "Garcia Cousins",
      description: "Cousins on Dad's side",
    });
  });

  it.each([[ZWSP], ["\n\t"], [`${RLO} ${ZWJ}`]])(
    "refuses the name %j, which shows nothing, with the name's sentence",
    async (name) => {
      const result = await createGroup({ name, type: "family" });

      expect(result).toEqual({ error: "Group name is required" });
      expect(insertSpy).not.toHaveBeenCalled();
    }
  );

  it.each([[HANGUL_FILLER], [HANGUL_FILLER.repeat(3)], [`${HANGUL_FILLER} ${HANGUL_FILLER}`]])(
    "refuses the name %j, made of blank-looking characters, with the name's sentence",
    async (name) => {
      const result = await createGroup({ name, type: "family" });

      expect(result).toEqual({ error: "Group name is required" });
      expect(insertSpy).not.toHaveBeenCalled();
    }
  );

  it.each([["\u{FE0F}"], ["\u{FE00}\u{FE0E}\u{E0100}"], ["\u{180B} \u{180F}"]])(
    "refuses the name %j, made of variation selectors, with the name's sentence",
    async (name) => {
      const result = await createGroup({ name, type: "family" });

      expect(result).toEqual({ error: "Group name is required" });
      expect(insertSpy).not.toHaveBeenCalled();
    }
  );

  /**
   * What this shows: a name of more than 100,000 code units made only of
   * things the tidying keeps (joined emoji, the rainbow flag with its
   * presentation selector and joiner, the flag of Scotland, a keycap and a
   * Persian word with its non-joiner) comes back from tidyGroupText exactly
   * as it went in, so every kept branch ran on it, and the whole of it,
   * tidying and createGroup's refusal for its length together, finishes
   * well inside the limit. A cost that grew with the square of the length
   * would take far longer than the limit at this size.
   *
   * What it does not show: that every possible input is tidied in linear
   * time; that is argued from the shape of the pattern, not measured. Nor
   * does the limit say anything about speed on a slower or busier machine,
   * beyond being generous.
   */
  it("tidies a 100,000-unit name of kept emoji, flags and joined words unchanged and quickly, then refuses its length", async () => {
    const unit = [FAMILY, RAINBOW, SCOTLAND, KEYCAP_ONE, PERSIAN_WORD].join("");
    // n units and n - 1 spaces between them: n * (length + 1) - 1 code units.
    const n = Math.ceil(100_001 / (unit.length + 1));
    const name = Array.from({ length: n }, () => unit).join(" ");
    expect(name.length).toBeGreaterThanOrEqual(100_000);

    const started = performance.now();
    const tidied = tidyGroupText(name);
    const result = await createGroup({ name, type: "family" });
    const elapsed = performance.now() - started;

    expect(tidied).toBe(name);
    expect(result).toEqual({ error: "Group name must be less than 50 characters" });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(1_000);
  });

  it("keeps an emoji built with a zero-width joiner as it is", async () => {
    await createGroup({ name: `${FAMILY} Riveras`, type: "family" });

    expect(insertSpy.mock.calls[0][1]).toMatchObject({
      name: `${FAMILY} Riveras`,
    });
  });
});

/**
 * deleteGroup reads the caller's role with their own client, then deletes. The
 * caller's `from` answers the role read with `membership` and records each
 * delete.
 */
describe("deleteGroup", () => {
  const deleteSpy = vi.fn();
  let membership: { data: unknown; error: unknown };
  let deleted: { error: unknown };

  beforeEach(() => {
    membership = { data: { role: "owner" }, error: null };
    deleted = { error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    from.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        delete: () => {
          deleteSpy(table);
          return chain;
        },
        maybeSingle: async () => membership,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(deleted).then(resolve),
      };
      return chain;
    });
  });

  it("answers its own sentence when the delete fails, logging the database's error but never answering it", async () => {
    const error = { code: "23503", message: 'update or delete on table "groups" violates foreign key constraint' };
    deleted = { error };

    const result = await deleteGroup(GROUP_ID);

    expect(result).toEqual({ error: "Failed to delete group. Please try again." });
    expect(console.error).toHaveBeenCalledWith(expect.any(String), error);
  });

  it("answers that it could not verify the membership when the role cannot be read, deleting nothing", async () => {
    membership = { data: null, error: { code: "XX000", message: "boom" } };

    const result = await deleteGroup(GROUP_ID);

    expect(result).toEqual({ error: "Failed to verify group membership. Please try again." });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("refuses anyone but the owner, deleting nothing", async () => {
    for (const read of [{ data: { role: "admin" }, error: null }, { data: null, error: null }]) {
      membership = read;

      expect(await deleteGroup(GROUP_ID)).toEqual({ error: "Only the owner can delete this group" });
    }
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("deletes the group for its owner", async () => {
    expect(await deleteGroup(GROUP_ID)).toEqual({ success: true });
    expect(deleteSpy).toHaveBeenCalledWith("groups");
  });
});
