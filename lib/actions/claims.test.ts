import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Follows the mocking pattern established in ./occasions.test.ts: mock
 * @/lib/auth/require-auth and @/lib/supabase/server the same way. claims.ts
 * never calls next/cache, unlike occasions.ts's writers, so that mock is not
 * needed here.
 *
 * Every function under test calls .rpc() (claimItem, releaseClaim) or
 * .from(...).select() (getActiveClaims), never insert/update/delete, so the
 * chainable table mock only needs select/eq/in/is plus the thenable
 * terminal -- borrowed from item-occasions.test.ts's shape, including
 * fromSpy (not just the chained methods) so a test can assert the database
 * was never reached at all, which getActiveClaims([]) and every "signed out"
 * case require.
 */

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

const rpc = vi.fn();
const fromSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();
const isSpy = vi.fn();

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
        is: (...args: unknown[]) => {
          isSpy(table, ...args);
          return chain;
        },
      };
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

const { claimItem, releaseClaim, getActiveClaims } = await import("./claims");

const ITEM_ID = "11111111-1111-1111-8111-111111111111";
const CELEBRANT_ID = "user_celebrant";
const OCCASION_ID = "22222222-2222-2222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
  supabase = createSupabaseMock({});
});

/**
 * claimItem's own logic is entirely "which RPC(s), in what order, with what
 * args, and how is a 22023 vs. any other error handled" -- both RPCs
 * themselves are SECURITY DEFINER and do the real authorization work in the
 * database (Task 1 / Task 3), so nothing here re-tests that.
 */
