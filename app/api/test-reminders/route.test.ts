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

/** What own_contact() answers for the developer: their one row. */
const CONTACT = { data: [{ email: "dev@example.test", email_preferences: null }], error: null };

/**
 * Just enough of the query builder for the calls the route makes. Every
 * select() is recorded with its table; own_contact() answers `contact`, and
 * any other database function an empty list. A row read with maybeSingle()
 * answers none.
 */
function supabaseStub(contact: { data: unknown; error: unknown } = CONTACT) {
  const selects: { table: string; args: unknown[] }[] = [];
  const rpc = vi.fn(async (name: string, ..._args: unknown[]) =>
    name === "own_contact" ? contact : { data: [], error: null }
  );
  const from = (table: string) => {
    const query = {
      select: (...args: unknown[]) => {
        selects.push({ table, args });
        return query;
      },
      eq: () => query,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return query;
  };
  return { selects, rpc, client: { from, rpc } };
}

let stub: ReturnType<typeof supabaseStub>;

beforeEach(() => {
  vi.clearAllMocks();
  stub = supabaseStub();
  createClient.mockResolvedValue(stub.client);
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

  it("answers the developer's own email from own_contact()", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(DEVELOPER);

    const res = await GET();

    expect((await res.json()).user).toEqual({ id: DEVELOPER, email: "dev@example.test" });
    expect(stub.rpc.mock.calls.filter(([name]) => name === "own_contact")).toEqual([["own_contact"]]);
  });

  it.each([
    ["fails", { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }],
    ["answers no row", { data: [], error: null }],
  ])("answers a null email when own_contact() %s", async (_case, contact) => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(DEVELOPER);
    stub = supabaseStub(contact);
    createClient.mockResolvedValue(stub.client);

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).user).toEqual({ id: DEVELOPER, email: null });
  });

  it("never asks user_profiles for the email, the email preferences or every column", async () => {
    vi.stubEnv("DEVELOPER_USER_IDS", DEVELOPER);
    getUserId.mockResolvedValue(DEVELOPER);

    await GET();

    expect(stub.selects.filter((s) => s.table === "user_profiles")).toEqual([]);
  });
});
