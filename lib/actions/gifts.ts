"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { GroupGiftFormData, ContributionUpdateData } from "@/lib/schemas/gifts";

/**
 * Create a new group gift
 */
export async function createGroupGift(formData: GroupGiftFormData) {
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
    return { error: "You must be a member of this group to create a group gift" };
  }

  // Use admin client to create the group gift (bypasses RLS)
  // This is safe because we've already validated the user above
  const adminClient = createAdminClient();

  const { data: groupGift, error: groupGiftError } = await adminClient
    .from("group_gifts")
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

  if (groupGiftError) {
    return { error: groupGiftError.message };
  }

  // Auto-add the creator as a member using admin client
  const { error: memberError } = await adminClient
    .from("group_gift_members")
    .insert({
      group_gift_id: groupGift.id,
      user_id: user.id,
      contribution_amount: 0,
      has_paid: false,
    });

  if (memberError) {
    // If adding member fails, try to clean up the group gift
    await adminClient.from("group_gifts").delete().eq("id", groupGift.id);
    return { error: "Failed to create group gift membership" };
  }

  revalidatePath("/gifts");
  revalidatePath(`/groups/${formData.group_id}`);

  return { data: groupGift };
}

/**
 * Get all group gifts the user is a member of
 */
export async function getMyGroupGifts() {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: [] };
  }

  // Get group gifts where user is a member using admin client
  const { data: memberships, error } = await adminClient
    .from("group_gift_members")
    .select(`
      group_gift_id,
      contribution_amount,
      has_paid,
      joined_at,
      group_gifts (
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
  const groupGifts = memberships?.map((m) => ({
    ...m.group_gifts,
    my_contribution: m.contribution_amount,
    my_has_paid: m.has_paid,
    my_joined_at: m.joined_at,
  })) || [];

  return { data: groupGifts };
}

/**
 * Get group gifts for a specific group
 */
export async function getGroupGiftsByGroup(groupId: string) {
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

  // Get all group gifts for this group
  const { data: groupGifts, error } = await supabase
    .from("group_gifts")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { data: groupGifts || [] };
}

/**
 * Get a specific group gift with members and messages
 */
export async function getGroupGiftById(groupGiftId: string) {
  // Use regular client for auth, admin client for data (to bypass RLS recursion)
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get group gift using admin client (bypasses RLS)
  const { data: groupGift, error: groupGiftError } = await adminClient
    .from("group_gifts")
    .select("*")
    .eq("id", groupGiftId)
    .single();

  if (groupGiftError) {
    return { error: groupGiftError.message };
  }

  // Check if user is a member using admin client
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("*")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You are not a member of this group gift" };
  }

  // Get all members using admin client (to see all members, not just yourself)
  const { data: members, error: membersError } = await adminClient
    .from("group_gift_members")
    .select("id, user_id, contribution_amount, has_paid, joined_at")
    .eq("group_gift_id", groupGiftId);

  if (membersError) {
    return { error: membersError.message };
  }

  // Get user profiles for all members using admin client
  const memberIds = members.map((m) => m.user_id);
  const { data: profiles } = await adminClient
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
      ...groupGift,
      group_gift_members: membersWithProfiles,
      my_membership: membership,
    },
  };
}

/**
 * Update user's contribution to a group gift
 */
export async function updateMyContribution(
  groupGiftId: string,
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
    .from("group_gift_members")
    .update({
      contribution_amount: data.contribution_amount,
      has_paid: data.has_paid,
    })
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${groupGiftId}`);
  revalidatePath("/gifts");

  return { success: true };
}

/**
 * Add members to a group gift
 * Any member of the group gift can invite users from groups they share with
 */
