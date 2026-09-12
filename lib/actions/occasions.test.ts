import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getUpcomingOccasions() is a thin mapper: get_upcoming_occasions() does all
 * the real work (privacy, derivation, the union) inside the database, so the
 * one thing this action can get wrong on its own is the 12-column
 * snake_case -> camelCase row mapping (9 original plus the 3 partner_*
 * columns added when a couple's anniversary can be shown as one row). That
 * is exactly the kind of bug that type-checks cleanly -- swapping
 * celebrant_username and celebrant_display_name, say, both `string | null`,
 * or silently dropping partner_id into a hardcoded null -- and would ship
 * silently without a test pinning the mapping column by column.
 *
 * Follows the mocking pattern established in ./invitations.test.ts: mock
 * @/lib/supabase/server and @/lib/auth/require-auth the same way. Task 5's
 * three writers below DO revalidate, unlike getUpcomingOccasions, so
 * next/cache is now mocked too -- omitted when this file only had a reader.
 *
 * getUpcomingOccasions only ever calls supabase.rpc(), so its own tests keep
 * the simple rpc-only stub. The writers below call .from(...).insert() /
 * .update() / .delete(), so the shared supabase mock also grows the
 * chainable table mock from ./invitations.test.ts, with insert/update/delete
 * spied so a test can assert on the exact payload sent to Postgres (e.g.
 * that created_by is the caller's id, not something defaulted).
 */

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
const insertSpy = vi.fn();
const updateSpy = vi.fn();
const deleteSpy = vi.fn();
const eqSpy = vi.fn();

/**
 * Same shape as invitations.test.ts's createSupabaseMock: every chain method
 * returns the chain, and the chain is thenable so `await from().select().eq()`
 * resolves without a terminal call while `.maybeSingle()` is its own promise.
 * Responses are queued per table and consumed in call order.
 *
 * insert/update/delete are additionally spied (not just chain-returning) so a
 * test can assert on exactly what was sent, e.g. that createGroupDate's
 * insert payload includes `created_by: userId`.
 */
function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, responses] of Object.entries(script)) {
    queues[table] = [...responses];
  }

  return {
    from(table: string) {
      const next = () => {
        const queue = queues[table];
        if (!queue || queue.length === 0) {
          throw new Error(`No scripted Supabase response left for "${table}"`);
        }
        return queue.shift();
      };

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          eqSpy(table, ...args);
          return chain;
        },
        insert: (payload: unknown) => {
          insertSpy(table, payload);
          return chain;
        },
        update: (payload: unknown) => {
          updateSpy(table, payload);
          return chain;
        },
        delete: () => {
          deleteSpy(table);
          return chain;
        },
      };
      chain.maybeSingle = async () => next();
      chain.single = async () => next();
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(next()).then(resolve);
      return chain;
    },
  };
}

let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...supabase,
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

const { revalidatePath } = await import("next/cache");
const { getUpcomingOccasions, createGroupDate, updateGroupDate, deleteGroupDate } =
  await import("./occasions");

const GROUP_ID = "11111111-1111-1111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
  // Reassigned per-test where a writer test needs specific scripted
  // responses; getUpcomingOccasions's own tests never touch .from(), so an
  // empty script is fine as the default.
  supabase = createSupabaseMock({});
});

