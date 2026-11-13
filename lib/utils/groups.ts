/**
 * Generate a unique invite code for a group
 * Format: ABC-DEF-GHI (9 uppercase letters, dash-separated)
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars (0, O, I, 1)
  const segments = 3;
  const segmentLength = 3;
  const total = segments * segmentLength;

  // crypto.getRandomValues, not Math.random. The invite code is now a
  // MEMBERSHIP CAPABILITY -- join_group_with_code() grants group membership to
  // whoever presents it -- where it used to grant nothing the group UUID did
  // not already give away. Math.random() is V8's xorshift128+, whose internal
  // state is recoverable from a handful of outputs, so a predictable code is a
  // predictable way into someone's group. Matches generateInviteToken() below.
  //
  // Rejection sampling keeps the 32-symbol alphabet uniform: 256 is a multiple
  // of 32, so a plain modulo would be unbiased here, but the guard keeps that
  // true if the alphabet ever changes.
  const picks: string[] = [];
  const buf = new Uint8Array(total * 2);
  while (picks.length < total) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (picks.length >= total) break;
      const limit = 256 - (256 % chars.length);
      if (byte >= limit) continue;
      picks.push(chars.charAt(byte % chars.length));
    }
  }

  return Array.from({ length: segments }, (_, i) =>
    picks.slice(i * segmentLength, (i + 1) * segmentLength).join('')
  ).join('-');
}

/**
 * An invite code as a person typed or pasted it, tidied the way the website
 * reads codes: compatibility forms folded (fullwidth letters and digits become
 * ASCII), letters and digits only, upper case, and the dashes put back when
 * exactly nine are left ("abc def ghi" -> "ABC-DEF-GHI"). Anything else is
 * returned as stripped, for joinGroupByCode to refuse. The strip comes before
 * the change of case, so upper-casing can never turn some other letter into
 * one of A to Z. The website's join box and joinGroupByCode both use it.
 */
export function tidyInviteCode(raw: string): string {
  const stripped = raw.normalize('NFKC').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  if (stripped.length === 9) {
    return `${stripped.slice(0, 3)}-${stripped.slice(3, 6)}-${stripped.slice(6, 9)}`;
  }

  return stripped;
}

/**
 * One pass over a group's text. The first branch is a whole subdivision flag:
 * the black flag, three to seven tag letters or digits (a subdivision code,
 * as gbeng, gbsct and gbwls are), and the cancel tag. The second is a run of
 * what does not show on one line: line breaks and other control characters,
 * invisible (format) characters, tag characters among them, and the
 * blank-looking characters that show nothing (the combining grapheme joiner,
 * the Hangul fillers, two Khmer inherent vowels and the braille blank).
 *
 * Linear: the flag branch starts with one fixed character and has a bounded
 * middle, and the run branch is a single character class with nothing after
 * it, so neither has anything to backtrack into.
 */
const ONE_LINE =
  /(\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{3,7}\u{E007F})|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{034F}\u{115F}\u{1160}\u{17B4}\u{17B5}\u{2800}\u{3164}\u{FFA0}]+/gu;

/** A zero-width non-joiner or joiner, on its own. */
const JOINER = /^[\u{200C}\u{200D}]$/u;

/** An emoji just before a joiner, with its variation selector or skin tone if it has one. */
const EMOJI_BEFORE = /\p{Extended_Pictographic}[\u{FE0F}\p{Emoji_Modifier}]?$/u;
/** An emoji just after a joiner. */
const EMOJI_AFTER = /^\p{Extended_Pictographic}/u;

/** The scripts whose words use a joiner or non-joiner: Arabic, and the Indic scripts. */
const JOINING_SCRIPTS = [
  'Arabic',
  'Bengali',
  'Devanagari',
  'Gujarati',
  'Gurmukhi',
  'Kannada',
  'Malayalam',
  'Oriya',
  'Sinhala',
  'Tamil',
  'Telugu',
].map((script) => ({
  ends: new RegExp(`\\p{Script_Extensions=${script}}$`, 'u'),
  starts: new RegExp(`^\\p{Script_Extensions=${script}}`, 'u'),
}));

/**
 * Whether the joiner at `at` joins what is on each side: two emoji, or two
 * characters of one joining script. Only the four code units before it and
 * the two after it are looked at, enough for an emoji and its skin tone.
 */
function joins(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 4), at);
  const after = text.slice(at + 1, at + 3);
  if (EMOJI_BEFORE.test(before) && EMOJI_AFTER.test(after)) return true;
  return JOINING_SCRIPTS.some(({ ends, starts }) => ends.test(before) && starts.test(after));
}

/**
 * A group's name or description as one line of text, trimmed: each run of
 * line breaks, control characters, invisible characters and blank-looking
 * characters becomes one space. Two things stay as they are, because they are
 * part of an emoji or a word: a whole subdivision flag (England, Scotland,
 * Wales), and a lone zero-width joiner or non-joiner between two emoji (a
 * family) or between two characters of a script that joins (Arabic and the
 * Indic scripts). A joiner anywhere else, between two Latin letters for one,
 * becomes a space. The group schema stores names and descriptions this way,
 * and the invitation email builds its subject from a name tidied the same way.
 */
export function tidyGroupText(text: string): string {
  return text
    .replace(ONE_LINE, (run: string, flag: string | undefined, at: number, whole: string) => {
      if (flag !== undefined) return flag;
      if (JOINER.test(run) && joins(whole, at)) return run;
      return ' ';
    })
    .trim();
}

/**
 * Generate a secure token for invitations
 */
export function generateInviteToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Get expiration date for invite (default: 7 days from now)
 */
export function getInviteExpiration(days: number = 7): Date {
  const expiration = new Date();
  expiration.setDate(expiration.getDate() + days);
  return expiration;
}

/**
 * Format group type for display
 */
export function formatGroupType(type: 'family' | 'friends' | 'work' | 'custom'): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Get icon name for group type (using lucide-react icon names)
 */
export function getGroupTypeIcon(type: 'family' | 'friends' | 'work' | 'custom'): string {
  const icons = {
    family: 'Home',
    friends: 'Users',
    work: 'Briefcase',
    custom: 'Grid'
  };
  return icons[type] || icons.custom;
}
