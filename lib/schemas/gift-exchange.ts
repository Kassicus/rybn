/**
 * Gift Exchange validation schemas using Zod
 */

import { z } from 'zod';

/**
 * Gift exchange creation/edit schema
 */
export const giftExchangeSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(200, 'Name must be less than 200 characters'),

  description: z.string()
    .max(1000, 'Description must be less than 1000 characters')
    .optional()
    .nullable(),

  group_id: z.string()
    .uuid('Invalid group ID'),

  exchange_type: z.enum(['secret_santa', 'white_elephant', 'yankee_swap', 'custom'])
    .default('secret_santa'),

  budget_min: z.number()
    .min(0, 'Minimum budget must be positive')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),

  budget_max: z.number()
    .min(0, 'Maximum budget must be positive')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),

  exchange_date: z.string()
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),

  exchange_location: z.string()
    .max(500, 'Location must be less than 500 characters')
    .optional()
    .nullable(),

  exchange_details: z.string()
    .max(2000, 'Details must be less than 2000 characters')
    .optional()
    .nullable(),

  registration_deadline: z.string()
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),

  is_active: z.boolean()
    .default(true),
}).refine(
  (data) => {
    if (data.budget_min !== null && data.budget_min !== undefined &&
        data.budget_max !== null && data.budget_max !== undefined) {
      return data.budget_min <= data.budget_max;
    }
    return true;
  },
  {
    message: 'Minimum budget must be less than or equal to maximum budget',
    path: ['budget_min'],
  }
);

export type GiftExchangeFormData = z.infer<typeof giftExchangeSchema>;

/**
 * Participant join/update schema
 */
export const participantUpdateSchema = z.object({
  opted_in: z.boolean()
    .default(true),

  wishlist_shared: z.boolean()
    .default(false),

  gift_sent: z.boolean()
    .default(false),

  gift_received: z.boolean()
    .default(false),

  notes: z.string()
    .max(1000, 'Notes must be less than 1000 characters')
    .optional()
    .nullable(),

  preferences: z.string()
    .max(1000, 'Preferences must be less than 1000 characters')
    .optional()
    .nullable(),
});

export type ParticipantUpdateData = z.infer<typeof participantUpdateSchema>;

/**
 * Assignment generation options
 */
export const assignmentOptionsSchema = z.object({
  allow_self_assignment: z.boolean()
    .default(false),

  exclusions: z.record(z.string(), z.array(z.string().uuid()))
    .optional(),
});

export type AssignmentOptions = z.infer<typeof assignmentOptionsSchema>;