describe("getUpcomingOccasions", () => {
  it("maps every one of the 12 RPC columns to the right camelCase field", async () => {
    // Every column gets a distinct, identifiable value -- not all-nulls --
    // so a transposition between two same-typed columns (e.g. the two
    // celebrant name columns, or occasion_id/group_id, both uuid-shaped)
    // fails loudly instead of type-checking its way into production.
    //
    // The three partner_* columns are exercised the same way and are the
    // one thing this test exists to pin down beyond the original 9: a
    // mapper that drops them (returns partnerId: null regardless of the RPC
    // row) would still type-check -- null is a valid UpcomingOccasion value
    // -- and would render a viewer entitled to see both partners as if they
    // could see only one, with no error anywhere. Distinct, non-null values
    // here mean this test FAILS on that exact silent failure, not just on a
    // gross wiring break.
    rpc.mockResolvedValue({
      data: [
        {
          occasion_id: "occasion-id-1",
          kind: "anniversary",
          name: "name-value",
          occasion_date: "2026-10-05",
          celebrant_id: "celebrant-id-1",
          celebrant_username: "celebrant-username-1",
          celebrant_display_name: "celebrant-display-name-1",
          group_id: "group-id-1",
          group_name: "group-name-1",
          partner_id: "partner-id-1",
          partner_username: "partner-username-1",
          partner_display_name: "partner-display-name-1",
        },
      ],
      error: null,
    });

    const result = await getUpcomingOccasions();

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([
      {
        occasionId: "occasion-id-1",
        kind: "anniversary",
        name: "name-value",
        occasionDate: "2026-10-05",
        celebrantId: "celebrant-id-1",
        celebrantUsername: "celebrant-username-1",
        celebrantDisplayName: "celebrant-display-name-1",
        groupId: "group-id-1",
        groupName: "group-name-1",
        partnerId: "partner-id-1",
        partnerUsername: "partner-username-1",
        partnerDisplayName: "partner-display-name-1",
      },
    ]);
  });

  it("passes daysAhead through as p_days_ahead, defaulting to 30", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await getUpcomingOccasions();
    expect(rpc).toHaveBeenCalledWith("get_upcoming_occasions", {
      p_days_ahead: 30,
    });

    await getUpcomingOccasions(90);
    expect(rpc).toHaveBeenCalledWith("get_upcoming_occasions", {
      p_days_ahead: 90,
    });
  });

  it("maps a derived birthday row, where occasion_id and the group columns are NULL", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          occasion_id: null,
          kind: "birthday",
          name: null,
          occasion_date: "2026-11-20",
          celebrant_id: "celebrant-id-2",
          celebrant_username: "celebrant-username-2",
          celebrant_display_name: "celebrant-display-name-2",
          group_id: null,
          group_name: null,
          partner_id: null,
          partner_username: null,
          partner_display_name: null,
        },
      ],
      error: null,
    });

    const result = await getUpcomingOccasions();

    expect(result.data).toEqual([
      {
        occasionId: null,
        kind: "birthday",
        name: null,
        occasionDate: "2026-11-20",
        celebrantId: "celebrant-id-2",
        celebrantUsername: "celebrant-username-2",
        celebrantDisplayName: "celebrant-display-name-2",
        groupId: null,
        groupName: null,
        partnerId: null,
        partnerUsername: null,
        partnerDisplayName: null,
      },
    ]);
  });

  it("maps a group-date row, where celebrant_id and both celebrant name columns are NULL", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          occasion_id: "occasion-id-3",
          kind: "group_date",
          name: "Holiday Party",
          occasion_date: "2026-12-19",
          celebrant_id: null,
          celebrant_username: null,
          celebrant_display_name: null,
          group_id: "group-id-3",
          group_name: "group-name-3",
          partner_id: null,
          partner_username: null,
          partner_display_name: null,
        },
      ],
      error: null,
    });

    const result = await getUpcomingOccasions();

    expect(result.data).toEqual([
      {
        occasionId: "occasion-id-3",
        kind: "group_date",
        name: "Holiday Party",
        occasionDate: "2026-12-19",
        celebrantId: null,
        celebrantUsername: null,
        celebrantDisplayName: null,
        groupId: "group-id-3",
        groupName: "group-name-3",
        partnerId: null,
        partnerUsername: null,
        partnerDisplayName: null,
      },
    ]);
  });

  it("returns an empty array when the RPC resolves data: null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await getUpcomingOccasions();

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([]);
  });

  it("returns a generic message on RPC error, without leaking the provider's own text", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function public.get_upcoming_occasions(integer) does not exist" },
    });

    const result = await getUpcomingOccasions();

    expect(result.data).toBeUndefined();
    expect(result.error).toBe("Failed to load upcoming occasions.");
    expect(result.error).not.toContain("does not exist");
    expect(result.error).not.toContain("42883");
  });

  it("returns Not authenticated when signed out, without calling the RPC", async () => {
    getUserId.mockResolvedValue(null);

    const result = await getUpcomingOccasions();

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * createGroupDate, updateGroupDate and deleteGroupDate are the three writers
 * Task 5 adds. get_upcoming_occasions() has no analog here -- these hit the
 * occasions table directly -- so what these tests pin is the action's own
 * logic: the schema gate ahead of every database call, the explicit
 * created_by claim the INSERT policy requires, the 42501 -> membership
 * message translation, and the not-found-or-not-yours message each of
 * updateGroupDate and deleteGroupDate returns on a zero-row result -- worded
 * differently per action ("...to edit" vs "...to delete"), but each one
 * never distinguishes a missing occasion from one that is not the caller's
 * (that would make the action an oracle for which occasion ids exist -- the
 * same reasoning acceptInvitation() documents), and that every writer
 * revalidates both the dashboard and the group page.
 */
describe("createGroupDate", () => {
  it("sets created_by to the caller's id explicitly, not a value the INSERT policy would have to trust unverified", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: "occasion-1" }, error: null }],
    });

    await createGroupDate({
      groupId: GROUP_ID,
      name: "Christmas 2026",
      occasionDate: "2026-12-25",
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "occasions",
      expect.objectContaining({ created_by: "user_123" })
    );
  });

  it("rejects invalid input before ever reaching the database", async () => {
    const result = await createGroupDate({
      groupId: "not-a-uuid",
      name: "   ",
      occasionDate: "12/25/2026",
    });

    expect(result.error).toBeTruthy();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('reports "You are not a member of this group" on a 42501, not the raw policy error', async () => {
    supabase = createSupabaseMock({
      occasions: [
        {
          data: null,
          error: {
            code: "42501",
            message: 'new row violates row-level security policy for table "occasions"',
          },
        },
      ],
    });

    const result = await createGroupDate({
      groupId: GROUP_ID,
      name: "Christmas 2026",
      occasionDate: "2026-12-25",
    });

    expect(result.error).toBe("You are not a member of this group");
    expect(result.error).not.toContain("row-level security");
  });

  it("revalidates /dashboard and the group's page", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: "occasion-1" }, error: null }],
    });

    await createGroupDate({
      groupId: GROUP_ID,
      name: "Christmas 2026",
      occasionDate: "2026-12-25",
    });

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${GROUP_ID}`);
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await createGroupDate({
      groupId: GROUP_ID,
      name: "Christmas 2026",
      occasionDate: "2026-12-25",
    });

    expect(result).toEqual({ error: "Not authenticated" });
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("updateGroupDate", () => {
  it("rejects invalid input before ever reaching the database", async () => {
    const result = await updateGroupDate("occasion-1", {
      name: "",
      occasionDate: "not-a-date",
    });

    expect(result.error).toBeTruthy();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("scopes the update to kind = group_date, so it can never reach a celebrated occasion", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: "occasion-1", group_id: GROUP_ID }, error: null }],
    });

    await updateGroupDate("occasion-1", {
      name: "Christmas Party",
      occasionDate: "2026-12-24",
    });

    expect(eqSpy).toHaveBeenCalledWith("occasions", "kind", "group_date");
  });

  it("returns a not-found-or-not-yours message on a zero-row result, without revealing which", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: null, error: null }],
    });

    const result = await updateGroupDate("occasion-1", {
      name: "Christmas Party",
      occasionDate: "2026-12-24",
    });

    // A zero-row result means "does not exist" OR "not yours" and this
    // message must not say which -- distinguishing them would let a caller
    // enumerate which occasion ids exist.
    expect(result.error).toBe("That occasion no longer exists, or is not yours to edit");
    expect(updateSpy).toHaveBeenCalled();
  });

  it("revalidates /dashboard and the occasion's group page", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: "occasion-1", group_id: GROUP_ID }, error: null }],
    });

    await updateGroupDate("occasion-1", {
      name: "Christmas Party",
      occasionDate: "2026-12-24",
    });

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${GROUP_ID}`);
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await updateGroupDate("occasion-1", {
      name: "Christmas Party",
      occasionDate: "2026-12-24",
    });

    expect(result).toEqual({ error: "Not authenticated" });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("deleteGroupDate", () => {
  it("scopes the delete to kind = group_date, so it can never reach a celebrated occasion", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: "occasion-1", group_id: GROUP_ID }, error: null }],
    });

    await deleteGroupDate("occasion-1");

    expect(eqSpy).toHaveBeenCalledWith("occasions", "kind", "group_date");
  });

  it("returns a not-found-or-not-yours message on a zero-row result, without revealing which", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: null, error: null }],
    });

    const result = await deleteGroupDate("occasion-1");

    expect(result.error).toBe("That occasion no longer exists, or is not yours to delete");
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("revalidates /dashboard and the occasion's group page", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: "occasion-1", group_id: GROUP_ID }, error: null }],
    });

    await deleteGroupDate("occasion-1");

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/groups/${GROUP_ID}`);
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await deleteGroupDate("occasion-1");

    expect(result).toEqual({ error: "Not authenticated" });
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
