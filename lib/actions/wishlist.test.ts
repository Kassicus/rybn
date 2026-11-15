import { describe, it, expect, vi, beforeEach } from "vitest";
import { WISHLIST_ITEM_COLUMNS } from "@/lib/wishlist/marks";

/**
 * What the wishlist actions read and answer.
 *
 * Every read of a wishlist_items row names WISHLIST_ITEM_COLUMNS, which hold
 * no mark. The marks on an item (bought, out of stock) are read only through
 * visible_item_marks(), and only for another person's items; the caller's own
 * rows are answered with all four mark fields unmarked, and nothing is asked
 * about their marks. The three mark actions write the marks and ask back the
 * item's id alone.
 *
 * markAsPurchased() is pinned closely: its authorization guard is a query on
 * wishlist_claims plus the item's bought mark, and TypeScript cannot see
 * inside a string filter, so a broken query would pass `tsc` and lint and only
 * fail at runtime. markOutOfStock() and unmarkOutOfStock() are pinned for what
 * they answer when their update matched no row: the mobile route answers 404
 * from their `notFound`.
 *
 * Follows the mocking pattern established in ./occasions.test.ts, with the
 * chainable table mock extended by `is` (needed for
 * `.is("released_at", null)`) and `neq` (for `.neq("user_id", userId)`) the
 * way item-occasions.test.ts extends it with `in`. Every select is recorded
 * with the table it was asked of. A database function's answers are queued
 * under "rpc:<name>", as in ./settings.test.ts, and each call is recorded by
 * rpcSpy. next/cache and @/lib/supabase/signed-image are both mocked: these
 * actions call revalidatePath and withSignedWishlistImage(s), neither of which
 * this file's tests care about, and the real signed-image module reaches the
 * admin/service-role client, which must not run in a unit test.
 */

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/signed-image", () => ({
  withSignedWishlistImage: async (item: unknown) => item,
  withSignedWishlistImages: async (items: unknown[]) => items,
}));

const eqSpy = vi.fn();
const neqSpy = vi.fn();
const isSpy = vi.fn();
const updateSpy = vi.fn();
const insertSpy = vi.fn();
const selectSpy = vi.fn();
const rpcSpy = vi.fn();

function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, responses] of Object.entries(script)) {
    queues[table] = [...responses];
  }
  const next = (key: string) => {
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`No scripted Supabase response left for "${key}"`);
    }
    return queue.shift();
  };

  return {
    rpc(name: string, args: unknown) {
      rpcSpy(name, args);
      return Promise.resolve(next(`rpc:${name}`));
    },
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: (...args: unknown[]) => {
          selectSpy(table, ...args);
          return chain;
        },
        eq: (...args: unknown[]) => {
          eqSpy(table, ...args);
          return chain;
        },
        neq: (...args: unknown[]) => {
          neqSpy(table, ...args);
          return chain;
        },
        is: (...args: unknown[]) => {
          isSpy(table, ...args);
          return chain;
        },
        order: () => chain,
        update: (payload: unknown) => {
          updateSpy(table, payload);
          return chain;
        },
        insert: (payload: unknown) => {
          insertSpy(table, payload);
          return chain;
        },
      };
      chain.maybeSingle = async () => next(table);
      chain.single = async () => next(table);
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(next(table)).then(resolve);
      return chain;
    },
  };
}

let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabase,
}));

const {
  getMyWishlist,
  getUserWishlist,
  createWishlistItem,
  updateWishlistItem,
  getWishlistItem,
  markAsPurchased,
  markOutOfStock,
  unmarkOutOfStock,
} = await import("./wishlist");

const ITEM_ID = "11111111-1111-1111-8111-111111111111";
const OTHER_ID = "22222222-2222-2222-8222-222222222222";
const ME = "user_claimer";
const MOM = "user_mom";

const MARK_COLUMNS = ["purchased", "purchased_at", "out_of_stock_marked_by", "out_of_stock_marked_at"];

