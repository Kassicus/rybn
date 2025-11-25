"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { RecipientFormData, TrackedGiftFormData, GiftStatus, GiftTrackingStats } from "@/lib/schemas/gift-tracking";

// =================================================================
// RECIPIENTS
// =================================================================

/**
 * Get all recipients for the current user
 */
export async function getMyRecipients(includeArchived: boolean = false) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  let query = supabase
    .from("gift_recipients")
    .select("*")
    .eq("user_id", user.id)
    .order("name");

  if (!includeArchived) {
    query = query.eq("is_archived", false);
  }

  const { data: recipients, error } = await query;

  if (error) {
    return { error: error.message };
  }

  return { data: recipients || [] };
}

/**
 * Get a single recipient by ID
 */
export async function getRecipientById(recipientId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: recipient, error } = await supabase
    .from("gift_recipients")
    .select("*")
    .eq("id", recipientId)
    .eq("user_id", user.id)
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data: recipient };
}

/**
 * Create a new recipient
 */
export async function createRecipient(formData: RecipientFormData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: recipient, error } = await supabase
    .from("gift_recipients")
    .insert({
      user_id: user.id,
      name: formData.name,
      notes: formData.notes || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "You already have a recipient with this name" };
    }
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  return { data: recipient };
}

/**
 * Update a recipient
 */
export async function updateRecipient(recipientId: string, formData: Partial<RecipientFormData>) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: recipient, error } = await supabase
    .from("gift_recipients")
    .update({
      ...formData,
      notes: formData.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recipientId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "You already have a recipient with this name" };
    }
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  revalidatePath(`/gift-tracker/${recipientId}`);
  return { data: recipient };
}

/**
 * Archive or unarchive a recipient
 */
