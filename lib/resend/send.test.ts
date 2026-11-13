import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The invitation email's subject carries the group's name. A name is tidied
 * when it is stored (lib/schemas/groups.ts), and the subject tidies it again
 * the same way, so a name stored before that cannot put a line break or an
 * invisible character into the subject either.
 *
 * The Resend client is replaced by a spy: nothing is sent anywhere.
 */
const send = vi.fn();

vi.mock("./client", () => ({
  resend: { emails: { send: (...args: unknown[]) => send(...args) } },
  EMAIL_FROM: "hello@example.com",
  EMAIL_FROM_NAME: "Rybn",
}));

const { sendGroupInviteEmail } = await import("./send");

/** Invisible characters, written as escapes, never typed. */
const RLO = "\u{202E}"; // right-to-left override
const ZWSP = "\u{200B}"; // zero-width space

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ data: { id: "e1" }, error: null });
});

describe("sendGroupInviteEmail", () => {
  it.each([
    ["The Suchows", "You're invited to join The Suchows on Rybn"],
    ["Garcia\r\nCousins", "You're invited to join Garcia Cousins on Rybn"],
    [`${RLO}Garcia${ZWSP}Cousins\t`, "You're invited to join Garcia Cousins on Rybn"],
  ])("builds the subject for the group %j on one line", async (groupName, subject) => {
    await sendGroupInviteEmail({
      toEmail: "gran@example.com",
      groupName,
      inviterName: "kason",
      inviteToken: "token-1",
      isNewUser: true,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: "gran@example.com",
      subject,
    });
  });
});
