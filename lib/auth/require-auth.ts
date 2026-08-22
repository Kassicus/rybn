import { auth } from "@clerk/nextjs/server";

import { ensureProfile } from "./ensure-profile";

/**
 * The Clerk user ID for the current request, or null when signed out.
 * Use in paths where being signed out is a legitimate state.
 */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/**
 * The Clerk user ID for the current request. Throws when signed out.
 * Use in server actions and protected pages, which must not proceed
 * without an identity.
 */
export async function requireAuth(): Promise<string> {
  const userId = await getUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

/**
 * The Clerk user ID, having attempted to provision the user_profiles row.
 * Prefer this in actions that read or write profile-linked data.
 *
 * The row is ensured, not guaranteed: ensureProfile() is fail-soft and logs
 * rather than throwing, so a Supabase failure still returns the id with no row
 * behind it. Callers that cannot proceed without the row must handle its
 * absence; they just do not have to create it.
 *
 * Throws when signed out, exactly like requireAuth(). Do NOT reach for this in
 * a layout or page whose signed-out behaviour is a redirect -- a throw there
 * turns a 307 into a 500. Gate on getUserId() first and call ensureProfile()
 * yourself, which is what app/(dashboard)/layout.tsx does.
 */
export async function requireAuthWithProfile(): Promise<string> {
  const userId = await requireAuth();
  await ensureProfile();
  return userId;
}
