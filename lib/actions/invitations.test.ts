import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The bug these pin: the Resend SDK does NOT throw on an API-level rejection.
 * `resend.emails.send()` resolves to `{ data: null, error }` (see
 * node_modules/resend/dist/index.mjs:491), so the `try/catch` that used to
 * wrap the send here was dead code for every failure Resend actually reports
 * -- an unverified domain, a suspended key, a rate limit.
 *
 * The visible symptom was the worst kind: sendGroupInvitation set
 * `emailSent: true` unconditionally, so the invite dialog said "Invitation
 * sent!" while Resend had returned 403 and no mail existed. The invitation row
 * was real, the email never was, and nothing anywhere said so.
 *
 * A network fault is the OTHER failure mode -- fetch itself rejects -- so both
 * shapes are covered below. They are not interchangeable and the code has to
 * handle both.
 */

/**
 * Mirrors EMAIL_SEND_FAILED_MESSAGE in ./invitations. It cannot be imported:
 * that module is "use server", where every export must be an async function.
 * If the wording there changes, these assertions fail -- which is the intent.
 */
const EMAIL_SEND_FAILED_MESSAGE =
  "The invitation is saved, but we couldn't send the email just now. " +
  "Try resending it in a moment.";

const sendGroupInviteEmail = vi.fn();

vi.mock("@/lib/resend/send", () => ({
  sendGroupInviteEmail: (...args: unknown[]) => sendGroupInviteEmail(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
  requireAuthWithProfile: vi.fn(),
}));

/**
 * Supabase's query builder is thenable, so `await from().select().eq()`
 * resolves without a terminal call while `.maybeSingle()` is its own promise.
 * This mock therefore makes every chain method return the chain and gives the
 * chain both a `then` and the terminal methods, all resolving the same
 * scripted response.
 *
 * Responses are queued PER TABLE and consumed in call order, which keeps each
 * test's script readable next to the sequence of queries in the action.
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

      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "insert",
        "update",
        "eq",
        "gte",
        "order",
        "limit",
      ]) {
        chain[method] = () => chain;
      }
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

const { sendGroupInvitation } = await import("./invitations");

/**
 * The happy-path query sequence sendGroupInvitation walks, in order:
 * user_profiles -> inviter, then the invitee lookup; invitations -> rate
 * limit, then existing-invite lookup, then the insert; group_members -> the
 * caller's membership. Individual tests override only what they care about.
 */
function happyPathScript() {
  return {
    user_profiles: [
      { data: { username: "kason", email: "kason@example.com" }, error: null },
      { data: null, error: null }, // invitee has no account yet
    ],
    invitations: [
      { data: [], error: null }, // under the rate limit
      { data: [], error: null }, // no existing invitation
      { data: { id: "invitation-1" }, error: null }, // insert
    ],
    group_members: [{ data: { role: "admin" }, error: null }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
  supabase = createSupabaseMock(happyPathScript());
});

/**
 * The invite template branches on isNewUser for both its body copy and its
 * button label ("Join Rybn & Accept Invite" vs "Accept Invitation"). It used
 * to be hardcoded true in lib/resend/send.tsx, so somebody who already had an
 * account was told to create one.
 *
 * The answer was already sitting in this action: it looks up the invitee in
 * user_profiles by email a few lines earlier, to check whether they are
 * already in the group. These pin that the lookup's result is what reaches
 * the template -- and, by passing it as an argument, that the email module
 * never needs a database of its own.
 */
describe("sendGroupInvitation invitee copy", () => {
  it("marks the invitee as new when no account exists", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({
      groupId: "group-1",
      groupName: "The Suchows",
      email: "invitee@example.com",
    });

    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ isNewUser: true })
    );
  });

  it("marks the invitee as existing when they already have an account", async () => {
    supabase = createSupabaseMock({
      user_profiles: [
        { data: { username: "kason", email: "kason@example.com" }, error: null },
        { data: { id: "user-existing" }, error: null }, // invitee HAS an account
      ],
      group_members: [
        { data: { role: "admin" }, error: null }, // inviter's membership
        { data: null, error: null }, // invitee is not in this group yet
      ],
      invitations: [
        { data: [], error: null },
        { data: [], error: null },
        { data: { id: "invitation-1" }, error: null },
      ],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({
      groupId: "group-1",
      groupName: "The Suchows",
      email: "invitee@example.com",
    });

    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ isNewUser: false })
    );
  });
});

describe("sendGroupInvitation", () => {
  it("reports failure when Resend rejects the send", async () => {
    // Exactly the payload Resend returns for rybn.app while the domain is
    // missing from the account -- resolved, not thrown.
    sendGroupInviteEmail.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        statusCode: 403,
        message: "The rybn.app domain is not verified.",
      },
    });

    const result = await sendGroupInvitation({
      groupId: "group-1",
      groupName: "The Suchows",
      email: "invitee@example.com",
    });

    expect(result.emailSent).toBe(false);
    expect(result.warning).toBe(EMAIL_SEND_FAILED_MESSAGE);
    // The provider's message named the app's own sending domain and linked
    // the Resend dashboard. A group member inviting a friend must never be
    // handed either; both stay in the server log.
    expect(result.warning).not.toContain("rybn.app");
    expect(result.warning).not.toContain("resend.com");
    // The invitation row itself is still created: a mail failure must not
    // cost the user the invitation.
    expect(result.data).toEqual({ id: "invitation-1" });
  });

  it("reports failure when the send throws outright", async () => {
    sendGroupInviteEmail.mockRejectedValue(new Error("fetch failed"));

    const result = await sendGroupInvitation({
      groupId: "group-1",
      groupName: "The Suchows",
      email: "invitee@example.com",
    });

    expect(result.emailSent).toBe(false);
    // Same message as an API rejection: the two failure shapes are one
    // situation from the inviter's side, and "fetch failed" means nothing
    // to them.
    expect(result.warning).toBe(EMAIL_SEND_FAILED_MESSAGE);
  });

  it("reports success when Resend accepts the send", async () => {
    sendGroupInviteEmail.mockResolvedValue({
      data: { id: "resend-message-1" },
      error: null,
    });

    const result = await sendGroupInvitation({
      groupId: "group-1",
      groupName: "The Suchows",
      email: "invitee@example.com",
    });

    expect(result.emailSent).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});
