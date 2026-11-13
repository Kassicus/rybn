/**
 * The fixed sentences the profile and settings actions answer (lib/actions/profile.ts, lib/actions/settings.ts) that
 * the app's routes match on, in one module that is not "use server", so the actions and the routes (lib/mobile) read
 * the same words.
 *
 * The sentence for a choice of who can see the profile that is refused is VISIBILITY_INVALID, which
 * lib/profile/visibility.ts answers with the schema that checks the choice; it is re-exported here. A field the form's
 * schema refuses answers that schema's own sentence (lib/schemas/profile.ts).
 *
 * VISIBILITY_MIXED is what the Settings page shows under the choice while some field has another setting, in the
 * app's words for the same thing.
 */

export { VISIBILITY_INVALID } from "@/lib/profile/visibility";

export const PROFILE_SENTENCES = {
  /** A save whose username another person already has. */
  usernameTaken: "Username is already taken",
} as const;

/** Some field has a setting other than the stored choice (getMySettings' `mixed`), and saving the choice sets them all. */
export const VISIBILITY_MIXED = "Some of your details have a different setting. Saving here sets them all.";
