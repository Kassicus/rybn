"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteCode } from "@/lib/utils/groups";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";

import { getUserId } from "@/lib/auth/require-auth";
type GroupType = Database['public']['Enums']['group_type'];

type UserClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A generated invite code that no group is currently using, or null after five
 * consecutive collisions.
 *
 * Not exported, and it cannot be: this file is "use server", so every export
 * would become an HTTP endpoint. Both writers of `groups.invite_code` go
 * through here -- creation and rotation -- so the collision handling is
 * written once.
 *
 * The probe is find_group_by_invite_code(), not a direct select on `groups`.
 * The groups SELECT policy is membership-only, so reading by invite_code from
 * here returned nothing for every code -- including one already in use -- and
 * the probe silently reported "unique" every time, pushing a genuine collision
 * out to the write. The resolver is SECURITY DEFINER and returns at most one
 * row without echoing the code back.
 *
 * Verified against the live database: as a non-member, the direct select
 * returns 0 rows for a code that exists; the resolver returns 1.
 *
 * A probe FAILURE is not a code failure. `groups.invite_code` is UNIQUE, so a
 * collision the probe missed still cannot be written -- it surfaces as 23505
 * on the insert or update, which both callers report. So a broken probe
 * returns the current candidate rather than spinning five times against it.
 */
async function findUnusedInviteCode(
  supabase: UserClient,
  context: string
): Promise<string | null> {
  let inviteCode = generateInviteCode();

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing, error: probeError } = await supabase.rpc(
      "find_group_by_invite_code",
      { p_invite_code: inviteCode }
    );

    if (probeError) {
      console.error(`${context}: invite code collision probe failed`, probeError);
      return inviteCode;
    }

    if (!existing || existing.length === 0) {
      return inviteCode;
    }

    inviteCode = generateInviteCode();
  }

  return null;
}

/**
 * Replaces a group's invite code, returning the new one.
 *
 * The write goes through the admin client. The user-scoped client cannot do
 * it: the groups UPDATE policy requires is_group_admin(), and the caller this
 * exists for is an ordinary member on their way out of the group.
 *
 * Callers must have already established that the caller belongs in this group.
 * Rotation invalidates the code for EVERY member, so an unguarded call is a
 * denial of service against a group whose UUID is in the URL.
 */
async function rotateInviteCode(
  groupId: string,
  supabase: UserClient,
  context: string
): Promise<{ inviteCode: string; error?: never } | { error: string; inviteCode?: never }> {
  const inviteCode = await findUnusedInviteCode(supabase, context);

  if (!inviteCode) {
    return { error: "Failed to generate a new invite code. Please try again." };
  }

  const adminClient = createAdminClient();

  const { data: updated, error: updateError } = await adminClient
    .from("groups")
    .update({ invite_code: inviteCode })
    .eq("id", groupId)
    .select("invite_code")
    .maybeSingle();

  if (updateError) {
    console.error(`${context}: invite code rotation failed`, updateError);
    return { error: "Failed to rotate the group's invite code. Please try again." };
  }

  if (!updated) {
    console.error(`${context}: invite code rotation matched no group`, groupId);
    return { error: "Failed to rotate the group's invite code. Please try again." };
  }

  return { inviteCode: updated.invite_code };
}

export async function createGroup(formData: {
  name: string;
  description?: string;
  type: GroupType;
}) {
  // Use regular client for auth check
  const supabase = await createClient();

  // Get current user
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Debug: Log user ID to help diagnose RLS issues
  console.log("Creating group with user ID:", userId);

  const inviteCode = await findUnusedInviteCode(supabase, "createGroup");

  if (!inviteCode) {
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
      created_by: userId,
    })
    .select()
    .maybeSingle();

  if (groupError) {
    console.error("Error creating group:", groupError);
    return { error: "Failed to create group. Please try again." };
  }

  if (!group) {
    console.error("No group returned after insert");
    return { error: "Failed to create group. Please try again." };
  }

  // Revalidate the groups page
  revalidatePath("/groups");

  return { data: group };
}

export async function getMyGroups() {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
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
    .eq("user_id", userId)
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

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Get group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    console.error("Error fetching group:", groupError);
    return { error: "Failed to load group. Please try again." };
  }

  if (!group) {
    return { error: "Group not found" };
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
  const isMember = members.some((member) => member.user_id === userId);

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

/**
 * Removes the caller from a group AND rotates the group's invite code.
 *
 * The rotation is not housekeeping, it is the removal. Task 9 routed joining
 * through join_group_with_code(), which turned the invite code from a
 * convenience into a MEMBERSHIP CAPABILITY: whoever presents it is made a
 * member. Someone who leaves (or is removed) still knows the code they used,
 * so without rotation they walk straight back in, and "remove from group"
 * removes nobody -- in an app whose whole value is controlling who sees what.
 * The schema anticipated this: see the group_members section of
 * 20260821000000_clerk_native_baseline.sql.
 *
 * ORDERING IS THE ATOMICITY. Two PostgREST round trips cannot share a
 * transaction, so one of them can fail after the other succeeded. The two
 * orderings fail very differently:
 *
 *   rotate then remove -- a failed removal leaves a member in the group with a
 *     code that no longer works. Everyone re-shares a code. Nothing is exposed.
 *   remove then rotate -- a failed rotation leaves someone removed from the
 *     roster still holding a live key to it. That is the exact hole this
 *     function exists to close, re-opened silently.
 *
 * So the rotation goes FIRST and its failure aborts the removal, loudly: the
 * caller stays a member and gets an error. There is no path on which the
 * membership row is deleted while the old code still opens the group.
 */
export async function leaveGroup(groupId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    console.error("leaveGroup: membership lookup failed", membershipError);
    return { error: "Failed to verify group membership. Please try again." };
  }

  // Non-membership is now a REJECTION, not a no-op.
  //
  // It used to be harmless: deleting your own row from a group you are not in
  // deletes nothing. It is not harmless now. The rotation below runs on the
  // admin client, so an unguarded call would let any signed-in user burn the
  // invite code of any group whose UUID they hold -- and the UUID is in the
  // URL. This check is what keeps rotation reachable only by a member acting
  // on their own membership.
  if (!membership) {
    return { error: "You are not a member of this group" };
  }

  if (membership.role === "owner") {
    return { error: "Owners cannot leave the group. Transfer ownership or delete the group." };
  }

  const rotation = await rotateInviteCode(groupId, supabase, "leaveGroup");

  if (rotation.error) {
    return { error: rotation.error };
  }

  // Remove the member
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (error) {
    // The code was already rotated. Say so rather than logging a bare failure:
    // the remaining members now hold a stale code and will report it as a bug.
    console.error(
      "leaveGroup: membership delete failed AFTER the invite code was rotated -- " +
        "the caller is still a member and the group's code has changed",
      { groupId, userId, error }
    );
    return { error: "Failed to leave the group. Please try again." };
  }

  revalidatePath("/groups");
  // The group and settings pages both render invite_code. The leaver can no
  // longer see either, but the members still in the group can, and a rotation
  // they are not shown is a code they will hand out and wonder why it fails.
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/settings`);
  return { success: true };
}

export async function deleteGroup(groupId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Check if user is the owner
  const { data: membership } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

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
