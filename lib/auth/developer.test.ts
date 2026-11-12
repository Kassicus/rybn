import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * DEVELOPER_USER_IDS is the allow-list behind the developer-only surfaces
 * (/admin/api-explorer and /api/test-reminders). These tests pin how it is
 * read: an exact match on a Clerk user id, and nobody at all when it is unset.
 *
 * require-auth.ts is mocked because the real module imports "server-only",
 * which throws outside a Server Component.
 */

const getUserId = vi.fn();
vi.mock("@/lib/auth/require-auth", () => ({ getUserId: () => getUserId() }));

const { isDeveloper, getDeveloperId } = await import("./developer");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDeveloper", () => {
  it("is false for everyone when DEVELOPER_USER_IDS is unset", () => {
    vi.stubEnv("DEVELOPER_USER_IDS", undefined);
    expect(isDeveloper("user_2abcDEF")).toBe(false);
  });

  it("is false for everyone when DEVELOPER_USER_IDS is blank", () => {
    for (const value of ["", "   ", ",", " , ,\n"]) {
      vi.stubEnv("DEVELOPER_USER_IDS", value);
      expect(isDeveloper("user_2abcDEF")).toBe(false);
      expect(isDeveloper("")).toBe(false);
    }
  });

  it("is true only for an id on the list", () => {
    vi.stubEnv("DEVELOPER_USER_IDS", "user_2abcDEF,user_2ghiJKL");
    expect(isDeveloper("user_2abcDEF")).toBe(true);
    expect(isDeveloper("user_2ghiJKL")).toBe(true);
    expect(isDeveloper("user_2zzzZZZ")).toBe(false);
  });

  it("matches the whole id, not a part of one", () => {
    vi.stubEnv("DEVELOPER_USER_IDS", "user_2abcDEF");
    expect(isDeveloper("user_2abc")).toBe(false);
    expect(isDeveloper("user_2abcDEFG")).toBe(false);
    expect(isDeveloper("USER_2ABCDEF")).toBe(false);
  });

  it("ignores spaces, newlines and empty entries around the ids", () => {
    vi.stubEnv("DEVELOPER_USER_IDS", " user_2abcDEF ,\n user_2ghiJKL,, ");
    expect(isDeveloper("user_2abcDEF")).toBe(true);
    expect(isDeveloper("user_2ghiJKL")).toBe(true);
  });

  it("is false when there is no user id", () => {
    vi.stubEnv("DEVELOPER_USER_IDS", "user_2abcDEF");
    expect(isDeveloper(null)).toBe(false);
    expect(isDeveloper(undefined)).toBe(false);
    expect(isDeveloper("")).toBe(false);
  });
});

describe("getDeveloperId", () => {
  it("returns the signed-in person's id when they are on the list", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", "user_2abcDEF");
    getUserId.mockResolvedValue("user_2abcDEF");
    expect(await getDeveloperId()).toBe("user_2abcDEF");
  });

  it("returns null for a signed-in person who is not on the list", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", "user_2abcDEF");
    getUserId.mockResolvedValue("user_2zzzZZZ");
    expect(await getDeveloperId()).toBeNull();
  });

  it("returns null when nobody is signed in", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", "user_2abcDEF");
    getUserId.mockResolvedValue(null);
    expect(await getDeveloperId()).toBeNull();
  });

  it("returns null for a signed-in person when the list is unset", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", undefined);
    getUserId.mockResolvedValue("user_2abcDEF");
    expect(await getDeveloperId()).toBeNull();
  });
});
