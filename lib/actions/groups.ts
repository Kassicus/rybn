"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteCode } from "@/lib/utils/groups";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";

type GroupType = Database['public']['Enums']['group_type'];

export async function createGroup(formData: {
  name: string;
  description?: string;
  type: GroupType;
}) {
  // Use regular client for auth check
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Debug: Log user ID to help diagnose RLS issues
  console.log("Creating group with user ID:", user.id);

  // Generate unique invite code
  let inviteCode = generateInviteCode();
  let codeExists = true;
  let attempts = 0;

  // Ensure invite code is unique (max 5 attempts)
  while (codeExists && attempts < 5) {
    const { data: existing } = await supabase
      .from("groups")
      .select("id")
      .eq("invite_code", inviteCode)
      .single();

    if (!existing) {
      codeExists = false;
    } else {
      inviteCode = generateInviteCode();
      attempts++;
    }
  }

  if (codeExists) {
    return { error: "Failed to generate unique invite code. Please try again." };
  }

  // Use admin client to create the group (bypasses RLS)
  // This is safe because we've already validated the user above
  const adminClient = createAdminClient();

  const { data: group, error: groupError } = await adminClient
    .from("groups")
    .insert({
      name: formData.name,
      description: formData.description || null,
      type: formData.type,
      invite_code: inviteCode,
      created_by: user.id,
    })
    .select()
    .single();

  if (groupError) {
    return { error: groupError.message };
  }

  // Revalidate the groups page
  revalidatePath("/groups");

  return { data: group };
}

export async function getMyGroups() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: [] };
  }

  // Get groups where user is a member
  const { data: groupMembers, error } = await supabase
    .from("group_members")
    .select(`
      role,
      joined_at,
      groups (
        id,
        name,
        description,
        type,
        invite_code,
        created_at,
        created_by
      )
    `)
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false });

  if (error) {
    return { error: error.message, data: [] };
  }

  // Transform the data
  const groups = groupMembers?.map((gm) => ({
    ...gm.groups,
    myRole: gm.role,
    joinedAt: gm.joined_at,
  }));

  return { data: groups || [] };
}

export async function getGroupById(groupId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .single();

  if (groupError) {
    return { error: groupError.message };
  }

  // Get group members
  const { data: members, error: membersError } = await supabase
    .from("group_members")
    .select("id, user_id, role, joined_at")
    .eq("group_id", groupId);

  if (membersError) {
    return { error: membersError.message };
  }

  // Check if user is a member
  const isMember = members.some((member) => member.user_id === user.id);

  if (!isMember) {
    return { error: "You are not a member of this group" };
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
      ...group,
      group_members: membersWithProfiles,
    },
  };
}

export async function leaveGroup(groupId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Check if user is the owner
  const { data: membership } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (membership?.role === "owner") {
    return { error: "Owners cannot leave the group. Transfer ownership or delete the group." };
  }

  // Remove the member
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/groups");
  return { success: true };
}

export async function deleteGroup(groupId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Check if user is the owner
  const { data: membership } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .single();

  if (membership?.role !== "owner") {
    return { error: "Only the owner can delete this group" };
  }

  // Delete the group (cascade will handle members)
  const { error } = await supabase
    .from("groups")
    .delete()
    .eq("id", groupId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/groups");
  return { success: true };
}
