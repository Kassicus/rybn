"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { WishlistItemFormData } from "@/lib/schemas/wishlist";

/**
 * Get the current user's wishlist
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

  return { data: items || [] };
}

/**
 * Get another user's wishlist (filtered by privacy)
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

  return { data: items || [] };
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

  return { data: item };
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
