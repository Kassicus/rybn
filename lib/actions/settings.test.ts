import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The Settings page's "Who can see your profile fields?" is one choice per
 * person, kept in profile_visibility. getMySettings answers that row (all four
 * kinds when there is none); updatePrivacySettings makes one database call,
 * set_profile_visibility, which stores the choice and writes it onto every
 * profile_info field the person has, both or neither.
 */

/**
 * Mirrors VISIBILITY_INVALID in lib/profile/visibility.ts. Written out so the
 * sentence a person reads is pinned here as well.
 */
const VISIBILITY_INVALID = "Choose which kinds of group can see your details.";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const getUserId = vi.fn();
vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

vi.mock("@/lib/auth/ensure-profile", () => ({
  ensureProfile: vi.fn(async () => "user_123"),
}));

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };
type RpcCall = { name: string; args: unknown };

/**
 * The same mock as ./profile.test.ts: queued per table, every call recorded.
 * A database function's answers are queued under "rpc:<name>", and each call
 * is recorded in `rpcs`.
 */
function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, responses] of Object.entries(script)) {
    queues[table] = [...responses];
  }
  const queries: Query[] = [];
  const rpcs: RpcCall[] = [];

  return {
    queries,
    rpcs,
    rpc(name: string, args: unknown) {
      rpcs.push({ name, args });
      const queue = queues[`rpc:${name}`];
      if (!queue || queue.length === 0) {
        throw new Error(`No scripted Supabase response left for rpc "${name}"`);
      }
      return Promise.resolve(queue.shift());
    },
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);

      const next = () => {
        const queue = queues[table];
        if (!queue || queue.length === 0) {
          throw new Error(`No scripted Supabase response left for "${table}"`);
        }
        return queue.shift();
      };

      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "insert",
        "update",
        "upsert",
        "delete",
        "eq",
        "in",
        "order",
        "limit",
      ]) {
        chain[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return chain;
        };
      }
      chain.maybeSingle = async () => next();
      chain.single = async () => next();
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve().then(next).then(resolve, reject);
      return chain;
    },
  };
}

let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabase,
}));

const { getMySettings, updatePrivacySettings } = await import("./settings");

function queriesWith(table: string, method: string): Query[] {
  return supabase.queries.filter(
    (q) => q.table === table && q.calls.some((c) => c.method === method)
  );
}

function argsOf(query: Query, method: string): unknown[] {
  return query.calls.find((c) => c.method === method)?.args ?? [];
}

/** The one call a Settings save makes, with these kinds. */
const saveCall = (kinds: string[]) => ({ name: "set_profile_visibility", args: { p_kinds: kinds } });

const OK = { data: null, error: null };
const ALL_FOUR = ["family", "friends", "work", "custom"];
const DEFAULT_EMAILS = {
  email_group_invites: true,
  email_date_reminders: true,
  email_gift_updates: true,
  email_exchange_notifications: true,
  email_marketing: false,
};

/** Two fields with different settings, the second tied to one group. */
const FIELDS = [
  {
    id: "f-1",
    user_id: "user_123",
    category: "sizes",
    field_name: "shoe_size",
    field_value: "10",
    privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null },
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  },
  {
    id: "f-2",
    user_id: "user_123",
    category: "dates",
    field_name: "birthday",
    field_value: "1990-05-04",
    privacy_settings: {
      visibleToGroupTypes: ["work"],
      restrictToGroup: "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e",
    },
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
  supabase = createSupabaseMock({});
});

// Puts back what a test's vi.spyOn replaced (console.error, silenced in the
// failure test), so no later test runs with it silenced.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getMySettings", () => {
  it("reads the stored choice, not the first field's", async () => {
    supabase = createSupabaseMock({
      user_profiles: [{ data: { email_preferences: null }, error: null }],
      profile_visibility: [{ data: { visible_to_group_types: ["friends"] }, error: null }],
      // A field whose own setting differs from the stored choice.
      profile_info: [{ data: FIELDS, error: null }],
    });

    const result = await getMySettings();

    expect(result.error).toBeNull();
    expect(result.data?.privacy_settings.visible_to_group_types).toEqual(["friends"]);
    expect(supabase.queries.map((q) => q.table)).not.toContain("profile_info");
    const [choice] = queriesWith("profile_visibility", "select");
    expect(argsOf(choice, "eq")).toEqual(["user_id", "user_123"]);
  });

  it("answers all four kinds for a person who has never chosen", async () => {
    supabase = createSupabaseMock({
      user_profiles: [{ data: { email_preferences: null }, error: null }],
      profile_visibility: [{ data: null, error: null }],
      profile_info: [{ data: [], error: null }],
    });

    const result = await getMySettings();

    expect(result.data?.privacy_settings.visible_to_group_types).toEqual(ALL_FOUR);
  });

  it("answers no kinds for a person who chose only themselves", async () => {
    supabase = createSupabaseMock({
      user_profiles: [{ data: { email_preferences: null }, error: null }],
      profile_visibility: [{ data: { visible_to_group_types: [] }, error: null }],
    });

    const result = await getMySettings();

    expect(result.data?.privacy_settings.visible_to_group_types).toEqual([]);
  });

  it("answers Failed to load settings when the choice cannot be read", async () => {
    supabase = createSupabaseMock({
      user_profiles: [{ data: { email_preferences: null }, error: null }],
      profile_visibility: [{ data: null, error: { code: "42501", message: "permission denied" } }],
      profile_info: [{ data: [], error: null }],
    });

    const result = await getMySettings();

    expect(result).toEqual({ data: null, error: "Failed to load settings" });
  });

  it("keeps the email preferences as they were", async () => {
    supabase = createSupabaseMock({
      user_profiles: [{ data: { email_preferences: { email_marketing: true } }, error: null }],
      profile_visibility: [{ data: { visible_to_group_types: ["family"] }, error: null }],
      profile_info: [{ data: [], error: null }],
    });

    const result = await getMySettings();

    expect(result.data?.email_preferences).toEqual({ ...DEFAULT_EMAILS, email_marketing: true });
  });
});

