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
 * Note: Claim data is stripped since owners should not see who claimed their items
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

  // Strip claim/stock data - owners should never see who claimed or marked their items
  const sanitizedItems = items?.map((item) => ({
    ...item,
    claimed_by: null,
    claimed_at: null,
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

  // If viewing own wishlist through this route, strip claim/stock data
  const isOwnWishlist = currentUserId === userId;
  const sanitizedItems = isOwnWishlist
    ? items?.map((item) => ({
        ...item,
        claimed_by: null,
        claimed_at: null,
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
    return { error: "Not authenticated" };
  }

  // RLS handles privacy filtering
  const { data: item, error } = await supabase
    .from("wishlist_items")
    .select("*")
    .eq("id", itemId)
    .single();

  if (error) {
    return { error: error.message };
  }

  // If viewing own item, strip claim/stock data
  const isOwnItem = item.user_id === userId;
  const sanitizedItem = isOwnItem
    ? {
        ...item,
        claimed_by: null,
        claimed_at: null,
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
 * Claim a wishlist item (mark that you're buying it)
 */
export async function claimWishlistItem(itemId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      claimed_by: userId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .neq("user_id", userId) // Can't claim your own items
    .is("claimed_by", null) // Item must not already be claimed
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(item, userId) };
}

/**
 * Unclaim a wishlist item
 */
export async function unclaimWishlistItem(itemId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      claimed_by: null,
      claimed_at: null,
    })
    .eq("id", itemId)
    .eq("claimed_by", userId) // Can only unclaim your own claims
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(item, userId) };
}

/**
 * Mark a wishlist item as purchased
 */
export async function markAsPurchased(itemId: string, purchased: boolean) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      purchased,
      purchased_at: purchased ? new Date().toISOString() : null,
    })
    .eq("id", itemId)
    .eq("claimed_by", userId) // Only the claimer can mark as purchased
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: await withSignedWishlistImage(item, userId) };
}

/**
 * Get the profile of a user who claimed an item
 * Used to display who claimed a gift to other viewers
 */
export async function getClaimerProfile(claimedById: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", claimedById)
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data: profile };
}

/**
 * Get profiles for multiple claimers (batch fetch)
 * Used to efficiently fetch claimer info for all claimed items on a wishlist
 */
export async function getClaimerProfiles(claimerIds: string[]) {
  if (claimerIds.length === 0) {
    return { data: {} };
  }

  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", claimerIds);

  if (error) {
    return { error: error.message };
  }

  // Convert to a map for easy lookup
  const profileMap: Record<string, typeof profiles[0]> = {};
  profiles?.forEach((profile) => {
    profileMap[profile.id] = profile;
  });

  return { data: profileMap };
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
