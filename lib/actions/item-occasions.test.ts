import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Follows the mocking pattern established in ./occasions.test.ts: mock
 * @/lib/auth/require-auth, next/cache and @/lib/supabase/server the same way,
 * with a chainable table mock whose insert/update/delete/select/in/eq calls
 * are spied so a test can assert on the exact payload and columns sent to
 * Postgres.
 *
 * One addition over occasions.test.ts's mock: `from` itself is spied
 * (fromSpy), not just the methods chained off it. getTagsForItems([]) must
 * short-circuit before the database is EVER reached -- not merely before a
 * particular method is called on it -- so the assertion needs to see whether
 * `.from(...)` was invoked at all, which the existing helper doesn't expose.
 *
 * `callOrder` is a second addition: tagItemForMyOccasion has to call the RPC
 * and then the insert, in that order, and a plain "both were called" assertion
 * cannot tell that apart from "insert first, then rpc" or "both fired
 * independently". Both rpc() and chain.insert() push their name onto this
 * array at the moment they are invoked (not when their promise resolves), so
 * the array records true call order even though everything here is async.
 */

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const callOrder: string[] = [];
const rpc = vi.fn();
const fromSpy = vi.fn();
const insertSpy = vi.fn();
const deleteSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();

function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, responses] of Object.entries(script)) {
    queues[table] = [...responses];
  }

  return {
    from(table: string) {
      fromSpy(table);
      const next = () => {
        const queue = queues[table];
        if (!queue || queue.length === 0) {
          throw new Error(`No scripted Supabase response left for "${table}"`);
        }
        return queue.shift();
      };

      const chain: Record<string, unknown> = {
        select: (...args: unknown[]) => {
          selectSpy(table, ...args);
          return chain;
        },
        eq: (...args: unknown[]) => {
          eqSpy(table, ...args);
          return chain;
        },
        in: (...args: unknown[]) => {
          inSpy(table, ...args);
          return chain;
        },
        insert: (payload: unknown) => {
          callOrder.push("insert");
          insertSpy(table, payload);
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
    rpc: (...args: unknown[]) => {
      callOrder.push("rpc");
      return rpc(...args);
    },
  }),
}));

const { revalidatePath } = await import("next/cache");
const {
  tagItemForMyOccasion,
  tagItemForGroupDate,
  untagItem,
  getTagsForItems,
} = await import("./item-occasions");

const USER_ID = "user-id-1";
const ITEM_ID = "item-id-1";
const OCCASION_ID = "occasion-id-1";
const GROUP_OCCASION_ID = "group-occasion-id-1";

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  getUserId.mockResolvedValue(USER_ID);
  supabase = createSupabaseMock({});
});

