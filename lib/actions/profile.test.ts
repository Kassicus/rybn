import { describe, it, expect, vi, beforeEach } from "vitest";
import { profileEditSchema, type ProfileEditFormData } from "@/lib/schemas/profile";
import { PROFILE_FIELD_NAMES } from "@/lib/profile/fields";

/**
 * updateProfile is what the browser's profile form calls, and the app's
 * PUT /profile route calls it too. These pin what a save does to each
 * profile_info row:
 *
 *   - a field that already has a row keeps the setting on that row: its
 *     write is an update of the value alone;
 *   - a field with no row (at the read, or by the time of its update) takes
 *     the person's stored choice (profile_visibility), or all four kinds when
 *     they have never chosen;
 *   - a field sent empty or null is removed;
 *   - a field the input does not name is not touched.
 *
 * The input is checked with the form's own schema, and both reads happen,
 * before anything is written.
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

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

/** The rows of each profile_info upsert, one list per call. */
function upsertCalls(): Row[][] {
  return queriesWith("profile_info", "upsert").map((q) => argsOf(q, "upsert")[0] as Row[]);
}

/** Every row upserted into profile_info, keyed by field name. */
function upserted(): Record<string, Row> {
  const rows = upsertCalls().flat();
  return Object.fromEntries(rows.map((row) => [row.field_name as string, row]));
}

/** The names each profile_info upsert wrote, one list per call. */
function upsertedNames(): string[][] {
  return upsertCalls().map((rows) => rows.map((row) => row.field_name as string));
}

/** Each profile_info update: its payload, what it matched on, and what it asked back. */
function fieldUpdates(): { payload: Row; matched: unknown[][]; select: unknown[] }[] {
  return queriesWith("profile_info", "update").map((q) => ({
    payload: argsOf(q, "update")[0] as Row,
    matched: q.calls.filter((c) => c.method === "eq").map((c) => c.args),
    select: argsOf(q, "select"),
  }));
}

/** The update a saved field's value is written with. */
const valueUpdate = (category: string, fieldName: string, value: string) => ({
  payload: { field_value: value },
  matched: [
    ["user_id", "user_123"],
    ["category", category],
    ["field_name", fieldName],
  ],
  select: ["id"],
});

/** True when some query wrote to profile_info. */
function wroteFields(): boolean {
  return ["insert", "update", "upsert", "delete"].some(
    (method) => queriesWith("profile_info", method).length > 0
  );
}

