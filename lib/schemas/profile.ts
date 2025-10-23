/**
 * Profile validation schemas using Zod
 */

import { z } from 'zod';
import { privacyLevelSchema } from '@/lib/utils/privacy';

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

  // Sizes
  shoe_size: z.string().max(20).optional().nullable(),
  shirt_size: z.string().max(20).optional().nullable(),
  pants_size: z.string().max(20).optional().nullable(),
  dress_size: z.string().max(20).optional().nullable(),
  ring_size: z.string().max(20).optional().nullable(),
  hat_size: z.string().max(20).optional().nullable(),

  // Preferences
  favorite_colors: z.string().max(200).optional().nullable(),
  favorite_brands: z.string().max(200).optional().nullable(),
  style_preferences: z.string().max(200).optional().nullable(),
  hobbies: z.string().max(300).optional().nullable(),
  interests: z.string().max(300).optional().nullable(),
  dislikes: z.string().max(300).optional().nullable(),

  // Vehicles
  vehicle_make: z.string().max(50).optional().nullable(),
  vehicle_model: z.string().max(50).optional().nullable(),
  vehicle_year: z.string().max(4).optional().nullable(),
  vehicle_accessories_needed: z.string().max(200).optional().nullable(),

  // Personal
  dietary_restrictions: z.string().max(200).optional().nullable(),
  allergies: z.string().max(200).optional().nullable(),
  coffee_order: z.string().max(100).optional().nullable(),
  favorite_restaurant: z.string().max(100).optional().nullable(),
  favorite_snacks: z.string().max(200).optional().nullable(),

  // Important dates
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please enter a valid date (YYYY-MM-DD)').optional().nullable().or(z.literal('')),
  anniversary: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please enter a valid date (YYYY-MM-DD)').optional().nullable().or(z.literal('')),

  // Privacy settings - array of group types that can see profile
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
 * Helper function to convert form data to profile_info records
 */
export function formDataToProfileInfo(
  userId: string,
  formData: ProfileEditFormData
): Array<{
  user_id: string;
  category: string;
  field_name: string;
  field_value: string | null;
  privacy_settings: { visibleToGroupTypes: string[]; overrides?: Record<string, string[]> };
}> {
  const records: Array<{
    user_id: string;
    category: string;
    field_name: string;
    field_value: string | null;
    privacy_settings: { visibleToGroupTypes: string[]; overrides?: Record<string, string[]> };
  }> = [];

  // Get the visible group types from the form
  const visibleToGroupTypes = formData.visible_to_group_types || [];

  // Sizes
  const sizeFields = [
    'shoe_size', 'shirt_size', 'pants_size', 'dress_size', 'ring_size', 'hat_size'
  ] as const;

  sizeFields.forEach(field => {
    const value = formData[field];
    if (value !== undefined && value !== null && value !== '') {
      records.push({
        user_id: userId,
        category: 'sizes',
        field_name: field,
        field_value: value,
        privacy_settings: {
          visibleToGroupTypes,
          overrides: {},
        },
      });
    }
  });

  // Preferences
  const preferenceFields = [
    'favorite_colors', 'favorite_brands', 'style_preferences',
    'hobbies', 'interests', 'dislikes'
  ] as const;

  preferenceFields.forEach(field => {
    const value = formData[field];
    if (value !== undefined && value !== null && value !== '') {
      records.push({
        user_id: userId,
        category: 'preferences',
        field_name: field,
        field_value: value,
        privacy_settings: {
          visibleToGroupTypes,
          overrides: {},
        },
      });
    }
  });

  // Vehicles
  const vehicleFields = [
    'vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_accessories_needed'
  ] as const;

  vehicleFields.forEach(field => {
    const value = formData[field];
    if (value !== undefined && value !== null && value !== '') {
      records.push({
        user_id: userId,
        category: 'vehicles',
        field_name: field,
        field_value: value,
        privacy_settings: {
          visibleToGroupTypes,
          overrides: {},
        },
      });
    }
  });

  // Personal
  const personalFields = [
    'dietary_restrictions', 'allergies', 'coffee_order',
    'favorite_restaurant', 'favorite_snacks'
  ] as const;

  personalFields.forEach(field => {
    const value = formData[field];
    if (value !== undefined && value !== null && value !== '') {
      records.push({
        user_id: userId,
        category: 'personal',
        field_name: field,
        field_value: value,
        privacy_settings: {
          visibleToGroupTypes,
          overrides: {},
        },
      });
    }
  });

  // Dates
  const dateFields = ['birthday', 'anniversary'] as const;

  dateFields.forEach(field => {
    const value = formData[field];
    if (value !== undefined && value !== null && value !== '') {
      records.push({
        user_id: userId,
        category: 'dates',
        field_name: field,
        field_value: value,
        privacy_settings: {
          visibleToGroupTypes,
          overrides: {},
        },
      });
    }
  });

  return records;
}