describe("tagItemForMyOccasion", () => {
  it("calls get_or_create_occasion with the given kind, then inserts (item_id, occasion_id), in that order", async () => {
    rpc.mockResolvedValue({ data: OCCASION_ID, error: null });
    supabase = createSupabaseMock({
      wishlist_item_occasions: [{ data: null, error: null }],
    });

    const result = await tagItemForMyOccasion(ITEM_ID, "birthday");

    expect(rpc).toHaveBeenCalledWith("get_or_create_occasion", {
      p_kind: "birthday",
    });
    expect(insertSpy).toHaveBeenCalledWith("wishlist_item_occasions", {
      item_id: ITEM_ID,
      occasion_id: OCCASION_ID,
    });
    // Not just "both happened" -- happened in THIS order. Swapping the insert
    // ahead of the RPC would still satisfy both toHaveBeenCalledWith checks
    // above but fails this one.
    expect(callOrder).toEqual(["rpc", "insert"]);
    expect(result).toEqual({ data: { occasionId: OCCASION_ID } });
  });

  it('maps a 22023 from get_or_create_occasion ("no date on file") to "Add your birthday to your profile first", not a generic failure', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "no birthday on file for this account" },
    });

    const result = await tagItemForMyOccasion(ITEM_ID, "birthday");

    expect(result).toEqual({
      error: "Add your birthday to your profile first",
    });
    // The RPC failed, so the insert must never be attempted.
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('maps a 42501 from the insert ("not the owner") to "You can only tag your own items", not the raw policy error', async () => {
    rpc.mockResolvedValue({ data: OCCASION_ID, error: null });
    supabase = createSupabaseMock({
      wishlist_item_occasions: [
        {
          data: null,
          error: {
            code: "42501",
            message:
              'new row violates row-level security policy for table "wishlist_item_occasions"',
          },
        },
      ],
    });

    const result = await tagItemForMyOccasion(ITEM_ID, "birthday");

    expect(result).toEqual({ error: "You can only tag your own items" });
    expect((result as { error: string }).error).not.toContain(
      "row-level security"
    );
  });

  it("revalidates /wishlist and the caller's own wishlist page on success", async () => {
    rpc.mockResolvedValue({ data: OCCASION_ID, error: null });
    supabase = createSupabaseMock({
      wishlist_item_occasions: [{ data: null, error: null }],
    });

    await tagItemForMyOccasion(ITEM_ID, "birthday");

    expect(revalidatePath).toHaveBeenCalledWith("/wishlist");
    expect(revalidatePath).toHaveBeenCalledWith(`/wishlist/user/${USER_ID}`);
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await tagItemForMyOccasion(ITEM_ID, "birthday");

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe("tagItemForGroupDate", () => {
  it("verifies the occasion (id + kind = group_date, filtered through occasions' own SELECT policy) then inserts, without calling get_or_create_occasion", async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: GROUP_OCCASION_ID }, error: null }],
      wishlist_item_occasions: [{ data: null, error: null }],
    });

    const result = await tagItemForGroupDate(ITEM_ID, GROUP_OCCASION_ID);

    expect(rpc).not.toHaveBeenCalled();
    expect(eqSpy).toHaveBeenCalledWith("occasions", "id", GROUP_OCCASION_ID);
    expect(eqSpy).toHaveBeenCalledWith("occasions", "kind", "group_date");
    expect(insertSpy).toHaveBeenCalledWith("wishlist_item_occasions", {
      item_id: ITEM_ID,
      occasion_id: GROUP_OCCASION_ID,
    });
    expect(result).toEqual({ data: { occasionId: GROUP_OCCASION_ID } });
  });

  /**
   * The occasion-verification query is exactly what a caller passing a
   * BIRTHDAY occasion's id would hit: `.eq("kind", "group_date")` excludes
   * it, so Postgres hands back zero rows -- the identical shape to a
   * nonexistent id or a real group_date the caller cannot see (not a group
   * member). All three collapse to this one scripted response, which is
   * exactly why one message below covers all three; there is nothing to
   * distinguish them by from here.
   *
   * Breaks if the `.eq("kind", "group_date")` filter (or the lookup
   * entirely) is removed from tagItemForGroupDate -- the function would then
   * proceed straight to the insert, and insertSpy would have been called.
   */
  it("refuses to tag using a birthday occasion's id, without reaching the insert", async () => {
    const BIRTHDAY_OCCASION_ID = "birthday-occasion-id-1";
    supabase = createSupabaseMock({
      occasions: [{ data: null, error: null }],
    });

    const result = await tagItemForGroupDate(ITEM_ID, BIRTHDAY_OCCASION_ID);

    expect(result).toEqual({
      error: "That occasion no longer exists, or is not yours to tag",
    });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('maps a 42501 from the insert to "You can only tag your own items", after the occasion check passes', async () => {
    supabase = createSupabaseMock({
      occasions: [{ data: { id: GROUP_OCCASION_ID }, error: null }],
      wishlist_item_occasions: [
        {
          data: null,
          error: {
            code: "42501",
            message:
              'new row violates row-level security policy for table "wishlist_item_occasions"',
          },
        },
      ],
    });

    const result = await tagItemForGroupDate(ITEM_ID, GROUP_OCCASION_ID);

    expect(result).toEqual({ error: "You can only tag your own items" });
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await tagItemForGroupDate(ITEM_ID, GROUP_OCCASION_ID);

    expect(result).toEqual({ error: "Not authenticated" });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

/**
 * A zero-row DELETE is what BOTH "the tag never existed" and "the tag exists
 * but is not yours" look like from here: the delete policy filters the second
 * case out silently, the same way a missing row does, and Postgres raises no
 * error for either. There is exactly one observable shape to test, not two --
 * scripting them differently would be testing a distinction the code cannot
 * actually make.
 */
describe("untagItem", () => {
  it("deletes by item_id and occasion_id and returns ok:true on success", async () => {
    supabase = createSupabaseMock({
      wishlist_item_occasions: [{ data: { item_id: ITEM_ID }, error: null }],
    });

    const result = await untagItem(ITEM_ID, OCCASION_ID);

    expect(deleteSpy).toHaveBeenCalledWith("wishlist_item_occasions");
    expect(eqSpy).toHaveBeenCalledWith(
      "wishlist_item_occasions",
      "item_id",
      ITEM_ID
    );
    expect(eqSpy).toHaveBeenCalledWith(
      "wishlist_item_occasions",
      "occasion_id",
      OCCASION_ID
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns the same message on a zero-row result, whether the tag did not exist or was not the caller's -- no oracle", async () => {
    supabase = createSupabaseMock({
      wishlist_item_occasions: [{ data: null, error: null }],
    });

    const result = await untagItem(ITEM_ID, OCCASION_ID);

    expect(result).toEqual({
      error: "That tag no longer exists, or is not yours to remove",
    });
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await untagItem(ITEM_ID, OCCASION_ID);

    expect(result).toEqual({ error: "Not authenticated" });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe("getTagsForItems", () => {
  it("returns {} for an empty list WITHOUT calling the database", async () => {
    const result = await getTagsForItems([]);

    expect(result).toEqual({ data: {} });
    // The strong form of the assertion: not just that no query resolved to
    // an empty set, but that the database was never even reached. If the
    // implementation instead called supabase.from(...).select(...).in(...)
    // with an empty array and let PostgREST hand back zero rows, `result`
    // above would still equal `{ data: {} }` -- only these two checks catch
    // that regression.
    expect(fromSpy).not.toHaveBeenCalled();
    expect(getUserId).not.toHaveBeenCalled();
  });

  it("groups multiple occasion ids per item id, keyed by item_id", async () => {
    const ITEM_A = "item-id-a";
    const ITEM_B = "item-id-b";
    const OCCASION_X = "occasion-id-x";
    const OCCASION_Y = "occasion-id-y";
    const OCCASION_Z = "occasion-id-z";

    supabase = createSupabaseMock({
      wishlist_item_occasions: [
        {
          data: [
            { item_id: ITEM_A, occasion_id: OCCASION_X },
            { item_id: ITEM_A, occasion_id: OCCASION_Y },
            { item_id: ITEM_B, occasion_id: OCCASION_Z },
          ],
          error: null,
        },
      ],
    });

    const result = await getTagsForItems([ITEM_A, ITEM_B]);

    expect(inSpy).toHaveBeenCalledWith("wishlist_item_occasions", "item_id", [
      ITEM_A,
      ITEM_B,
    ]);
    expect(result).toEqual({
      data: {
        [ITEM_A]: [OCCASION_X, OCCASION_Y],
        [ITEM_B]: [OCCASION_Z],
      },
    });
  });

  it("returns Not authenticated for a non-empty list when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await getTagsForItems([ITEM_ID]);

    expect(result).toEqual({ error: "Not authenticated" });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
