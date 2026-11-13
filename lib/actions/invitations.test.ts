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
const requireAuthWithProfile = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
  requireAuthWithProfile: () => requireAuthWithProfile(),
}));

/**
 * Every query the action builds, as `(table, "from")` and then
 * `(table, method, ...args)` for each chain call, so a test can read what was
 * asked for and with which values -- or that nothing was asked at all.
 */
const query = vi.fn();
const rpc = vi.fn();

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
      query(table, "from");
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
        chain[method] = (...args: unknown[]) => {
          query(table, method, ...args);
          return chain;
        };
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
  createClient: async () => ({
    ...supabase,
    rpc: (...args: unknown[]) => rpc(...args),
  }),
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
    group_members: [MEMBERSHIP],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
      groupId: GROUP_ID,
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
        MEMBERSHIP, // inviter's membership
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
      groupId: GROUP_ID,
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
    expect(result.data).toEqual({ id: "invitation-1" });
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
    // The account lookup and the waiting-invitation lookup use it too.
    const emailFilters = query.mock.calls.filter(
      ([, method, column]) => method === "eq" && column === "email"
    );
    expect(emailFilters).toHaveLength(2);
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

    expect(result).toMatchObject({ data: { id: "invitation-1" }, emailSent: true });
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
