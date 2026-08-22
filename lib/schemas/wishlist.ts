/**
 * Wishlist validation schemas using Zod
 */

import { z } from 'zod';
import { imageValueProblem } from '@/lib/storage/image-value';

/**
 * Length limits for the free-text fields.
 *
 * Exported because they are not only a form rule: `wishlist_items` carries a
 * `title_length between 1 and 200` check constraint, and
 * `lib/link-metadata/extract.ts` trims auto-filled values to exactly these
 * numbers so a fetched page can never produce a value the form would reject.
 * One definition, so the two cannot drift apart.
 */
export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 1000;

/**
 * Priority levels for wishlist items
 */
export const priorityLevels = ['low', 'medium', 'high', 'must-have'] as const;
export type Priority = typeof priorityLevels[number];

/**
 * Wishlist item creation/edit schema
 */
export const wishlistItemSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(TITLE_MAX_LENGTH, `Title must be less than ${TITLE_MAX_LENGTH} characters`),

  description: z.string()
    .max(DESCRIPTION_MAX_LENGTH, `Description must be less than ${DESCRIPTION_MAX_LENGTH} characters`)
    .optional()
    .nullable(),

  url: z.string()
    .url('Please enter a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),

  price: z.number()
    .min(0, 'Price must be positive')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),

  // Holds EITHER an external image URL the user pasted OR an object path in the
  // private `wishlist-images` bucket, which is what our upload now returns. A
  // bare .url() would reject every uploaded image; see lib/storage/image-value.ts.
  //
  // superRefine rather than refine so the SPECIFIC reason reaches the user. The
  // most likely way to fail this is pasting the image address off your own
  // wishlist, and "please enter a valid image URL" is a useless answer to that.
  image_url: z.string()
    .superRefine((value, ctx) => {
      const problem = imageValueProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .optional()
    .nullable()
    .or(z.literal('')),

  priority: z.enum(priorityLevels)
    .default('medium'),

  category: z.string()
    .max(50, 'Category must be less than 50 characters')
    .optional()
    .nullable(),

  // Privacy settings - group types that can see this item
  visible_to_group_types: z.array(z.enum(['family', 'friends', 'work', 'custom']))
    .default(['family', 'friends', 'work', 'custom']),

  // Optional: Restrict to a single specific group (group ID)
  restrict_to_group: z.string().uuid().nullable()
    .optional()
    .default(null),
});

export type WishlistItemFormData = z.infer<typeof wishlistItemSchema>;

/**
 * Priority display information
 */
export interface PriorityInfo {
  value: Priority;
  label: string;
  description: string;
  hexColor: string;
  icon: string;
}

export const PRIORITY_INFO: Record<Priority, PriorityInfo> = {
  'low': {
    value: 'low',
    label: 'Low',
    description: 'Nice to have',
    hexColor: '#9CA3AF', // gray
    icon: 'Circle',
  },
  'medium': {
    value: 'medium',
    label: 'Medium',
    description: 'Would appreciate',
    hexColor: '#3B82F6', // blue
    icon: 'Circle',
  },
  'high': {
    value: 'high',
    label: 'High',
    description: 'Really want this',
    hexColor: '#14B8A6', // teal (blue-green)
    icon: 'Circle',
  },
  'must-have': {
    value: 'must-have',
    label: 'Must Have',
    description: 'Top priority!',
    hexColor: '#009E01', // rybn green
    icon: 'Circle',
  },
};
