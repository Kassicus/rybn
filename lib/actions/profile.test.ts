import { describe, it, expect, vi, beforeEach } from "vitest";
import { profileEditSchema, type ProfileEditFormData } from "@/lib/schemas/profile";

/**
 * updateProfile is what the browser's profile form calls, and the app's
 * PUT /profile route calls it too. These pin what a save does to each
 * profile_info row:
 *
 *   - a field that already has a row keeps the setting on that row;
 *   - a field with no row takes the person's stored choice
 *     (profile_visibility), or all four kinds when they have never chosen;
 *   - a field sent empty or null is removed;
 *   - a field the input does not name is not touched.
 *
 * The input is checked with the form's own schema before anything is read or
 * written.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getUserId = vi.fn();
vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

const ensureProfile = vi.fn();
vi.mock("@/lib/auth/ensure-profile", () => ({
  ensureProfile: () => ensureProfile(),
}));

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };
type Row = Record<string, unknown>;

/**
 * The same shape as lib/actions/invitations.test.ts's mock: every chain
 * method returns the chain, the chain is thenable and has the terminal
 * methods, and responses are queued PER TABLE in call order. Each `from()`
 * also records the methods called on it and their arguments, so a test can
 * read every payload and filter.
 */
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

const { updateProfile, getUserProfile } = await import("./profile");

/** Every query on `table` whose chain called `method`. */
function queriesWith(table: string, method: string): Query[] {
  return supabase.queries.filter(
    (q) => q.table === table && q.calls.some((c) => c.method === method)
  );
}

function argsOf(query: Query, method: string): unknown[] {
  return query.calls.find((c) => c.method === method)?.args ?? [];
}

/** Every row upserted into profile_info, keyed by field name. */
function upserted(): Record<string, Row> {
  const rows = queriesWith("profile_info", "upsert").flatMap(
    (q) => argsOf(q, "upsert")[0] as Row[]
  );
  return Object.fromEntries(rows.map((row) => [row.field_name as string, row]));
}

/** Exactly what the browser's form sends: parsed by its schema. */
const BROWSER_FORM = {
  username: "sam",
  display_name: "Sam Rivera",
  bio: "",
  avatar_url: "https://img.clerk.com/abc",
  shoe_size: "10",
};
const form = (over: Record<string, unknown> = {}) =>
  profileEditSchema.parse({ ...BROWSER_FORM, ...over });

const SAVED_PROFILE = { id: "user_123", username: "sam", display_name: "Sam Rivera" };
const PROFILE_SAVED = { data: SAVED_PROFILE, error: null };
const OK = { data: null, error: null };
const ALL_FOUR = ["family", "friends", "work", "custom"];
const FAMILY_ONLY = { visibleToGroupTypes: ["family"], restrictToGroup: null };

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
  ensureProfile.mockResolvedValue("user_123");
  supabase = createSupabaseMock({});
});

