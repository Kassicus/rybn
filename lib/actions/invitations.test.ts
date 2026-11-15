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
 * The warning the action answers (GROUP_SENTENCES.emailNotSent in
 * lib/groups/sentences.ts), written out rather than imported: if the wording
 * there changes, these assertions fail -- which is the intent.
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
const requireAuthWithProfile = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
  requireAuthWithProfile: () => requireAuthWithProfile(),
}));

/**
 * Every query the action builds with the caller's own client, as
 * `(table, "from")` and then `(table, method, ...args)` for each chain call,
 * so a test can read what was asked for and with which values -- or that
 * nothing was asked at all. `adminQuery` records the admin client's queries
 * the same way.
 */
const query = vi.fn();
const adminQuery = vi.fn();
const rpc = vi.fn();
const createAdminClient = vi.fn();

/**
 * Supabase's query builder is thenable, so `await from().select().eq()`
 * resolves without a terminal call while `.maybeSingle()` is its own promise.
 * This mock therefore makes every chain method return the chain and gives the
 * chain both a `then` and the terminal methods, all resolving the same
 * scripted response.
 *
 * Responses are queued PER TABLE and consumed in call order, which keeps each
 * test's script readable next to the sequence of queries in the action. The
 * admin client's are queued under "admin:<table>". `order` holds every table
 * asked, the admin client's as "admin:<table>", in the order they were asked.
 */
function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, responses] of Object.entries(script)) {
    queues[table] = [...responses];
  }
  const order: string[] = [];

  const client = (prefix: string, record: typeof query) => (table: string) => {
    const queued = `${prefix}${table}`;
    order.push(queued);
    record(table, "from");
    const next = () => {
      const queue = queues[queued];
      if (!queue || queue.length === 0) {
        throw new Error(`No scripted Supabase response left for "${queued}"`);
      }
      return queue.shift();
    };

    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "eq",
      "in",
      "gte",
      "order",
      "limit",
    ]) {
      chain[method] = (...args: unknown[]) => {
        record(table, method, ...args);
        return chain;
      };
    }
    chain.maybeSingle = async () => next();
    chain.single = async () => next();
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(next()).then(resolve);
    return chain;
  };

  return { order, from: client("", query), adminFrom: client("admin:", adminQuery) };
}

let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => supabase.from(table),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    createAdminClient();
    return { from: (table: string) => supabase.adminFrom(table) };
  },
}));

const { sendGroupInvitation, joinGroupByCode } = await import("./invitations");

/**
 * The caller's membership as the action reads it: their role, and the name of
 * the group it belongs to.
 */
const MEMBERSHIP = {
  data: { role: "admin", groups: { name: "The Suchows" } },
  error: null,
};

/** The group every invitation here is for; a group's id is a UUID. */
const GROUP_ID = "4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b";

/**
 * The happy-path query sequence sendGroupInvitation walks, per table, each in
 * order: group_members -> the caller's membership (the first read of all);
 * user_profiles -> the inviter's username; invitations -> rate limit, then
 * existing-invite lookup, then the insert. On the admin client,
 * user_profiles -> the ids of the accounts holding the address, between the
 * rate limit and the existing-invite lookup. Individual tests override only
 * what they care about.
 */
function happyPathScript() {
  return {
    user_profiles: [{ data: { username: "kason" }, error: null }],
    "admin:user_profiles": [{ data: [], error: null }], // no account holds the address yet
    invitations: [
      { data: [], error: null }, // under the rate limit
      { data: [], error: null }, // no existing invitation
      { data: { id: "invitation-1" }, error: null }, // insert
    ],
    group_members: [MEMBERSHIP],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // An answer one test queued for the database function and never used is
  // not left for the next test.
  rpc.mockReset();
  getUserId.mockResolvedValue("user_123");
  requireAuthWithProfile.mockResolvedValue("user_123");
  supabase = createSupabaseMock(happyPathScript());
});

/**
 * The invite template branches on isNewUser for both its body copy and its
 * button label ("Join Rybn & Accept Invite" vs "Accept Invitation"). It used
 * to be hardcoded true in lib/resend/send.tsx, so somebody who already had an
 * account was told to create one.
 *
 * The answer is in this action: it looks up, with the admin client, the ids
 * of the accounts holding the address, to check whether one of them is
 * already in the group. These pin that the lookup's result is what reaches
 * the template -- and, by passing it as an argument, that the email module
 * never needs a database of its own.
 */
