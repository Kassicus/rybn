/**
 * The fixed sentences of deleting an account (lib/actions/account.ts), in one
 * module that is not "use server", so the action, the Settings page and the
 * tests read the same words. "Not authenticated" is answered by every action
 * on the site, and stays with them.
 */
export const ACCOUNT_SENTENCES = {
  /** Any step of deleting an account that failed; trying again finishes what is left. */
  deleteFailed: "Couldn't delete your account. Please try again.",
} as const;
