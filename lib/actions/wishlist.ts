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

/**
 * INVARIANT for this file: every wishlist_items row that leaves a server action
 * has passed through withSignedWishlistImage(s).
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
 */

/**
 * Get the current user's wishlist
 * Note: purchase/stock data is stripped since owners should not see whether
 * or by whom their items were marked purchased or out of stock. Claim data
 * needs no stripping here -- see the comment inside this function.
 */
export async function getMyWishlist() {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: items, error } = await supabase
    .from("wishlist_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  // Strip purchase/stock data - owners should never see whether or by whom
  // their items were marked purchased or out of stock. Claim data no longer
  // needs stripping here at all: claimed_by/claimed_at left wishlist_items
  // in 20260911100003_drop_item_claim_columns.sql, and owner-blindness for
  // claims is now enforced structurally by wishlist_claims' own SELECT
  // policy (it excludes the item's owner outright), not by this function
  // remembering to null out two columns that no longer exist.
  const sanitizedItems = items?.map((item) => ({
    ...item,
    purchased: false,
    purchased_at: null,
    out_of_stock_marked_by: null,
    out_of_stock_marked_at: null,
  }));

  return { data: await withSignedWishlistImages(sanitizedItems || [], userId) };
}

/**
 * Get another user's wishlist (filtered by privacy)
 * Returns currentUserId for UI to determine claim permissions
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
    .select("*")
    .eq("user_id", userId)
    .order("priority", { ascending: false }) // Show high priority first
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  // If viewing own wishlist through this route, strip purchase/stock data.
  // No claimed_by/claimed_at left to strip -- see getMyWishlist's comment.
  const isOwnWishlist = currentUserId === userId;
  const sanitizedItems = isOwnWishlist
    ? items?.map((item) => ({
        ...item,
        purchased: false,
        purchased_at: null,
        out_of_stock_marked_by: null,
        out_of_stock_marked_at: null,
      }))
    : items;

  return {
    data: await withSignedWishlistImages(sanitizedItems || [], currentUserId),
    currentUserId,
  };
}

/**
 * Create a new wishlist item
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
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(item, userId) };
}

/**
 * Update a wishlist item
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
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  revalidatePath(`/wishlist/${itemId}`);
  return { data: await withSignedWishlistImage(item, userId) };
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
    .select("*")
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

  // If viewing own item, strip purchase/stock data. No claimed_by/claimed_at
  // left to strip -- see getMyWishlist's comment.
  const isOwnItem = item.user_id === userId;
  const sanitizedItem = isOwnItem
    ? {
        ...item,
        purchased: false,
        purchased_at: null,
        out_of_stock_marked_by: null,
        out_of_stock_marked_at: null,
      }
    : item;

  return {
    data: await withSignedWishlistImage(sanitizedItem, userId),
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
 * record its purchase state. This used to be `.eq("claimed_by", userId)`
 * against wishlist_items -- that column is gone, so the same rule is now
 * checked against where the fact actually lives: a wishlist_claims row for
 * this item, this caller, with released_at is null. It is the same
 * authorization, re-pointed at the new source of truth, not a weaker one --
 * the RLS layer alone would not stop this: "Users can claim visible
 * wishlist items" (the policy still governing this UPDATE, per that
 * migration's own comment) admits any non-owner who can see the item, and
 * the pin_wishlist_item_owner_fields trigger only restricts WHICH columns a
 * non-owner may touch, not WHICH non-owner. Skipping this check would let
 * any co-member who can see the item mark somebody else's claim purchased.
 *
 * The claimer can always read their own claim row here: wishlist_claims'
 * SELECT policy admits any row on an item the caller can still see, and a
 * caller holding an active claim on an item can, by construction, see it.
 */
export async function markAsPurchased(itemId: string, purchased: boolean) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: claim, error: claimError } = await supabase
    .from("wishlist_claims")
    .select("id")
    .eq("item_id", itemId)
    .eq("claimed_by", userId)
    .is("released_at", null)
    .maybeSingle();

  if (claimError) {
    return { error: claimError.message };
  }

  if (!claim) {
    return {
      error: "Only the person who claimed this item can mark it purchased",
    };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      purchased,
      purchased_at: purchased ? new Date().toISOString() : null,
    })
    .eq("id", itemId)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(item, userId) };
}

/**
 * Mark a wishlist item as out of stock
 * Only visible to other viewers, not the item owner
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
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(item, userId) };
}

/**
 * Unmark a wishlist item as out of stock
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
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(item, userId) };
}
