import { describe, it, expect, vi, beforeEach } from "vitest";
import { isMixed } from "@/lib/profile/visibility";

/**
 * The Settings page's "Who can see your profile fields?" is one choice per
 * person, kept in profile_visibility. getMySettings answers that row (all four
 * kinds when there is none); updatePrivacySettings stores it and writes it
 * onto every profile_info field the person has, with one update that names
 * only privacy_settings.
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
type Row = Record<string, unknown>;

/** The same mock as ./profile.test.ts: queued per table, every call recorded. */
function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, responses] of Object.entries(script)) {
    queues[table] = [...responses];
  }
  const queries: Query[] = [];

  return {
    queries,
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

/** Every query on profile_info, whatever it did. */
function fieldQueries(): Query[] {
  return supabase.queries.filter((q) => q.table === "profile_info");
}

/** The one write to profile_info a Settings save makes, and its payload. */
function theFieldWrite(): { query: Query; payload: Row } {
  const queries = fieldQueries();
  expect(queries).toHaveLength(1);
  expect(queries[0].calls.map((c) => c.method)).toEqual(["update", "eq"]);
  return { query: queries[0], payload: argsOf(queries[0], "update")[0] as Row };
}

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
  it("stores the choice for a person with no fields", async () => {
    supabase = createSupabaseMock({
      profile_visibility: [OK],
      profile_info: [OK], // the update matches no row
    });

    const result = await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(result).toEqual({ data: true, error: null });
    const stored = queriesWith("profile_visibility", "upsert");
    expect(stored).toHaveLength(1);
    expect(argsOf(stored[0], "upsert")[0]).toEqual({
      user_id: "user_123",
      visible_to_group_types: ["family"],
    });
    expect(argsOf(stored[0], "upsert")[1]).toMatchObject({ onConflict: "user_id" });
  });

  it("stores the choice and writes it onto every field", async () => {
    supabase = createSupabaseMock({
      profile_visibility: [OK],
      profile_info: [OK],
    });

    const result = await updatePrivacySettings({ visible_to_group_types: ["friends"] });

    expect(result).toEqual({ data: true, error: null });
    // The fields are written first, then the choice is stored.
    expect(supabase.queries.map((q) => q.table)).toEqual(["profile_info", "profile_visibility"]);
    const [stored] = queriesWith("profile_visibility", "upsert");
    expect(argsOf(stored, "upsert")[0]).toEqual({
      user_id: "user_123",
      visible_to_group_types: ["friends"],
    });

    // Exactly one write to profile_info: every row of the caller's, and it
    // names the setting only, never a field's value.
    const { query, payload } = theFieldWrite();
    expect(argsOf(query, "eq")).toEqual(["user_id", "user_123"]);
    expect(payload).toEqual({
      privacy_settings: { visibleToGroupTypes: ["friends"], restrictToGroup: null },
    });
    expect(payload).not.toHaveProperty("field_value");

    // Afterwards no field differs from the choice, the tied one included.
    expect(isMixed(["friends"], FIELDS.map((field) => field.privacy_settings))).toBe(true);
    const after = FIELDS.map((field) => ({ ...field, ...payload }));
    expect(isMixed(["friends"], after.map((field) => field.privacy_settings))).toBe(false);
  });

  it("stores the kinds once each, in the order family, friends, work, custom", async () => {
    supabase = createSupabaseMock({
      profile_visibility: [OK],
      profile_info: [OK],
    });

    await updatePrivacySettings({ visible_to_group_types: ["work", "family", "work"] });

    const [stored] = queriesWith("profile_visibility", "upsert");
    expect(argsOf(stored, "upsert")[0]).toEqual({
      user_id: "user_123",
      visible_to_group_types: ["family", "work"],
    });
    expect(theFieldWrite().payload).toEqual({
      privacy_settings: { visibleToGroupTypes: ["family", "work"], restrictToGroup: null },
    });
  });

  it("stores an empty choice as only you, on the choice and on every field", async () => {
    supabase = createSupabaseMock({
      profile_visibility: [OK],
      profile_info: [OK],
    });

    const result = await updatePrivacySettings({ visible_to_group_types: [] });

    expect(result).toEqual({ data: true, error: null });
    const [stored] = queriesWith("profile_visibility", "upsert");
    expect(argsOf(stored, "upsert")[0]).toEqual({
      user_id: "user_123",
      visible_to_group_types: [],
    });
    expect(theFieldWrite().payload).toEqual({
      privacy_settings: { visibleToGroupTypes: [], restrictToGroup: null },
    });
  });

  it("refuses a kind that is not one of the four, touching nothing", async () => {
    // Scripted so that code which does reach the database runs to the end.
    supabase = createSupabaseMock({
      profile_visibility: [OK],
      profile_info: [{ data: FIELDS, error: null }, OK],
    });

    const result = await updatePrivacySettings({ visible_to_group_types: ["club"] });

    expect(result).toEqual({ data: null, error: VISIBILITY_INVALID });
    expect(supabase.queries).toEqual([]);
  });

  it("refuses a missing choice, touching nothing", async () => {
    const result = await updatePrivacySettings(null as never);

    expect(result).toEqual({ data: null, error: VISIBILITY_INVALID });
    expect(supabase.queries).toEqual([]);
  });

  // The stored choice is what the Settings page shows. Storing it only after
  // the fields took it means a failure never leaves the page showing a choice
  // the fields do not have, so choosing it again is a change and is saved.
  it("stores no choice when the fields cannot be written", async () => {
    supabase = createSupabaseMock({
      profile_visibility: [OK],
      profile_info: [
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      ],
    });

    const result = await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(result).toEqual({ data: null, error: "Failed to update privacy settings" });
    expect(supabase.queries.map((q) => q.table)).not.toContain("profile_visibility");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers Failed to update privacy settings when the choice cannot be stored after the fields were written", async () => {
    supabase = createSupabaseMock({
      profile_visibility: [
        { data: null, error: { code: "42501", message: "permission denied for table profile_visibility" } },
      ],
      profile_info: [OK],
    });

    const result = await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(result).toEqual({ data: null, error: "Failed to update privacy settings" });
    // The fields already have the new setting.
    expect(theFieldWrite().payload).toEqual({
      privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes the settings and profile pages after a save", async () => {
    supabase = createSupabaseMock({
      profile_visibility: [OK],
      profile_info: [OK],
    });

    await updatePrivacySettings({ visible_to_group_types: ["family"] });

    expect(revalidatePath.mock.calls).toEqual([["/settings"], ["/profile"]]);
  });
});
