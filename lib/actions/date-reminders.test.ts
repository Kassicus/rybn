import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * get_upcoming_dates_for_notifications has no notion of anniversary_links --
 * it reads profile_info directly, so a confirmed couple's shared anniversary
 * reaches checkAndSendDateReminders as TWO separate rows, one per partner's
 * own profile_info entry. Left alone that mails every shared group member
 * twice for one event. These tests pin the fix: the non-canonical half's row
 * is dropped before it is ever inserted (Step 3), and the surviving row's
 * email copy names BOTH partners rather than reading as though only the
 * canonical (lexicographically-smaller-id) half's anniversary is happening
 * (Step 3b) -- a dedupe without the copy fix is worse than no dedupe, since
 * it would make the surviving email wrong for half of every couple.
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
});

describe("checkAndSendDateReminders: couple reminder copy", () => {
  it("names both partners for a linked couple's surviving reminder, matching occasionLabel's combined-name rendering", async () => {
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

    expect(sendDateReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ celebrantName: "Alex & Sam" })
    );

    // Falsifiable by: reverting Step 3b so celebrantName stays
    // dateInfo.celebrant_username -- verified by making that revert, which
    // sends celebrantName: "alex" and fails this assertion. NOT caught by
    // this test alone: it does not exercise the username-only fallback
    // (display_name null) or the "Someone" floor for a missing profile row
    // -- only that a linked couple's copy names both people at all.
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
    // renders combined copy -- that is the previous test's job.
  });
});
