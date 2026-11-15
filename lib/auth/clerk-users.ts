import { clerkClient } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * The one module that changes a person's sign-in account at the sign-in
 * provider. Everything that does so goes through here, so tests fake this
 * module rather than the provider's client.
 */

/**
 * Deletes the sign-in account with this id.
 *
 * An answer of 404 means the account is already gone: an earlier try deleted
 * it, so this counts it as deleted and a second try finishes. Any other
 * failure is thrown.
 */
export async function deleteSignInAccount(userId: string): Promise<void> {
  try {
    await (await clerkClient()).users.deleteUser(userId);
  } catch (error) {
    if (isClerkAPIResponseError(error) && error.status === 404) return;
    throw error;
  }
}
