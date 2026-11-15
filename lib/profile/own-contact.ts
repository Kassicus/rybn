import type { createClient } from "@/lib/supabase/server";

/** The columns of a profile row a signed-in person's client reads. */
export const OWN_PROFILE_COLUMNS =
  "id, username, display_name, avatar_url, bio, created_at, updated_at";

export type OwnContact = { email: string | null; emailPreferences: unknown };

/**
 * The signed-in person's own email and email preferences, from own_contact().
 * `contact` is null when they have no profile row.
 *
 * own_contact() takes no argument and answers only about the caller of the
 * client it is called with: one row, or none.
 */
export async function readOwnContact(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ contact: OwnContact | null } | { error: { message: string; code?: string } }> {
  const { data, error } = await supabase.rpc("own_contact");

  if (error) {
    return { error: { message: error.message, code: error.code } };
  }

  const row = data?.[0];
  if (!row) {
    return { contact: null };
  }
  return { contact: { email: row.email ?? null, emailPreferences: row.email_preferences ?? null } };
}