describe("sendGroupInvitation invitee copy", () => {
  it("marks the invitee as new when no account holds the address, asking nothing about the group", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ isNewUser: true })
    );
    expect(query).not.toHaveBeenCalledWith("group_members", "in", "user_id", expect.anything());
  });

  it("marks the invitee as existing when an account holds the address and none is in the group", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      "admin:user_profiles": [{ data: [{ id: "user-existing" }], error: null }],
      group_members: [
        MEMBERSHIP, // inviter's membership
        { data: [], error: null }, // no account holding the address is in this group yet
      ],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ isNewUser: false })
    );
  });
});

/**
 * Which accounts hold the typed address is read with the admin client, ids
 * alone, after the membership check and the hourly limit; whether one of them
 * is in the group is asked of the caller's own client. The address is never
 * logged, and the ids never leave the action.
 */
describe("sendGroupInvitation invitee check", () => {
  /** Two accounts hold the address. */
  const HOLDERS = { data: [{ id: "user_2holderA" }, { id: "user_2holderB" }], error: null };

  it("reads the ids of the accounts holding the address with the admin client", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(adminQuery.mock.calls).toEqual([
      ["user_profiles", "from"],
      ["user_profiles", "select", "id"],
      ["user_profiles", "eq", "email", "invitee@example.com"],
    ]);
  });

  it("answers already in the group when the caller's client finds one of those accounts in it", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      "admin:user_profiles": [HOLDERS],
      group_members: [MEMBERSHIP, { data: [{ id: "membership-9" }], error: null }],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(result).toEqual({ error: "This user is already a member of the group" });
    // One question of the caller's own client: is any of the ids in this group.
    const check = query.mock.calls.filter(([table]) => table === "group_members").slice(4);
    expect(check).toEqual([
      ["group_members", "from"],
      ["group_members", "select", "id"],
      ["group_members", "eq", "group_id", GROUP_ID],
      ["group_members", "in", "user_id", ["user_2holderA", "user_2holderB"]],
      ["group_members", "limit", 1],
    ]);
    expect(query).not.toHaveBeenCalledWith("invitations", "insert", expect.anything());
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("invites when none of those accounts is in the group, passing on no id", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    supabase = createSupabaseMock({
      ...happyPathScript(),
      "admin:user_profiles": [HOLDERS],
      group_members: [MEMBERSHIP, { data: [], error: null }],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(result).toStrictEqual({ emailSent: true, isResend: false });
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ isNewUser: false })
    );
    const handedOn = [
      ...sendGroupInviteEmail.mock.calls,
      ...query.mock.calls.filter(([table]) => table === "invitations"),
      ...logs.flatMap((spy) => spy.mock.calls),
    ];
    expect(JSON.stringify(handedOn)).not.toMatch(/user_2holder/);
    for (const spy of logs) spy.mockRestore();
  });

  it("treats a failed lookup as no account, logging its code alone and never the address", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    supabase = createSupabaseMock({
      ...happyPathScript(),
      "admin:user_profiles": [
        {
          data: null,
          error: { code: "57014", message: "canceling statement for invitee@example.com" },
        },
      ],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(result).toStrictEqual({ emailSent: true, isResend: false });
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ isNewUser: true })
    );
    expect(query).not.toHaveBeenCalledWith("group_members", "in", "user_id", expect.anything());
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["sendGroupInvitation: could not look up the address (57014)"],
    ]);
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain("invitee@example.com");
    for (const spy of logs) spy.mockRestore();
  });

  it("looks the address up after the hourly count and before the waiting-invitation lookup", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      "admin:user_profiles": [HOLDERS],
      group_members: [MEMBERSHIP, { data: [], error: null }],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(supabase.order).toEqual([
      "group_members", // the caller's membership
      "user_profiles", // the inviter's username
      "invitations", // the hourly count
      "admin:user_profiles", // the accounts holding the address
      "group_members", // whether one of them is in the group
      "invitations", // a waiting invitation
      "invitations", // the insert
    ]);
  });

  it.each([
    ["someone not in the group", { group_members: [{ data: null, error: null }] }],
    [
      "a member who has sent ten this hour",
      {
        invitations: [
          { data: Array.from({ length: 10 }, (_, i) => ({ id: `invitation-${i}` })), error: null },
        ],
      },
    ],
  ])("looks up nothing about the address for %s", async (_case, over) => {
    supabase = createSupabaseMock({ ...happyPathScript(), ...over });

    const result = await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(result).toHaveProperty("error");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(adminQuery).not.toHaveBeenCalled();
  });

  it("never asks user_profiles anything about the email through the caller's client", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    const profileCalls = query.mock.calls.filter(([table]) => table === "user_profiles");
    expect(profileCalls).toEqual([
      ["user_profiles", "from"],
      ["user_profiles", "select", "username"],
      ["user_profiles", "eq", "id", "user_123"],
    ]);
    expect(JSON.stringify(profileCalls)).not.toMatch(/email|invitee@example\.com/);
  });
});

