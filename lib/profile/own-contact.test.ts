import { describe, it, expect, vi } from "vitest";
import { OWN_PROFILE_COLUMNS, readOwnContact } from "./own-contact";

/**
 * A person's own email and email preferences are read through the database
 * function own_contact(), which takes no argument and answers one row about
 * the caller, or none when they have no profile. A profile row read with a
 * signed-in person's client names OWN_PROFILE_COLUMNS.
 */

/** Just enough of a Supabase client for one database function call. */
function clientAnswering(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (..._args: unknown[]) => response);
  const from = vi.fn();
  const client = { rpc, from } as unknown as Parameters<typeof readOwnContact>[0];
  return { client, rpc, from };
}

describe("OWN_PROFILE_COLUMNS", () => {
  it("names the profile row's columns, never the email, the email preferences or *", () => {
    expect(OWN_PROFILE_COLUMNS).toBe(
      "id, username, display_name, avatar_url, bio, created_at, updated_at"
    );
    const named = OWN_PROFILE_COLUMNS.split(",").map((column) => column.trim());
    expect(named).not.toContain("email");
    expect(named).not.toContain("email_preferences");
    expect(named).not.toContain("*");
  });
});

describe("readOwnContact", () => {
  it("calls own_contact() once, with no arguments, and answers its first row", async () => {
    const preferences = { email_marketing: true };
    const { client, rpc, from } = clientAnswering({
      data: [{ email: "sam@example.com", email_preferences: preferences }],
      error: null,
    });

    expect(await readOwnContact(client)).toEqual({
      contact: { email: "sam@example.com", emailPreferences: preferences },
    });
    expect(rpc.mock.calls).toEqual([["own_contact"]]);
    expect(from).not.toHaveBeenCalled();
  });

  it("answers a null email and null preferences as they are", async () => {
    const { client } = clientAnswering({
      data: [{ email: null, email_preferences: null }],
      error: null,
    });

    expect(await readOwnContact(client)).toEqual({
      contact: { email: null, emailPreferences: null },
    });
  });

  it("answers no contact when the person has no profile row", async () => {
    const { client } = clientAnswering({ data: [], error: null });

    expect(await readOwnContact(client)).toEqual({ contact: null });
  });

  it("answers the database's error by its message and code", async () => {
    const { client } = clientAnswering({
      data: null,
      error: {
        code: "57014",
        message: "canceling statement due to statement timeout",
        details: null,
        hint: null,
      },
    });

    expect(await readOwnContact(client)).toEqual({
      error: { message: "canceling statement due to statement timeout", code: "57014" },
    });
  });
});
