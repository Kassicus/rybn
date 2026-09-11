import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getUpcomingOccasions() is a thin mapper: get_upcoming_occasions() does all
 * the real work (privacy, derivation, the union) inside the database, so the
 * one thing this action can get wrong on its own is the 9-column
 * snake_case -> camelCase row mapping. That is exactly the kind of bug that
 * type-checks cleanly -- swapping celebrant_username and
 * celebrant_display_name, say, both `string | null` -- and would ship
 * silently without a test pinning the mapping column by column.
 *
 * Follows the mocking pattern established in ./invitations.test.ts: mock
 * @/lib/supabase/server and @/lib/auth/require-auth the same way (next/cache
 * is that file's third mock, but getUpcomingOccasions() never revalidates
 * anything, so there is nothing here to mock it for). This action only ever
 * calls supabase.rpc(), so the stub is simpler than invitations.test.ts's
 * chainable table mock: no .from()/.select() chain needed, just a scripted
 * rpc() resolution.
 */

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

const { getUpcomingOccasions } = await import("./occasions");

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
});

describe("getUpcomingOccasions", () => {
  it("maps every one of the 9 RPC columns to the right camelCase field", async () => {
    // Every column gets a distinct, identifiable value -- not all-nulls --
    // so a transposition between two same-typed columns (e.g. the two
    // celebrant name columns, or occasion_id/group_id, both uuid-shaped)
    // fails loudly instead of type-checking its way into production.
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
