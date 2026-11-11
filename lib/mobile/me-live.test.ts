import { describe, it, expect, vi, beforeEach } from "vitest";

const fromSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
const maybeSingleSpy = vi.fn();

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

const { loadMe } = await import("./me-live");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadMe", () => {
  it("reads the caller's own row with the user-scoped client", async () => {
    maybeSingleSpy.mockResolvedValue({
      data: { id: "user_1", username: "sam", display_name: "Sam", email: "s@e.c", avatar_url: null },
      error: null,
    });
    const result = await loadMe("user_1");
    expect(fromSpy).toHaveBeenCalledWith("user_profiles");
    expect(selectSpy).toHaveBeenCalledWith("id, username, display_name, email, avatar_url");
    expect(eqSpy).toHaveBeenCalledWith("id", "user_1");
    expect(maybeSingleSpy).toHaveBeenCalledTimes(1);
    expect(result.user.id).toBe("user_1");
    expect(result.user.displayName).toBe("Sam");
  });

  it("throws when there is no row", async () => {
    maybeSingleSpy.mockResolvedValue({ data: null, error: null });
    await expect(loadMe("user_1")).rejects.toThrow();
  });

  it("throws when the read fails", async () => {
    maybeSingleSpy.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(loadMe("user_1")).rejects.toThrow();
  });
});
