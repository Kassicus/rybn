"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { GiftExchangeFormData, ParticipantUpdateData } from "@/lib/schemas/gift-exchange";
import { generateAssignments, type Participant } from "@/lib/utils/gift-exchange";

/**
 * Create a new gift exchange
 */
export async function createGiftExchange(formData: GiftExchangeFormData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member of the group
  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", formData.group_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of this group to create a gift exchange" };
  }

  // Create the gift exchange
  const { data: exchange, error: exchangeError } = await supabase
    .from("gift_exchanges")
    .insert({
      name: formData.name,
      description: formData.description || null,
      group_id: formData.group_id,
      exchange_type: formData.exchange_type,
      budget_min: formData.budget_min || null,
      budget_max: formData.budget_max || null,
      exchange_date: formData.exchange_date || null,
      exchange_location: formData.exchange_location || null,
      exchange_details: formData.exchange_details || null,
      registration_deadline: formData.registration_deadline || null,
      is_active: formData.is_active,
      assignments_generated: false,
      created_by: user.id,
    })
    .select()
    .single();

  if (exchangeError) {
    return { error: exchangeError.message };
  }

  // Auto-join the creator as a participant
  const { error: participantError } = await supabase
    .from("gift_exchange_participants")
    .insert({
      exchange_id: exchange.id,
      user_id: user.id,
      opted_in: true,
    });

  if (participantError) {
    // Clean up the exchange if adding participant fails
    await supabase.from("gift_exchanges").delete().eq("id", exchange.id);
    return { error: "Failed to create participant record" };
  }

  revalidatePath("/gift-exchange");
  revalidatePath(`/groups/${formData.group_id}`);

  return { data: exchange };
}

/**
 * Get all gift exchanges for a group
 */
export async function getGiftExchangesByGroup(groupId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member of the group
  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of this group" };
  }

  // Get all gift exchanges for this group
  const { data: exchanges, error } = await supabase
    .from("gift_exchanges")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { data: exchanges || [] };
}

/**
 * Get a specific gift exchange with participants
 */
export async function getGiftExchangeById(exchangeId: string) {
  // Use regular client for auth, admin client for data (to bypass RLS recursion)
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get gift exchange using admin client (bypasses RLS)
  const { data: exchange, error: exchangeError } = await adminClient
    .from("gift_exchanges")
    .select("*")
    .eq("id", exchangeId)
    .single();

  if (exchangeError) {
    return { error: exchangeError.message };
  }

  // Verify user is a member of the group using admin client
  const { data: membership } = await adminClient
    .from("group_members")
    .select("id")
    .eq("group_id", exchange.group_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of the group" };
  }

  // Get all participants using admin client (bypasses self-referencing RLS)
  const { data: participants, error: participantsError } = await adminClient
    .from("gift_exchange_participants")
    .select("*")
    .eq("exchange_id", exchangeId);

  if (participantsError) {
    return { error: participantsError.message };
  }

  // Get user profiles for all participants using admin client
  const participantIds = participants.map((p) => p.user_id);
  const { data: profiles } = await adminClient
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", participantIds);

  // Combine participants with their profiles
  const participantsWithProfiles = participants.map((participant) => ({
    ...participant,
    user_profiles: profiles?.find((p) => p.id === participant.user_id) || null,
  }));

  // Get current user's participation
  const myParticipation = participants.find((p) => p.user_id === user.id);

  return {
    data: {
      ...exchange,
      participants: participantsWithProfiles,
      my_participation: myParticipation,
    },
  };
}

/**
 * Join a gift exchange
 */
