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