describe("updatePrivacySettings", () => {
  // One call: set_profile_visibility stores the choice and writes it onto
  // every field of the caller's in the same call, so the two succeed or fail
  // together.
  it("makes exactly one database call, set_profile_visibility, with the kinds once each in order", async () => {
    supabase = createSupabaseMock({ "rpc:set_profile_visibility": [OK] });

    const result = await updatePrivacySettings({ visible_to_group_types: ["work", "family", "work"] });

    expect(result).toEqual({ data: true, error: null });
    expect(supabase.rpcs).toEqual([saveCall(["family", "work"])]);
    expect(supabase.queries).toEqual([]);
  });

  it("stores the choice for a person with no fields: the one call is made", async () => {
    // Whether the person has fields is the database's business: the call is
    // the same, and answers no rows either way.
    supabase = createSupabaseMock({ "rpc:set_profile_visibility": [OK] });

    const result = await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(result).toEqual({ data: true, error: null });
    expect(supabase.rpcs).toEqual([saveCall(["family"])]);
  });

  it("sends an empty selection (only you) as an empty list", async () => {
    supabase = createSupabaseMock({ "rpc:set_profile_visibility": [OK] });

    const result = await updatePrivacySettings({ visible_to_group_types: [] });

    expect(result).toEqual({ data: true, error: null });
    expect(supabase.rpcs).toEqual([saveCall([])]);
  });

  it("neither reads nor writes profile_info or profile_visibility itself", async () => {
    // Scripted so that code which does reach those tables runs to the end
    // and fails on the assertion below, not on a missing script.
    supabase = createSupabaseMock({
      "rpc:set_profile_visibility": [OK],
      profile_visibility: [OK, OK],
      profile_info: [{ data: FIELDS, error: null }, OK],
    });

    await updatePrivacySettings({ visible_to_group_types: ["friends"] });

    expect(supabase.queries.map((q) => q.table)).toEqual([]);
    expect(supabase.rpcs).toEqual([saveCall(["friends"])]);
  });

  it("answers Failed to update privacy settings when the call fails, refreshing nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({
      "rpc:set_profile_visibility": [
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      ],
    });

    const result = await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(result).toEqual({ data: null, error: "Failed to update privacy settings" });
    expect(supabase.rpcs).toEqual([saveCall(["family"])]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a kind that is not one of the four, touching nothing", async () => {
    // Scripted so that code which does reach the database runs to the end.
    supabase = createSupabaseMock({
      "rpc:set_profile_visibility": [OK],
      profile_visibility: [OK],
      profile_info: [{ data: FIELDS, error: null }, OK],
    });

    const result = await updatePrivacySettings({ visible_to_group_types: ["club"] });

    expect(result).toEqual({ data: null, error: VISIBILITY_INVALID });
    expect(supabase.queries).toEqual([]);
    expect(supabase.rpcs).toEqual([]);
  });

  it("refuses a missing choice, touching nothing", async () => {
    supabase = createSupabaseMock({ "rpc:set_profile_visibility": [OK] });

    const result = await updatePrivacySettings(null as never);

    expect(result).toEqual({ data: null, error: VISIBILITY_INVALID });
    expect(supabase.queries).toEqual([]);
    expect(supabase.rpcs).toEqual([]);
  });

  it("answers Not authenticated when signed out, touching nothing", async () => {
    getUserId.mockResolvedValue(null);
    supabase = createSupabaseMock({ "rpc:set_profile_visibility": [OK] });

    const result = await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(result).toEqual({ data: null, error: "Not authenticated" });
    expect(supabase.queries).toEqual([]);
    expect(supabase.rpcs).toEqual([]);
  });

  it("refreshes the settings and profile pages after a save", async () => {
    supabase = createSupabaseMock({ "rpc:set_profile_visibility": [OK] });

    await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(revalidatePath.mock.calls).toEqual([["/settings"], ["/profile"]]);
  });
});
