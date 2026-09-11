"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth/require-auth";

/**
 * Owner-only tagging: which occasion(s) an item was meant for.
 *
 * Every function here runs on the USER-SCOPED client (@/lib/supabase/server)
 * so Task 2's RLS policies on wishlist_item_occasions apply -- the admin
 * client would bypass every one of them, including the ownership check that
 * is the entire point of these actions.
 *
 * Shaped on lib/actions/occasions.ts: getUserId() first, a generic
 * caller-facing message with the provider detail logged server-side, and
 * revalidatePath("/wishlist") + revalidatePath(`/wishlist/user/${ownerId}`)
 * after a write. The owner is always the caller here -- you only ever tag
 * your own items -- so ownerId is just userId.
 */

/**
 * Tag an item for the caller's OWN celebrated occasion (birthday or
 * anniversary), materializing that occasion via get_or_create_occasion() if
 * it does not already exist this year.
 *
 * get_or_create_occasion() raises 22023 when the caller has no such date on
 * file -- mapped to a message that tells them what to do about it, not a
 * generic failure. A 42501 from the insert means the wishlist_item_occasions
 * INSERT policy refused: the item is not the caller's.
 */
export async function tagItemForMyOccasion(
  itemId: string,
  kind: "birthday" | "anniversary"
): Promise<{ data: { occasionId: string } } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data: occasionId, error: rpcError } = await supabase.rpc(
    "get_or_create_occasion",
    { p_kind: kind }
  );

  if (rpcError) {
    if (rpcError.code === "22023") {
      return { error: `Add your ${kind} to your profile first` };
    }
    console.error(
      "tagItemForMyOccasion: get_or_create_occasion failed",
      rpcError
    );
    return { error: "Failed to tag this item. Please try again." };
  }

  if (!occasionId) {
    console.error("tagItemForMyOccasion: RPC returned no occasion id");
    return { error: "Failed to tag this item. Please try again." };
  }

  const { error: insertError } = await supabase
    .from("wishlist_item_occasions")
    .insert({ item_id: itemId, occasion_id: occasionId });

  if (insertError) {
    if (insertError.code === "42501") {
      return { error: "You can only tag your own items" };
    }
    console.error("tagItemForMyOccasion: insert failed", insertError);
    return { error: "Failed to tag this item. Please try again." };
  }

  revalidatePath("/wishlist");
  revalidatePath(`/wishlist/user/${userId}`);

  return { data: { occasionId } };
}

/**
 * Tag an item for an existing group_date occasion. Unlike
 * tagItemForMyOccasion, the occasion already exists (created explicitly
 * through createGroupDate()), so this does not call get_or_create_occasion --
 * but it must still verify the id it was handed before inserting.
 *
 * Nothing constrains which occasion_id a caller may pass here: this is a
 * directly callable server action, and RLS on wishlist_item_occasions gates
 * INSERT on the ITEM's ownership only, never on which occasion the tag
 * names. Without this check a caller could tag their own item against an
 * occasion id that is a birthday/anniversary rather than a group date, or a
 * real group_date belonging to a group they do not belong to. Occasion ids
 * are not hard to come by either -- get_upcoming_occasions() (already wired
 * into lib/actions/occasions.ts and rendered on the dashboard) hands every
 * family member the materialized occasion id for OTHER people's derived
 * birthdays (20260910100002_occasions_derivation.sql:87), so "the id is
 * secret" cannot be relied on to close this gap.
 *
 * The check runs on the user-scoped client so occasions' own SELECT policy
 * applies, which closes both problems in the same query: filtering on
 * kind = 'group_date' rejects a celebrated occasion's id outright (the
 * celebrated-occasion SELECT policy is a different branch entirely, so this
 * filter alone would reject it even under an admin client), and reusing RLS
 * rather than re-deriving it means a group_date row only comes back if the
 * caller is actually a member of that group -- "Members can view their
 * groups' occasions" in 20260910100000_occasions_schema.sql. One generic
 * message covers a nonexistent id, the wrong kind, and a real group_date the
 * caller cannot see, for the same no-oracle reason untagItem documents
 * below: distinguishing them would let a caller probe which occasion ids
 * exist and what kind they are.
 *
 * A 42501 from the insert below means what it means everywhere else in this
 * file: the ITEM is not the caller's. That check is unaffected by, and
 * still necessary alongside, the occasion check above -- they gate two
 * different foreign keys on the same row.
 */
