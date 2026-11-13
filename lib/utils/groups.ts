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
 * One character of what does not show on one line, stated by Unicode
 * property: everything Unicode marks as default ignorable, every control,
 * format, private-use and unassigned character (a lone surrogate too), the
 * line and paragraph separators, the braille blank, and every space separator
 * other than the ordinary space. Its two alternatives never match the same
 * character.
 */
const HIDDEN = String.raw`(?:[\p{Default_Ignorable_Code_Point}\p{C}\p{Zl}\p{Zp}\u{2800}]|(?! )\p{Zs})`;

/** The flags of England, Scotland and Wales: the black flag, gbeng, gbsct or gbwls in tag letters, the cancel tag. */
const SUBDIVISION_FLAG = String.raw`\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}`;
/** A keycap: a digit, # or *, the emoji presentation selector, the enclosing keycap. */
const KEYCAP = String.raw`[0-9#*]\u{FE0F}\u{20E3}`;
/** An emoji with the emoji presentation selector straight after it. */
const EMOJI_PRESENTATION = String.raw`\p{Extended_Pictographic}\u{FE0F}`;
/** A zero-width non-joiner or joiner with no hidden character straight after it. */
const LONE_JOINER = String.raw`[\u{200C}\u{200D}](?!${HIDDEN})`;

/**
 * One pass over a group's text, tried in this order at each place:
 *  1. something kept whole: a subdivision flag, a keycap, or an emoji with
 *     its presentation selector;
 *  2. a lone joiner, kept or not by joins();
 *  3. a run of hidden characters, which becomes one space.
 * Each kept thing is its own branch, so a run never swallows one: a kept
 * selector always follows a visible emoji, and a lone joiner is only matched
 * where nothing hidden comes after it (a run before it would already have
 * taken it in).
 *
 * Linear: branch 1 is three fixed-length sequences, each starting with one
 * character test, so it fails or matches in at most seven steps. Branch 2 is
 * one character and a one-character look ahead. Branch 3 repeats a single
 * character, whose two alternatives never overlap, with nothing after the
 * repeat, so it never gives anything back. None can match nothing.
 */
const ONE_LINE = new RegExp(
  `(${SUBDIVISION_FLAG}|${KEYCAP}|${EMOJI_PRESENTATION})|(${LONE_JOINER})|${HIDDEN}+`,
  'gu'
);

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
 * hidden characters (see HIDDEN) becomes one space. Kept as they are, because
 * they are part of an emoji or a word: the emoji presentation selector
 * straight after an emoji or inside a keycap; a lone zero-width joiner or
 * non-joiner between two emoji (a family) or between two characters of a
 * script that joins (Arabic and the Indic scripts); and the flags of England,
 * Scotland and Wales. Everything else hidden becomes a space: every other
 * variation selector, tag sequence, joiner and bidirectional mark, and the
 * thin and hair spaces. The group schema stores names and descriptions this
 * way, and the invitation email builds its subject from a name tidied the
 * same way.
 */
export function tidyGroupText(text: string): string {
  return text
    .replace(
      ONE_LINE,
      (_match: string, kept: string | undefined, joiner: string | undefined, at: number, whole: string) => {
        if (kept !== undefined) return kept;
        if (joiner !== undefined && joins(whole, at)) return joiner;
        return ' ';
      }
    )
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