describe("claimItem", () => {
  it("materializes the celebrant's occasion, then claims, in that order and with the occasion id it returned", async () => {
    // What would make this fail: swapping the call order, passing celebrantId
    // instead of the RPC's returned occasion id into claim_wishlist_item, or
    // dropping either call. What this does NOT catch: whether either RPC's
    // OWN authorization logic is correct -- that lives in the RLS suite
    // (17_claim_lifecycle.sql, 15_celebrated_materialization.sql).
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_or_create_celebrated_occasion") {
        return Promise.resolve({ data: OCCASION_ID, error: null });
      }
      if (fn === "claim_wishlist_item") {
        return Promise.resolve({ data: "claim-1", error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await claimItem(ITEM_ID, CELEBRANT_ID, "birthday");

    expect(result).toEqual({ data: { claimId: "claim-1" } });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "get_or_create_celebrated_occasion",
      { p_celebrant_id: CELEBRANT_ID, p_kind: "birthday" }
    );
    expect(rpc).toHaveBeenNthCalledWith(2, "claim_wishlist_item", {
      p_item_id: ITEM_ID,
      p_occasion_id: OCCASION_ID,
    });
  });

  it("claims unscoped when kind is null, without calling the materialization RPC", async () => {
    // What would make this fail: calling get_or_create_celebrated_occasion
    // at all when kind is null, or passing anything other than null as
    // p_occasion_id. What this does NOT catch: whether claim_wishlist_item
    // itself treats a null occasion correctly -- that is
    // 17_claim_lifecycle.sql's concern.
    rpc.mockResolvedValue({ data: "claim-2", error: null });

    const result = await claimItem(ITEM_ID, CELEBRANT_ID, null);

    expect(result).toEqual({ data: { claimId: "claim-2" } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("claim_wishlist_item", {
      p_item_id: ITEM_ID,
      p_occasion_id: null,
    });
  });

  it("returns the claim RPC's own user-facing message on a 22023, not a generic one", async () => {
    // What would make this fail: swapping the passthrough for a generic
    // string, or checking the wrong error code. What this does NOT catch:
    // whether "somebody has already claimed that item" is actually the
    // message claim_wishlist_item raises in production -- that is pinned by
    // 17_claim_lifecycle.sql's anchored source checks against the live
    // function body, not by this test.
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_or_create_celebrated_occasion") {
        return Promise.resolve({ data: OCCASION_ID, error: null });
      }
      if (fn === "claim_wishlist_item") {
        return Promise.resolve({
          data: null,
          error: {
            code: "22023",
            message: "somebody has already claimed that item",
          },
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await claimItem(ITEM_ID, CELEBRANT_ID, "birthday");

    expect(result).toEqual({ error: "somebody has already claimed that item" });
  });

  it("returns the materialization RPC's own 22023 message too, not just the claim RPC's", async () => {
    // What would make this fail: only checking claim_wishlist_item's error
    // for a 22023 passthrough and falling through to the generic message for
    // get_or_create_celebrated_occasion's own 22023 ("no visible % for that
    // person"). What this does NOT catch: whether that message is what the
    // function actually raises in production (a source-anchored RLS test's
    // job, not vitest's).
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_or_create_celebrated_occasion") {
        return Promise.resolve({
          data: null,
          error: { code: "22023", message: "no visible birthday for that person" },
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await claimItem(ITEM_ID, CELEBRANT_ID, "birthday");

    expect(result).toEqual({ error: "no visible birthday for that person" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns a generic message on a non-22023 error, without leaking provider detail", async () => {
    // What would make this fail: passing a non-22023 error's raw message
    // through to the caller. What this does NOT catch: whether the provider
    // detail actually reached console.error (not asserted here; the point
    // pinned is what the CALLER sees).
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_or_create_celebrated_occasion") {
        return Promise.resolve({ data: OCCASION_ID, error: null });
      }
      return Promise.resolve({
        data: null,
        error: {
          code: "42883",
          message: "function public.claim_wishlist_item(uuid, uuid) does not exist",
        },
      });
    });

    const result = await claimItem(ITEM_ID, CELEBRANT_ID, "birthday");

    expect(result).toEqual({
      error: "Failed to claim this item. Please try again.",
    });
    if ("error" in result) {
      expect(result.error).not.toContain("does not exist");
    }
  });

  it("returns Not authenticated when signed out, without calling any RPC", async () => {
    // What would make this fail: calling either RPC before checking
    // getUserId()'s result. What this does NOT catch: a signed-out call
    // reaching the database through some path other than .rpc() -- there is
    // none in this function, so that gap is closed by inspection, not test.
    getUserId.mockResolvedValue(null);

    const result = await claimItem(ITEM_ID, CELEBRANT_ID, "birthday");

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("releaseClaim", () => {
  it("returns { ok: false } rather than an error when the RPC releases nothing", async () => {
    // What would make this fail: treating a false return as an error, or
    // returning { ok: true } regardless of the RPC's result. What this does
    // NOT catch: whether release_wishlist_claim's row_count logic is itself
    // correct -- 17_claim_lifecycle.sql assertions 5/6 cover that.
    rpc.mockResolvedValue({ data: false, error: null });

    const result = await releaseClaim(ITEM_ID);

    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: true } when the RPC releases a row", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const result = await releaseClaim(ITEM_ID);

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("release_wishlist_claim", {
      p_item_id: ITEM_ID,
    });
  });

  it("returns a generic message on an RPC error, without leaking provider detail", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "28000", message: "not authenticated" },
    });

    const result = await releaseClaim(ITEM_ID);

    expect(result).toEqual({
      error: "Failed to release this claim. Please try again.",
    });
  });

  it("returns Not authenticated when signed out, without calling the RPC", async () => {
    getUserId.mockResolvedValue(null);

    const result = await releaseClaim(ITEM_ID);

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("getActiveClaims", () => {
  it("returns {} for an empty list WITHOUT touching the database", async () => {
    // What would make this fail: removing the early return, or replacing it
    // with one that still calls getUserId()/createClient()/.from() first.
    // What this does NOT catch: a mock that always resolves harmlessly would
    // let a version that DOES query survive a weaker assertion -- which is
    // exactly why fromSpy and getUserId are asserted un-called here, not just
    // the returned value. (The brief calls this out explicitly: asserting
    // only `result).toEqual({ data: {} })` would still pass a version that
    // queries and happens to get zero rows back.)
    const result = await getActiveClaims([]);

    expect(result).toEqual({ data: {} });
    expect(getUserId).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("maps active claims by item id", async () => {
    // What would make this fail: swapping claimed_by/occasion_id in the
    // mapping, or keying by something other than item_id. What this does
    // NOT catch: whether the SELECT policy on wishlist_claims genuinely
    // hides the item owner's own claims -- that is 16_claim_visibility.sql's
    // job; this only pins the row-to-record mapping. Occasion dates are both
    // deliberately far in the future so this test cannot be confused with
    // the predicate tests below -- it exists purely to pin the mapping.
    supabase = createSupabaseMock({
      wishlist_claims: [
        {
          data: [
            {
              item_id: "item-1",
              claimed_by: "user_a",
              occasion_id: OCCASION_ID,
              occasions: { occasion_date: "2999-01-01" },
            },
            {
              item_id: "item-2",
              claimed_by: "user_b",
              occasion_id: null,
              occasions: null,
            },
          ],
          error: null,
        },
      ],
    });

    const result = await getActiveClaims(["item-1", "item-2"]);

    expect(result).toEqual({
      data: {
        "item-1": { claimedBy: "user_a", occasionId: OCCASION_ID },
        "item-2": { claimedBy: "user_b", occasionId: null },
      },
    });
    expect(isSpy).toHaveBeenCalledWith("wishlist_claims", "released_at", null);
  });

  it("returns an empty map when no item in the list has an active claim", async () => {
    supabase = createSupabaseMock({
      wishlist_claims: [{ data: [], error: null }],
    });

    const result = await getActiveClaims(["item-1"]);

    expect(result).toEqual({ data: {} });
  });

  /**
   * The active-claim predicate: released_at is null (already covered by the
   * tests above, which never exercise this describe block's clock) AND
   * (occasion_id is null OR occasion.occasion_date >= current_date) --
   * _planning/2026-09-10-gift-giving-occasions-design.md:260-267,
   * 20260911100002_claim_rpcs.sql:5-6. The clock is pinned with fake timers
   * rather than computed relative to the real Date.now(), so this suite
   * passes identically regardless of which day it is actually run -- Task 1
   * of this phase lost a full round to a calendar-dependent fixture, and a
   * test that only fails during part of the year is worse than no test.
   */
  describe("the active-claim predicate", () => {
    const TODAY = "2026-06-15";

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("omits a claim whose linked occasion has already passed", async () => {
      // What would make this fail: filtering only on released_at is null and
      // ignoring the embedded occasion date entirely -- exactly the gap this
      // predicate exists to close. Left unfixed, an item claimed for an
      // occasion that has passed would keep rendering as claimed to every
      // other giver -- looking taken while claim_wishlist_item would
      // actually release and re-award it on the very next attempt -- until
      // somebody happens to make that attempt. What this does NOT catch:
      // whether a REAL PostgREST response embeds a to-one `occasions`
      // relationship as a bare object (matching this mock and matching how
      // lib/actions/groups.ts's `gm.groups` already behaves in this
      // codebase) rather than an array -- that is a live-wiring risk no
      // mock-based test can see.
      supabase = createSupabaseMock({
        wishlist_claims: [
          {
            data: [
              {
                item_id: "item-1",
                claimed_by: "user_a",
                occasion_id: OCCASION_ID,
                occasions: { occasion_date: "2026-06-01" },
              },
            ],
            error: null,
          },
        ],
      });

      const result = await getActiveClaims(["item-1"]);

      expect(result).toEqual({ data: {} });
    });

    it("keeps a lapsed claim whose item was already PURCHASED", async () => {
      // The normal end state of every fulfilled gift: claim it, buy it, then
      // the occasion passes. claim_wishlist_item() refuses a new claim on a
      // purchased item (20260911100002_claim_rpcs.sql:50-52) BEFORE it ever
      // reaches the lapsed-release, so such a claim is never released -- it
      // is the standing record of who bought it. A read path that lapses it
      // anyway disagrees with the RPC about the same row.
      //
      // What would make this fail: applying the date comparison without
      // checking `purchased` first -- which is exactly what shipped. The
      // visible damage is not subtle: every viewer sees a "Purchased" badge
      // AND an "I'll get this" button that can only ever error, and the
      // person who actually bought it loses their own Undo/Unclaim controls,
      // because those derive from this result.
      //
      // What this does NOT catch: whether a real PostgREST response embeds
      // `wishlist_items` as a bare object rather than an array (same
      // live-wiring risk as the `occasions` embed above), nor whether the
      // caller can actually SELECT the item row -- they can, since the item
      // ids came from a list they just read.
      supabase = createSupabaseMock({
        wishlist_claims: [
          {
            data: [
              {
                item_id: "item-1",
                claimed_by: "user_a",
                occasion_id: OCCASION_ID,
                occasions: { occasion_date: "2026-06-01" },
                wishlist_items: { purchased: true },
              },
            ],
            error: null,
          },
        ],
      });

      const result = await getActiveClaims(["item-1"]);

      expect(result).toEqual({
        data: { "item-1": { claimedBy: "user_a", occasionId: OCCASION_ID } },
      });
    });

    it("includes a claim whose linked occasion is today or in the future", async () => {
      // What would make this fail: an off-by-one in the comparison (e.g.
      // strict `>` instead of `>=`, which would wrongly exclude an occasion
      // dated exactly today -- the boundary this test pins with item-1).
      // What this does NOT catch: whether ISO 8601 (YYYY-MM-DD) string
      // comparison agrees with Postgres's own date comparison for every
      // value it could hand back -- both sides here are plain ISO strings,
      // which sort identically to a numeric date comparison, so a
      // differently-formatted date would not be caught by this test.
      supabase = createSupabaseMock({
        wishlist_claims: [
          {
            data: [
              {
                item_id: "item-1",
                claimed_by: "user_a",
                occasion_id: OCCASION_ID,
                occasions: { occasion_date: TODAY },
              },
              {
                item_id: "item-2",
                claimed_by: "user_b",
                occasion_id: OCCASION_ID,
                occasions: { occasion_date: "2026-06-20" },
              },
            ],
            error: null,
          },
        ],
      });

      const result = await getActiveClaims(["item-1", "item-2"]);

      expect(result).toEqual({
        data: {
          "item-1": { claimedBy: "user_a", occasionId: OCCASION_ID },
          "item-2": { claimedBy: "user_b", occasionId: OCCASION_ID },
        },
      });
    });

    it("includes an unscoped claim (occasion_id null), because it never lapses", async () => {
      // What would make this fail: applying the date check even when
      // occasion_id is null -- there is no date to check an unscoped claim
      // against ("An unscoped claim never auto-releases," design doc
      // :280-282). What this does NOT catch: whether an unscoped claim is
      // correctly constructed in the first place -- claimItem's own "claims
      // unscoped when kind is null" test above covers what gets sent to the
      // RPC; this only covers reading one back.
      supabase = createSupabaseMock({
        wishlist_claims: [
          {
            data: [
              {
                item_id: "item-1",
                claimed_by: "user_a",
                occasion_id: null,
                occasions: null,
              },
            ],
            error: null,
          },
        ],
      });

      const result = await getActiveClaims(["item-1"]);

      expect(result).toEqual({
        data: { "item-1": { claimedBy: "user_a", occasionId: null } },
      });
    });
  });

  it("returns a generic message on a select error, without leaking provider detail", async () => {
    supabase = createSupabaseMock({
      wishlist_claims: [
        { data: null, error: { code: "42501", message: "permission denied" } },
      ],
    });

    const result = await getActiveClaims(["item-1"]);

    expect(result).toEqual({
      error: "Failed to load claims. Please try again.",
    });
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await getActiveClaims(["item-1"]);

    expect(result).toEqual({ error: "Not authenticated" });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