describe("updateProfile", () => {
  it("keeps the setting a saved field already has", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        { data: [{ field_name: "shoe_size", privacy_settings: FAMILY_ONLY }], error: null },
        OK, // upsert
      ],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ data: SAVED_PROFILE });
    const rows = upserted();
    expect(Object.keys(rows)).toEqual(["shoe_size"]);
    expect(rows.shoe_size).toMatchObject({
      user_id: "user_123",
      category: "sizes",
      field_name: "shoe_size",
      field_value: "10",
    });
    expect(rows.shoe_size.privacy_settings).toEqual(FAMILY_ONLY);

    // The setting is read from the caller's own rows, for the fields being set.
    const [read] = queriesWith("profile_info", "select");
    expect(argsOf(read, "select")).toEqual(["field_name, privacy_settings"]);
    expect(argsOf(read, "eq")).toEqual(["user_id", "user_123"]);
    expect(argsOf(read, "in")).toEqual(["field_name", ["shoe_size"]]);
    const [write] = queriesWith("profile_info", "upsert");
    expect(argsOf(write, "upsert")[1]).toMatchObject({
      onConflict: "user_id,category,field_name",
    });
  });

  it("gives a new field the person's stored choice", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        { data: [{ field_name: "shoe_size", privacy_settings: FAMILY_ONLY }], error: null },
        OK,
      ],
      profile_visibility: [
        { data: { visible_to_group_types: ["family", "friends"] }, error: null },
      ],
    });

    await updateProfile(form({ shirt_size: "M" }));

    const rows = upserted();
    expect(rows.shirt_size).toMatchObject({ category: "sizes", field_value: "M" });
    expect(rows.shirt_size.privacy_settings).toEqual({
      visibleToGroupTypes: ["family", "friends"],
      restrictToGroup: null,
    });
    // The field that had a row still keeps its own.
    expect(rows.shoe_size.privacy_settings).toEqual(FAMILY_ONLY);

    const [choice] = queriesWith("profile_visibility", "select");
    expect(argsOf(choice, "eq")).toEqual(["user_id", "user_123"]);
  });

  it("gives a new field all four kinds when the person has never chosen", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [{ data: [], error: null }, OK],
      profile_visibility: [{ data: null, error: null }],
    });

    await updateProfile(form());

    expect(upserted().shoe_size.privacy_settings).toEqual({
      visibleToGroupTypes: ALL_FOUR,
      restrictToGroup: null,
    });
  });

  it("gives a field added after every field was cleared the stored choice", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        { data: [], error: null }, // no rows left
        OK, // upsert
        OK, // delete
      ],
      profile_visibility: [{ data: { visible_to_group_types: ["work"] }, error: null }],
    });

    await updateProfile(form({ shoe_size: "", hat_size: "7" }));

    const rows = upserted();
    expect(Object.keys(rows)).toEqual(["hat_size"]);
    expect(rows.hat_size.privacy_settings).toEqual({
      visibleToGroupTypes: ["work"],
      restrictToGroup: null,
    });
  });

  it("writes no field when the stored choice cannot be read", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [{ data: [], error: null }],
      profile_visibility: [
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      ],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ error: "Failed to load settings" });
    expect(queriesWith("profile_info", "upsert")).toEqual([]);
  });

  it("removes a field that was emptied", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [OK], // delete
    });

    const result = await updateProfile(form({ shoe_size: "" }));

    expect(result).toEqual({ data: SAVED_PROFILE });
    const deletes = queriesWith("profile_info", "delete");
    expect(deletes).toHaveLength(1);
    expect(argsOf(deletes[0], "eq")).toEqual(["user_id", "user_123"]);
    expect(argsOf(deletes[0], "in")).toEqual(["field_name", ["shoe_size"]]);
    expect(upserted().shoe_size).toBeUndefined();
  });

  it("removes a field sent as null", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [OK],
    });

    await updateProfile(form({ shoe_size: null }));

    const deletes = queriesWith("profile_info", "delete");
    expect(deletes).toHaveLength(1);
    expect(argsOf(deletes[0], "eq")).toEqual(["user_id", "user_123"]);
    expect(argsOf(deletes[0], "in")).toEqual(["field_name", ["shoe_size"]]);
    expect(upserted().shoe_size).toBeUndefined();
  });

  it("leaves a field the input does not name alone", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [{ data: [], error: null }, OK],
      profile_visibility: [{ data: null, error: null }],
    });

    await updateProfile(profileEditSchema.parse({ username: "sam", shirt_size: "L" }));

    expect(Object.keys(upserted())).toEqual(["shirt_size"]);
    expect(queriesWith("profile_info", "delete")).toEqual([]);
  });

  it.each([
    [{ username: "ab" }, "Username must be at least 3 characters"],
    [{ shoe_size: "1".repeat(21) }, "Shoe size must be at most 20 characters"],
    [{ birthday: "1990-02-30" }, "Please enter a valid date (YYYY-MM-DD)"],
  ])("refuses %j with the form's sentence, touching nothing", async (over, sentence) => {
    // Responses are scripted so that code which does reach the database runs
    // to the end and fails on the assertions below, not on a missing script.
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [{ data: [], error: null }, OK, OK],
      profile_visibility: [{ data: null, error: null }],
    });
    const input = {
      ...BROWSER_FORM,
      visible_to_group_types: [],
      ...over,
    } as ProfileEditFormData;

    const result = await updateProfile(input);

    expect(result).toEqual({ error: sentence });
    expect(supabase.queries).toEqual([]);
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("leaves the avatar alone when the input has none", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        { data: [{ field_name: "shoe_size", privacy_settings: FAMILY_ONLY }], error: null },
        OK,
      ],
    });
    const { avatar_url: _avatar, ...withoutAvatar } = BROWSER_FORM;

    await updateProfile(profileEditSchema.parse(withoutAvatar));

    const [update] = queriesWith("user_profiles", "update");
    const payload = argsOf(update, "update")[0] as Row;
    expect(payload).not.toHaveProperty("avatar_url");
    expect(payload).toMatchObject({ username: "sam", display_name: "Sam Rivera", bio: "" });
    expect(argsOf(update, "eq")).toEqual(["id", "user_123"]);
  });

  it("writes the avatar the input has, and none for an empty one", async () => {
    const script = () => ({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        { data: [{ field_name: "shoe_size", privacy_settings: FAMILY_ONLY }], error: null },
        OK,
      ],
    });

    supabase = createSupabaseMock(script());
    await updateProfile(form());
    const [given] = queriesWith("user_profiles", "update");
    expect(argsOf(given, "update")[0]).toMatchObject({
      avatar_url: "https://img.clerk.com/abc",
    });

    supabase = createSupabaseMock(script());
    await updateProfile(form({ avatar_url: "" }));
    const [emptied] = queriesWith("user_profiles", "update");
    expect(argsOf(emptied, "update")[0]).toMatchObject({ avatar_url: null });
  });

  it("answers Username is already taken for the database's 23505", async () => {
    supabase = createSupabaseMock({
      user_profiles: [
        {
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "user_profiles_username_key"',
          },
        },
      ],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ error: "Username is already taken" });
    expect(supabase.queries.map((q) => q.table)).toEqual(["user_profiles"]);
  });

  it("answers Not authenticated when signed out, touching nothing", async () => {
    getUserId.mockResolvedValue(null);

    const result = await updateProfile(form());

    expect(result).toEqual({ error: "Not authenticated" });
    expect(supabase.queries).toEqual([]);
    expect(ensureProfile).not.toHaveBeenCalled();
  });
});

describe("getUserProfile", () => {
  it("reads another person's profile by the columns its page shows", async () => {
    const person = {
      username: "riley",
      display_name: "Riley Park",
      avatar_url: null,
      bio: "Tea, not coffee.",
    };
    supabase = createSupabaseMock({
      user_profiles: [{ data: person, error: null }],
      profile_info: [{ data: [], error: null }],
    });

    const result = await getUserProfile("user_456");

    const [read] = queriesWith("user_profiles", "select");
    const columns = argsOf(read, "select")[0];
    expect(columns).not.toBe("*");
    const named = String(columns)
      .split(",")
      .map((column) => column.trim());
    expect(named).not.toContain("email");
    expect(named).not.toContain("email_preferences");
    // The page and its ProfileHeader read exactly these.
    expect([...named].sort()).toEqual(["avatar_url", "bio", "display_name", "username"]);
    expect(argsOf(read, "eq")).toEqual(["id", "user_456"]);

    expect(result).toEqual({ data: { ...person, profile_info: [] } });
  });
});
