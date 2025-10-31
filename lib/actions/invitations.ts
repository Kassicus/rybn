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

  // Security: Rate limiting - check how many invitations this user has sent in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentInvites, error: rateLimitError } = await supabase
    .from("invitations")
    .select("id")
    .eq("invited_by", user.id)
    .gte("created_at", oneHourAgo);

  if (rateLimitError) {
    console.error("Rate limit check failed:", rateLimitError);
  } else if (recentInvites && recentInvites.length >= 10) {
    return {
      error: "Rate limit exceeded. You can send up to 10 invitations per hour. Please try again later."
    };
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
    .maybeSingle();

  if (existingUser) {
    const { data: alreadyMember } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", data.groupId)
      .eq("user_id", existingUser.id)
      .maybeSingle();

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
    .maybeSingle();

  // Generate invitation token
  const token = generateInviteToken();
  const expiresAt = getInviteExpiration();

  let invitation;

  // If there's an existing pending invitation, update it with new token and expiry
  // Otherwise, create a new invitation
  if (existingInvite && !existingInvite.accepted) {
    const { data: updatedInvite, error: updateError } = await supabase
      .from("invitations")
      .update({
        token,
        expires_at: expiresAt.toISOString(),
        invited_by: user.id,
        created_at: new Date().toISOString(), // Update timestamp to reflect resend
      })
      .eq("id", existingInvite.id)
      .select()
      .single();

    if (updateError) {
      return { error: updateError.message };
    }
    invitation = updatedInvite;
  } else {
    // Create new invitation
    const { data: newInvite, error: inviteError } = await supabase
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
    invitation = newInvite;
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
    isResend: existingInvite && !existingInvite.accepted ? true : false,
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

  // Security: Mark invitation as accepted BEFORE adding user to prevent race condition
  // Use atomic update to ensure only one acceptance per invitation
  const { error: acceptError } = await supabase
    .from("invitations")
    .update({
      accepted: true,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invitation.id)
    .eq("accepted", false); // Only update if not already accepted

  if (acceptError) {
    return { error: "Failed to accept invitation. It may have already been used." };
  }

  // Add user to group
  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: invitation.group_id,
    user_id: user.id,
    role: "member",
  });

  if (memberError) {
    // If adding member fails, rollback the acceptance
    await supabase
      .from("invitations")
      .update({ accepted: false, accepted_at: null })
      .eq("id", invitation.id);
    return { error: memberError.message };
  }

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
