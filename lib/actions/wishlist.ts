"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { WishlistItemFormData } from "@/lib/schemas/wishlist";

/**
 * Get the current user's wishlist
 * Note: Claim data is stripped since owners should not see who claimed their items
 */
export async function getMyWishlist() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: items, error } = await supabase
    .from("wishlist_items")
    .select("*")
    .eq("user_id", user.id)
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

  return { data: sanitizedItems || [] };
}

/**
 * Get another user's wishlist (filtered by privacy)
 * Returns currentUserId for UI to determine claim permissions
 */
export async function getUserWishlist(userId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
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
  const isOwnWishlist = user.id === userId;
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

  return { data: sanitizedItems || [], currentUserId: user.id };
}

/**
 * Create a new wishlist item
 */
export async function createWishlistItem(formData: WishlistItemFormData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .insert({
      user_id: user.id,
      title: formData.title,
      description: formData.description || null,
      url: formData.url || null,
      price: formData.price || null,
      image_url: formData.image_url || null,
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
  return { data: item };
}

/**
 * Update a wishlist item
 */
export async function updateWishlistItem(itemId: string, formData: WishlistItemFormData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      title: formData.title,
      description: formData.description || null,
      url: formData.url || null,
      price: formData.price || null,
      image_url: formData.image_url || null,
      priority: formData.priority,
      category: formData.category || null,
      privacy_settings: {
        visibleToGroupTypes: formData.visible_to_group_types || ['family', 'friends', 'work', 'custom'],
        restrictToGroup: formData.restrict_to_group || null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("user_id", user.id) // Extra security check
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  revalidatePath(`/wishlist/${itemId}`);
  return { data: item };
}

/**
 * Delete a wishlist item
 */
export async function deleteWishlistItem(itemId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("wishlist_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", user.id); // Extra security check

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

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
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
  const isOwnItem = item.user_id === user.id;
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

  return { data: sanitizedItem, currentUserId: user.id };
}

/**
 * Claim a wishlist item (mark that you're buying it)
 */
export async function claimWishlistItem(itemId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      claimed_by: user.id,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .neq("user_id", user.id) // Can't claim your own items
    .is("claimed_by", null) // Item must not already be claimed
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: item };
}

/**
 * Unclaim a wishlist item
 */
export async function unclaimWishlistItem(itemId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      claimed_by: null,
      claimed_at: null,
    })
    .eq("id", itemId)
    .eq("claimed_by", user.id) // Can only unclaim your own claims
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: item };
}

/**
 * Mark a wishlist item as purchased
 */
export async function markAsPurchased(itemId: string, purchased: boolean) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      purchased,
      purchased_at: purchased ? new Date().toISOString() : null,
    })
    .eq("id", itemId)
    .eq("claimed_by", user.id) // Only the claimer can mark as purchased
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: item };
}

/**
 * Get the profile of a user who claimed an item
 * Used to display who claimed a gift to other viewers
 */
export async function getClaimerProfile(claimedById: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
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

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
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

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: item, error } = await supabase
    .from("wishlist_items")
    .update({
      out_of_stock_marked_by: user.id,
      out_of_stock_marked_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .neq("user_id", user.id) // Can't mark your own items
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: item };
}

/**
 * Unmark a wishlist item as out of stock
 */
export async function unmarkOutOfStock(itemId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
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
    .neq("user_id", user.id) // Can't modify your own items this way
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/wishlist");
  return { data: item };
}