export async function joinGiftExchange(exchangeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Check if exchange exists and is active
  const { data: exchange } = await supabase
    .from("gift_exchanges")
    .select("id, group_id, is_active, registration_deadline, assignments_generated")
    .eq("id", exchangeId)
    .single();

  if (!exchange) {
    return { error: "Gift exchange not found" };
  }

  if (!exchange.is_active) {
    return { error: "This gift exchange is no longer active" };
  }

  if (exchange.assignments_generated) {
    return { error: "Cannot join after assignments have been generated" };
  }

  // Check registration deadline
  if (exchange.registration_deadline) {
    const deadline = new Date(exchange.registration_deadline);
    if (new Date() > deadline) {
      return { error: "Registration deadline has passed" };
    }
  }

  // Verify user is a member of the group
  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", exchange.group_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of the group" };
  }

  // Join the exchange
  const { error } = await supabase
    .from("gift_exchange_participants")
    .insert({
      exchange_id: exchangeId,
      user_id: user.id,
      opted_in: true,
    });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gift-exchange/${exchangeId}`);

  return { success: true };
}

/**
 * Leave a gift exchange
 */
export async function leaveGiftExchange(exchangeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Check if assignments have been generated
  const { data: exchange } = await supabase
    .from("gift_exchanges")
    .select("assignments_generated")
    .eq("id", exchangeId)
    .single();

  if (exchange?.assignments_generated) {
    return { error: "Cannot leave after assignments have been generated" };
  }

  // Leave the exchange
  const { error } = await supabase
    .from("gift_exchange_participants")
    .delete()
    .eq("exchange_id", exchangeId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gift-exchange/${exchangeId}`);

  return { success: true };
}

/**
 * Generate assignments for a gift exchange
 */
export async function generateGiftExchangeAssignments(exchangeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator
  const { data: exchange } = await supabase
    .from("gift_exchanges")
    .select("created_by, assignments_generated")
    .eq("id", exchangeId)
    .single();

  if (!exchange || exchange.created_by !== user.id) {
    return { error: "Only the creator can generate assignments" };
  }

  if (exchange.assignments_generated) {
    return { error: "Assignments have already been generated" };
  }

  // Get participants
  const { data: participants } = await supabase
    .from("gift_exchange_participants")
    .select("id, user_id")
    .eq("exchange_id", exchangeId)
    .eq("opted_in", true);

  if (!participants || participants.length < 3) {
    return { error: "Need at least 3 opted-in participants" };
  }

  // Generate assignments
  const result = generateAssignments(participants as Participant[], {});

  if (!result.success) {
    return { error: result.error || "Failed to generate assignments" };
  }

  // Use admin client to update assignments
  const adminClient = createAdminClient();

  // Update each participant with their assignment
  for (const [userId, assignedToUserId] of result.assignments) {
    const participant = participants.find((p) => p.user_id === userId);
    if (!participant) continue;

    await adminClient
      .from("gift_exchange_participants")
      .update({ assigned_to: assignedToUserId })
      .eq("id", participant.id);
  }

  // Mark assignments as generated
  await supabase
    .from("gift_exchanges")
    .update({ assignments_generated: true })
    .eq("id", exchangeId);

  revalidatePath(`/gift-exchange/${exchangeId}`);

  return { success: true, participantCount: participants.length };
}

/**
 * Get my assignment (who I should give a gift to)
 */
export async function getMyAssignment(exchangeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get my participation
  const { data: participation } = await supabase
    .from("gift_exchange_participants")
    .select("assigned_to")
    .eq("exchange_id", exchangeId)
    .eq("user_id", user.id)
    .single();

  if (!participation || !participation.assigned_to) {
    return { data: null };
  }

  // Get the assigned user's profile
  const { data: assignedUser } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", participation.assigned_to)
    .single();

  return { data: assignedUser };
}

/**
 * Update my participation status
 */
export async function updateMyParticipation(
  exchangeId: string,
  data: Partial<ParticipantUpdateData>
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Update participation
  const { error } = await supabase
    .from("gift_exchange_participants")
    .update(data)
    .eq("exchange_id", exchangeId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gift-exchange/${exchangeId}`);

  return { success: true };
}

/**
 * Delete a gift exchange (creator only)
 */
export async function deleteGiftExchange(exchangeId: string) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator using admin client
  const { data: exchange } = await adminClient
    .from("gift_exchanges")
    .select("created_by, group_id")
    .eq("id", exchangeId)
    .single();

  if (!exchange || exchange.created_by !== user.id) {
    return { error: "Only the creator can delete this gift exchange" };
  }

  // Delete the gift exchange using admin client (cascade will handle participants)
  const { error } = await adminClient
    .from("gift_exchanges")
    .delete()
    .eq("id", exchangeId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gift-exchange");
  revalidatePath(`/groups/${exchange.group_id}`);

  return { success: true };
}
