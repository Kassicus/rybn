import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Scoped to markAsPurchased() only. It is the one function in this file with
 * logic worth pinning outside the RLS suite: 20260911100003_drop_item_claim_
 * columns.sql removed wishlist_items.claimed_by, so the authorization guard
 * that used to be `.eq("claimed_by", userId)` had to be rewritten against
 * wishlist_claims -- and TypeScript cannot see inside a string filter, so a
 * broken rewrite would pass `tsc` and lint and only fail at runtime. That is
 * exactly the class of bug this file exists to catch before it ships.
 *
 * Every other exported function here (getMyWishlist, createWishlistItem,
 * etc.) is unchanged by Task 5's rewrite and is not re-tested here.
 *
 * Follows the mocking pattern established in ./occasions.test.ts, with the
 * chainable table mock extended by `is` (needed for
 * `.is("released_at", null)`) the way item-occasions.test.ts extends it with
 * `in`. next/cache and @/lib/supabase/signed-image are both mocked:
 * markAsPurchased calls revalidatePath and withSignedWishlistImage, neither
 * of which this file's tests care about, and the real signed-image module
 * reaches the admin/service-role client, which must not run in a unit test.
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
const isSpy = vi.fn();
const updateSpy = vi.fn();

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
        is: (...args: unknown[]) => {
          isSpy(table, ...args);
          return chain;
        },
        update: (payload: unknown) => {
          updateSpy(table, payload);
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
  createClient: async () => supabase,
}));

const { markAsPurchased } = await import("./wishlist");

const ITEM_ID = "11111111-1111-1111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_claimer");
  supabase = createSupabaseMock({});
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
      wishlist_claims: [{ data: { id: "claim-1" }, error: null }],
      wishlist_items: [
        { data: { id: ITEM_ID, purchased: true, purchased_at: "now" }, error: null },
      ],
    });

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({
      data: { id: ITEM_ID, purchased: true, purchased_at: "now" },
    });
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

  it("refuses a co-member who can see the item but does not hold an active claim on it", async () => {
    // This is the authorization-regression case Correction 1 exists to
    // prevent: dropping the guard entirely (rather than rewriting it) would
    // let ANY co-member who can see the item mark somebody else's claim
    // purchased, since the RLS policy governing this UPDATE
    // ("Users can claim visible wishlist items") admits any non-owner who
    // can see the item, not just the claimer -- confirmed by reading that
    // policy's own USING/WITH CHECK clause, which has no claimed_by
    // conjunct at all. What would make this fail: returning the generic
    // "not found" behavior of .maybeSingle() (null, no error) as a success,
    // or reaching the wishlist_items update despite no claim row existing.
    // What this does NOT catch: a hypothetical bug where the query is
    // correct here but a DIFFERENT, more permissive RLS policy on
    // wishlist_claims lets a non-claimer read someone else's claim row --
    // 16_claim_visibility.sql's assertion 2 (owner-blindness) and its "same
    // shape as wishlist_item_occasions" reasoning is what rules that out.
    supabase = createSupabaseMock({
      wishlist_claims: [{ data: null, error: null }],
    });

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({
      error: "Only the person who claimed this item can mark it purchased",
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("refuses the claimer when their own claim has LAPSED", async () => {
    // The gap the final review caught: this function used to check only
    // `released_at is null`, a LOOSER rule than the one getActiveClaims()
    // applies to the very same row. So a claim the read path had already
    // told every viewer did not exist could still authorize a purchase --
    // permanently marking an item purchased that the UI was showing as
    // available to claim.
    //
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
              wishlist_items: { purchased: false },
            },
            error: null,
          },
        ],
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
    // date test runs before the purchased test. What this does NOT catch:
    // whether "Mark as Not Purchased" is still reachable in the UI at that
    // point -- ClaimActions renders it from getActiveClaims(), which is
    // covered separately in claims.test.ts.
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
              wishlist_items: { purchased: true },
            },
            error: null,
          },
        ],
        wishlist_items: [
          { data: { id: ITEM_ID, purchased: false, purchased_at: null }, error: null },
        ],
      });

      const result = await markAsPurchased(ITEM_ID, false);

      expect(result).toEqual({
        data: { id: ITEM_ID, purchased: false, purchased_at: null },
      });
      expect(updateSpy).toHaveBeenCalledWith(
        "wishlist_items",
        expect.objectContaining({ purchased: false })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await markAsPurchased(ITEM_ID, true);

    expect(result).toEqual({ error: "Not authenticated" });
    expect(eqSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
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
