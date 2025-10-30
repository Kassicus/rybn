/**
 * Wishlist validation schemas using Zod
 */

import { z } from 'zod';

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
    .max(200, 'Title must be less than 200 characters'),

  description: z.string()
    .max(1000, 'Description must be less than 1000 characters')
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

  image_url: z.string()
    .url('Please enter a valid image URL')
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
  color: string;
  icon: string;
}

export const PRIORITY_INFO: Record<Priority, PriorityInfo> = {
  'low': {
    value: 'low',
    label: 'Low',
    description: 'Nice to have',
    color: 'text-gray-600 dark:text-gray-400',
    icon: 'CircleDashed',
  },
  'medium': {
    value: 'medium',
    label: 'Medium',
    description: 'Would appreciate',
    color: 'text-blue-600 dark:text-blue-400',
    icon: 'Circle',
  },
  'high': {
    value: 'high',
    label: 'High',
    description: 'Really want this',
    color: 'text-orange-600 dark:text-orange-400',
    icon: 'CircleDot',
  },
  'must-have': {
    value: 'must-have',
    label: 'Must Have',
    description: 'Top priority!',
    color: 'text-red-600 dark:text-red-400',
    icon: 'Star',
  },
};
