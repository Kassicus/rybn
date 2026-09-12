import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * get_upcoming_dates_for_notifications has no notion of anniversary_links --
 * it reads profile_info directly, so a confirmed couple's shared anniversary
 * reaches checkAndSendDateReminders as TWO separate rows, one per partner's
 * own profile_info entry. Left alone that mails every shared group member
 * twice for one event. These tests pin the fix: the non-canonical half's row
 * is dropped before it is ever inserted (Step 3), and the surviving row's
 * email copy names BOTH partners -- for the recipients entitled to both names
 * -- rather than reading as though only the canonical
 * (lexicographically-smaller-id) half's anniversary is happening (Step 3b) --
 * a dedupe without the copy fix is worse than no dedupe, since it would make
 * the surviving email wrong for half of every couple. Who is entitled is
 * decided per recipient; see the "couple reminder copy" block below.
 *
 * Mocking follows lib/actions/occasions.test.ts's chainable-thenable
 * Supabase mock, extended with `.in()` (for the batched partner-profile
 * lookup) and a plain `rpc` spy (checkAndSendDateReminders calls
 * supabase.rpc(...) directly, not through .from()).
 */

const rpc = vi.fn();
const insertSpy = vi.fn();
const updateSpy = vi.fn();
const sendDateReminderEmail = vi.fn();

vi.mock("@/lib/resend/send", () => ({
  sendDateReminderEmail: (...args: unknown[]) => sendDateReminderEmail(...args),
}));

// checkAndSendDateReminders itself never touches these, but date-reminders.ts
// imports both at module scope (for getActiveDateReminders/dismissDateReminder),
// and both real modules pull in "server-only" (require-auth.ts directly,
// supabase/server.ts transitively via @clerk/nextjs/server) -- which throws
// unconditionally outside a real Server Component. Unmocked, importing
// date-reminders.ts at all fails before a single test runs.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: vi.fn(),
}));

/**
 * Same shape as occasions.test.ts's createSupabaseMock: every chain method
 * returns the chain, and the chain is thenable so `await from().select().eq()`
 * or `await from().select().in()` resolves without a terminal call, while
 * `.single()` is its own promise. Responses are queued per table and consumed
 * in call order.
 */
function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, responses] of Object.entries(script)) {
    queues[table] = [...responses];
  }

  return {
    rpc: (...args: unknown[]) => rpc(...args),
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
        eq: () => chain,
        in: () => chain,
        insert: (payload: unknown) => {
          insertSpy(table, payload);
          return chain;
        },
        update: (payload: unknown) => {
          updateSpy(table, payload);
          return chain;
        },
      };
      chain.single = async () => next();
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(next()).then(resolve);
      return chain;
    },
  };
}

let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => supabase,
}));

const { checkAndSendDateReminders } = await import("./date-reminders");

const CRON_SECRET = "test-cron-secret";

