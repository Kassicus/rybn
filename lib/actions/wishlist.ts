"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { WishlistItemFormData } from "@/lib/schemas/wishlist";
import {
  withSignedWishlistImage,
  withSignedWishlistImages,
} from "@/lib/supabase/signed-image";
import { resolveStoredImageValue } from "@/lib/storage/image-value";

import { getUserId } from "@/lib/auth/require-auth";
import { isClaimActive, todayISO } from "@/lib/claims/active";
import {
  WISHLIST_ITEM_COLUMNS,
  readVisibleMarks,
  unmarked,
  withMarks,
} from "@/lib/wishlist/marks";

/**
 * INVARIANT for this file: every wishlist_items row that leaves a server action
 * has passed through withSignedWishlistImage(s). The three mark actions
 * (markAsPurchased, markOutOfStock, unmarkOutOfStock) answer the item's id
 * alone, not a row.
 *
 * `image_url` is stored as an object path in the PRIVATE `wishlist-images`
 * bucket (or an external URL the user pasted). A path is not renderable, so
 * every return signs it; the client keeps using `image_url` and needs no change.
 * `image_path` carries the raw stored value back to the owner's edit form so a
 * save round-trips the path instead of overwriting it with an expiring URL.
 *
 * Signing is safe here precisely because RLS has already run: the row is in
 * hand only if the caller was permitted to read it. Holding the invariant for
 * EVERY return -- including the ones nothing renders today -- is what stops the
 * next caller from picking the one function that forgot.
 *
 * Every read of a wishlist_items row names WISHLIST_ITEM_COLUMNS, which hold no
 * mark. A row leaves here in the site's item shape, with its four mark fields
 * (purchased, purchased_at, out_of_stock_marked_by, out_of_stock_marked_at):
 * on another person's item they come from visible_item_marks() (withMarks); on
 * the caller's own item they are unmarked (unmarked), and nothing is asked
 * about its marks. Claims live in wishlist_claims, whose own SELECT policy
 * leaves out the item's owner.
 */

/**
 * Get the current user's wishlist, each item unmarked: nothing is asked about
 * the marks on the caller's own items.
 */
export async function getMyWishlist() {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: items, error } = await supabase
    .from("wishlist_items")
    .select(WISHLIST_ITEM_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { data: await withSignedWishlistImages((items ?? []).map(unmarked), userId) };
}

/**
 * Get another user's wishlist (filtered by privacy)
 * Returns currentUserId for UI to determine claim permissions
 *
 * Another person's items carry their marks from visible_item_marks(); a list
 * whose marks cannot be read is not answered, since it could show a bought
 * item as available. The caller's own list (the mobile app asks for it this
 * way) is answered unmarked, and nothing is asked about its marks.
 */
export async function getUserWishlist(userId: string) {
  const supabase = await createClient();

  const currentUserId = await getUserId();

  if (!currentUserId) {
    return { error: "Not authenticated" };
  }

  // RLS handles privacy filtering
  const { data: items, error } = await supabase
    .from("wishlist_items")
    .select(WISHLIST_ITEM_COLUMNS)
    .eq("user_id", userId)
    .order("priority", { ascending: false }) // Show high priority first
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  const rows = items ?? [];
  let marked;
  if (currentUserId === userId) {
    marked = rows.map(unmarked);
  } else {
    const read = await readVisibleMarks(
      supabase,
      rows.map((row) => row.id),
    );
    if ("error" in read) {
      return { error: read.error.message };
    }
    marked = rows.map((row) => withMarks(row, read.marks));
  }

  return {
    data: await withSignedWishlistImages(marked, currentUserId),
    currentUserId,
  };
}

/**
 * Create a new wishlist item. The new row is asked back by its named columns
 * and answered unmarked.
 */
export async function createWishlistItem(formData: WishlistItemFormData) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // An object path may only ever name a folder the caller owns -- signing later
  // uses the admin client, which does not re-check.
  const image = resolveStoredImageValue(formData.image_url, userId);
  if (!image.ok) {
    return { error: image.error };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .insert({
      user_id: userId,
      title: formData.title,
      description: formData.description || null,
      url: formData.url || null,
      price: formData.price || null,
      image_url: image.value,
      priority: formData.priority,
      category: formData.category || null,
      privacy_settings: {
        visibleToGroupTypes: formData.visible_to_group_types || ['family', 'friends', 'work', 'custom'],
        restrictToGroup: formData.restrict_to_group || null,
      },
    })
    .select(WISHLIST_ITEM_COLUMNS)
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(unmarked(item), userId) };
}

/**
 * Update a wishlist item. The written row is asked back by its named columns
 * and answered unmarked.
 */