/**
 * The invitation names the inviter by their username, else their own email,
 * read through own_contact() only when there is no username, else "A friend".
 */
describe("sendGroupInvitation inviter's name", () => {
  /** Every select() asked of user_profiles through the caller's client. */
  const profileSelects = () =>
    query.mock.calls
      .filter(([table, method]) => table === "user_profiles" && method === "select")
      .map(([, , ...args]) => args);

  it("names the inviter by their username, reading that column alone, without own_contact()", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(query).toHaveBeenCalledWith("user_profiles", "select", "username");
    expect(query).toHaveBeenCalledWith("user_profiles", "eq", "id", "user_123");
    expect(rpc).not.toHaveBeenCalled();
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: "kason" })
    );
  });

  it.each([
    ["has no profile row", { data: null, error: null }],
    ["has an empty username", { data: { username: "" }, error: null }],
  ])("names the inviter by their own email from own_contact() when the inviter %s", async (_case, inviter) => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      user_profiles: [inviter],
    });
    rpc.mockResolvedValueOnce({
      data: [{ email: "kason@example.com", email_preferences: null }],
      error: null,
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(rpc.mock.calls).toEqual([["own_contact"]]);
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: "kason@example.com" })
    );
  });

  it.each([
    ["fails", { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }],
    ["answers no row", { data: [], error: null }],
    ["answers no email", { data: [{ email: null, email_preferences: null }], error: null }],
  ])("names the inviter A friend when they have no username and own_contact() %s", async (_case, contact) => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      user_profiles: [{ data: null, error: null }],
    });
    rpc.mockResolvedValueOnce(contact);
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(result).toEqual({ emailSent: true, isResend: false });
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: "A friend" })
    );
  });

  it("never asks user_profiles for the email, the email preferences or every column through the caller's client", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    const selects = profileSelects();
    expect(selects.length).toBeGreaterThan(0);
    for (const args of selects) {
      expect(args).toHaveLength(1);
      const named = String(args[0])
        .split(",")
        .map((column) => column.trim());
      expect(named.filter((column) => ["*", "email", "email_preferences", ""].includes(column))).toEqual([]);
    }
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
      groupId: GROUP_ID,
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
    expect(query).toHaveBeenCalledWith(
      "invitations",
      "insert",
      expect.objectContaining({ email: "invitee@example.com" })
    );
  });

  it("reports failure when the send throws outright", async () => {
    sendGroupInviteEmail.mockRejectedValue(new Error("fetch failed"));

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
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
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(result.emailSent).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

/**
 * What the action answers once the invitation is made: whether the email went,
 * whether it was sent again, and the warning when it did not go. The
 * invitation's row stays on the server.
 */
describe("sendGroupInvitation answers", () => {
  /** The row the database hands back, with columns the answer must not carry. */
  const ROW = {
    id: "invitation-1",
    email: "invitee@example.com",
    token: "tok_secret",
    expires_at: "2026-11-19T10:00:00.000Z",
  };

  it("whether the email went and whether it was sent again, and nothing else", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      invitations: [
        { data: [], error: null },
        { data: [], error: null },
        { data: ROW, error: null }, // insert
      ],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(result).toStrictEqual({ emailSent: true, isResend: false });
  });

  it("says it was sent again for an invitation already waiting", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      invitations: [
        { data: [], error: null },
        // The caller's own invitation, still waiting.
        { data: [{ id: "invitation-1", accepted: false, invited_by: "user_123" }], error: null },
        { data: ROW, error: null }, // update
      ],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(query).toHaveBeenCalledWith("invitations", "update", expect.anything());
    expect(result).toStrictEqual({ emailSent: true, isResend: true });
  });

  it("reads who sent the invitation already there", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    expect(query).toHaveBeenCalledWith("invitations", "select", "id, accepted, invited_by");
  });

  it("answers that someone else in the group already invited the address while theirs is waiting, writing and sending nothing", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      invitations: [
        { data: [], error: null },
        { data: [{ id: "invitation-1", accepted: false, invited_by: "user_other" }], error: null },
        { data: ROW, error: null }, // scripted so that a write would run, and fail the assertions below
      ],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(result).toEqual({ error: "Someone in this group has already invited this address." });
    expect(query).not.toHaveBeenCalledWith("invitations", "update", expect.anything());
    expect(query).not.toHaveBeenCalledWith("invitations", "insert", expect.anything());
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("invites afresh when someone else's invitation to the address was accepted", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      invitations: [
        { data: [], error: null },
        { data: [{ id: "invitation-1", accepted: true, invited_by: "user_other" }], error: null },
        { data: ROW, error: null }, // insert
      ],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(query).toHaveBeenCalledWith("invitations", "insert", expect.objectContaining({ invited_by: "user_123" }));
    expect(result).toStrictEqual({ emailSent: true, isResend: false });
  });

  it("adds the warning, and nothing else, when the email did not go", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      invitations: [
        { data: [], error: null },
        { data: [], error: null },
        { data: ROW, error: null },
      ],
    });
    sendGroupInviteEmail.mockRejectedValue(new Error("fetch failed"));

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(result).toStrictEqual({
      emailSent: false,
      isResend: false,
      warning: EMAIL_SEND_FAILED_MESSAGE,
    });
  });
});