/** A full get_upcoming_dates_for_notifications row, with per-test overrides. */
function dateRow(overrides: Partial<{
  celebrant_id: string;
  celebrant_username: string;
  field_name: string;
  field_value: string;
  celebration_date: string;
  group_id: string;
  group_name: string;
  group_type: "family" | "friends" | "work" | "custom";
  notified_user_id: string;
  notified_user_email: string;
}> = {}) {
  return {
    celebrant_id: "celebrant-default",
    celebrant_username: "celebrant-default-username",
    field_name: "anniversary",
    field_value: "1990-06-15",
    celebration_date: "2026-06-15",
    group_id: "group-1",
    group_name: "The Household",
    group_type: "family" as const,
    notified_user_id: "notified-1",
    notified_user_email: "notified@example.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
  sendDateReminderEmail.mockResolvedValue({ data: {}, error: null });
  supabase = createSupabaseMock({});
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("checkAndSendDateReminders: couple dedupe", () => {
  it("inserts exactly ONE date_notifications row for a confirmed couple's anniversary, keyed to the canonical (user_a) partner", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        dateRow({ celebrant_id: "user_alex", celebrant_username: "alex" }),
        dateRow({ celebrant_id: "user_sam", celebrant_username: "sam" }),
      ],
      error: null,
    });

    supabase = createSupabaseMock({
      anniversary_links: [
        { data: [{ user_a: "user_alex", user_b: "user_sam" }], error: null },
      ],
      user_profiles: [
        {
          data: [
            { id: "user_alex", username: "alex", display_name: "Alex" },
            { id: "user_sam", username: "sam", display_name: "Sam" },
          ],
          error: null,
        },
      ],
      // One surviving row -> one insert+select().single(), one update().
      date_notifications: [
        { data: { id: "notification-1" }, error: null },
        { data: null, error: null },
      ],
    });

    const result = await checkAndSendDateReminders(CRON_SECRET);

    const notificationInserts = insertSpy.mock.calls.filter(
      ([table]) => table === "date_notifications"
    );
    expect(notificationInserts).toHaveLength(1);
    expect(notificationInserts[0][1]).toMatchObject({ celebrant_id: "user_alex" });
    expect(result.sent).toBe(1);

    // Falsifiable by: deleting the `nonCanonicalCelebrantIds.has(...)` guard
    // in date-reminders.ts -- verified by commenting it out and re-running,
    // which inserts BOTH rows and fails this assertion at `toHaveLength(1)`.
    // NOT caught by this test alone: a dedupe keyed on celebration_date
    // (e.g. "drop the second row seen for a given date") would also produce
    // exactly one insert here and pass -- that failure mode is what the
    // "two unrelated people" test below exists to catch.
  });

  it("still produces TWO reminders for two unrelated people who happen to share an anniversary date", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        dateRow({
          celebrant_id: "user_taylor",
          celebrant_username: "taylor",
          celebration_date: "2026-06-15",
          notified_user_id: "notified-taylor",
        }),
        dateRow({
          celebrant_id: "user_jordan",
          celebrant_username: "jordan",
          celebration_date: "2026-06-15",
          notified_user_id: "notified-jordan",
        }),
      ],
      error: null,
    });

    supabase = createSupabaseMock({
      // No confirmed link between them -- the shared date is coincidence.
      anniversary_links: [{ data: [], error: null }],
      // Neither celebrant resolves to a partner, so the batched profile
      // lookup is never issued: no "user_profiles" entry is scripted, and if
      // the implementation queried it anyway this test would fail with
      // "No scripted Supabase response left for user_profiles".
      date_notifications: [
        { data: { id: "notification-taylor" }, error: null },
        { data: null, error: null },
        { data: { id: "notification-jordan" }, error: null },
        { data: null, error: null },
      ],
    });

    const result = await checkAndSendDateReminders(CRON_SECRET);

    const notificationInserts = insertSpy.mock.calls.filter(
      ([table]) => table === "date_notifications"
    );
    expect(notificationInserts).toHaveLength(2);
    expect(notificationInserts.map(([, payload]) => (payload as { celebrant_id: string }).celebrant_id))
      .toEqual(["user_taylor", "user_jordan"]);
    expect(result.sent).toBe(2);

    // Falsifiable by: swapping the link-membership dedupe for one keyed on
    // celebration_date (e.g. "insert only the first row per distinct date
    // per notified user") -- verified by making that swap, which collapses
    // these two unrelated people's rows into one and fails
    // `toHaveLength(2)`. NOT caught by this test alone: it says nothing
    // about which id a *linked* couple's survivor is keyed to -- that is
    // what the test above pins down.
  });

  // FINDING I3. The dedupe dropped EVERY anniversary row whose celebrant was
  // any confirmed link's user_b, globally, without checking that the same
  // RECIPIENT was also getting the user_a row meant to stand in for it.
  //
  // Every source row is independently gated on
  // can_view_field(celebrant, notified_user, ...) inside
  // get_upcoming_dates_for_notifications, so a recipient who can see only
  // the non-canonical partner's date gets the user_b row and no user_a row
  // at all -- and the global dedupe deleted the only reminder they were ever
  // going to get. They received one before this branch existed. That is the
  // spec's explicitly REJECTED option ("hide unless both are visible ...
  // takes away access a viewer already legitimately had") arriving through
  // the reminder path.
  it("still reminds a recipient who can see ONLY the non-canonical partner -- finding I3", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        // The only row this recipient's visibility produces: the
        // non-canonical half. There is no user_alex row for notified-2.
        dateRow({
          celebrant_id: "user_sam",
          celebrant_username: "sam",
          notified_user_id: "notified-2",
          notified_user_email: "partner-side@example.com",
        }),
      ],
      error: null,
    });

    supabase = createSupabaseMock({
      anniversary_links: [
        { data: [{ user_a: "user_alex", user_b: "user_sam" }], error: null },
      ],
      // No user_profiles entry is scripted: user_sam is not a canonical
      // celebrant, so the couple-copy path must not fire for this row. If it
      // did, this test would fail on "No scripted Supabase response left for
      // user_profiles".
      date_notifications: [
        { data: { id: "notification-2" }, error: null },
        { data: null, error: null },
      ],
    });

    const result = await checkAndSendDateReminders(CRON_SECRET);

    const notificationInserts = insertSpy.mock.calls.filter(
      ([table]) => table === "date_notifications"
    );
    expect(notificationInserts).toHaveLength(1);
    expect(notificationInserts[0][1]).toMatchObject({
      celebrant_id: "user_sam",
      notified_user_id: "notified-2",
    });
    expect(result.sent).toBe(1);
    // Single name, not "Alex & Sam": this recipient cannot see user_alex's
    // date, which is why they never received that row.
    expect(sendDateReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ celebrantName: "sam" })
    );

    // Falsifiable by: reverting the drop condition to the global form
    // (`nonCanonicalCelebrantIds.has(dateInfo.celebrant_id)` with no
    // canonicalRowKeys conjunct) -- verified by making that revert, which
    // sends ZERO reminders and fails at `toHaveLength(1)` with 0.
    // NOT caught by this test alone: whether a recipient who sees BOTH
    // partners still gets exactly one -- that is the first test in this
    // describe block, which the per-recipient key must not regress.
  });

  it("dedupes per recipient, not globally -- two recipients, different visibility", async () => {
    // The two halves in one run, which is the state that makes the global
    // dedupe and the per-recipient dedupe visibly different:
    //   notified-1 sees both partners -> gets user_alex AND user_sam rows
    //   notified-2 sees only user_sam -> gets the user_sam row alone
    // Correct outcome: TWO inserts -- one merged couple reminder keyed to
    // user_alex for notified-1, and one single-name reminder keyed to
    // user_sam for notified-2. The global dedupe produced ONE (notified-2's
    // row was collateral damage of notified-1 having a canonical row).
    rpc.mockResolvedValueOnce({
      data: [
        dateRow({
          celebrant_id: "user_alex",
          celebrant_username: "alex",
          notified_user_id: "notified-1",
        }),
        dateRow({
          celebrant_id: "user_sam",
          celebrant_username: "sam",
          notified_user_id: "notified-1",
        }),
        dateRow({
          celebrant_id: "user_sam",
          celebrant_username: "sam",
          notified_user_id: "notified-2",
          notified_user_email: "partner-side@example.com",
        }),
      ],
      error: null,
    });

    supabase = createSupabaseMock({
      anniversary_links: [
        { data: [{ user_a: "user_alex", user_b: "user_sam" }], error: null },
      ],
      user_profiles: [
        {
          data: [
            { id: "user_alex", username: "alex", display_name: "Alex" },
            { id: "user_sam", username: "sam", display_name: "Sam" },
          ],
          error: null,
        },
      ],
      date_notifications: [
        { data: { id: "notification-1" }, error: null },
        { data: null, error: null },
        { data: { id: "notification-2" }, error: null },
        { data: null, error: null },
      ],
    });

    const result = await checkAndSendDateReminders(CRON_SECRET);

    const notificationInserts = insertSpy.mock.calls.filter(
      ([table]) => table === "date_notifications"
    );
    expect(
      notificationInserts.map(([, payload]) => {
        const p = payload as { celebrant_id: string; notified_user_id: string };
        return `${p.notified_user_id}:${p.celebrant_id}`;
      })
    ).toEqual(["notified-1:user_alex", "notified-2:user_sam"]);
    expect(result.sent).toBe(2);

    // Falsifiable by: reverting to the global dedupe, which drops
    // notified-2's row and leaves only ["notified-1:user_alex"] -- verified
    // by making that revert and watching this assertion fail with a
    // one-element array. Also falsifiable in the other direction: removing
    // the dedupe entirely produces three inserts including
    // "notified-1:user_sam", the double-email this step exists to prevent.
    // NOT caught: the email COPY for either survivor, which the
    // "couple reminder copy" block below covers.
  });
});

