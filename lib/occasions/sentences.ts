/**
 * The fixed sentences the group date actions answer (lib/actions/occasions.ts) that the app's routes match on, in one
 * module that is not "use server", so the actions and the routes (lib/mobile) read the same words.
 *
 * The sentences for a name or a date the actions refuse are GROUP_DATE_RULES (lib/schemas/occasions.ts), re-exported
 * here. The one for someone not in the group is GROUP_SENTENCES.notAMember (lib/groups/sentences.ts), which the group
 * actions answer too.
 */

export { GROUP_DATE_RULES } from "@/lib/schemas/occasions";

export const GROUP_DATE_SENTENCES = {
  /** A change that reached no row: the date is not there, or the caller may not change it. Never says which. */
  notYoursToEdit: "That occasion no longer exists, or is not yours to edit",
  /** The same, for a delete. */
  notYoursToDelete: "That occasion no longer exists, or is not yours to delete",
} as const;