/** An item as WISHLIST_ITEM_COLUMNS read it. */
const itemRow = (id: string, owner: string) => ({
  id,
  user_id: owner,
  title: `Item ${id.slice(0, 4)}`,
  description: null,
  url: null,
  price: 20,
  image_url: null,
  priority: "medium",
  category: null,
  privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null },
  created_at: "2026-11-01T00:00:00+00:00",
  updated_at: "2026-11-02T00:00:00+00:00",
});

const UNMARKED = {
  purchased: false,
  purchased_at: null,
  out_of_stock_marked_by: null,
  out_of_stock_marked_at: null,
};

/** What visible_item_marks() answers: one row for each marked item the caller may see and does not own. */
const marks = (...rows: { item_id: string; purchased: boolean; out_of_stock_marked_by: string | null }[]) => ({
  data: rows,
  error: null,
});

/**
 * A visible_item_marks() answer marking the item bought, scripted where nothing
 * should ask for it: code that does ask answers the item bought and fails.
 */
const BOUGHT = marks({ item_id: ITEM_ID, purchased: true, out_of_stock_marked_by: "user_giver" });

const FORM = {
  title: "Scarf",
  description: "",
  url: "",
  price: null,
  image_url: "",
  priority: "medium" as const,
  category: null,
  visible_to_group_types: ["family" as const],
  restrict_to_group: null,
};

/**
 * Fails when any select the fake recorded asks for a mark column or `*`
 * (embedded tables' columns included), or names no columns (a bare .select()).
 */
function expectNoMarkOrStarOrBareSelect() {
  expect(selectSpy).toHaveBeenCalled();
  for (const [table, columns] of selectSpy.mock.calls) {
    expect(typeof columns, `a select on ${table} names its columns`).toBe("string");
    const named = String(columns)
      .split(/[\s,()]+/)
      .filter(Boolean);
    expect(named.length, `a select on ${table} names its columns`).toBeGreaterThan(0);
    expect(named.filter((column) => column === "*" || MARK_COLUMNS.includes(column))).toEqual([]);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue(ME);
  supabase = createSupabaseMock({});
});

describe("getMyWishlist", () => {
  it("reads the caller's own items by their named columns and answers each unmarked", async () => {
    const rows = [itemRow(ITEM_ID, ME), itemRow(OTHER_ID, ME)];
    supabase = createSupabaseMock({ wishlist_items: [{ data: rows, error: null }] });

    const result = await getMyWishlist();

    expect(result).toEqual({ data: rows.map((row) => ({ ...row, ...UNMARKED })) });
    expect(selectSpy.mock.calls).toEqual([["wishlist_items", WISHLIST_ITEM_COLUMNS]]);
    expect(eqSpy).toHaveBeenCalledWith("wishlist_items", "user_id", ME);
  });

  it("never asks wishlist_items for a mark column, every column or a bare select", async () => {
    supabase = createSupabaseMock({ wishlist_items: [{ data: [itemRow(ITEM_ID, ME)], error: null }] });

    await getMyWishlist();

    expectNoMarkOrStarOrBareSelect();
  });

  it("never calls visible_item_marks()", async () => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: [itemRow(ITEM_ID, ME)], error: null }],
      "rpc:visible_item_marks": [BOUGHT],
    });

    const result = await getMyWishlist();

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ ...itemRow(ITEM_ID, ME), ...UNMARKED }] });
  });
});