/**
 * PER-RECIPIENT PARTNER NAMING (owner decision, fix wave 2 item D).
 *
 * The rule: name BOTH partners only when the recipient shares a group with
 * each of them; otherwise name only the partner they can see. One occasion,
 * one date, one email -- different copy per viewer.
 *
 * Why this is not cosmetic. get_upcoming_dates_for_notifications gates every
 * row on the CELEBRANT alone (`can_view_field(pi.user_id, gm.user_id, ...)`
 * after an inner join on the celebrant's group_members), and user_profiles'
 * own SELECT policy is group-gated -- so a recipient who shares no group with
 * the partner cannot read that partner's display name through the app at all.
 * checkAndSendDateReminders reads it anyway, through the service-role client,
 * and used to print it into the email unconditionally. That handed a name --
 * and an association -- across a boundary RLS enforces everywhere else.
 *
 * The signal is the run's own rows. A recipient who can see the non-canonical
 * partner received that partner's row too, because the RPC applied the same
 * can_view_field gate to it. `nonCanonicalRowKeys` is that set; no extra query.
 *
 * ALL FIVE RENDERED SURFACES come from the single `celebrantName` argument
 * asserted below -- subject (lib/resend/send.tsx, `${emoji} ${celebrantName}'s
 * ${dateTypeLabel} - ${celebrationDate}`), body sentence, highlight heading,
 * the "View ...'s Wishlist" button and the footer sentence (all four in
 * lib/resend/templates/DateReminderEmail.tsx). Pinning the argument pins all
 * five; the negative test additionally asserts that NO argument reaching the
 * email layer carries the unseen partner's name, username or id, which is
 * stronger than checking those five strings one at a time.
 */