export async function tagItemForGroupDate(
  itemId: string,
  occasionId: string
): Promise<{ data: { occasionId: string } } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data: occasion, error: occasionError } = await supabase
    .from("occasions")
    .select("id")
    .eq("id", occasionId)
    .eq("kind", "group_date")
    .maybeSingle();

  if (occasionError) {
    console.error(
      "tagItemForGroupDate: occasion lookup failed",
      occasionError
    );
    return { error: "Failed to tag this item. Please try again." };
  }

  if (!occasion) {
    return { error: "That occasion no longer exists, or is not yours to tag" };
  }

  const { error } = await supabase
    .from("wishlist_item_occasions")
    .insert({ item_id: itemId, occasion_id: occasionId });

  if (error) {
    if (error.code === "42501") {
      return { error: "You can only tag your own items" };
    }
    console.error("tagItemForGroupDate: insert failed", error);
    return { error: "Failed to tag this item. Please try again." };
  }

  revalidatePath("/wishlist");
  revalidatePath(`/wishlist/user/${userId}`);

  return { data: { occasionId } };
}

/**
 * Remove a tag.
 *
 * A zero-row delete means the tag does not exist OR the item is not the
 * caller's, and both return the SAME message on purpose -- distinguishing
 * them would make this an oracle for which item/occasion pairs exist, the
 * same reasoning acceptInvitation() documents for invitation tokens.
 */
export async function untagItem(
  itemId: string,
  occasionId: string
): Promise<{ ok: true } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("wishlist_item_occasions")
    .delete()
    .eq("item_id", itemId)
    .eq("occasion_id", occasionId)
    .select("item_id")
    .maybeSingle();

  if (error) {
    console.error("untagItem: delete failed", error);
    return { error: "Failed to remove this tag. Please try again." };
  }

  if (!data) {
    return { error: "That tag no longer exists, or is not yours to remove" };
  }

  revalidatePath("/wishlist");
  revalidatePath(`/wishlist/user/${userId}`);

  return { ok: true };
}

/**
 * Every occasion id each of the given items is tagged for, keyed by item id.
 * Items with no tags are simply absent from the result, not present with an
 * empty array.
 *
 * The empty-list short circuit runs BEFORE getUserId() or createClient() are
 * even called -- stricter than the similarly-shaped short circuit in
 * getClaimerProfiles() (lib/actions/wishlist.ts:408-419), which checks the
 * empty list first but still calls createClient() ahead of its own !userId
 * check. Here neither runs at all for an empty list, not just "no query is
 * sent."
 *
 * Read access is gated by the ITEM's visibility (can_view_wishlist_item), not
 * by ownership, so this can return tags for items the caller does not own --
 * that is by design: Task 5 uses this for viewer-side ordering, and nothing
 * returned here carries claim state (no claimed_by, no purchased, etc. --
 * this table has no such columns to begin with).
 */
export async function getTagsForItems(
  itemIds: string[]
): Promise<{ data: Record<string, string[]> } | { error: string }> {
  if (itemIds.length === 0) {
    return { data: {} };
  }

  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("wishlist_item_occasions")
    .select("item_id, occasion_id")
    .in("item_id", itemIds);

  if (error) {
    console.error("getTagsForItems: select failed", error);
    return { error: "Failed to load tags. Please try again." };
  }

  const result: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const occasionIds = result[row.item_id] ?? (result[row.item_id] = []);
    occasionIds.push(row.occasion_id);
  }

  return { data: result };
}