describe("getUserWishlist", () => {
  it("reads another person's items by their named columns, and their marks through visible_item_marks()", async () => {
    const third = "33333333-3333-3333-8333-333333333333";
    const rows = [itemRow(ITEM_ID, MOM), itemRow(OTHER_ID, MOM), itemRow(third, MOM)];
    supabase = createSupabaseMock({
      wishlist_items: [{ data: rows, error: null }],
      "rpc:visible_item_marks": [
        marks(
          { item_id: ITEM_ID, purchased: true, out_of_stock_marked_by: null },
          { item_id: OTHER_ID, purchased: false, out_of_stock_marked_by: "user_giver" },
        ),
      ],
    });

    const result = await getUserWishlist(MOM);

    expect(selectSpy.mock.calls).toEqual([["wishlist_items", WISHLIST_ITEM_COLUMNS]]);
    expect(eqSpy).toHaveBeenCalledWith("wishlist_items", "user_id", MOM);
    expect(rpcSpy.mock.calls).toEqual([["visible_item_marks", { p_item_ids: [ITEM_ID, OTHER_ID, third] }]]);
    expect(result).toEqual({
      data: [
        { ...rows[0], ...UNMARKED, purchased: true },
        { ...rows[1], ...UNMARKED, out_of_stock_marked_by: "user_giver" },
        { ...rows[2], ...UNMARKED },
      ],
      currentUserId: ME,
    });
  });

  it("answers the marks read's error, and no list, when another person's marks cannot be read", async () => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: [itemRow(ITEM_ID, MOM)], error: null }],
      "rpc:visible_item_marks": [
        { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      ],
    });

    const result = await getUserWishlist(MOM);

    expect(result).toEqual({ error: "canceling statement due to statement timeout" });
  });

  it("asks nothing about marks when another person's list is empty", async () => {
    supabase = createSupabaseMock({ wishlist_items: [{ data: [], error: null }] });

    expect(await getUserWishlist(MOM)).toEqual({ data: [], currentUserId: ME });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("answers the caller's own list unmarked, and never calls visible_item_marks() for it", async () => {
    const rows = [itemRow(ITEM_ID, ME)];
    supabase = createSupabaseMock({
      wishlist_items: [{ data: rows, error: null }],
      "rpc:visible_item_marks": [BOUGHT],
    });

    const result = await getUserWishlist(ME);

    expect(result).toEqual({ data: [{ ...rows[0], ...UNMARKED }], currentUserId: ME });
    expect(selectSpy.mock.calls).toEqual([["wishlist_items", WISHLIST_ITEM_COLUMNS]]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["another person's", MOM],
    ["the caller's own", ME],
  ])("never asks wishlist_items for a mark column, every column or a bare select, for %s list", async (_, owner) => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: [itemRow(ITEM_ID, owner)], error: null }],
      "rpc:visible_item_marks": [marks()],
    });

    await getUserWishlist(owner);

    expectNoMarkOrStarOrBareSelect();
  });
});

