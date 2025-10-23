/**
 * Generate a unique invite code for a group
 * Format: ABC-DEF-GHI (9 uppercase letters, dash-separated)
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars (0, O, I, 1)
  const segments = 3;
  const segmentLength = 3;

  const code = Array.from({ length: segments }, () => {
    return Array.from({ length: segmentLength }, () => {
      return chars.charAt(Math.floor(Math.random() * chars.length));
    }).join('');
  }).join('-');

  return code;
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
