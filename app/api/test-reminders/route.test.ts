import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * /api/test-reminders is a developer diagnostic. It answers only for a Clerk
 * user id listed in DEVELOPER_USER_IDS; for everyone else -- signed in or not
 * -- the route does not exist, and it must say so before opening a database
 * client.
 *
 * Both mocked modules import "server-only" for real, which throws outside a
 * Server Component.
 */

const getUserId = vi.fn();
vi.mock("@/lib/auth/require-auth", () => ({ getUserId: () => getUserId() }));

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const { GET } = await import("./route");

const DEVELOPER = "user_2abcDEF";
const SOMEONE_ELSE = "user_2zzzZZZ";

/** Just enough of the query builder for the three calls the route makes. */
function supabaseStub() {
  const query = {
    select: () => query,
    eq: () => query,
    limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: { email: "dev@example.test" }, error: null }),
  };
  return {
    from: () => query,
    rpc: async () => ({ data: [], error: null }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue(supabaseStub());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/test-reminders", () => {
  it("answers 404 and reads nothing for a signed-in person who is not on the list", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(SOMEONE_ELSE);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers 404 for every signed-in person when the list is unset", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", undefined);
    getUserId.mockResolvedValue(DEVELOPER);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers 404 when nobody is signed in", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers the diagnostics for a listed developer", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", `${SOMEONE_ELSE}, ${DEVELOPER}`);
    getUserId.mockResolvedValue(DEVELOPER);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      user: { id: DEVELOPER, email: "dev@example.test" },
      tests: { tableExists: true, functionWorks: true },
    });
  });
});