describe.each([
  ["createWishlistItem", () => createWishlistItem(FORM)],
  ["updateWishlistItem", () => updateWishlistItem(ITEM_ID, FORM)],
] as const)("%s", (_, save) => {
  it("asks for the written row back by its named columns and answers it unmarked", async () => {
    supabase = createSupabaseMock({ wishlist_items: [{ data: itemRow(ITEM_ID, ME), error: null }] });

    const result = await save();

    expect(result).toEqual({ data: { ...itemRow(ITEM_ID, ME), ...UNMARKED } });
    expect(selectSpy.mock.calls).toEqual([["wishlist_items", WISHLIST_ITEM_COLUMNS]]);
  });

  it("never asks wishlist_items for a mark column, every column or a bare select", async () => {
    supabase = createSupabaseMock({ wishlist_items: [{ data: itemRow(ITEM_ID, ME), error: null }] });

    await save();

    expectNoMarkOrStarOrBareSelect();
  });

  it("never calls visible_item_marks()", async () => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: itemRow(ITEM_ID, ME), error: null }],
      "rpc:visible_item_marks": [BOUGHT],
    });

    await save();

    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe("getWishlistItem", () => {
  it("reads another person's item by its named columns, and its marks through visible_item_marks()", async () => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: itemRow(ITEM_ID, MOM), error: null }],
      "rpc:visible_item_marks": [BOUGHT],
    });

    const result = await getWishlistItem(ITEM_ID);

    expect(selectSpy.mock.calls).toEqual([["wishlist_items", WISHLIST_ITEM_COLUMNS]]);
    expect(eqSpy).toHaveBeenCalledWith("wishlist_items", "id", ITEM_ID);
    expect(rpcSpy.mock.calls).toEqual([["visible_item_marks", { p_item_ids: [ITEM_ID] }]]);
    expect(result).toEqual({
      data: { ...itemRow(ITEM_ID, MOM), ...UNMARKED, purchased: true, out_of_stock_marked_by: "user_giver" },
      currentUserId: ME,
    });
  });

  it("answers another person's item unmarked when visible_item_marks() has no row for it", async () => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: itemRow(ITEM_ID, MOM), error: null }],
      "rpc:visible_item_marks": [marks()],
    });

    expect(await getWishlistItem(ITEM_ID)).toEqual({
      data: { ...itemRow(ITEM_ID, MOM), ...UNMARKED },
      currentUserId: ME,
    });
  });

  it("answers the marks read's error as not a missing item", async () => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: itemRow(ITEM_ID, MOM), error: null }],
      "rpc:visible_item_marks": [{ data: null, error: { code: "08006", message: "connection failure" } }],
    });

    expect(await getWishlistItem(ITEM_ID)).toEqual({ error: "connection failure", notFound: false });
  });

  it("answers the caller's own item unmarked, and never calls visible_item_marks() for it", async () => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: itemRow(ITEM_ID, ME), error: null }],
      "rpc:visible_item_marks": [BOUGHT],
    });

    const result = await getWishlistItem(ITEM_ID);

    expect(result).toEqual({ data: { ...itemRow(ITEM_ID, ME), ...UNMARKED }, currentUserId: ME });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["another person's", MOM],
    ["the caller's own", ME],
  ])("never asks wishlist_items for a mark column, every column or a bare select, for %s item", async (_, owner) => {
    supabase = createSupabaseMock({
      wishlist_items: [{ data: itemRow(ITEM_ID, owner), error: null }],
      "rpc:visible_item_marks": [marks()],
    });

    await getWishlistItem(ITEM_ID);

    expectNoMarkOrStarOrBareSelect();
  });
});