export async function updateWishlistItem(itemId: string, formData: WishlistItemFormData) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const image = resolveStoredImageValue(formData.image_url, userId);
  if (!image.ok) {
    return { error: image.error };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      title: formData.title,
      description: formData.description || null,
      url: formData.url || null,
      price: formData.price || null,
      image_url: image.value,
      priority: formData.priority,
      category: formData.category || null,
      privacy_settings: {
        visibleToGroupTypes: formData.visible_to_group_types || ['family', 'friends', 'work', 'custom'],
        restrictToGroup: formData.restrict_to_group || null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("user_id", userId) // Extra security check
    .select(WISHLIST_ITEM_COLUMNS)
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  revalidatePath(`/wishlist/${itemId}`);
  return { data: await withSignedWishlistImage(unmarked(item), userId) };
}

/**
 * Delete a wishlist item
 */
export async function deleteWishlistItem(itemId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("wishlist_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", userId); // Extra security check

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { success: true };
}

/**
 * Get a single wishlist item
 * Returns currentUserId for UI to determine claim permissions
 *
 * Another person's item carries its marks from visible_item_marks(); the
 * caller's own item is answered unmarked, and nothing is asked about its marks.
 */
export async function getWishlistItem(itemId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated", notFound: true };
  }

  // RLS handles privacy filtering
  const { data: item, error } = await supabase
    .from("wishlist_items")
    .select(WISHLIST_ITEM_COLUMNS)
    .eq("id", itemId)
    .single();

  if (error) {
    // `notFound` means "not there FOR YOU" -- deleted, never existed, privacy
    // revoked, or signed out. PGRST116 is what .single() returns for zero rows,
    // and RLS filtering is indistinguishable from deletion from here, which is
    // correct: both mean stop showing this item.
    //
    // Everything else is infrastructure -- a pooler blip, a timeout -- and is
    // deliberately NOT reported as a missing item. The detail page re-fetches on
    // a timer and on every tab focus, so conflating the two would navigate a
    // reader off the page they were reading because the database hiccuped once.
    return { error: error.message, notFound: error.code === "PGRST116" };
  }

  let marked;
  if (item.user_id === userId) {
    marked = unmarked(item);
  } else {
    const read = await readVisibleMarks(supabase, [itemId]);
    if ("error" in read) {
      // The item is there; its marks could not be read. Infrastructure, as
      // above, not a missing item.
      return { error: read.error.message, notFound: false };
    }
    marked = withMarks(item, read.marks);
  }

  return {
    data: await withSignedWishlistImage(marked, userId),
    currentUserId: userId,
  };
}

/**
 * Mark a wishlist item as purchased.
 *
 * Claiming and unclaiming moved to lib/actions/claims.ts (claimItem /
 * releaseClaim), which write public.wishlist_claims through the
 * claim_wishlist_item()/release_wishlist_claim() RPCs. This action stays
 * here because `purchased`/`purchased_at` are still columns on
 * wishlist_items (20260911100003_drop_item_claim_columns.sql's header:
 * "Purchase is terminal... stays on wishlist_items").
 *
 * AUTHORIZATION: only the person holding an ACTIVE claim on this item may
 * record its purchase state. The check reads the caller's own wishlist_claims
 * row for this item (released_at is null) and decides activity with
 * lib/claims/active.ts, as getActiveClaims() does. Whether the item is
 * bought, which that decision needs, is read through visible_item_marks(),
 * once there is a claim row to decide about.
 *
 * A claimer who can no longer see the item (they left the group they shared
 * with its owner, or the owner changed who may see it) still has their claim
 * row read here, but the update finds no row to change, so the action answers
 * an error and writes nothing. release_wishlist_claim() still releases such a
 * claim.
 *
 * The update asks back the item's id alone, and that id is the answer.
 */
export async function markAsPurchased(itemId: string, purchased: boolean) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: claim, error: claimError } = await supabase
    .from("wishlist_claims")
    .select("id, occasion_id, occasions ( occasion_date )")
    .eq("item_id", itemId)
    .eq("claimed_by", userId)
    .is("released_at", null)
    .maybeSingle();

  if (claimError) {
    return { error: claimError.message };
  }

  // Same message for "no claim row" and "claim exists but has lapsed". The
  // caller is not entitled to learn which, and one message keeps this from
  // becoming an oracle about other people's claims -- the same reason
  // claim_wishlist_item() collapses its own two refusal paths into one raise.
  const refusal = {
    error: "Only the person who claimed this item can mark it purchased",
  };

  const claimRow = claim as
    | {
        id: string;
        occasion_id: string | null;
        occasions: { occasion_date: string } | null;
      }
    | null;

  if (claimRow === null) {
    return refusal;
  }

  const read = await readVisibleMarks(supabase, [itemId]);
  if ("error" in read) {
    return { error: read.error.message };
  }

  const holdsActiveClaim = isClaimActive(
    {
      occasionId: claimRow.occasion_id,
      occasionDate: claimRow.occasions?.occasion_date ?? null,
      itemPurchased: read.marks.get(itemId)?.purchased ?? false,
    },
    todayISO(),
  );

  if (!holdsActiveClaim) {
    return refusal;
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      purchased,
      purchased_at: purchased ? new Date().toISOString() : null,
    })
    .eq("id", itemId)
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: { id: item.id } };
}

/**
 * Mark a wishlist item as out of stock
 * Only visible to other viewers, not the item owner
 * The update asks back the item's id alone, and that id is the answer.
 */
export async function markOutOfStock(itemId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      out_of_stock_marked_by: userId,
      out_of_stock_marked_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .neq("user_id", userId) // Can't mark your own items
    .select("id")
    .single();

  if (error) {
    // `notFound`: no item was the caller's to mark -- their own (the .neq
    // above), one RLS hides from them, or one that is gone. PGRST116 is what
    // .single() returns when the update matched no row. Any other error is
    // infrastructure, not a missing item, as in getWishlistItem.
    return { error: error.message, notFound: error.code === "PGRST116" };
  }

  revalidatePath("/wishlist");
  return { data: { id: item.id } };
}

/**
 * Unmark a wishlist item as out of stock
 * The update asks back the item's id alone, and that id is the answer.
 */
export async function unmarkOutOfStock(itemId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Anyone who can view the item can unmark it (to report it's back in stock)
  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      out_of_stock_marked_by: null,
      out_of_stock_marked_at: null,
    })
    .eq("id", itemId)
    .neq("user_id", userId) // Can't modify your own items this way
    .select("id")
    .single();

  if (error) {
    // `notFound` as in markOutOfStock: the update matched no row (PGRST116).
    return { error: error.message, notFound: error.code === "PGRST116" };
  }

  revalidatePath("/wishlist");
  return { data: { id: item.id } };
}
