import { z } from "zod";
import type { GroupType } from "@/types/privacy";
import type { createClient } from "@/lib/supabase/server";
import { ALL_GROUP_TYPES } from "@/lib/wishlist/privacy-choice";

/**
 * Who can see a person's profile fields.
 *
 * Each profile_info row carries its own setting in privacy_settings:
 * `visibleToGroupTypes` (the kinds of group whose members may see it) unless
 * `restrictToGroup` ties it to one group, which can_view_field() checks first.
 * A person's choice is kept in profile_visibility (no row means all four
 * kinds); the Settings page writes it onto every field, and a field saved for
 * the first time takes it.
 */

/** The four kinds of group, in the order every list here is kept in. */
export const ALL_KINDS: readonly GroupType[] = Object.freeze([...ALL_GROUP_TYPES]);

export const VISIBILITY_INVALID = "Choose which kinds of group can see your details.";

/** The kinds a list names, once each, in ALL_KINDS order. Anything else is dropped. */
function inOrder(kinds: unknown): GroupType[] {
  if (!Array.isArray(kinds)) return [];
  return ALL_KINDS.filter((kind) => kinds.includes(kind));
}

/** A person's choice as it arrives: a list of the four kinds, possibly empty. */
export const visibleToSchema: z.ZodType<GroupType[], unknown> = z
  .array(z.enum(ALL_KINDS, { error: VISIBILITY_INVALID }), { error: VISIBILITY_INVALID })
  .transform((kinds) => inOrder(kinds));

/**
 * The kinds a field's privacy_settings lets see it, or null when the field is
 * tied to one group.
 */
export function fieldKinds(privacy: unknown): GroupType[] | null {
  if (typeof privacy !== "object" || privacy === null) return [];
  const { visibleToGroupTypes, restrictToGroup } = privacy as {
    visibleToGroupTypes?: unknown;
    restrictToGroup?: unknown;
  };
  if (typeof restrictToGroup === "string") return null;
  return inOrder(visibleToGroupTypes);
}

/** True when some field is tied to one group or lets a different set of kinds see it. */
export function isMixed(choice: readonly GroupType[], privacies: readonly unknown[]): boolean {
  const wanted = inOrder(choice);
  return privacies.some((privacy) => {
    const kinds = fieldKinds(privacy);
    return (
      kinds === null ||
      kinds.length !== wanted.length ||
      kinds.some((kind, index) => kind !== wanted[index])
    );
  });
}

/** The privacy_settings a field saved for the first time is given. */
export function newFieldPrivacy(choice: readonly GroupType[]): {
  visibleToGroupTypes: GroupType[];
  restrictToGroup: null;
} {
  return { visibleToGroupTypes: inOrder(choice), restrictToGroup: null };
}

/**
 * The caller's stored choice, read with their own client (RLS lets a person
 * read only their own row). All four kinds when they have no row.
 */
export async function readStoredChoice(
  client: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<{ choice: GroupType[] } | { error: string }> {
  const { data, error } = await client
    .from("profile_visibility")
    .select("visible_to_group_types")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching profile visibility:", error);
    return { error: "Failed to load settings" };
  }

  return { choice: data ? inOrder(data.visible_to_group_types) : [...ALL_KINDS] };
}