describe("markAsPurchased", () => {
  it("succeeds for the caller holding an active claim on the item", async () => {
    // What would make this fail: querying wishlist_claims with the wrong
    // column names or values (e.g. checking user_id instead of claimed_by,
    // or omitting the released_at is null filter so a released claim would
    // also pass), or failing to reach the update at all. What this does NOT
    // catch: whether wishlist_claims' own SELECT policy actually lets the
    // claimer read this row in production -- that is 16_claim_visibility
    // .sql's job; this only pins this function's own query and control flow.
    supabase = createSupabaseMock({
      wishlist_claims: [{ data: { id: "claim-1", occasion_id: null, occasions: null }, error: null }],
      "rpc:visible_item_marks": [marks()],
      wishlist_items: [{ data: { id: ITEM_ID }, error: null }],
    });

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({ data: { id: ITEM_ID } });
    expect(eqSpy).toHaveBeenCalledWith("wishlist_claims", "item_id", ITEM_ID);
    expect(eqSpy).toHaveBeenCalledWith(
      "wishlist_claims",
      "claimed_by",
      "user_claimer"
    );
    expect(isSpy).toHaveBeenCalledWith(
      "wishlist_claims",
      "released_at",
      null
    );
    expect(updateSpy).toHaveBeenCalledWith(
      "wishlist_items",
      expect.objectContaining({ purchased: true })
    );
  });

  it("reads the claim by its own columns and occasion date, the bought mark through visible_item_marks(), and asks the update back for the id", async () => {
    supabase = createSupabaseMock({
      wishlist_claims: [{ data: { id: "claim-1", occasion_id: null, occasions: null }, error: null }],
      "rpc:visible_item_marks": [marks()],
      // More than was asked for: the answer still carries the id alone.
      wishlist_items: [{ data: { id: ITEM_ID, purchased: true, purchased_at: "now" }, error: null }],
    });

    const result = await markAsPurchased(ITEM_ID, true);

    expect(selectSpy.mock.calls).toEqual([
      ["wishlist_claims", "id, occasion_id, occasions ( occasion_date )"],
      ["wishlist_items", "id"],
    ]);
    expect(rpcSpy.mock.calls).toEqual([["visible_item_marks", { p_item_ids: [ITEM_ID] }]]);
    expect(result).toEqual({ data: { id: ITEM_ID } });
  });

  it("never asks for a mark column, every column or a bare select, on the claim or on the item", async () => {
    supabase = createSupabaseMock({
      wishlist_claims: [{ data: { id: "claim-1", occasion_id: null, occasions: null }, error: null }],
      "rpc:visible_item_marks": [marks()],
      wishlist_items: [{ data: { id: ITEM_ID }, error: null }],
    });

    await markAsPurchased(ITEM_ID, true);

    expectNoMarkOrStarOrBareSelect();
  });

  it("refuses a co-member who can see the item but does not hold an active claim on it", async () => {
    // Someone with no active claim on the item is refused, and nothing is
    // written. What would make this fail: answering .maybeSingle()'s null
    // (no claim row, no error) as a success, or reaching the wishlist_items
    // update without a claim row.
    supabase = createSupabaseMock({
      wishlist_claims: [{ data: null, error: null }],
      "rpc:visible_item_marks": [BOUGHT],
    });

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({
      error: "Only the person who claimed this item can mark it purchased",
    });
    expect(updateSpy).not.toHaveBeenCalled();
    // With no claim there is nothing to decide, so the mark is not asked for.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("refuses the claimer when their own claim has LAPSED", async () => {
    // What would make this fail: dropping the isClaimActive() call and going
    // back to "a row came back, therefore authorized". What this does NOT
    // catch: whether Postgres would have lapsed this same claim at the same
    // instant -- claim_rpcs.sql:102 compares against `current_date` in the
    // session TimeZone while this compares ISO strings in UTC, and they
    // agree only because the database is configured to UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    try {
      supabase = createSupabaseMock({
        wishlist_claims: [
          {
            data: {
              id: "claim-1",
              occasion_id: "occ-1",
              occasions: { occasion_date: "2026-06-01" },
            },
            error: null,
          },
        ],
        // The item is not bought: visible_item_marks() has no row for it.
        "rpc:visible_item_marks": [marks()],
      });

      const result = await markAsPurchased(ITEM_ID, true);

      expect(result).toEqual({
        error: "Only the person who claimed this item can mark it purchased",
      });
      expect(updateSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still lets the purchaser UNDO after the occasion has passed", async () => {
    // The counterpart, and the reason isClaimActive() checks `purchased`
    // before the date rather than after. Buying the gift and then letting the
    // birthday go by is the ordinary end state of a fulfilled claim: the
    // occasion is in the past AND the item is purchased. If the date were
    // checked first, the person who actually bought it would be refused
    // permission to undo their own purchase.
    //
    // What would make this fail: reordering isClaimActive()'s branches so the
    // date test runs before the purchased test, or not reading the bought
    // mark from visible_item_marks(). What this does NOT catch: whether
    // "Mark as Not Purchased" is still reachable in the UI at that point --
    // ClaimActions renders it from getActiveClaims(), which is covered
    // separately in claims.test.ts.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    try {
      supabase = createSupabaseMock({
        wishlist_claims: [
          {
            data: {
              id: "claim-1",
              occasion_id: "occ-1",
              occasions: { occasion_date: "2026-06-01" },
            },
            error: null,
          },
        ],
        "rpc:visible_item_marks": [marks({ item_id: ITEM_ID, purchased: true, out_of_stock_marked_by: null })],
        wishlist_items: [{ data: { id: ITEM_ID }, error: null }],
      });

      const result = await markAsPurchased(ITEM_ID, false);

      expect(result).toEqual({ data: { id: ITEM_ID } });
      expect(updateSpy).toHaveBeenCalledWith(
        "wishlist_items",
        expect.objectContaining({ purchased: false })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers the marks read's error and writes nothing when the bought mark cannot be read", async () => {
    supabase = createSupabaseMock({
      wishlist_claims: [{ data: { id: "claim-1", occasion_id: null, occasions: null }, error: null }],
      "rpc:visible_item_marks": [{ data: null, error: { code: "08006", message: "connection failure" } }],
    });

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({ error: "connection failure" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({ error: "Not authenticated" });
    expect(eqSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("surfaces the claim lookup's own error message rather than falling through to the update", async () => {
    supabase = createSupabaseMock({
      wishlist_claims: [
        { data: null, error: { code: "500", message: "connection reset" } },
      ],
    });

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({ error: "connection reset" });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("markOutOfStock and unmarkOutOfStock", () => {
  const NO_ROWS = "JSON object requested, multiple (or no) rows returned";

  it("answers notFound when no item was the caller's to mark: their own, one they cannot see, or one that is gone", async () => {
    // The update is filtered by .neq("user_id", userId), so the caller's own
    // item matches no row, exactly as one row-level security hides from them
    // or one that was deleted does; .single() then answers PGRST116.
    for (const action of [markOutOfStock, unmarkOutOfStock]) {
      neqSpy.mockClear();
      supabase = createSupabaseMock({
        wishlist_items: [{ data: null, error: { code: "PGRST116", message: NO_ROWS } }],
      });

      const result = await action(ITEM_ID);

      expect(result).toEqual({ error: NO_ROWS, notFound: true });
      expect(neqSpy).toHaveBeenCalledWith("wishlist_items", "user_id", "user_claimer");
    }
  });

  it("answers notFound false for any other database error", async () => {
    for (const action of [markOutOfStock, unmarkOutOfStock]) {
      supabase = createSupabaseMock({
        wishlist_items: [{ data: null, error: { code: "08006", message: "connection failure" } }],
      });

      const result = await action(ITEM_ID);

      expect(result).toEqual({ error: "connection failure", notFound: false });
    }
  });

  it("marks an item as before, asking the update back for the id alone", async () => {
    // More than was asked for: the answer still carries the id alone.
    const row = { id: ITEM_ID, out_of_stock_marked_by: "user_claimer", out_of_stock_marked_at: "now" };
    supabase = createSupabaseMock({ wishlist_items: [{ data: row, error: null }] });

    const result = await markOutOfStock(ITEM_ID);

    expect(result).toEqual({ data: { id: ITEM_ID } });
    expect(updateSpy).toHaveBeenCalledWith(
      "wishlist_items",
      expect.objectContaining({ out_of_stock_marked_by: "user_claimer" })
    );
    expect(eqSpy).toHaveBeenCalledWith("wishlist_items", "id", ITEM_ID);
    expect(neqSpy).toHaveBeenCalledWith("wishlist_items", "user_id", "user_claimer");
    expect(selectSpy.mock.calls).toEqual([["wishlist_items", "id"]]);
  });

  it("clears the mark as before, asking the update back for the id alone", async () => {
    const row = { id: ITEM_ID, out_of_stock_marked_by: null, out_of_stock_marked_at: null };
    supabase = createSupabaseMock({ wishlist_items: [{ data: row, error: null }] });

    const result = await unmarkOutOfStock(ITEM_ID);

    expect(result).toEqual({ data: { id: ITEM_ID } });
    expect(updateSpy).toHaveBeenCalledWith("wishlist_items", {
      out_of_stock_marked_by: null,
      out_of_stock_marked_at: null,
    });
    expect(neqSpy).toHaveBeenCalledWith("wishlist_items", "user_id", "user_claimer");
    expect(selectSpy.mock.calls).toEqual([["wishlist_items", "id"]]);
  });

  it.each([
    ["markOutOfStock", markOutOfStock],
    ["unmarkOutOfStock", unmarkOutOfStock],
  ] as const)("%s never asks wishlist_items for a mark column, every column or a bare select", async (_, action) => {
    supabase = createSupabaseMock({ wishlist_items: [{ data: { id: ITEM_ID }, error: null }] });

    await action(ITEM_ID);

    expectNoMarkOrStarOrBareSelect();
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
