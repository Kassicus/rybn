/**
 * Privacy control utility functions for Rybn
 */

import { z } from 'zod';
import type {
  PrivacyLevel,
  PrivacySettings,
  LegacyPrivacySettings,
  ViewerContext,
  GroupType,
  ProfileCategory,
} from '@/types/privacy';
import { PRIVACY_DEFAULTS } from '@/types/privacy';

/**
 * Zod schema for privacy level validation
 */
export const privacyLevelSchema = z.enum(['private', 'group', 'friends', 'family', 'public']);

/**
 * Zod schema for privacy settings validation
 */
export const privacySettingsSchema = z.object({
  default: privacyLevelSchema,
  overrides: z.record(z.string().uuid(), privacyLevelSchema).default({}),
});

/**
 * Normalize legacy privacy settings to ensure consistency
 */
export function normalizeLegacyPrivacySettings(
  settings: unknown
): LegacyPrivacySettings {
  const result = privacySettingsSchema.safeParse(settings);

  if (!result.success) {
    // Return safe default if invalid
    return { default: 'private', overrides: {} };
  }

  return result.data;
}

/**
 * Clean up legacy privacy overrides for deleted/left groups
 */
export function cleanLegacyPrivacyOverrides(
  settings: LegacyPrivacySettings,
  activeGroupIds: string[]
): LegacyPrivacySettings {
  const activeGroupIdSet = new Set(activeGroupIds);

  const cleanedOverrides = Object.fromEntries(
    Object.entries(settings.overrides).filter(([groupId]) =>
      activeGroupIdSet.has(groupId)
    )
  );

  return {
    default: settings.default,
    overrides: cleanedOverrides,
  };
}

/**
 * Clean up new privacy overrides for deleted/left groups
 */
export function cleanPrivacyOverrides(
  settings: PrivacySettings,
  activeGroupIds: string[]
): PrivacySettings {
  const activeGroupIdSet = new Set(activeGroupIds);

  const cleanedOverrides = settings.overrides
    ? Object.fromEntries(
        Object.entries(settings.overrides).filter(([groupId]) =>
          activeGroupIdSet.has(groupId)
        )
      )
    : {};

  return {
    visibleToGroupTypes: settings.visibleToGroupTypes,
    overrides: cleanedOverrides,
  };
}

/**
 * Get default privacy level for a category
 */
export function getDefaultPrivacy(category: ProfileCategory): PrivacyLevel {
  return PRIVACY_DEFAULTS[category] ?? 'private';
}

/**
 * Suggest privacy level based on user's groups
 */
export function suggestPrivacyLevel(
  category: ProfileCategory,
  userGroups: { type: GroupType }[]
): PrivacyLevel {
  const baseDefault = getDefaultPrivacy(category);

  // If user only has family groups, suggest family for personal stuff
  if (userGroups.every(g => g.type === 'family') && category === 'personal') {
    return 'family';
  }

  // If user has no groups, private is safer
  if (userGroups.length === 0) {
    return 'private';
  }

  return baseDefault;
}

/**
 * Check if a privacy level allows viewing based on group type
 */
function checkPrivacyLevel(
  level: PrivacyLevel,
  groupId: string,
  groupTypes: Map<string, GroupType>
): boolean {
  switch (level) {
    case 'private':
      return false;
    case 'group':
      return true; // In the group
    case 'friends':
      return groupTypes.get(groupId) === 'friends';
    case 'family':
      return groupTypes.get(groupId) === 'family';
    case 'public':
      return true;
    default:
      return false;
  }
}

/**
 * Check if a privacy level allows viewing across all shared groups
 */
