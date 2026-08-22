import { auth } from "@clerk/nextjs/server";

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