/** A save naming these fields. */
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
const SHOE_ROW = { category: "sizes", field_name: "shoe_size" };
const rowsRead = (...rows: Row[]) => ({ data: rows, error: null });
/** A saved field's update that found its row, and one that found none. */
const MATCHED = (id = "f-1") => ({ data: [{ id }], error: null });
const MATCHED_NONE = { data: [], error: null };
const choice = (kinds: string[] | null) => ({
  data: kinds === null ? null : { visible_to_group_types: kinds },
  error: null,
});

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
      profile_info: [rowsRead(SHOE_ROW), MATCHED()],
      profile_visibility: [choice(["family"])],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ data: SAVED_PROFILE });
    // The write is an update of the value alone, matched on the person, the
    // section and the name, so it can never change the setting.
    expect(fieldUpdates()).toEqual([valueUpdate("sizes", "shoe_size", "10")]);
    expect(queriesWith("profile_info", "upsert")).toEqual([]);

    // Which fields have rows is read from the caller's own rows.
    const [read] = queriesWith("profile_info", "select");
    expect(argsOf(read, "select")).toEqual(["category, field_name"]);
    expect(argsOf(read, "eq")).toEqual(["user_id", "user_123"]);
    expect(argsOf(read, "in")).toEqual(["field_name", ["shoe_size"]]);
    // Both reads, the stored choice included, come before any write.
    expect(supabase.queries.map((q) => [q.table, q.calls[0].method])).toEqual([
      ["profile_info", "select"],
      ["profile_visibility", "select"],
      ["user_profiles", "update"],
      ["profile_info", "update"],
    ]);
  });

  it("gives a new field the person's stored choice", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [rowsRead(SHOE_ROW), MATCHED(), OK],
      profile_visibility: [choice(["family", "friends"])],
    });

    await updateProfile(form({ shirt_size: "M" }));

    // The saved field is updated; the new one is upserted with the choice.
    expect(fieldUpdates()).toEqual([valueUpdate("sizes", "shoe_size", "10")]);
    expect(upsertedNames()).toEqual([["shirt_size"]]);
    const rows = upserted();
    expect(rows.shirt_size).toMatchObject({ category: "sizes", field_value: "M" });
    expect(rows.shirt_size.privacy_settings).toEqual({
      visibleToGroupTypes: ["family", "friends"],
      restrictToGroup: null,
    });
    const [write] = queriesWith("profile_info", "upsert");
    expect(argsOf(write, "upsert")[1]).toMatchObject({
      onConflict: "user_id,category,field_name",
    });

    const [read] = queriesWith("profile_visibility", "select");
    expect(argsOf(read, "eq")).toEqual(["user_id", "user_123"]);
  });

  it("writes a field that vanished between the read and the write as a new row with the stored choice", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        rowsRead(SHOE_ROW), // there at the read
        MATCHED_NONE, // gone by the update
        OK, // the new row
      ],
      profile_visibility: [choice(["family"])],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ data: SAVED_PROFILE });
    expect(fieldUpdates()).toEqual([valueUpdate("sizes", "shoe_size", "10")]);
    // What the person typed is kept, with their choice, never the column's default.
    expect(upsertedNames()).toEqual([["shoe_size"]]);
    expect(upserted().shoe_size).toEqual({
      user_id: "user_123",
      category: "sizes",
      field_name: "shoe_size",
      field_value: "10",
      privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null },
    });
  });

  it("answers the database's message when a saved field cannot be written", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        rowsRead(SHOE_ROW),
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
        OK,
      ],
      profile_visibility: [choice(["family"])],
    });

    const result = await updateProfile(form({ shirt_size: "M" }));

    expect(result).toEqual({ error: "canceling statement due to statement timeout" });
    expect(queriesWith("profile_info", "upsert")).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes every saved field and answers the first error when some of several cannot be written", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        rowsRead(
          SHOE_ROW,
          { category: "sizes", field_name: "shirt_size" },
          { category: "sizes", field_name: "hat_size" }
        ),
        MATCHED("f-1"), // shoe_size is written
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }, // shirt_size
        { data: null, error: { code: "40P01", message: "deadlock detected" } }, // hat_size
        OK, // scripted so a new-row write, were one made, would not fail on a missing script
        OK, // and a removal likewise
      ],
      profile_visibility: [choice(["family"])],
    });

    const result = await updateProfile(form({ shirt_size: "M", hat_size: "7", ring_size: "" }));

    // The first failure, in the form's order, is the one answered.
    expect(result).toEqual({ error: "canceling statement due to statement timeout" });
    // All three updates were issued, so the field that could be written was.
    expect(fieldUpdates()).toEqual([
      valueUpdate("sizes", "shoe_size", "10"),
      valueUpdate("sizes", "shirt_size", "M"),
      valueUpdate("sizes", "hat_size", "7"),
    ]);
    // Nothing after the updates runs: no new rows, no removals.
    expect(queriesWith("profile_info", "upsert")).toEqual([]);
    expect(queriesWith("profile_info", "delete")).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("gives a new field all four kinds when the person has never chosen", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [rowsRead(), OK],
      profile_visibility: [choice(null)],
    });

    await updateProfile(form());

    expect(upserted().shoe_size.privacy_settings).toEqual({
      visibleToGroupTypes: ALL_FOUR,
      restrictToGroup: null,
    });
  });

  it("gives a new field no kinds for a person who chose only themselves", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [rowsRead(), OK],
      profile_visibility: [choice([])],
    });

    await updateProfile(form());

    expect(upserted().shoe_size.privacy_settings).toEqual({
      visibleToGroupTypes: [],
      restrictToGroup: null,
    });
  });

  it("gives a field added after every field was cleared the stored choice", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        rowsRead(), // no rows left
        OK, // upsert
        OK, // delete
      ],
      profile_visibility: [choice(["work"])],
    });

    await updateProfile(form({ shoe_size: "", hat_size: "7" }));

    const rows = upserted();
    expect(Object.keys(rows)).toEqual(["hat_size"]);
    expect(rows.hat_size.privacy_settings).toEqual({
      visibleToGroupTypes: ["work"],
      restrictToGroup: null,
    });
  });

  it("counts a saved row only under the field's own section", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      // A row with the same name under another section is not this field's.
      profile_info: [rowsRead({ category: "personal", field_name: "shoe_size" }), OK],
      profile_visibility: [choice(["family"])],
    });

    await updateProfile(form());

    expect(upserted().shoe_size).toMatchObject({
      category: "sizes",
      privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null },
    });
  });

  it("touches nothing when the saved fields cannot be read", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
        OK,
      ],
      profile_visibility: [choice(null)],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ error: "canceling statement due to statement timeout" });
    expect(queriesWith("user_profiles", "update")).toEqual([]);
    expect(wroteFields()).toBe(false);
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("touches nothing when the stored choice cannot be read", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [rowsRead(), OK],
      profile_visibility: [
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      ],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ error: "Failed to update profile" });
    expect(queriesWith("user_profiles", "update")).toEqual([]);
    expect(wroteFields()).toBe(false);
    expect(ensureProfile).not.toHaveBeenCalled();
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
      profile_info: [rowsRead(), OK],
      profile_visibility: [choice(null)],
    });

    await updateProfile(profileEditSchema.parse({ username: "sam", shirt_size: "L" }));

    expect(Object.keys(upserted())).toEqual(["shirt_size"]);
    expect(queriesWith("profile_info", "delete")).toEqual([]);
  });

  it("handles a save naming all 23 fields, the empty ones as \"\"", async () => {
    const everyFieldEmpty = Object.fromEntries(PROFILE_FIELD_NAMES.map((name) => [name, ""]));
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [
        rowsRead(SHOE_ROW, { category: "dates", field_name: "birthday" }),
        MATCHED("f-1"), // shoe_size
        MATCHED("f-2"), // birthday
        OK, // new field
        OK, // delete
      ],
      profile_visibility: [choice(["family", "friends"])],
    });

    await updateProfile(
      profileEditSchema.parse({
        ...everyFieldEmpty,
        ...BROWSER_FORM,
        hobbies: "Chess",
        birthday: "1990-05-04",
        visible_to_group_types: [],
      })
    );

    // The saved fields keep their settings; the new one takes the stored
    // choice. A visible_to_group_types in the input is no part of a save.
    expect(fieldUpdates()).toEqual([
      valueUpdate("sizes", "shoe_size", "10"),
      valueUpdate("dates", "birthday", "1990-05-04"),
    ]);
    expect(upsertedNames()).toEqual([["hobbies"]]);
    const rows = upserted();
    expect(rows.hobbies.privacy_settings).toEqual({
      visibleToGroupTypes: ["family", "friends"],
      restrictToGroup: null,
    });

    // One delete, naming exactly the empty fields.
    const deletes = queriesWith("profile_info", "delete");
    expect(deletes).toHaveLength(1);
    expect(argsOf(deletes[0], "in")).toEqual([
      "field_name",
      PROFILE_FIELD_NAMES.filter((name) => !["shoe_size", "hobbies", "birthday"].includes(name)),
    ]);
  });

  it.each([
    [{ username: "ab" }, "Username must be at least 3 characters"],
    [{ shoe_size: "1".repeat(21) }, "Shoe size must be at most 20 characters"],
    [{ birthday: "1990-02-30" }, "Please enter a valid date (YYYY-MM-DD)"],
    // A U+0000 cannot be stored: in a field it is refused before the basics are written, not after.
    [{ shirt_size: "M\u0000" }, "That has characters Rybn can't save. Try typing it again."],
    [{ display_name: "Sam\u0000Rivera" }, "That has characters Rybn can't save. Try typing it again."],
    [{ bio: "Coffee\u0000" }, "That has characters Rybn can't save. Try typing it again."],
    [{ favorite_colors: "Green\nnavy" }, "That has characters Rybn can't save. Try typing it again."],
  ])("refuses %j with the form's sentence, touching nothing", async (over, sentence) => {
    // Responses are scripted so that code which does reach the database runs
    // to the end and fails on the assertions below, not on a missing script.
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [rowsRead(), OK, OK],
      profile_visibility: [choice(null)],
    });
    const input = {
      ...BROWSER_FORM,
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
      profile_info: [rowsRead(SHOE_ROW), MATCHED()],
      profile_visibility: [choice(null)],
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
      profile_info: [rowsRead(SHOE_ROW), MATCHED()],
      profile_visibility: [choice(null)],
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
      profile_info: [rowsRead(SHOE_ROW)],
      profile_visibility: [choice(null)],
    });

    const result = await updateProfile(form());

    expect(result).toEqual({ error: "Username is already taken" });
    expect(wroteFields()).toBe(false);
  });

  it("answers Not authenticated when signed out, touching nothing", async () => {
    getUserId.mockResolvedValue(null);

    const result = await updateProfile(form());

    expect(result).toEqual({ error: "Not authenticated" });
    expect(supabase.queries).toEqual([]);
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("refreshes the profile pages after a save", async () => {
    supabase = createSupabaseMock({
      user_profiles: [PROFILE_SAVED],
      profile_info: [rowsRead(SHOE_ROW), MATCHED()],
      profile_visibility: [choice(null)],
    });

    await updateProfile(form());

    expect(revalidatePath.mock.calls).toEqual([["/profile"], ["/profile/edit"]]);
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
    const fields = [
      { id: "f-1", category: "sizes", field_name: "shoe_size", field_value: "9" },
    ];
    supabase = createSupabaseMock({
      user_profiles: [{ data: person, error: null }],
      profile_info: [{ data: fields, error: null }],
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

    // And each field by the columns the page shows of it.
    const [fieldRead] = queriesWith("profile_info", "select");
    expect(argsOf(fieldRead, "select")).toEqual(["id, category, field_name, field_value"]);
    expect(argsOf(fieldRead, "eq")).toEqual(["user_id", "user_456"]);

    expect(result).toEqual({ data: { ...person, profile_info: fields } });
  });
});
