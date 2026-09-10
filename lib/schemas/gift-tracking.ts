/**
 * Gift Tracking validation schemas using Zod
 */

import { z } from 'zod';
import { imageValueProblem } from '@/lib/storage/image-value';

/**
 * Gift status workflow
 */
export const giftStatuses = ['planned', 'ordered', 'arrived', 'wrapped', 'given'] as const;
export type GiftStatus = typeof giftStatuses[number];

/**
 * Common occasions for gifts
 */
export const OCCASIONS = [
  'Birthday',
  'Christmas',
  'Hanukkah',
  'Anniversary',
  'Wedding',
  'Baby Shower',
  'Graduation',
  "Valentine's Day",
  "Mother's Day",
  "Father's Day",
  'Thank You',
  'Just Because',
  'Other',
] as const;

/**
 * Recipient creation/edit schema
 */
export const recipientSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),

  notes: z.string()
    .max(500, 'Notes must be less than 500 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
});

export type RecipientFormData = z.infer<typeof recipientSchema>;

/**
 * Tracked gift creation/edit schema
 */
export const trackedGiftSchema = z.object({
  recipient_id: z.string()
    .uuid('Please select a recipient'),

  name: z.string()
    .min(1, 'Gift name is required')
    .max(200, 'Name must be less than 200 characters'),

  description: z.string()
    .max(1000, 'Description must be less than 1000 characters')
    .optional()
    .nullable()
    .or(z.literal('')),

  // External image URL, or an object path in the private `gift-photos` bucket.
  // See the same note on wishlist_items.image_url.
  photo_url: z.string()
    .superRefine((value, ctx) => {
      const problem = imageValueProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .optional()
    .nullable()
    .or(z.literal('')),

  product_link: z.string()
    .url('Please enter a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),

  price: z.number()
    .min(0, 'Price must be positive')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),

  status: z.enum(giftStatuses)
    .default('planned'),

  occasion: z.string()
    .max(100, 'Occasion must be less than 100 characters')
    .optional()
    .nullable()
    .or(z.literal('')),

  season_year: z.number()
    .optional()
    .default(() => new Date().getFullYear()),

  notes: z.string()
    .max(1000, 'Notes must be less than 1000 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
});

export type TrackedGiftFormData = z.infer<typeof trackedGiftSchema>;

/**
 * Status display information
 * Uses hex colors to match wishlist priority color scheme
 */
export interface StatusInfo {
  value: GiftStatus;
  label: string;
  description: string;
  /**
   * Hex rather than Tailwind classes because these are consumed as inline
   * styles in five components (progress segments, stepper, badge). Values
   * mirror the light palette in app/globals.css and must be updated by hand
   * if it moves. Every pair clears 4.5:1 as text on its own background.
   */
  hexColor: string;
  hexBgColor: string;
  icon: string;
  step: number;
}

export const STATUS_INFO: Record<GiftStatus, StatusInfo> = {
  planned: {
    value: 'planned',
    label: 'Planned',
    description: 'Gift idea saved',
    hexColor: '#5C6660', // not started: neutral
    hexBgColor: '#F0EBE1',
    icon: 'Lightbulb',
    step: 1,
  },
  ordered: {
    value: 'ordered',
    label: 'Ordered',
    description: 'Purchased or ordered',
    hexColor: '#7A5D09', // in motion: gold
    hexBgColor: '#F5EEDD',
    icon: 'ShoppingCart',
    step: 2,
  },
  arrived: {
    value: 'arrived',
    label: 'Arrived',
    description: 'Item has arrived',
    hexColor: '#9F1239', // in hand: cranberry
    hexBgColor: '#F7E6EA',
    icon: 'Package',
    step: 3,
  },
  wrapped: {
    value: 'wrapped',
    label: 'Wrapped',
    description: 'Ready to give',
    hexColor: '#2F6B49', // nearly there: mid evergreen
    hexBgColor: '#E1EBE4',
    icon: 'Gift',
    step: 4,
  },
  given: {
    value: 'given',
    label: 'Given',
    description: 'Gift delivered!',
    hexColor: '#14432A', // done: evergreen
    hexBgColor: '#EAF0EA',
    icon: 'CheckCircle2',
    step: 5,
  },
};

/**
 * Gift tracking stats type
 */
export interface GiftTrackingStats {
  totalCost: number;
  giftCount: number;
  recipientCount: number;
  byStatus: Record<GiftStatus, { count: number; total: number }>;
}
