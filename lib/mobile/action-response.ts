import { mobileError } from "./route";

/** What the website's server actions return when nobody is signed in. */
export const NOT_SIGNED_IN = "Not authenticated";

/** What markAsPurchased returns for a claim the caller does not hold (lib/actions/wishlist.ts). */
export const NOT_THE_CLAIMER = "Only the person who claimed this item can mark it purchased";

/** What getGroupById returns for a group the caller cannot see, and for one they are not in (lib/actions/groups.ts). */
export const GROUP_NOT_FOUND = "Group not found";
export const NOT_A_MEMBER = "You are not a member of this group";

/** What tagItemForMyOccasion and tagItemForGroupDate return for a tag that is already there (lib/actions/item-occasions.ts). */
export const ALREADY_TAGGED = "You've already tagged this item for that occasion";

/** What untagItem returns when the tag is not there; asked only about the caller's own item, it is already gone. */
export const TAG_GONE = "That tag no longer exists, or is not yours to remove";

export const ACTION_FALLBACK = "That didn't work. Please try again.";

/**
 * The app's answer for a server action that failed, or null when it succeeded.
 * A sign-in failure answers 401; any other refusal answers 422 with the
 * website's own words.
 */
export function actionFailure(result: object): Response | null {
  const error: unknown = "error" in result ? result.error : undefined;
  if (error === undefined || error === null) return null;
  if (error === NOT_SIGNED_IN) return mobileError("unauthorized");
  return mobileError("invalid", typeof error === "string" && error !== "" ? error : ACTION_FALLBACK);
}

/**
 * For actions whose errors are database text (D7), which must never reach the app.
 * Signed out: the 401 Response. Any other error: throws an Error naming `action` and the text,
 * so mobileRoute logs it with the path and answers the standard 500. Success: null.
 */
export function databaseFailure(result: object, action: string): Response | null {
  const error: unknown = "error" in result ? result.error : undefined;
  if (error === undefined || error === null) return null;
  if (error === NOT_SIGNED_IN) return mobileError("unauthorized");
  throw new Error(`${action} failed: ${typeof error === "string" ? error : JSON.stringify(error)}`);
}
