"use server";

import { createClient } from "@/lib/supabase/server";
import { generateInviteToken, getInviteExpiration } from "@/lib/utils/groups";
import { sendGroupInviteEmail } from "@/lib/resend/send";

export async function sendGroupInvitation(data: {
  groupId: string;
  groupName: string;
  email: string;
}) {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Check if user is a member of the group
  const { data: membership } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", data.groupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You are not a member of this group" };
  }

  // Check if email is already a member
  const { data: existingUser } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("email", data.email)
    .single();

  if (existingUser) {
    const { data: alreadyMember } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", data.groupId)
      .eq("user_id", existingUser.id)
      .single();

    if (alreadyMember) {
      return { error: "This user is already a member of the group" };
    }
  }

  // Check for existing pending invitation
  const { data: existingInvite } = await supabase
    .from("invitations")
    .select("id, accepted")
    .eq("group_id", data.groupId)
    .eq("email", data.email)
    .single();

  if (existingInvite && !existingInvite.accepted) {
    return { error: "An invitation has already been sent to this email" };
  }

  // Generate invitation token
  const token = generateInviteToken();
  const expiresAt = getInviteExpiration();

  // Create invitation
  const { data: invitation, error: inviteError } = await supabase
    .from("invitations")
    .insert({
      group_id: data.groupId,
      email: data.email,
      invited_by: user.id,
      token,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (inviteError) {
    return { error: inviteError.message };
  }

  // Send invitation email
  let emailSent = false;
  let emailError = null;

  try {
    await sendGroupInviteEmail({
      toEmail: data.email,
      groupName: data.groupName,
      inviterName: user.user_metadata?.username || user.email || "A friend",
      inviteToken: token,
    });
    emailSent = true;
  } catch (error) {
    console.error("Failed to send invite email:", error);
    emailError = error instanceof Error ? error.message : "Unknown error";
    // Don't fail the invitation creation if email fails
  }

  return {
    data: invitation,
    emailSent,
    warning: !emailSent ? `Invitation created but email failed to send: ${emailError}` : undefined
  };
}

export async function acceptInvitation(token: string) {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Find the invitation
  const { data: invitation, error: inviteError } = await supabase
    .from("invitations")
    .select("*, groups(*)")
    .eq("token", token)
    .single();

  if (inviteError || !invitation) {
    return { error: "Invalid invitation token" };
  }

  // Check if invitation has expired
  if (new Date(invitation.expires_at) < new Date()) {
    return { error: "This invitation has expired" };
  }

  // Check if already accepted
  if (invitation.accepted) {
    return { error: "This invitation has already been accepted" };
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", invitation.group_id)
    .eq("user_id", user.id)
    .single();

  if (existingMember) {
    return { error: "You are already a member of this group" };
  }

  // Add user to group
  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: invitation.group_id,
    user_id: user.id,
    role: "member",
  });

  if (memberError) {
    return { error: memberError.message };
  }

  // Mark invitation as accepted
  await supabase
    .from("invitations")
    .update({
      accepted: true,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invitation.id);

  return { data: invitation.groups };
}

export async function joinGroupByCode(inviteCode: string) {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Find the group
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("*")
    .eq("invite_code", inviteCode.toUpperCase())
    .single();

  if (groupError || !group) {
    return { error: "Invalid invite code" };
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", group.id)
    .eq("user_id", user.id)
    .single();

  if (existingMember) {
    return { error: "You are already a member of this group" };
  }

  // Add user to group
  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: group.id,
    user_id: user.id,
    role: "member",
  });

  if (memberError) {
    return { error: memberError.message };
  }

  return { data: group };
}
