import { GROUP_SENTENCES } from "@/lib/groups/sentences";
import { mobileError } from "./route";

/** What the website's server actions return when nobody is signed in. */
export const NOT_SIGNED_IN = "Not authenticated";

/** What markAsPurchased returns for a claim the caller does not hold (lib/actions/wishlist.ts). */
export const NOT_THE_CLAIMER = "Only the person who claimed this item can mark it purchased";

/**
 * What getGroupById returns for a group the caller cannot see, and for one they are not in (lib/actions/groups.ts).
 * The group actions answer these from lib/groups/sentences.ts, as these do.
 */
export const GROUP_NOT_FOUND = GROUP_SENTENCES.groupNotFound;
export const NOT_A_MEMBER = GROUP_SENTENCES.notAMember;

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

/** The website's sentences a route passes on: `notFound` as 404, `refusals` as 422 with the sentence. */
export interface ActionAnswers {
  notFound?: readonly string[];
  refusals?: readonly string[];
}

/**
 * Between actionFailure and databaseFailure, for actions whose refusals the person can act on but whose other errors
 * are faults. The answer for an action that failed, or null when it succeeded. Signed out: 401. A sentence in
 * `notFound`: 404, saying nothing more, as for something the caller cannot see. A sentence in `refusals`: 422 with
 * those words. Anything else throws an Error naming `action` and the error, so mobileRoute logs it and answers 500.
 */
export function actionAnswer(result: object, action: string, answers: ActionAnswers = {}): Response | null {
  const error: unknown = "error" in result ? result.error : undefined;
  if (typeof error === "string" && error !== NOT_SIGNED_IN) {
    if (answers.notFound?.includes(error)) return mobileError("not_found");
    if (answers.refusals?.includes(error)) return mobileError("invalid", error);
  }
  return databaseFailure(result, action);
}