export async function addMembersToGroupGift(groupGiftId: string, userIds: string[]) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member OR creator of the group gift (using admin client to avoid RLS recursion)
  const { data: groupGift } = await adminClient
    .from("group_gifts")
    .select("created_by, group_id")
    .eq("id", groupGiftId)
    .single();

  if (!groupGift) {
    return { error: "Group gift not found" };
  }

  // Check if user is creator or member
  const isCreator = groupGift.created_by === user.id;
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isCreator && !membership) {
    return { error: "You must be a member of this group gift to invite others" };
  }

  // Get all groups the inviter is a member of
  const { data: inviterGroups } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);

  if (!inviterGroups || inviterGroups.length === 0) {
    return { error: "You are not a member of any groups" };
  }

  const inviterGroupIds = inviterGroups.map(g => g.group_id);

  // Verify all users being invited are from groups the inviter shares
  const { data: inviteeGroupMemberships } = await supabase
    .from("group_members")
    .select("user_id, group_id")
    .in("user_id", userIds)
    .in("group_id", inviterGroupIds);

  if (!inviteeGroupMemberships) {
    return { error: "Failed to verify user memberships" };
  }

  // Check that each user being invited shares at least one group with the inviter
  const validUserIds = new Set(inviteeGroupMemberships.map(m => m.user_id));
  const invalidUsers = userIds.filter(userId => !validUserIds.has(userId));

  if (invalidUsers.length > 0) {
    return { error: "You can only invite users from groups you're a member of" };
  }

  // Add members using admin client to avoid RLS recursion
  const membersToAdd = userIds.map((userId) => ({
    group_gift_id: groupGiftId,
    user_id: userId,
    contribution_amount: 0,
    has_paid: false,
  }));

  const { error } = await adminClient
    .from("group_gift_members")
    .insert(membersToAdd);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${groupGiftId}`);

  return { success: true };
}

/**
 * Leave a group gift
 */
export async function leaveGroupGift(groupGiftId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Check if user is the creator
  const { data: groupGift } = await supabase
    .from("group_gifts")
    .select("created_by")
    .eq("id", groupGiftId)
    .single();

  if (groupGift?.created_by === user.id) {
    return { error: "Creators cannot leave the group gift. Delete it instead." };
  }

  // Remove the member
  const { error } = await supabase
    .from("group_gift_members")
    .delete()
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gifts");
  return { success: true };
}

/**
 * Delete a group gift (creator only)
 */
export async function deleteGroupGift(groupGiftId: string) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator using admin client
  const { data: groupGift } = await adminClient
    .from("group_gifts")
    .select("created_by, group_id")
    .eq("id", groupGiftId)
    .single();

  if (!groupGift || groupGift.created_by !== user.id) {
    return { error: "Only the creator can delete this group gift" };
  }

  // Delete the group gift using admin client (cascade will handle members and messages)
  const { error } = await adminClient
    .from("group_gifts")
    .delete()
    .eq("id", groupGiftId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gifts");
  revalidatePath(`/groups/${groupGift.group_id}`);

  return { success: true };
}

/**
 * Update group gift details (creator only)
 */
export async function updateGroupGift(
  groupGiftId: string,
  updates: Partial<GroupGiftFormData>
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator
  const { data: groupGift } = await supabase
    .from("group_gifts")
    .select("created_by")
    .eq("id", groupGiftId)
    .single();

  if (!groupGift || groupGift.created_by !== user.id) {
    return { error: "Only the creator can update this group gift" };
  }

  // Update the group gift
  const { error } = await supabase
    .from("group_gifts")
    .update(updates)
    .eq("id", groupGiftId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${groupGiftId}`);
  revalidatePath("/gifts");

  return { success: true };
}

/**
 * Get available users from all groups the current user is in who can be invited to the group gift
 * Any member of the group gift can invite users from groups they share with
 */
export async function getAvailableGroupMembers(groupGiftId: string) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get the group gift info (using admin client to avoid RLS issues)
  const { data: groupGift, error: groupGiftError } = await adminClient
    .from("group_gifts")
    .select("group_id, created_by")
    .eq("id", groupGiftId)
    .single();

  if (groupGiftError || !groupGift) {
    return { error: "Group gift not found" };
  }

  // Verify user is a member or creator of the group gift
  const isCreator = groupGift.created_by === user.id;
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isCreator && !membership) {
    return { error: "You must be a member of this group gift to manage members" };
  }

  // Get all groups the current user is a member of
  const { data: userGroups, error: userGroupsError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);

  if (userGroupsError) {
    return { error: userGroupsError.message };
  }

  if (!userGroups || userGroups.length === 0) {
    return { data: [] };
  }

  const userGroupIds = userGroups.map(g => g.group_id);

  // Get all members from all groups the user is in
  const { data: groupMembers, error: groupMembersError } = await supabase
    .from("group_members")
    .select("user_id")
    .in("group_id", userGroupIds);

  if (groupMembersError) {
    return { error: groupMembersError.message };
  }

  // Get current group gift members (using admin client)
  const { data: currentMembers, error: currentMembersError } = await adminClient
    .from("group_gift_members")
    .select("user_id")
    .eq("group_gift_id", groupGiftId);

  if (currentMembersError) {
    return { error: currentMembersError.message };
  }

  // Filter out users already in the group gift and the current user
  const currentMemberIds = new Set(currentMembers?.map((m) => m.user_id) || []);
  const uniqueUserIds = new Set(groupMembers?.map((gm) => gm.user_id) || []);
  const availableUserIds = Array.from(uniqueUserIds)
    .filter((userId) => !currentMemberIds.has(userId) && userId !== user.id);

  if (availableUserIds.length === 0) {
    return { data: [] };
  }

  // Get user profiles for available members
  const { data: profiles, error: profilesError } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", availableUserIds);

  if (profilesError) {
    return { error: profilesError.message };
  }

  return { data: profiles || [] };
}

// Export alias for backward compatibility
export { createGroupGift as createGiftGroup };
