/**
 * Profile validation schemas using Zod
 */

import { z } from 'zod';
import { privacyLevelSchema } from '@/lib/utils/privacy';
import { isCalendarDay } from '@/lib/utils/dates';
import {
  PROFILE_LIMITS,
  PROFILE_SECTIONS,
  fieldSpec,
  type ProfileCategory,
  type ProfileFieldName,
} from '@/lib/profile/fields';

/**
 * A text profile field, its limit and label read from the catalog
 * (lib/profile/fields.ts), so the form and the catalog cannot disagree.
 */
function profileText(name: ProfileFieldName) {
  const spec = fieldSpec(name);
  if (!spec) throw new Error(`No profile field named ${name}`);
  return z.string()
    .max(spec.max, `${spec.label} must be at most ${spec.max} characters`)
    .optional()
    .nullable();
}

const DATE_MESSAGE = 'Please enter a valid date (YYYY-MM-DD)';

/**
 * Basic profile information schema
 */
export const basicProfileSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),

  display_name: z.string()
    .max(50, 'Display name must be less than 50 characters')
    .optional()
    .nullable(),

  bio: z.string()
    .max(500, 'Bio must be less than 500 characters')
    .optional()
    .nullable(),

  avatar_url: z.string()
    .url('Please enter a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),
});

/**
 * Profile info field schema (for categorized fields)
 */
export const profileInfoFieldSchema = z.object({
  category: z.enum(['sizes', 'preferences', 'vehicles', 'personal', 'dates']),
  field_name: z.string().min(1, 'Field name is required'),
  field_value: z.string().optional().nullable(),
  privacy_settings: z.object({
    default: privacyLevelSchema,
    overrides: z.record(z.string().uuid(), privacyLevelSchema).default({}),
  }),
});

/**
 * Profile edit form schema
 */
export const profileEditSchema = z.object({
  // Basic info
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(PROFILE_LIMITS.username, `Username must be at most ${PROFILE_LIMITS.username} characters`)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),

  display_name: z.string()
    .max(PROFILE_LIMITS.displayName, `Display name must be less than ${PROFILE_LIMITS.displayName} characters`)
    .optional()
    .nullable(),

  bio: z.string()
    .max(PROFILE_LIMITS.bio, `Bio must be less than ${PROFILE_LIMITS.bio} characters`)
    .optional()
    .nullable(),

  avatar_url: z.string()
    .url('Please enter a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),

  // Sizes
  shoe_size: profileText('shoe_size'),
  shirt_size: profileText('shirt_size'),
  pants_size: profileText('pants_size'),
  dress_size: profileText('dress_size'),
  ring_size: profileText('ring_size'),
  hat_size: profileText('hat_size'),

  // Preferences
  favorite_colors: profileText('favorite_colors'),
  favorite_brands: profileText('favorite_brands'),
  style_preferences: profileText('style_preferences'),
  hobbies: profileText('hobbies'),
  interests: profileText('interests'),
  dislikes: profileText('dislikes'),

  // Vehicles
  vehicle_make: profileText('vehicle_make'),
  vehicle_model: profileText('vehicle_model'),
  vehicle_year: profileText('vehicle_year'),
  vehicle_accessories_needed: profileText('vehicle_accessories_needed'),

  // Personal
  dietary_restrictions: profileText('dietary_restrictions'),
  allergies: profileText('allergies'),
  coffee_order: profileText('coffee_order'),
  favorite_restaurant: profileText('favorite_restaurant'),
  favorite_snacks: profileText('favorite_snacks'),

  // Important dates: YYYY-MM-DD, and a day that exists
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, DATE_MESSAGE).refine(isCalendarDay, DATE_MESSAGE).optional().nullable().or(z.literal('')),
  anniversary: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, DATE_MESSAGE).refine(isCalendarDay, DATE_MESSAGE).optional().nullable().or(z.literal('')),

  // Not read by updateProfile: a field keeps its own setting, and a new one
  // takes the person's stored choice (lib/profile/visibility.ts).
  visible_to_group_types: z.array(z.enum(['family', 'friends', 'work', 'custom'])).default([]),

  // Per-field privacy overrides (optional for future use)
  privacy_overrides: z.object({
    // Basic info
    bio: privacyLevelSchema.optional(),
    avatar_url: privacyLevelSchema.optional(),

    // Sizes
    shoe_size: privacyLevelSchema.optional(),
    shirt_size: privacyLevelSchema.optional(),
    pants_size: privacyLevelSchema.optional(),
    dress_size: privacyLevelSchema.optional(),
    ring_size: privacyLevelSchema.optional(),
    hat_size: privacyLevelSchema.optional(),

    // Preferences
    favorite_colors: privacyLevelSchema.optional(),
    favorite_brands: privacyLevelSchema.optional(),
    style_preferences: privacyLevelSchema.optional(),
    hobbies: privacyLevelSchema.optional(),
    interests: privacyLevelSchema.optional(),
    dislikes: privacyLevelSchema.optional(),

    // Vehicles
    vehicle_make: privacyLevelSchema.optional(),
    vehicle_model: privacyLevelSchema.optional(),
    vehicle_year: privacyLevelSchema.optional(),
    vehicle_accessories_needed: privacyLevelSchema.optional(),

    // Personal
    dietary_restrictions: privacyLevelSchema.optional(),
    allergies: privacyLevelSchema.optional(),
    coffee_order: privacyLevelSchema.optional(),
    favorite_restaurant: privacyLevelSchema.optional(),
    favorite_snacks: privacyLevelSchema.optional(),

    // Dates
    birthday: privacyLevelSchema.optional(),
    anniversary: privacyLevelSchema.optional(),
  }).optional(),

  // Group-specific overrides (optional - for advanced mode)
  group_privacy_overrides: z.record(
    z.string().uuid(), // groupId
    z.object({
      fields: z.record(z.string(), privacyLevelSchema), // fieldName -> privacy level
    })
  ).optional(),
});

export type BasicProfileFormData = z.infer<typeof basicProfileSchema>;
export type ProfileInfoFieldData = z.infer<typeof profileInfoFieldSchema>;
export type ProfileEditFormData = z.infer<typeof profileEditSchema>;

/**
 * What a profile save does to each catalog field, in catalog order: a
 * non-empty string is set, null or an empty string is cleared, and a field
 * the input does not name (undefined) is in neither list, so it is left as
 * it is. Who can see a field is not decided here (see updateProfile).
 */
export function planProfileFields(data: ProfileEditFormData): {
  set: { category: ProfileCategory; field_name: ProfileFieldName; field_value: string }[];
  clear: { category: ProfileCategory; field_name: ProfileFieldName }[];
} {
  const set: { category: ProfileCategory; field_name: ProfileFieldName; field_value: string }[] = [];
  const clear: { category: ProfileCategory; field_name: ProfileFieldName }[] = [];

  for (const section of PROFILE_SECTIONS) {
    for (const field of section.fields) {
      const value = data[field.name];
      if (typeof value === 'string' && value !== '') {
        set.push({ category: section.id, field_name: field.name, field_value: value });
      } else if (value === null || value === '') {
        clear.push({ category: section.id, field_name: field.name });
      }
    }
  }

  return { set, clear };
}
