import { occasionLabel, type UpcomingOccasion } from "@/lib/occasions/display";
import { formatMonthDay } from "@/lib/utils/dates";

/**
 * Pure logic behind ItemOccasionTags (components/wishlist/ItemOccasionTags.tsx),
 * pulled out so it can be unit tested -- this repo's vitest config only
 * collects `*.test.ts`, and there is no React testing library to exercise the
 * "use client" component itself (see vitest.config.ts, AGENTS.md-adjacent
 * environment notes for Task 4).
 */

/**
 * Occasions this component may ever offer as a TAG TARGET on an owner's own
 * wishlist item.
 *
 * getUpcomingOccasions() (lib/actions/occasions.ts) returns every occasion
 * the caller may SEE -- including other people's derived birthdays and
 * anniversaries, which is exactly what the dashboard's "Coming up" widget
 * wants and exactly wrong here. tagItemForMyOccasion() (lib/actions/
 * item-occasions.ts) takes no celebrant argument at all: get_or_create_
 * occasion()'s own header states "the caller is always the celebrant,
 * because you only tag YOUR OWN items, and your own items are for occasions
 * where you are the recipient" (supabase/migrations/
 * 20260911000000_get_or_create_occasion.sql). Offering a family member's
 * derived birthday as a pickable option would not error when picked -- it
 * would silently tag the CALLER's own birthday instead, because that
 * function has no id to target anyone else's. There is nothing for the
 * action layer to reject, so the wrong option is removed here instead.
 *
 * A group_date carries no celebrant at all -- it is a shared occasion any
 * member of the group may tag toward -- so every group_date the caller can
 * see passes through unfiltered.
 */
export function taggableOccasions(
  occasions: UpcomingOccasion[],
  userId: string
): UpcomingOccasion[] {
  return occasions.filter(
    (o) => o.kind === "group_date" || o.celebrantId === userId
  );
}

/**
 * Of the occasions a caller may tag TOWARD, the ones not already tagged on
 * this item -- what the "add a tag" control should list.
 *
 * A never-materialized birthday/anniversary (occasionId: null) always
 * passes through: it cannot be "already tagged" until tagItemForMyOccasion
 * has given it a real id, and taggedOccasionIds only ever contains real ids
 * (getTagsForItems reads occasion_id off wishlist_item_occasions rows,
 * which are only ever inserted with a materialized id).
 */
export function untaggedOccasions(
  occasions: UpcomingOccasion[],
  taggedOccasionIds: string[]
): UpcomingOccasion[] {
  return occasions.filter(
    (o) => !o.occasionId || !taggedOccasionIds.includes(o.occasionId)
  );
}

export type TagTarget =
  | { via: "my"; kind: "birthday" | "anniversary" }
  | { via: "group"; occasionId: string };

/**
 * Which of the two write actions applies to a given occasion, and with what
 * argument.
 *
 * A derived birthday/anniversary the caller has never materialized has
 * occasionId: null and is tagged by KIND, not by id --
 * tagItemForMyOccasion() derives the date from the caller's own profile via
 * get_or_create_occasion() and ignores any id. A group_date is a stored row
 * (group_date_shape, supabase/migrations/
 * 20260910100000_occasions_schema.sql requires occasion_id whenever
 * kind = 'group_date') and always has a real id, tagged by that id via
 * tagItemForGroupDate().
 *
 * Returns null only for a group_date somehow missing its id, which the
 * schema constraint above should make unreachable through any row the
 * database will actually hand back -- a defensive floor, not a case this
 * app's data can produce, mirroring occasionLabel()'s own fallback in
 * lib/occasions/display.ts.
 */
export function resolveTagTarget(occasion: UpcomingOccasion): TagTarget | null {
  if (occasion.kind === "group_date") {
    return occasion.occasionId
      ? { via: "group", occasionId: occasion.occasionId }
      : null;
  }
  return { via: "my", kind: occasion.kind };
}

export interface ResolvedTagChip {
  occasionId: string;
  label: string;
  /** Absolute month/day, e.g. "October 24th". Null when the occasion could
   *  not be resolved -- see the doc comment below. */
  dateLabel: string | null;
}

/**
 * Tagged occasion ids paired with the display info to render them as chips,
 * when that info is still available.
 *
 * A tag can outlive its occasion's presence in `availableOccasions`:
 * get_upcoming_occasions() is a "next N days" window, so once an occasion's
 * date has passed it drops out -- a derived birthday/anniversary reappears
 * under a DIFFERENT id next year (occasions_celebrant_identity keys on
 * occasion_year) rather than the old row aging in place, and a past
 * group_date simply falls out of the window with nothing to replace it. The
 * tag row in wishlist_item_occasions survives until the owner explicitly
 * removes it. Those ids still need a chip -- with a working remove button --
 * even though there is nothing left to show but "this was tagged for
 * something."
 */
export function resolveTaggedChips(
  taggedOccasionIds: string[],
  availableOccasions: UpcomingOccasion[]
): ResolvedTagChip[] {
  const byId = new Map<string, UpcomingOccasion>();
  for (const o of availableOccasions) {
    if (o.occasionId) byId.set(o.occasionId, o);
  }

  return taggedOccasionIds.map((occasionId) => {
    const occasion = byId.get(occasionId);
    if (!occasion) {
      return { occasionId, label: "Past occasion", dateLabel: null };
    }
    return {
      occasionId,
      label: occasionLabel(occasion),
      dateLabel: formatMonthDay(occasion.occasionDate),
    };
  });
}
