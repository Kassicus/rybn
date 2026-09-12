import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mirrors the mocking pattern established in ./occasions.test.ts and
 * ./invitations.test.ts: the user-scoped Supabase client is a chainable
 * thenable, with an `rpc` stub alongside it for the four RPC-backed actions.
 *
 * `@/lib/supabase/admin` is mocked separately to THROW if ever called. All
 * four RPCs are SECURITY DEFINER and pin themselves to requesting_user_id(),
 * which the admin client never carries -- using it here would either return
 * nothing (silently wrong) or, worse, since this repo's .env.local carries a
 * real SUPABASE_SERVICE_ROLE_KEY, actually reach the live project during a
 * test run. Throwing turns either failure mode into a loud, immediate one.
 */
const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("anniversary-links.ts must not use the admin client");
  },
}));

const rpc = vi.fn();
const eqSpy = vi.fn();
const neqSpy = vi.fn();
const inSpy = vi.fn();

/**
 * Same shape as invitations.test.ts's createSupabaseMock: every chain method
 * returns the chain, and the chain is thenable so `await from().select()
 * .order().order().limit()` resolves without a terminal call, while
 * `.maybeSingle()` is its own promise. Responses are queued per table and
 * consumed in call order.
 *
 * `.order()` and `.limit()` are NOT no-ops here, unlike invitations.test.ts's
 * version: they record the requested clauses and, at resolution time, an
 * array `data` payload is actually sorted (stably, by every recorded clause
 * in the order requested) and sliced. Without this, getMyAnniversaryLink's
 * multi-row precedence test below would be pinning whatever order the
 * fixture array happened to be written in, not the implementation's own
 * `order by` calls -- exactly the false-falsifiability trap this plan has
 * shipped before.
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

      const orderClauses: { field: string; ascending: boolean }[] = [];
      let limitCount: number | undefined;

      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.order = (
        field: string,
        opts?: { ascending?: boolean }
      ) => {
        orderClauses.push({ field, ascending: opts?.ascending ?? true });
        return chain;
      };
      chain.limit = (count: number) => {
        limitCount = count;
        return chain;
      };
      chain.eq = (...args: unknown[]) => {
        eqSpy(table, ...args);
        return chain;
      };
      chain.neq = (...args: unknown[]) => {
        neqSpy(table, ...args);
        return chain;
      };
      chain.in = (...args: unknown[]) => {
        inSpy(table, ...args);
        return chain;
      };

      const resolveWithOrderAndLimit = (): unknown => {
        const result = next() as { data: unknown; error: unknown };
        if (!Array.isArray(result.data) || orderClauses.length === 0) {
          const data = Array.isArray(result.data) && limitCount !== undefined
            ? result.data.slice(0, limitCount)
            : result.data;
          return { ...result, data };
        }
        const rows = [...(result.data as Record<string, unknown>[])];
        rows.sort((a, b) => {
          for (const { field, ascending } of orderClauses) {
            const av = a[field];
            const bv = b[field];
            if (av === bv) continue;
            const cmp = av! < bv! ? -1 : 1;
            return ascending ? cmp : -cmp;
          }
          return 0;
        });
        const data = limitCount !== undefined ? rows.slice(0, limitCount) : rows;
        return { ...result, data };
      };

      chain.maybeSingle = async () => next();
      chain.single = async () => next();
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolveWithOrderAndLimit()).then(resolve);
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

const {
  requestAnniversaryLink,
  confirmAnniversaryLink,
  declineAnniversaryLink,
  unlinkAnniversary,
  getMyAnniversaryLink,
  getAnniversaryPartnerCandidates,
} = await import("./anniversary-links");

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_a_123");
  supabase = createSupabaseMock({});
});

describe("requestAnniversaryLink", () => {
  it("calls request_anniversary_link on the user-scoped client with the right args", async () => {
    rpc.mockResolvedValue({ data: "link-1", error: null });

    const result = await requestAnniversaryLink("user_b_456", "2020-06-01");

    expect(rpc).toHaveBeenCalledWith("request_anniversary_link", {
      p_partner_id: "user_b_456",
      p_date: "2020-06-01",
    });
    expect(result).toEqual({ data: { linkId: "link-1" } });
  });

  // Falsifiability: change the 22023 branch to `return { error: "Failed to
  // send that request. Please try again." }` (the generic message) and this
  // fails, since it asserts the EXACT provider string, not just that some
  // error is present. NOT caught by this test: a non-22023 error being
  // mishandled -- that is a separate assertion below -- nor a 22023 arriving
  // from confirm/decline/unlink instead of request.
  it("returns the RPC's own message verbatim on a 22023, not a generic string", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "you cannot share an anniversary with yourself",
      },
    });

    const result = await requestAnniversaryLink("user_a_123", "2020-06-01");

    expect(result).toEqual({
      error: "you cannot share an anniversary with yourself",
    });
  });

  // Falsifiability: delete the `if (error.code === "22023")` branch (or
  // replace it with `if (false)`) and this fails, since the generic-error
  // path also runs for 22023 and the message no longer matches. NOT caught:
  // whether the SAME code path also runs for non-22023 errors -- that is
  // covered by the "swaps a non-22023 error" test below.
  it("returns that person is not in any of your groups verbatim", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "that person is not in any of your groups",
      },
    });

    const result = await requestAnniversaryLink("nobody", "2020-06-01");

    expect(result).toEqual({
      error: "that person is not in any of your groups",
    });
  });

  // Falsifiability: change `if (error.code === "22023")` to `if (true)` (so
  // every error is passed through verbatim) and this fails, since it now
  // asserts a message the provider never wrote is returned instead of the
  // real one. NOT caught: a 22023 being swapped for the generic message --
  // that is the inverse case, covered above.
  it("swaps a non-22023 error for a generic message, without leaking provider detail", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    });

    const result = await requestAnniversaryLink("user_b_456", "2020-06-01");

    expect(result).toEqual({
      error: "Failed to send that request. Please try again.",
    });
  });

  // Falsifiability: move the `getUserId()` check below the `createClient()`
  // call (or delete it) and this fails on both assertions -- rpc gets
  // called, and the result becomes whatever the (now-invoked) mock returns
  // rather than the signed-out shape. NOT caught: a signed-out check that
  // exists but returns the wrong string.
  it("returns Not authenticated when signed out, without calling the RPC", async () => {
    getUserId.mockResolvedValue(null);

    const result = await requestAnniversaryLink("user_b_456", "2020-06-01");

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("confirmAnniversaryLink", () => {
  it("calls confirm_anniversary_link on the user-scoped client with the right link id", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await confirmAnniversaryLink("link-1");

    expect(rpc).toHaveBeenCalledWith("confirm_anniversary_link", {
      p_link_id: "link-1",
    });
    expect(result).toEqual({ ok: true });
  });

  // Falsifiability: same as requestAnniversaryLink's 22023 test -- replace
  // the passthrough with the generic message and this fails. NOT caught: a
  // 22023 arriving from a DIFFERENT action being mishandled.
  it("returns one of you already shares an anniversary with somebody else verbatim", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "one of you already shares an anniversary with somebody else",
      },
    });

    const result = await confirmAnniversaryLink("link-1");

    expect(result).toEqual({
      error: "one of you already shares an anniversary with somebody else",
    });
  });

  it("returns no anniversary request for you to confirm verbatim", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "no anniversary request for you to confirm",
      },
    });

    const result = await confirmAnniversaryLink("link-1");

    expect(result).toEqual({
      error: "no anniversary request for you to confirm",
    });
  });

  it("returns Not authenticated when signed out, without calling the RPC", async () => {
    getUserId.mockResolvedValue(null);

    const result = await confirmAnniversaryLink("link-1");

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("declineAnniversaryLink", () => {
  it("calls decline_anniversary_link on the user-scoped client with the right link id", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const result = await declineAnniversaryLink("link-1");

    expect(rpc).toHaveBeenCalledWith("decline_anniversary_link", {
      p_link_id: "link-1",
    });
    expect(result).toEqual({ ok: true });
  });

  // Falsifiability: change `return { ok: data === true }` to
  // `return { ok: !error }` and this fails -- `!error` is true whenever the
  // call succeeds regardless of what the RPC returned, so `{ ok: false }`
  // would incorrectly become `{ ok: true }`. NOT caught: the RPC raising an
  // actual error (a separate code path, exercised nowhere in this suite
  // since decline never raises 22023 per its migration).
  it("returns { ok: false } rather than an error when the RPC returns false", async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    const result = await declineAnniversaryLink("link-1");

    expect(result).toEqual({ ok: false });
    expect((result as { error?: string }).error).toBeUndefined();
  });

  it("returns Not authenticated when signed out, without calling the RPC", async () => {
    getUserId.mockResolvedValue(null);

    const result = await declineAnniversaryLink("link-1");

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("unlinkAnniversary", () => {
  it("calls unlink_anniversary on the user-scoped client with the right link id", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const result = await unlinkAnniversary("link-1");

    expect(rpc).toHaveBeenCalledWith("unlink_anniversary", {
      p_link_id: "link-1",
    });
    expect(result).toEqual({ ok: true });
  });

  // Falsifiability: same swap as declineAnniversaryLink's -- `{ ok: !error }`
  // instead of `{ ok: data === true }` -- and this fails for the same
  // reason. NOT caught: unlink's own 42501/RLS-style failures, which this
  // suite does not construct.
  it("returns { ok: false } rather than an error when the RPC returns false", async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    const result = await unlinkAnniversary("link-1");

    expect(result).toEqual({ ok: false });
  });

  it("returns Not authenticated when signed out, without calling the RPC", async () => {
    getUserId.mockResolvedValue(null);

    const result = await unlinkAnniversary("link-1");

    expect(result).toEqual({ error: "Not authenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("getMyAnniversaryLink", () => {
  // Falsifiability: this is the near-miss the brief calls out by name.
  // Hardcode `const partnerId = row.user_b;` (dropping the `row.user_a ===
  // userId ? row.user_b : row.user_a` conditional) and THIS test fails --
  // the caller-as-user_a case above still passes, because user_b legitimately
  // IS the partner there, but here the caller is user_b and the hardcoded
  // version would wrongly return the caller's OWN id as partnerId. Verified
  // by actually making that edit and re-running: this test failed while the
  // caller-as-user_a test kept passing, which is exactly the asymmetry the
  // brief warns an incomplete fix would produce.
  it("resolves partnerId and initiatedByMe when the caller is user_a", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            {
              id: "link-1",
              user_a: "user_a_123",
              user_b: "user_b_456",
              status: "pending",
              initiated_by: "user_a_123",
              agreed_date: "2020-06-01",
            },
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: { username: "partner-username", display_name: "Partner Name" },
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLink();

    expect(result).toEqual({
      data: {
        id: "link-1",
        partnerId: "user_b_456",
        partnerUsername: "partner-username",
        partnerDisplayName: "Partner Name",
        status: "pending",
        agreedDate: "2020-06-01",
        initiatedByMe: true,
      },
    });
    expect(eqSpy).toHaveBeenCalledWith("user_profiles", "id", "user_b_456");
  });

  it("resolves partnerId and initiatedByMe when the caller is user_b -- the near-miss case", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            {
              id: "link-2",
              user_a: "user_z_789",
              user_b: "user_a_123", // the CALLER, canonically stored as user_b
              status: "confirmed",
              initiated_by: "user_z_789", // the OTHER person initiated
              agreed_date: "2019-05-05",
            },
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: { username: "z-username", display_name: "Z Display" },
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLink();

    expect(result).toEqual({
      data: {
        id: "link-2",
        partnerId: "user_z_789",
        partnerUsername: "z-username",
        partnerDisplayName: "Z Display",
        status: "confirmed",
        agreedDate: "2019-05-05",
        initiatedByMe: false,
      },
    });
    expect(eqSpy).toHaveBeenCalledWith("user_profiles", "id", "user_z_789");
  });

  // Task 3's review established that pending links are deliberately
  // unconstrained -- only a CONFIRMED link is limited to one per person
  // (anniversary_link_members' primary key) -- so a caller can genuinely
  // hold a confirmed link with one partner and a pending request with a
  // DIFFERENT person at the same time. getMyAnniversaryLink drives Task 9's
  // three-way UI state (unlinked / pending-with-cancel /
  // confirmed-with-unlink), so returning the wrong row here is not cosmetic:
  // it tells someone with a real partner "you have a pending request,
  // cancel it?"
  //
  // The pending row is placed FIRST in this fixture and the confirmed row
  // SECOND, deliberately the opposite of the expected output order -- a
  // test that put them in output order would pass even if the
  // implementation never ordered anything at all, since createSupabaseMock's
  // `.limit(1)` would just take the fixture's first element. Only a mock
  // that actually SORTS on the recorded `.order()` clauses (see
  // createSupabaseMock above) can fail this test for the right reason.
  //
  // Falsifiability, verified by actually breaking the implementation:
  //   1. Deleting both `.order(...)` calls in getMyAnniversaryLink: this
  //      test failed, returning the PENDING row (the fixture's raw first
  //      element) instead of the confirmed one. The "resolves ... user_a"
  //      and "... user_b" tests above, each single-row, kept passing --
  //      confirming this scenario needed its own test.
  //   2. Flipping `.order("status", { ascending: true })` to
  //      `{ ascending: false }` alone: this test failed the same way
  //      ("pending" now sorts before "confirmed" descending), while every
  //      other test in this file kept passing.
  //   3. Control check for the false-falsifiability trap named above:
  //      reversing this test's OWN fixture order (confirmed first, pending
  //      second) against the UNMODIFIED implementation still passed -- as it
  //      must, since real ordering doesn't care about input order -- proving
  //      the mock's sort, not incidental fixture placement, is what makes
  //      this test pass.
  // All three checks were reverted after observation; the file below is the
  // shipped version.
  it("returns the confirmed link over a pending one when the caller holds both", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            {
              id: "link-pending",
              user_a: "user_a_123",
              user_b: "user_x_999",
              status: "pending",
              initiated_by: "user_x_999",
              agreed_date: "2099-12-31",
              created_at: "2026-06-01T00:00:00Z",
            },
            {
              id: "link-confirmed",
              user_a: "user_a_123",
              user_b: "user_c_789",
              status: "confirmed",
              initiated_by: "user_a_123",
              agreed_date: "2018-09-09",
              created_at: "2020-01-01T00:00:00Z",
            },
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: { username: "c-username", display_name: "C Display" },
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLink();

    expect(result).toEqual({
      data: {
        id: "link-confirmed",
        partnerId: "user_c_789",
        partnerUsername: "c-username",
        partnerDisplayName: "C Display",
        status: "confirmed",
        agreedDate: "2018-09-09",
        initiatedByMe: true,
      },
    });
    expect(eqSpy).toHaveBeenCalledWith("user_profiles", "id", "user_c_789");
  });

  // Falsifiability: change the empty-result branch to fall through instead
  // of returning early (e.g. `const row = data?.[0] ?? {}`) and this fails --
  // either on a thrown "No scripted Supabase response left for
  // user_profiles" (the profile lookup runs with an unqueued table) or on
  // the returned shape no longer being `{ data: null }`. NOT caught: a
  // non-empty result being mapped incorrectly, which the two tests above
  // cover.
  it("returns { data: null } when the caller has no anniversary link", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [{ data: [], error: null }],
    });

    const result = await getMyAnniversaryLink();

    expect(result).toEqual({ data: null });
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await getMyAnniversaryLink();

    expect(result).toEqual({ error: "Not authenticated" });
  });
});

describe("getAnniversaryPartnerCandidates", () => {
  // Falsifiability: drop the `.neq("user_id", userId)` call (querying
  // group_members unfiltered) and this fails -- the caller's own id would
  // stay in candidateIds, "group_members" -> user_profiles fixture would
  // include their row, and the caller would show up in their own picker.
  it("returns groupmates, deduped, sorted by display name over username", async () => {
    supabase = createSupabaseMock({
      group_members: [
        {
          data: [
            { user_id: "user_z_999" },
            { user_id: "user_b_456" },
            { user_id: "user_b_456" }, // same person, second shared group
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [
            { id: "user_z_999", username: "zed", display_name: null },
            { id: "user_b_456", username: "beebee", display_name: "Alex" },
          ],
          error: null,
        },
      ],
    });

    const result = await getAnniversaryPartnerCandidates();

    expect(result).toEqual({
      data: [
        { id: "user_b_456", username: "beebee", displayName: "Alex" },
        { id: "user_z_999", username: "zed", displayName: null },
      ],
    });
    expect(neqSpy).toHaveBeenCalledWith(
      "group_members",
      "user_id",
      "user_a_123"
    );
    expect(inSpy).toHaveBeenCalledWith("user_profiles", "id", [
      "user_z_999",
      "user_b_456",
    ]);
  });

  // Falsifiability: remove the `if (candidateIds.length === 0) return { data:
  // [] }` short-circuit and this fails on a thrown "No scripted Supabase
  // response left for user_profiles" -- the fixture above deliberately
  // supplies no user_profiles queue at all, so a fall-through would have
  // nothing to shift.
  it("returns an empty list without querying profiles when the caller shares no group", async () => {
    supabase = createSupabaseMock({
      group_members: [{ data: [], error: null }],
    });

    const result = await getAnniversaryPartnerCandidates();

    expect(result).toEqual({ data: [] });
  });

  it("returns Not authenticated when signed out, without touching the database", async () => {
    getUserId.mockResolvedValue(null);

    const result = await getAnniversaryPartnerCandidates();

    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("swaps a group_members failure for a generic message", async () => {
    supabase = createSupabaseMock({
      group_members: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getAnniversaryPartnerCandidates();

    expect(result).toEqual({
      error: "Failed to load your groupmates. Please try again.",
    });
  });
});
