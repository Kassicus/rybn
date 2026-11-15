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

/**
 * Sets the picture on the sign-in account with this id, and answers the
 * address the sign-in provider gives for it. An answer with no address, or an
 * empty one, is thrown as a failure, as is any other failure, so the caller
 * writes nothing.
 */
export async function setSignInPicture(userId: string, file: Blob): Promise<string> {
  const user = await (await clerkClient()).users.updateUserProfileImage(userId, { file });
  const address: unknown = user.imageUrl;
  if (typeof address !== "string" || address === "") {
    throw new Error("setSignInPicture: the sign-in provider answered no address for the picture");
  }
  return address;
}

/**
 * Removes the picture from the sign-in account with this id.
 *
 * The account is read first. One the provider says has no picture of its own
 * (`hasImage` false: it shows the provider's placeholder) is left as it is,
 * and no removal is asked for. Otherwise the picture is removed, and an
 * answer of 404 counts as removed: an earlier try already removed it, so a
 * second try finishes. A failure to read the account, or any other failure
 * of the removal, is thrown.
 */
export async function removeSignInPicture(userId: string): Promise<void> {
  const users = (await clerkClient()).users;
  const user = await users.getUser(userId);
  if (user.hasImage === false) return;
  try {
    await users.deleteUserProfileImage(userId);
  } catch (error) {
    if (isClerkAPIResponseError(error) && error.status === 404) return;
    throw error;
  }
}
