/**
 * Gift Tracking validation schemas using Zod
 */

import { z } from 'zod';

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

  photo_url: z.string()
    .url('Please enter a valid URL')
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
 */
export interface StatusInfo {
  value: GiftStatus;
  label: string;
  description: string;
  color: string;
  bgColor: string;
  icon: string;
  step: number;
}

export const STATUS_INFO: Record<GiftStatus, StatusInfo> = {
  planned: {
    value: 'planned',
    label: 'Planned',
    description: 'Gift idea saved',
    color: 'text-light-text-secondary',
    bgColor: 'bg-light-background-hover',
    icon: 'Lightbulb',
    step: 1,
  },
  ordered: {
    value: 'ordered',
    label: 'Ordered',
    description: 'Purchased or ordered',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    icon: 'ShoppingCart',
    step: 2,
  },
  arrived: {
    value: 'arrived',
    label: 'Arrived',
    description: 'Item has arrived',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    icon: 'Package',
    step: 3,
  },
  wrapped: {
    value: 'wrapped',
    label: 'Wrapped',
    description: 'Ready to give',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    icon: 'Gift',
    step: 4,
  },
  given: {
    value: 'given',
    label: 'Given',
    description: 'Gift delivered!',
    color: 'text-success',
    bgColor: 'bg-success/10',
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