function checkPrivacyLevelAcrossGroups(
  level: PrivacyLevel,
  sharedGroupIds: string[],
  groupTypes: Map<string, GroupType>
): boolean {
  switch (level) {
    case 'private':
      return false;
    case 'group':
      // Any shared group is sufficient
      return sharedGroupIds.length > 0;
    case 'friends':
      // Must be in a 'friends' type group together
      return sharedGroupIds.some(gid =>
        groupTypes.get(gid) === 'friends'
      );
    case 'family':
      // Must be in a 'family' type group together
      return sharedGroupIds.some(gid =>
        groupTypes.get(gid) === 'family'
      );
    case 'public':
      return true;
    default:
      return false;
  }
}

/**
 * Determine if a viewer can see a specific field based on legacy privacy settings
 *
 * Privacy hierarchy (from most to least restrictive):
 * - private: Only owner can view
 * - group: Anyone in a shared group can view (unless group override)
 * - friends: Anyone in a 'friends' type group can view
 * - family: Anyone in a 'family' type group can view
 * - public: Everyone can view
 */
export function canViewLegacyField(
  fieldOwnerId: string,
  privacySettings: LegacyPrivacySettings,
  viewer: ViewerContext
): boolean {
  // Owner can always view their own fields
  if (fieldOwnerId === viewer.viewerId) {
    return true;
  }

  // Check group-specific overrides first (most specific)
  for (const groupId of viewer.sharedGroupIds) {
    const override = privacySettings.overrides[groupId];

    if (override) {
      return checkPrivacyLevel(
        override,
        groupId,
        viewer.sharedGroupTypes
      );
    }
  }

  // Fall back to default privacy level
  return checkPrivacyLevelAcrossGroups(
    privacySettings.default,
    viewer.sharedGroupIds,
    viewer.sharedGroupTypes
  );
}

/**
 * Get effective privacy level for a field in a specific group (legacy)
 */
export function getEffectivePrivacyLevel(
  privacySettings: LegacyPrivacySettings,
  groupId: string
): PrivacyLevel {
  return privacySettings.overrides[groupId] ?? privacySettings.default;
}

/**
 * Check if two privacy levels are equivalent
 */
export function arePrivacyLevelsEqual(
  level1: PrivacyLevel,
  level2: PrivacyLevel
): boolean {
  return level1 === level2;
}

/**
 * Get a human-readable description of who can see a field (legacy format)
 */
export function getLegacyPrivacyDescription(
  privacySettings: LegacyPrivacySettings,
  userGroups: { id: string; name: string; type: GroupType }[]
): string {
  const { default: defaultLevel, overrides } = privacySettings;

  // If no overrides, return simple description
  if (Object.keys(overrides).length === 0) {
    switch (defaultLevel) {
      case 'private':
        return 'Only you';
      case 'group':
        return 'Anyone in your groups';
      case 'friends':
        return 'Friends groups only';
      case 'family':
        return 'Family groups only';
      case 'public':
        return 'Everyone';
    }
  }

  // With overrides, show more detailed info
  const groupsWithOverrides = userGroups.filter(g => overrides[g.id]);

  if (groupsWithOverrides.length === 0) {
    return getLegacyPrivacyDescription({ default: defaultLevel, overrides: {} }, userGroups);
  }

  const overrideDescriptions = groupsWithOverrides.map(g => {
    const level = overrides[g.id];
    return `${g.name}: ${level}`;
  });

  return `Default: ${defaultLevel}, ${overrideDescriptions.join(', ')}`;
}

/**
 * Get a human-readable description of who can see a field (new format)
 */
export function getPrivacyDescription(
  privacySettings: PrivacySettings,
  userGroups: { id: string; name: string; type: GroupType }[]
): string {
  const { visibleToGroupTypes, overrides } = privacySettings;

  // If no group types selected, it's private
  if (visibleToGroupTypes.length === 0) {
    return 'Only you';
  }

  // If all group types are selected, it's visible to everyone in groups
  if (visibleToGroupTypes.length === 4) {
    return 'Anyone in your groups';
  }

  // Return selected group types
  return `Visible to: ${visibleToGroupTypes.join(', ')} groups`;
}
