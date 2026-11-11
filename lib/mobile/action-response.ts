import { mobileError } from "./route";

/** What the website's server actions return when nobody is signed in. */
export const NOT_SIGNED_IN = "Not authenticated";

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
