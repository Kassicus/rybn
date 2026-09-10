import type { GroupType } from "@/types/privacy";

/**
 * Canonical order. Normalising through this list dedupes, drops anything that
 * is not a real group type, and gives a stable order, so two rows meaning the
 * same thing compare equal.
 */
export const ALL_GROUP_TYPES: GroupType[] = ["family", "friends", "work", "custom"];

/** The shape stored in wishlist_items.privacy_settings. */
export interface StoredPrivacy {
  visibleToGroupTypes: GroupType[];
  restrictToGroup: string | null;
}

/**
 * What the form offers. `legacyTypes` is not offered as a choice -- it only
 * appears when reading an item saved while the group-type toggles still
 * existed, so that editing an unrelated field cannot quietly widen it.
 */
export type PrivacyChoice =
  | { kind: "groups" }
  | { kind: "group"; groupId: string }
  | { kind: "private" }
  | { kind: "legacyTypes"; types: GroupType[] };

function normalise(types: readonly GroupType[] | null | undefined): GroupType[] {
  if (!Array.isArray(types)) return [];
  return ALL_GROUP_TYPES.filter((t) => types.includes(t));
}

/**
 * Mirrors can_view_wishlist_item(): a restriction short-circuits everything,
 * so a row carrying both a restriction and types is a one-group item and must
 * be read as one.
 */
export function fromStored(stored: StoredPrivacy): PrivacyChoice {
  const restrictToGroup =
    typeof stored.restrictToGroup === "string" && stored.restrictToGroup.length > 0
      ? stored.restrictToGroup
      : null;

  if (restrictToGroup !== null) {
    return { kind: "group", groupId: restrictToGroup };
  }

  const types = normalise(stored.visibleToGroupTypes);

  if (types.length === 0) return { kind: "private" };
  if (types.length === ALL_GROUP_TYPES.length) return { kind: "groups" };
  return { kind: "legacyTypes", types };
}

export function toStored(choice: PrivacyChoice): StoredPrivacy {
  switch (choice.kind) {
    case "groups":
      return { visibleToGroupTypes: [...ALL_GROUP_TYPES], restrictToGroup: null };

    case "private":
      return { visibleToGroupTypes: [], restrictToGroup: null };

    case "group":
      // Empty rather than all-four. The database ignores types while a
      // restriction is set, so their only effect is what happens if the
      // restriction is ever cleared -- and the safe answer there is "private",
      // not "everyone".
      return { visibleToGroupTypes: [], restrictToGroup: choice.groupId };

    case "legacyTypes":
      return { visibleToGroupTypes: normalise(choice.types), restrictToGroup: null };
  }
}

/** Plain-language summary of the current setting, for the form and the cards. */
export function describeChoice(
  choice: PrivacyChoice,
  groupName?: string | null
): string {
  switch (choice.kind) {
    case "groups":
      return "Everyone in your groups";
    case "group":
      return groupName ? `Only ${groupName}` : "Only one group";
    case "private":
      return "Only you";
    case "legacyTypes":
      return `Only your ${choice.types.join(", ")} groups`;
  }
}
