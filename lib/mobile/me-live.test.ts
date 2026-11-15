import { describe, it, expect, vi, beforeEach } from "vitest";

const fromSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
const maybeSingleSpy = vi.fn();
const rpcSpy = vi.fn();

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
    rpc: (...args: unknown[]) => rpcSpy(...args),
  }),
}));

const { loadMe } = await import("./me-live");

/** The caller's own row, as its four named columns read it. */
const ROW = { id: "user_1", username: "sam", display_name: "Sam", avatar_url: null };

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingleSpy.mockResolvedValue({ data: ROW, error: null });
  rpcSpy.mockResolvedValue({ data: [{ email: "s@e.c", email_preferences: null }], error: null });
});

describe("loadMe", () => {
  it("reads the caller's own row with the user-scoped client, then their email through own_contact()", async () => {
    const result = await loadMe("user_1");
    expect(fromSpy).toHaveBeenCalledWith("user_profiles");
    expect(selectSpy.mock.calls).toEqual([["id, username, display_name, avatar_url"]]);
    expect(eqSpy).toHaveBeenCalledWith("id", "user_1");
    expect(maybeSingleSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy.mock.calls).toEqual([["own_contact"]]);
    expect(result).toEqual({
      user: { id: "user_1", username: "sam", displayName: "Sam", email: "s@e.c", avatarUrl: null },
    });
  });

  it("answers a null email when own_contact() answers no row", async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    expect((await loadMe("user_1")).user.email).toBeNull();
  });

  it("throws when own_contact() fails, naming the caller and the database's message", async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: "57014", message: "boom" } });
    await expect(loadMe("user_1")).rejects.toThrow("Could not read the contact details for user_1: boom");
  });

  it("throws when there is no row, before own_contact()", async () => {
    maybeSingleSpy.mockResolvedValue({ data: null, error: null });
    await expect(loadMe("user_1")).rejects.toThrow();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("throws when the read fails, before own_contact()", async () => {
    maybeSingleSpy.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(loadMe("user_1")).rejects.toThrow("Could not read the profile for user_1: boom");
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("never asks user_profiles for the email, the email preferences or every column", async () => {
    await loadMe("user_1");
    expect(selectSpy).toHaveBeenCalled();
    for (const args of selectSpy.mock.calls) {
      expect(args).toHaveLength(1);
      const named = String(args[0])
        .split(",")
        .map((column) => column.trim());
      expect(named.filter((column) => ["*", "email", "email_preferences", ""].includes(column))).toEqual([]);
    }
  });
});
