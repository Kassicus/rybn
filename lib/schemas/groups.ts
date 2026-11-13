import { z } from "zod";
import { tidyGroupText } from "@/lib/utils/groups";
import type { Database } from "@/types/database";

type GroupType = Database["public"]["Enums"]["group_type"];

/**
 * The website's sentences for a group or an invitation it will not take. The
 * create form shows the group ones under its fields, and createGroup and
 * sendGroupInvitation answer them, so every caller is told the same thing.
 */
export const GROUP_RULES = {
  nameMissing: "Group name is required",
  nameTooLong: "Group name must be less than 50 characters",
  descriptionTooLong: "Description must be less than 200 characters",
  kind: "Choose a kind of group.",
  email: "Please enter a valid email address",
} as const;

const GROUP_TYPES = ["family", "friends", "work", "custom"] as const satisfies readonly GroupType[];

/**
 * A new group: a name of 1 to 50 characters and a description of at most 200,
 * each made one line and trimmed first (tidyGroupText: line breaks, control
 * characters and invisible characters become spaces), and one of the four
 * kinds. Every refusal carries a GROUP_RULES sentence: a field's own, for a
 * value of the wrong kind too, and the name's for an input that is not an
 * object at all.
 */
export const createGroupSchema = z.object(
  {
    name: z
      .string({ error: GROUP_RULES.nameMissing })
      .overwrite(tidyGroupText)
      .min(1, GROUP_RULES.nameMissing)
      .max(50, GROUP_RULES.nameTooLong),
    description: z
      .string({ error: GROUP_RULES.descriptionTooLong })
      .overwrite(tidyGroupText)
      .max(200, GROUP_RULES.descriptionTooLong)
      .optional(),
    type: z.enum(GROUP_TYPES, { error: GROUP_RULES.kind }),
  },
  { error: GROUP_RULES.nameMissing }
);

export type CreateGroupInput = z.input<typeof createGroupSchema>;

/**
 * An invitation's address: trimmed (a phone's keyboard adds a space after an
 * address it completes), then an email address of at most 254 characters.
 * Every refusal is GROUP_RULES.email; the output is the trimmed address.
 */
export const invitationEmailSchema = z
  .string({ error: GROUP_RULES.email })
  .trim()
  .pipe(z.email({ error: GROUP_RULES.email }).max(254, GROUP_RULES.email));
