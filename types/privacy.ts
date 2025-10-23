/**
 * Privacy control types for Rybn profile system
 */

export type PrivacyLevel = 'private' | 'group' | 'friends' | 'family' | 'public';
export type GroupType = 'family' | 'friends' | 'work' | 'custom';

/**
 * Privacy settings for a field (new checkbox-based system)
 * - visibleToGroupTypes: Array of group types that can see this field
 *   Empty array = private (only user can see)
 *   ['family', 'friends'] = visible to family and friends groups
 *   ['family', 'friends', 'work', 'custom'] = visible to all groups
 * - overrides: Group-specific privacy overrides (groupId -> group types array)
 */
export interface PrivacySettings {
  visibleToGroupTypes: GroupType[];
  overrides?: Record<string, GroupType[]>;
}

/**
 * Legacy privacy settings format (for backward compatibility)
 */
export interface LegacyPrivacySettings {
  default: PrivacyLevel;
  overrides: Record<string, PrivacyLevel>;
}

/**
 * Viewer context for privacy checks
 */
export interface ViewerContext {
  viewerId: string;
  sharedGroupIds: string[];
  sharedGroupTypes: Map<string, GroupType>;
}

/**
 * Profile categories
 */
export type ProfileCategory = 'sizes' | 'preferences' | 'vehicles' | 'personal' | 'dates';

/**
 * Privacy level display information
 */
export interface PrivacyLevelInfo {
  level: PrivacyLevel;
  label: string;
  description: string;
  icon: string;
}

/**
 * Privacy level hierarchy (most to least restrictive)
 */
export const PRIVACY_HIERARCHY: PrivacyLevel[] = [
  'private',
  'friends',
  'family',
  'group',
  'public',
];

/**
 * Privacy level display information
 */
export const PRIVACY_LEVELS: Record<PrivacyLevel, PrivacyLevelInfo> = {
  private: {
    level: 'private',
    label: 'Private',
    description: 'Only you can see this',
    icon: 'Lock',
  },
  group: {
    level: 'group',
    label: 'All Groups',
    description: 'Visible to anyone in your groups',
    icon: 'Users',
  },
  friends: {
    level: 'friends',
    label: 'Friends Only',
    description: 'Only visible in friends-type groups',
    icon: 'Heart',
  },
  family: {
    level: 'family',
    label: 'Family Only',
    description: 'Only visible in family-type groups',
    icon: 'Home',
  },
  public: {
    level: 'public',
    label: 'Public',
    description: 'Visible to everyone',
    icon: 'Globe',
  },
};

/**
 * Group type display information
 */
export interface GroupTypeInfo {
  type: GroupType;
  label: string;
  description: string;
  icon: string;
}

export const GROUP_TYPES: Record<GroupType, GroupTypeInfo> = {
  family: {
    type: 'family',
    label: 'Family',
    description: 'Family-type groups',
    icon: 'Home',
  },
  friends: {
    type: 'friends',
    label: 'Friends',
    description: 'Friends-type groups',
    icon: 'Heart',
  },
  work: {
    type: 'work',
    label: 'Work',
    description: 'Work-type groups',
    icon: 'Briefcase',
  },
  custom: {
    type: 'custom',
    label: 'Other',
    description: 'Custom groups',
    icon: 'Users',
  },
};

/**
 * Default privacy levels by category
 */
export const PRIVACY_DEFAULTS: Record<ProfileCategory, PrivacyLevel> = {
  sizes: 'group',        // Useful for gift-givers
  preferences: 'group',  // Useful for gift ideas
  vehicles: 'friends',   // More personal
  personal: 'private',   // Very personal info
  dates: 'family',       // Birthdays, anniversaries
};