describe("checkAndSendDateReminders: couple reminder copy", () => {
  it("names BOTH partners when the recipient holds both partners' rows", async () => {
    // notified-1 received user_alex AND user_sam -- the RPC's per-celebrant
    // can_view_field gate passed for each, so this recipient shares a group
    // with both and may be told both names.
    rpc.mockResolvedValueOnce({
      data: [
        dateRow({ celebrant_id: "user_alex", celebrant_username: "alex" }),
        dateRow({ celebrant_id: "user_sam", celebrant_username: "sam" }),
      ],
      error: null,
    });

    supabase = createSupabaseMock({
      anniversary_links: [
        { data: [{ user_a: "user_alex", user_b: "user_sam" }], error: null },
      ],
      user_profiles: [
        {
          data: [
            { id: "user_alex", username: "alex", display_name: "Alex" },
            { id: "user_sam", username: "sam", display_name: "Sam" },
          ],
          error: null,
        },
      ],
      date_notifications: [
        { data: { id: "notification-1" }, error: null },
        { data: null, error: null },
      ],
    });

    await checkAndSendDateReminders(CRON_SECRET);

    // One email, naming both -- matching occasionLabel's combined rendering
    // for exactly the viewers occasionLabel would combine for.
    expect(sendDateReminderEmail).toHaveBeenCalledTimes(1);
    expect(sendDateReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ celebrantName: "Alex & Sam" })
    );

    // Falsifiable by: dropping the nonCanonicalRowKeys conjunct from the
    // celebrantName condition in date-reminders.ts -- no, that direction
    // still passes here (this recipient DOES hold both rows). It is falsified
    // by reverting Step 3b so celebrantName stays dateInfo.celebrant_username,
    // which sends "alex" and fails this assertion -- verified by making that
    // revert. NOT caught by this test alone: whether a recipient who holds
    // only ONE partner's row is spared the other's name -- the next test.
  });

  it("names ONLY the visible partner when the recipient holds just one partner's row", async () => {
    // The fixture the previous version of this test used, and what it means:
    // a single user_alex row for notified-1, with NO user_sam row. By the
    // reasoning already stated in the I3 test above ("There is no user_alex
    // row for notified-2 ... this recipient cannot see user_alex's date,
    // which is why they never received that row"), the missing user_sam row
    // says this recipient cannot see Sam. The old test asserted "Alex & Sam"
    // here -- it pinned the leak as correct behaviour.
    rpc.mockResolvedValueOnce({
      data: [
        dateRow({ celebrant_id: "user_alex", celebrant_username: "alex" }),
      ],
      error: null,
    });

    supabase = createSupabaseMock({
      anniversary_links: [
        { data: [{ user_a: "user_alex", user_b: "user_sam" }], error: null },
      ],
      // No user_profiles entry is scripted ON PURPOSE. A name this recipient
      // may not be told must not even be FETCHED: the batched partner-profile
      // lookup is now narrowed to the couples some recipient in this run can
      // actually see both halves of. If the implementation issued it anyway
      // this test fails with "No scripted Supabase response left for
      // user_profiles" -- which is how it fails against the pre-fix code.
      date_notifications: [
        { data: { id: "notification-1" }, error: null },
        { data: null, error: null },
      ],
    });

    await checkAndSendDateReminders(CRON_SECRET);

    // The reminder still goes out, keyed to the celebrant they CAN see, with
    // the couple's (shared) date -- one occasion, one email, different copy.
    expect(sendDateReminderEmail).toHaveBeenCalledTimes(1);
    expect(sendDateReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ celebrantName: "alex" })
    );

    // Nothing identifying Sam reaches the email layer through ANY argument --
    // not the name, not the username, not the id (which would become a
    // /profile/<id> and /wishlist/<id> link in send.tsx). Covers all five
    // rendered surfaces at once, since every one of them is built from these
    // arguments.
    const args = JSON.stringify(sendDateReminderEmail.mock.calls);
    expect(args).not.toContain("Sam");
    expect(args).not.toContain("sam");
    expect(args).not.toContain("user_sam");

    // Falsifiable by: removing the `nonCanonicalRowKeys.has(...)` conjunct
    // from the celebrantName condition -- verified by removing it, which
    // sends celebrantName "Alex & Sam" and fails both the equality and the
    // not-to-contain assertions. NOT caught by this test alone: that a
    // recipient who CAN see both still gets the combined copy -- the previous
    // test, which the per-recipient gate must not regress.
  });

  it("renders a single name for a person with no confirmed anniversary link", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        dateRow({ celebrant_id: "user_jordan", celebrant_username: "jordan" }),
      ],
      error: null,
    });

    supabase = createSupabaseMock({
      anniversary_links: [{ data: [], error: null }],
      date_notifications: [
        { data: { id: "notification-jordan" }, error: null },
        { data: null, error: null },
      ],
    });

    await checkAndSendDateReminders(CRON_SECRET);

    expect(sendDateReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ celebrantName: "jordan" })
    );

    // Falsifiable by: hardcoding the couple-name path to always run (e.g.
    // dropping the `&& partnerId` guard so it fires even without a link) --
    // verified by making that change, which throws building the partner half
    // from an empty profiles map / undefined partnerId and fails this test.
    // NOT caught by this test alone: it does not verify the LINKED case
    // renders combined copy -- that is the first test's job.
  });
});
