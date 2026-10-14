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
 * in the order requested) and sliced. Without this, getMyAnniversaryLinks'
 * ordering tests below would be pinning whatever order the
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
  getMyAnniversaryLinks,
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

describe("getMyAnniversaryLinks", () => {
  // The caller is "user_a_123" (beforeEach). Ids keep canonical order
  // (user_a < user_b) so the fixtures look like real rows; "user_0_999"
  // sorts before the caller, putting the caller on the user_b side.
  const row = (overrides: Record<string, unknown>) => ({
    id: "link-x",
    user_a: "user_a_123",
    user_b: "user_b_456",
    status: "pending",
    initiated_by: "user_b_456",
    agreed_date: "2020-06-01",
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  });

  const profile = (id: string, name: string) => ({
    id,
    username: name.toLowerCase(),
    display_name: name,
  });

  const profileLookups = () =>
    inSpy.mock.calls.filter(([table]) => table === "user_profiles");

  // Falsifiability: hidden case 1 (F4). Reintroduce `.limit(1)` and this
  // fails -- only the newer incoming row survives the limit, so `confirmed`
  // comes back null. Hardcode `partnerId = row.user_b` and it fails too:
  // the incoming row puts the caller on the user_b side. NOT caught: a
  // reader that returned the right groups from a different query shape.
  it("returns a confirmed link AND a newer incoming request", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({
              id: "link-confirmed",
              status: "confirmed",
              initiated_by: "user_a_123",
              created_at: "2026-09-01T00:00:00Z",
            }),
            row({
              id: "link-incoming",
              user_a: "user_0_999",
              user_b: "user_a_123",
              initiated_by: "user_0_999",
              agreed_date: "2018-03-03",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Partner"), profile("user_0_999", "Asker")],
          error: null,
        },
      ],
      profile_info: [
        { data: [{ user_id: "user_a_123", field_value: "2019-05-05" }], error: null },
      ],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      data: {
        confirmed: {
          id: "link-confirmed",
          partnerId: "user_b_456",
          partnerUsername: "partner",
          partnerDisplayName: "Partner",
          status: "confirmed",
          agreedDate: "2020-06-01",
          sharedDate: "2019-05-05",
          initiatedByMe: true,
        },
        outgoing: null,
        incoming: [
          {
            id: "link-incoming",
            partnerId: "user_0_999",
            partnerUsername: "asker",
            partnerDisplayName: "Asker",
            status: "pending",
            agreedDate: "2018-03-03",
            sharedDate: null,
            initiatedByMe: false,
          },
        ],
      },
    });
    // One profile lookup covering every partner, not one per row.
    expect(profileLookups()).toHaveLength(1);
    expect([...(profileLookups()[0][2] as string[])].sort()).toEqual([
      "user_0_999",
      "user_b_456",
    ]);
  });

  // Falsifiability: hidden case 2. Reintroduce `.limit(1)` and only one
  // request comes back. Drop the `.order("created_at", ...)` call and the
  // fixture's own oldest-first order leaks through, so the ids come back
  // reversed (the mock sorts only by the clauses actually requested). NOT
  // caught: ties on created_at, which real rows do not have.
  it("returns every incoming request, newest first", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({ id: "link-older", created_at: "2026-10-01T00:00:00Z" }),
            row({
              id: "link-newer",
              user_b: "user_c_789",
              initiated_by: "user_c_789",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Bea"), profile("user_c_789", "Cal")],
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.incoming.map((l) => l.id)).toEqual([
      "link-newer",
      "link-older",
    ]);
    expect(result.data.confirmed).toBeNull();
    expect(result.data.outgoing).toBeNull();
  });

  // Falsifiability: hidden case 3. Reintroduce `.limit(1)` and the caller's
  // own (older) request disappears behind the newer incoming one. Classify
  // on status alone (ignoring initiated_by) and the outgoing row lands in
  // `incoming`. NOT caught: which of two outgoing rows wins -- see the next
  // test.
  it("keeps the caller's own request when someone asks them later", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({
              id: "link-mine",
              initiated_by: "user_a_123",
              created_at: "2026-10-01T00:00:00Z",
            }),
            row({
              id: "link-theirs",
              user_b: "user_c_789",
              initiated_by: "user_c_789",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Bea"), profile("user_c_789", "Cal")],
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.outgoing?.id).toBe("link-mine");
    expect(result.data.outgoing?.initiatedByMe).toBe(true);
    expect(result.data.incoming.map((l) => l.id)).toEqual(["link-theirs"]);
  });

  // Review focus 2. Two outgoing rows can only predate the I-out refusal.
  // Falsifiability: take the LAST outgoing row instead of the first and the
  // older one wins; drop the warning and the spy assertion fails. NOT
  // caught: what the UI does with the dropped row -- nothing, by design.
  it("returns the newest outgoing request when two exist, and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({
              id: "link-old-mine",
              initiated_by: "user_a_123",
              created_at: "2026-10-01T00:00:00Z",
            }),
            row({
              id: "link-new-mine",
              user_b: "user_c_789",
              initiated_by: "user_a_123",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Bea"), profile("user_c_789", "Cal")],
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.outgoing?.id).toBe("link-new-mine");
    expect(result.data.incoming).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // Review focus 1. A requester who no longer shares a group with the
  // caller is hidden by user_profiles' RLS. Falsifiability: index the
  // profile lookup by position instead of by id and the wrong name lands on
  // the wrong row; throw on a missing profile and this rejects. NOT caught:
  // what label the UI shows -- the card's "Someone" fallback.
  it("keeps a link whose partner profile is hidden", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({ id: "link-hidden", created_at: "2026-10-01T00:00:00Z" }),
            row({
              id: "link-visible",
              user_b: "user_c_789",
              initiated_by: "user_c_789",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [{ data: [profile("user_c_789", "Cal")], error: null }],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    const [visible, hidden] = result.data.incoming;
    expect(visible).toMatchObject({ id: "link-visible", partnerDisplayName: "Cal" });
    expect(hidden).toMatchObject({
      id: "link-hidden",
      partnerId: "user_b_456",
      partnerUsername: null,
      partnerDisplayName: null,
    });
  });

  // Falsifiability: look up profiles (or profile_info) when there are no
  // rows and the unscripted table throws "No scripted Supabase response".
  // NOT caught: an extra query on a NON-empty result -- the other tests
  // script exactly the tables they expect.
  it("returns empty groups without further queries when there are no links", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [{ data: [], error: null }],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      data: { confirmed: null, outgoing: null, incoming: [] },
    });
  });

  // Falsifiability: return `{ data: { ... } }` on a failed read and the
  // error shape assertion fails. NOT caught: the exact log text.
  it("returns an error when the links read fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      error: "Failed to load your anniversary links. Please try again.",
    });
    error.mockRestore();
  });

  it("returns an error when the partner profile lookup fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [{ data: [row({ id: "link-1" })], error: null }],
      user_profiles: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      error: "Failed to load your anniversary links. Please try again.",
    });
    error.mockRestore();
  });

  // Falsifiability: surface the shared-date failure as `{ error }` and this
  // fails. NOT caught: whether the fallback date is the right one -- the
  // component falls back to agreedDate, as before.
  it("falls back to a null shared date when that lookup fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [row({ id: "link-c", status: "confirmed", initiated_by: "user_a_123" })],
          error: null,
        },
      ],
      user_profiles: [{ data: [profile("user_b_456", "Bea")], error: null }],
      profile_info: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.confirmed).toMatchObject({ id: "link-c", sharedDate: null });
    error.mockRestore();
  });

  // Falsifiability: build the client before checking getUserId() and the
  // empty mock throws on the first from(). NOT caught: a signed-out caller
  // reaching an RPC -- this action calls none.
  it("returns Not authenticated when signed out, without querying", async () => {
    getUserId.mockResolvedValue(null);
    supabase = createSupabaseMock({});

    const result = await getMyAnniversaryLinks();

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
