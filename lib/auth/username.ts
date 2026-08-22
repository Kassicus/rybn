/**
 * Username rules, kept in one dependency-free place so they can be tested on
 * their own and so there is a single answer to "what may go in that column".
 *
 * Clerk and this schema do not agree about usernames. Clerk allows up to 64
 * characters and a wider character set; user_profiles.username carries two
 * CHECK constraints from the baseline migration:
 *
 *   username_length  -- char_length between 3 and 30
 *   username_format  -- ^[a-zA-Z0-9_-]+$
 *
 * A Clerk username that breaks either one raises 23514, not 23505, so the
 * unique-collision retry in ensureProfile() does not cover it. Left unhandled
 * that leaves the user with NO profile row and no way to get one: every later
 * request repeats the identical failing insert. So the value is made to fit
 * the column before it is ever sent.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/** Characters the username_format constraint permits. */
const DISALLOWED = /[^a-zA-Z0-9_-]/g;

/**
 * The generated username for a user whose Clerk username is unusable or
 * absent. Always 5-13 characters of permitted alphabet, so it satisfies both
 * constraints by construction.
 */
export function fallbackUsername(userId: string): string {
  return `user_${userId.replace(DISALLOWED, "").slice(-8)}`;
}

/**
 * A username that user_profiles will accept: Clerk's, stripped of characters
 * the format constraint rejects and clamped to the length constraint, or the
 * generated fallback when too little survives.
 */
export function sanitizeUsername(
  clerkUsername: string | null | undefined,
  userId: string
): string {
  const cleaned = (clerkUsername ?? "")
    .replace(DISALLOWED, "")
    .slice(0, USERNAME_MAX_LENGTH);

  return cleaned.length >= USERNAME_MIN_LENGTH
    ? cleaned
    : fallbackUsername(userId);
}