export async function archiveRecipient(recipientId: string, archived: boolean = true) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: recipient, error } = await supabase
    .from("gift_recipients")
    .update({
      is_archived: archived,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recipientId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  return { data: recipient };
}

/**
 * Delete a recipient (and all their gifts via CASCADE)
 */
export async function deleteRecipient(recipientId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("gift_recipients")
    .delete()
    .eq("id", recipientId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  return { success: true };
}

// =================================================================
// TRACKED GIFTS
// =================================================================

/**
 * Get all gifts for a specific recipient
 */
export async function getGiftsForRecipient(recipientId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: gifts, error } = await supabase
    .from("tracked_gifts")
    .select("*")
    .eq("recipient_id", recipientId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { data: gifts || [] };
}

/**
 * Get all gifts for the current user with optional filtering
 */
export async function getAllMyGifts(filters?: {
  status?: GiftStatus;
  season_year?: number;
  is_archived?: boolean;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  let query = supabase
    .from("tracked_gifts")
    .select("*, gift_recipients(id, name)")
    .eq("user_id", user.id);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.season_year) {
    query = query.eq("season_year", filters.season_year);
  }

  if (filters?.is_archived !== undefined) {
    query = query.eq("is_archived", filters.is_archived);
  } else {
    query = query.eq("is_archived", false);
  }

  const { data: gifts, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { data: gifts || [] };
}

/**
 * Get a single gift by ID
 */
export async function getGiftById(giftId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: gift, error } = await supabase
    .from("tracked_gifts")
    .select("*, gift_recipients(id, name)")
    .eq("id", giftId)
    .eq("user_id", user.id)
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data: gift };
}

/**
 * Create a new tracked gift
 */
export async function createGift(formData: TrackedGiftFormData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: gift, error } = await supabase
    .from("tracked_gifts")
    .insert({
      user_id: user.id,
      recipient_id: formData.recipient_id,
      name: formData.name,
      description: formData.description || null,
      photo_url: formData.photo_url || null,
      product_link: formData.product_link || null,
      price: formData.price || null,
      status: formData.status || "planned",
      occasion: formData.occasion || null,
      season_year: formData.season_year || new Date().getFullYear(),
      notes: formData.notes || null,
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  revalidatePath(`/gift-tracker/${formData.recipient_id}`);
  return { data: gift };
}

/**
 * Update a tracked gift
 */
export async function updateGift(giftId: string, formData: Partial<TrackedGiftFormData>) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Build update object, handling empty strings as null
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (formData.name !== undefined) updateData.name = formData.name;
  if (formData.description !== undefined) updateData.description = formData.description || null;
  if (formData.photo_url !== undefined) updateData.photo_url = formData.photo_url || null;
  if (formData.product_link !== undefined) updateData.product_link = formData.product_link || null;
  if (formData.price !== undefined) updateData.price = formData.price || null;
  if (formData.status !== undefined) updateData.status = formData.status;
  if (formData.occasion !== undefined) updateData.occasion = formData.occasion || null;
  if (formData.season_year !== undefined) updateData.season_year = formData.season_year;
  if (formData.notes !== undefined) updateData.notes = formData.notes || null;
  if (formData.recipient_id !== undefined) updateData.recipient_id = formData.recipient_id;

  const { data: gift, error } = await supabase
    .from("tracked_gifts")
    .update(updateData)
    .eq("id", giftId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  return { data: gift };
}

/**
 * Update just the status of a gift (convenience method)
 */
export async function updateGiftStatus(giftId: string, status: GiftStatus) {
  return updateGift(giftId, { status });
}

/**
 * Archive or unarchive a gift
 */
export async function archiveGift(giftId: string, archived: boolean = true) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: gift, error } = await supabase
    .from("tracked_gifts")
    .update({
      is_archived: archived,
      updated_at: new Date().toISOString(),
    })
    .eq("id", giftId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  return { data: gift };
}

/**
 * Archive all gifts for a specific season/year
 */
export async function archiveSeasonGifts(seasonYear: number) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: gifts, error } = await supabase
    .from("tracked_gifts")
    .update({
      is_archived: true,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("season_year", seasonYear)
    .in("status", ["wrapped", "given"]) // Archive completed gifts (wrapped or given)
    .select();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  return { data: gifts, count: gifts?.length || 0 };
}

/**
 * Delete a tracked gift
 */
export async function deleteGift(giftId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("tracked_gifts")
    .delete()
    .eq("id", giftId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-tracker");
  return { success: true };
}

// =================================================================
// STATS & SUMMARIES
// =================================================================

/**
 * Get gift tracking statistics for the current user
 */
export async function getGiftTrackingStats(seasonYear?: number): Promise<{ data?: GiftTrackingStats; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Get all non-archived gifts
  let query = supabase
    .from("tracked_gifts")
    .select("price, status")
    .eq("user_id", user.id)
    .eq("is_archived", false);

  if (seasonYear) {
    query = query.eq("season_year", seasonYear);
  }

  const { data: gifts, error: giftsError } = await query;

  if (giftsError) {
    return { error: giftsError.message };
  }

  // Get recipient count
  const { count: recipientCount, error: recipientError } = await supabase
    .from("gift_recipients")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_archived", false);

  if (recipientError) {
    return { error: recipientError.message };
  }

  // Calculate stats
  const stats: GiftTrackingStats = {
    totalCost: 0,
    giftCount: gifts?.length || 0,
    recipientCount: recipientCount || 0,
    byStatus: {
      planned: { count: 0, total: 0 },
      ordered: { count: 0, total: 0 },
      arrived: { count: 0, total: 0 },
      wrapped: { count: 0, total: 0 },
      given: { count: 0, total: 0 },
    },
  };

  gifts?.forEach((gift) => {
    const price = gift.price || 0;
    // Only count toward total cost if gift has been ordered (not just planned)
    if (gift.status !== "planned") {
      stats.totalCost += price;
    }
    stats.byStatus[gift.status as keyof typeof stats.byStatus].count += 1;
    stats.byStatus[gift.status as keyof typeof stats.byStatus].total += price;
  });

  return { data: stats };
}

/**
 * Get recipients with their gift counts and totals
 */
export async function getRecipientsWithStats(includeArchived: boolean = false) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Get recipients
  let recipientQuery = supabase
    .from("gift_recipients")
    .select("*")
    .eq("user_id", user.id)
    .order("name");

  if (!includeArchived) {
    recipientQuery = recipientQuery.eq("is_archived", false);
  }

  const { data: recipients, error: recipientError } = await recipientQuery;

  if (recipientError) {
    return { error: recipientError.message };
  }

  // Get all gifts for these recipients
  let giftQuery = supabase
    .from("tracked_gifts")
    .select("recipient_id, price, status")
    .eq("user_id", user.id);

  if (!includeArchived) {
    giftQuery = giftQuery.eq("is_archived", false);
  }

  const { data: gifts, error: giftsError } = await giftQuery;

  if (giftsError) {
    return { error: giftsError.message };
  }

  // Calculate stats per recipient
  const recipientsWithStats = recipients?.map((recipient) => {
    const recipientGifts = gifts?.filter((g) => g.recipient_id === recipient.id) || [];
    // Only count spending for gifts that have been ordered (not just planned)
    const totalSpent = recipientGifts
      .filter((g) => g.status !== "planned")
      .reduce((sum, g) => sum + (g.price || 0), 0);
    const giftCount = recipientGifts.length;
    // Count wrapped and given as complete (wrapped = ready to give)
    const completedCount = recipientGifts.filter((g) => g.status === "wrapped" || g.status === "given").length;

    return {
      ...recipient,
      giftCount,
      totalSpent,
      completedCount,
    };
  });

  return { data: recipientsWithStats || [] };
}

/**
 * Get available season years for filtering
 */
export async function getAvailableSeasons() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  const { data: seasons, error } = await supabase
    .from("tracked_gifts")
    .select("season_year")
    .eq("user_id", user.id)
    .order("season_year", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  // Get unique years
  const uniqueYears = [...new Set(seasons?.map((s) => s.season_year))];

  return { data: uniqueYears };
}
