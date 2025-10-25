/**
 * Group gifts validation schemas using Zod
 */

import { z } from 'zod';

/**
 * Group gift creation/edit schema
 */
export const groupGiftSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(200, 'Name must be less than 200 characters'),

  description: z.string()
    .max(1000, 'Description must be less than 1000 characters')
    .optional()
    .nullable(),

  group_id: z.string()
    .uuid('Invalid group ID'),

  target_user_id: z.string()
    .uuid('Invalid user ID')
    .optional()
    .nullable(),

  target_amount: z.number()
    .min(0, 'Target amount must be positive')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),

  is_active: z.boolean()
    .default(true),
});

export type GroupGiftFormData = z.infer<typeof groupGiftSchema>;

/**
 * Group gift member contribution update schema
 */
export const contributionUpdateSchema = z.object({
  contribution_amount: z.number()
    .min(0, 'Contribution amount must be positive'),

  has_paid: z.boolean()
    .default(false),
});

export type ContributionUpdateData = z.infer<typeof contributionUpdateSchema>;

/**
 * Group gift member invitation schema
 */
export const groupGiftInviteSchema = z.object({
  group_gift_id: z.string()
    .uuid('Invalid group gift ID'),

  user_ids: z.array(z.string().uuid('Invalid user ID'))
    .min(1, 'At least one user must be selected'),
});

export type GroupGiftInviteData = z.infer<typeof groupGiftInviteSchema>;

/**
 * Message schema
 */
export const messageSchema = z.object({
  content: z.string()
    .min(1, 'Message cannot be empty')
    .max(5000, 'Message must be less than 5000 characters'),

  group_gift_id: z.string()
    .uuid('Invalid group gift ID'),

  attachment_url: z.string()
    .url('Please enter a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),
});

export type MessageFormData = z.infer<typeof messageSchema>;

/**
 * Message edit schema
 */
export const messageEditSchema = z.object({
  content: z.string()
    .min(1, 'Message cannot be empty')
    .max(5000, 'Message must be less than 5000 characters'),
});

export type MessageEditData = z.infer<typeof messageEditSchema>;
