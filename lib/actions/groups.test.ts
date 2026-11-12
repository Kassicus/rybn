import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateGroupInput } from "@/lib/schemas/groups";

/**
 * createGroup checks what it is given before it reaches the database, with
 * the sentences the website's create form shows, and stores the name and
 * description trimmed.
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

const { createGroup } = await import("./groups");

const GROUP_ID = "5a6b7c8d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";

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
});
