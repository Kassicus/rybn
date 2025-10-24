"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { GiftGroupFormData, ContributionUpdateData } from "@/lib/schemas/gifts";

/**
 * Create a new gift coordination group
 */
export async function createGiftGroup(formData: GiftGroupFormData) {
  // Use regular client for auth check
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
    return { error: "You must be a member of this group to create a gift group" };
  }

  // Use admin client to create the gift group (bypasses RLS)
  // This is safe because we've already validated the user above
  const adminClient = createAdminClient();

  const { data: giftGroup, error: giftGroupError } = await adminClient
    .from("gift_groups")
    .insert({
      name: formData.name,
      description: formData.description || null,
      group_id: formData.group_id,
      target_user_id: formData.target_user_id || null,
      target_amount: formData.target_amount || null,
      is_active: formData.is_active,
      created_by: user.id,
    })
    .select()
    .single();

  if (giftGroupError) {
    return { error: giftGroupError.message };
  }

  // Auto-add the creator as a member using admin client
  const { error: memberError } = await adminClient
    .from("gift_group_members")
    .insert({
      gift_group_id: giftGroup.id,
      user_id: user.id,
      contribution_amount: 0,
      has_paid: false,
    });

  if (memberError) {
    // If adding member fails, try to clean up the gift group
    await adminClient.from("gift_groups").delete().eq("id", giftGroup.id);
    return { error: "Failed to create gift group membership" };
  }

  revalidatePath("/gifts");
  revalidatePath(`/groups/${formData.group_id}`);

  return { data: giftGroup };
}

/**
 * Get all gift groups the user is a member of
 */
export async function getMyGiftGroups() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: [] };
  }

  // Get gift groups where user is a member
  const { data: memberships, error } = await supabase
    .from("gift_group_members")
    .select(`
      gift_group_id,
      contribution_amount,
      has_paid,
      joined_at,
      gift_groups (
        id,
        name,
        description,
        group_id,
        target_user_id,
        target_amount,
        current_amount,
        is_active,
        created_by,
        created_at
      )
    `)
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false });

  if (error) {
    return { error: error.message, data: [] };
  }

  // Transform the data
  const giftGroups = memberships?.map((m) => ({
    ...m.gift_groups,
    my_contribution: m.contribution_amount,
    my_has_paid: m.has_paid,
    my_joined_at: m.joined_at,
  })) || [];

  return { data: giftGroups };
}

/**
 * Get gift groups for a specific group
 */
export async function getGiftGroupsByGroup(groupId: string) {
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

  // Get all gift groups for this group
  const { data: giftGroups, error } = await supabase
    .from("gift_groups")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { data: giftGroups || [] };
}

/**
 * Get a specific gift group with members and messages
 */
export async function getGiftGroupById(giftGroupId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get gift group
  const { data: giftGroup, error: giftGroupError } = await supabase
    .from("gift_groups")
    .select("*")
    .eq("id", giftGroupId)
    .single();

  if (giftGroupError) {
    return { error: giftGroupError.message };
  }

  // Check if user is a member
  const { data: membership } = await supabase
    .from("gift_group_members")
    .select("*")
    .eq("gift_group_id", giftGroupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You are not a member of this gift group" };
  }

  // Get all members
  const { data: members, error: membersError } = await supabase
    .from("gift_group_members")
    .select("id, user_id, contribution_amount, has_paid, joined_at")
    .eq("gift_group_id", giftGroupId);

  if (membersError) {
    return { error: membersError.message };
  }

  // Get user profiles for all members
  const memberIds = members.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", memberIds);

  // Combine members with their profiles
  const membersWithProfiles = members.map((member) => ({
    ...member,
    user_profiles: profiles?.find((p) => p.id === member.user_id) || null,
  }));

  return {
    data: {
      ...giftGroup,
      gift_group_members: membersWithProfiles,
      my_membership: membership,
    },
  };
}

/**
 * Update user's contribution to a gift group
 */
export async function updateMyContribution(
  giftGroupId: string,
  data: ContributionUpdateData
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Update the membership
  const { error } = await supabase
    .from("gift_group_members")
    .update({
      contribution_amount: data.contribution_amount,
      has_paid: data.has_paid,
    })
    .eq("gift_group_id", giftGroupId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${giftGroupId}`);
  revalidatePath("/gifts");

  return { success: true };
}

/**
 * Add members to a gift group
 */
export async function addMembersToGiftGroup(giftGroupId: string, userIds: string[]) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator of the gift group
  const { data: giftGroup } = await supabase
    .from("gift_groups")
    .select("created_by")
    .eq("id", giftGroupId)
    .single();

  if (!giftGroup || giftGroup.created_by !== user.id) {
    return { error: "Only the creator can add members to this gift group" };
  }

  // Add members
  const membersToAdd = userIds.map((userId) => ({
    gift_group_id: giftGroupId,
    user_id: userId,
    contribution_amount: 0,
    has_paid: false,
  }));

  const { error } = await supabase
    .from("gift_group_members")
    .insert(membersToAdd);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${giftGroupId}`);

  return { success: true };
}

/**
 * Leave a gift group
 */
export async function leaveGiftGroup(giftGroupId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Check if user is the creator
  const { data: giftGroup } = await supabase
    .from("gift_groups")
    .select("created_by")
    .eq("id", giftGroupId)
    .single();

  if (giftGroup?.created_by === user.id) {
    return { error: "Creators cannot leave the gift group. Delete the group instead." };
  }

  // Remove the member
  const { error } = await supabase
    .from("gift_group_members")
    .delete()
    .eq("gift_group_id", giftGroupId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gifts");
  return { success: true };
}

/**
 * Delete a gift group (creator only)
 */
export async function deleteGiftGroup(giftGroupId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator
  const { data: giftGroup } = await supabase
    .from("gift_groups")
    .select("created_by, group_id")
    .eq("id", giftGroupId)
    .single();

  if (!giftGroup || giftGroup.created_by !== user.id) {
    return { error: "Only the creator can delete this gift group" };
  }

  // Delete the gift group (cascade will handle members and messages)
  const { error } = await supabase
    .from("gift_groups")
    .delete()
    .eq("id", giftGroupId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gifts");
  revalidatePath(`/groups/${giftGroup.group_id}`);

  return { success: true };
}

/**
 * Update gift group details (creator only)
 */
export async function updateGiftGroup(
  giftGroupId: string,
  updates: Partial<GiftGroupFormData>
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator
  const { data: giftGroup } = await supabase
    .from("gift_groups")
    .select("created_by")
    .eq("id", giftGroupId)
    .single();

  if (!giftGroup || giftGroup.created_by !== user.id) {
    return { error: "Only the creator can update this gift group" };
  }

  // Update the gift group
  const { error } = await supabase
    .from("gift_groups")
    .update(updates)
    .eq("id", giftGroupId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${giftGroupId}`);
  revalidatePath("/gifts");

  return { success: true };
}