/**
 * The action checks the address and reads the group's name itself, so a
 * caller other than the website's invite dialog gets the same rules.
 */
describe("sendGroupInvitation checks what it is given", () => {
  it("reads the group's name itself", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    // The name comes from the caller's membership row, joined to its group.
    expect(query).toHaveBeenCalledWith(
      "group_members",
      "select",
      "role, groups ( name )"
    );
    expect(query).toHaveBeenCalledWith("group_members", "eq", "group_id", GROUP_ID);
    expect(query).toHaveBeenCalledWith("group_members", "eq", "user_id", "user_123");
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ groupName: "The Suchows" })
    );
  });

  it("answers Not authenticated when signed out, before checking anything", async () => {
    getUserId.mockResolvedValue(null);

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "not-an-email",
    });

    expect(result).toEqual({ error: "Not authenticated" });
    expect(query).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("refuses an address that is not an email, before any query", async () => {
    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "not-an-email",
    });

    expect(result).toEqual({ error: "Please enter a valid email address" });
    expect(query).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("refuses an address longer than 254 characters, before any query", async () => {
    // Well formed, and 255 characters long: 64 + "@" + 186 + ".com".
    const email = `${"a".repeat(64)}@${"b".repeat(186)}.com`;
    expect(email).toHaveLength(255);

    const result = await sendGroupInvitation({ groupId: GROUP_ID, email });

    expect(result).toEqual({ error: "Please enter a valid email address" });
    expect(query).not.toHaveBeenCalled();
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("trims the address before checking it, and invites and emails the trimmed one", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({
      groupId: GROUP_ID,
      email: " gran@example.com ",
    });

    expect(query).toHaveBeenCalledWith(
      "invitations",
      "insert",
      expect.objectContaining({ email: "gran@example.com" })
    );
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "gran@example.com" })
    );
    // The account lookup (on the admin client) and the waiting-invitation
    // lookup (on the caller's) use it too.
    const emailFilters = [...adminQuery.mock.calls, ...query.mock.calls].filter(
      ([, method, column]) => method === "eq" && column === "email"
    );
    expect(emailFilters.map(([table]) => table)).toEqual(["user_profiles", "invitations"]);
    for (const [, , , value] of emailFilters) {
      expect(value).toBe("gran@example.com");
    }
  });

  it.each([
    ["no row", { data: null, error: null }],
    ["a row without its group", { data: { role: "member", groups: null }, error: null }],
  ])(
    "answers You are not a member of this group when the membership read finds nothing (%s)",
    async (_case, membership) => {
      supabase = createSupabaseMock({
        ...happyPathScript(),
        group_members: [membership],
      });

      const result = await sendGroupInvitation({
        groupId: GROUP_ID,
        email: "invitee@example.com",
      });

      expect(result).toEqual({ error: "You are not a member of this group" });
      expect(query).not.toHaveBeenCalledWith(
        "invitations",
        "insert",
        expect.anything()
      );
      expect(sendGroupInviteEmail).not.toHaveBeenCalled();
    }
  );

  it("answers someone not in the group as not a member, whatever they have sent this hour, before any other read", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      group_members: [{ data: null, error: null }],
      // Ten invitations in the last hour, to groups of their own.
      invitations: [{ data: Array.from({ length: 10 }, (_, i) => ({ id: `invitation-${i}` })), error: null }],
    });

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(result).toEqual({ error: "You are not a member of this group" });
    // The membership is the only thing read: not the inviter's profile, not the hourly count.
    const tables = query.mock.calls.filter(([, method]) => method === "from").map(([table]) => table);
    expect(tables).toEqual(["group_members"]);
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("reads the membership first, then the inviter, then the hourly count", async () => {
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    await sendGroupInvitation({ groupId: GROUP_ID, email: "invitee@example.com" });

    const tables = query.mock.calls.filter(([, method]) => method === "from").map(([table]) => table);
    expect(tables.slice(0, 3)).toEqual(["group_members", "user_profiles", "invitations"]);
  });

  it("answers the hourly limit to a member who has sent ten this hour, writing nothing", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      invitations: [{ data: Array.from({ length: 10 }, (_, i) => ({ id: `invitation-${i}` })), error: null }],
    });

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(result).toEqual({
      error: "Rate limit exceeded. You can send up to 10 invitations per hour. Please try again later.",
    });
    expect(query).not.toHaveBeenCalledWith("invitations", "insert", expect.anything());
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("invites for a member whose group's stored name is empty", async () => {
    supabase = createSupabaseMock({
      ...happyPathScript(),
      group_members: [{ data: { role: "member", groups: { name: "" } }, error: null }],
    });
    sendGroupInviteEmail.mockResolvedValue({ data: { id: "e1" }, error: null });

    const result = await sendGroupInvitation({
      groupId: GROUP_ID,
      email: "invitee@example.com",
    });

    expect(result).toEqual({ emailSent: true, isResend: false });
    expect(sendGroupInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ groupName: "" })
    );
  });

  it.each([[null], [undefined]])(
    "answers the email sentence for %j, which is not an object, before any query",
    async (data) => {
      const result = await sendGroupInvitation(
        data as unknown as { groupId: string; email: string }
      );

      expect(result).toEqual({ error: "Please enter a valid email address" });
      expect(query).not.toHaveBeenCalled();
      expect(sendGroupInviteEmail).not.toHaveBeenCalled();
    }
  );

  it.each([["nope"], [123], [undefined]])(
    "answers You are not a member of this group for the group id %j, reading nothing",
    async (groupId) => {
      const result = await sendGroupInvitation({
        groupId: groupId as unknown as string,
        email: "a@example.com",
      });

      expect(result).toEqual({ error: "You are not a member of this group" });
      expect(query).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      expect(sendGroupInviteEmail).not.toHaveBeenCalled();
    }
  );
});

describe("joinGroupByCode", () => {
  it.each([[123], [null], [undefined], [{}]])(
    "answers Invalid invite code for %j without asking the database",
    async (raw) => {
      const result = await joinGroupByCode(raw as unknown as string);

      expect(result).toEqual({ error: "Invalid invite code" });
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it("answers Invalid invite code for a 10,000-character code without asking the database", async () => {
    const result = await joinGroupByCode("A".repeat(10_000));

    expect(result).toEqual({ error: "Invalid invite code" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tidies the code before asking the database", async () => {
    rpc.mockResolvedValue({ data: "group-1", error: null });

    const result = await joinGroupByCode("k7p mxr 4tq");

    expect(rpc).toHaveBeenCalledWith("join_group_with_code", {
      p_invite_code: "K7P-MXR-4TQ",
    });
    expect(result).toEqual({ data: { id: "group-1" } });
  });

  it.each([
    ["22023", "Invalid invite code"],
    ["23505", "You are already a member of this group"],
  ])("answers %s as %j", async (code, sentence) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "refused" } });

    const result = await joinGroupByCode("K7P-MXR-4TQ");

    expect(result).toEqual({ error: sentence });
  });
});
