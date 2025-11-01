"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteToken, getInviteExpiration } from "@/lib/utils/groups";
import { sendGroupInviteEmail } from "@/lib/resend/send";
import { revalidatePath } from "next/cache";

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
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", data.groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    console.error("Membership check failed:", membershipError);
    return { error: "Failed to verify group membership. Please try again." };
  }

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
  // Use order by and limit to handle potential duplicates gracefully
  const { data: existingInvites } = await supabase
    .from("invitations")
    .select("id, accepted")
    .eq("group_id", data.groupId)
    .eq("email", data.email)
    .order("created_at", { ascending: false })
    .limit(1);

  const existingInvite = existingInvites && existingInvites.length > 0 ? existingInvites[0] : null;

  // Generate invitation token
  const token = generateInviteToken();
  const expiresAt = getInviteExpiration();

  let invitation;

  // If there's an existing pending invitation, update it with new token and expiry
  // Otherwise, create a new invitation
  if (existingInvite && !existingInvite.accepted) {
    console.log("Updating existing invitation:", existingInvite.id);

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
      .maybeSingle();

    if (updateError) {
      console.error("Error updating invitation:", updateError);
      console.error("Update error details:", JSON.stringify(updateError, null, 2));
      console.error("Attempted to update invitation ID:", existingInvite.id);
      return { error: `Failed to update invitation: ${updateError.message}` };
    }

    if (!updatedInvite) {
      console.error("No invitation returned after update for ID:", existingInvite.id);
      return { error: "Failed to update invitation. Please try again." };
    }

    console.log("Successfully updated invitation:", updatedInvite.id);
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
      .maybeSingle();

    if (inviteError) {
      console.error("Error creating invitation:", inviteError);
      return { error: "Failed to create invitation. Please try again." };
    }

    if (!newInvite) {
      console.error("No invitation returned after insert");
      return { error: "Failed to create invitation. Please try again." };
    }

    invitation = newInvite;
  }

  // Send invitation email
  let emailSent = false;
  let emailError = null;

  try {
    const result = await sendGroupInviteEmail({
      toEmail: data.email,
      groupName: data.groupName,
      inviterName: user.user_metadata?.username || user.email || "A friend",
      inviteToken: token,
    });
    console.log("Email sent successfully:", result);
    emailSent = true;
  } catch (error) {
    console.error("Failed to send invite email:", error);
    console.error("Email details:", {
      toEmail: data.email,
      groupName: data.groupName,
      inviterName: user.user_metadata?.username || user.email || "A friend",
    });
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
  console.log("acceptInvitation called with token:", token);

  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  console.log("User check:", { user: user?.id, error: userError?.message });

  if (userError || !user) {
    console.error("Not authenticated:", userError);
    return { error: "Not authenticated" };
  }

  // Find the invitation (don't fetch groups data yet due to RLS)
  console.log("Searching for invitation with token:", token);
  const { data: invitation, error: inviteError } = await supabase
    .from("invitations")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  console.log("Invitation query result:", { invitation, error: inviteError });

  if (inviteError) {
    console.error("Error fetching invitation:", inviteError);
    return { error: "Failed to fetch invitation. Please try again." };
  }

  if (!invitation) {
    console.error("No invitation found for token:", token);
    return { error: "Invalid invitation token" };
  }

  console.log("Found invitation:", invitation.id, "for group:", invitation.group_id);

  // Check if invitation has expired
  if (new Date(invitation.expires_at) < new Date()) {
    return { error: "This invitation has expired" };
  }

  // Check if already accepted
  if (invitation.accepted) {
    return { error: "This invitation has already been accepted" };
  }

  // Check if user is already a member
  console.log("Checking membership for user:", user.id, "in group:", invitation.group_id);

  // Check all memberships to see if there are duplicates
  const { data: allMemberships } = await supabase
    .from("group_members")
    .select("id, role, joined_at")
    .eq("group_id", invitation.group_id)
    .eq("user_id", user.id);

  console.log("All memberships found:", allMemberships);

  if (allMemberships && allMemberships.length > 0) {
    console.log("User is already a member, redirecting to group");
    console.log("Membership details:", JSON.stringify(allMemberships, null, 2));

    // Mark the invitation as accepted since they're already in the group
    // Use admin client to bypass RLS
    const adminClient = createAdminClient();
    await adminClient
      .from("invitations")
      .update({
        accepted: true,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);

    // Fetch the group data now that they're a member
    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("id", invitation.group_id)
      .maybeSingle();

    // Revalidate the groups page
    revalidatePath("/groups");
    revalidatePath(`/groups/${invitation.group_id}`);

    const result = { data: group || { id: invitation.group_id } };
    console.log("Returning from acceptInvitation (already member):", result);
    // Redirect them to the group instead of showing an error
    return result;
  }

  console.log("User is not a member, proceeding with acceptance");

  // Security: Mark invitation as accepted BEFORE adding user to prevent race condition
  // Use admin client to bypass RLS for this update (user accepting isn't the sender)
  console.log("Attempting to mark invitation as accepted...");
  const adminClient = createAdminClient();
  const { error: acceptError, data: acceptData } = await adminClient
    .from("invitations")
    .update({
      accepted: true,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invitation.id)
    .eq("accepted", false) // Only update if not already accepted
    .select();

  console.log("Accept update result:", { error: acceptError, data: acceptData });

  if (acceptError) {
    console.error("Failed to mark invitation as accepted:", acceptError);
    console.error("Error details:", JSON.stringify(acceptError, null, 2));
    return { error: `Failed to accept invitation: ${acceptError.message}` };
  }

  if (!acceptData || acceptData.length === 0) {
    console.error("No rows updated when marking invitation as accepted");
    return { error: "Failed to accept invitation. It may have already been used." };
  }

  console.log("Successfully marked invitation as accepted");

  // Add user to group
  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: invitation.group_id,
    user_id: user.id,
    role: "member",
  });

  if (memberError) {
    console.error("Error adding user to group:", memberError);
    // If adding member fails, rollback the acceptance using admin client
    await adminClient
      .from("invitations")
      .update({ accepted: false, accepted_at: null })
      .eq("id", invitation.id);
    return { error: memberError.message };
  }

  console.log("Successfully added user to group");

  // Now fetch the group data (user is a member now, so RLS allows it)
  const { data: group } = await supabase
    .from("groups")
    .select("*")
    .eq("id", invitation.group_id)
    .maybeSingle();

  console.log("Fetched group data:", group?.id);

  // Revalidate the groups page to ensure fresh data
  revalidatePath("/groups");
  revalidatePath(`/groups/${invitation.group_id}`);

  const result = { data: group || { id: invitation.group_id } };
  console.log("Returning from acceptInvitation:", result);
  return result;
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
    .maybeSingle();

  if (groupError) {
    console.error("Error fetching group:", groupError);
    return { error: "Failed to fetch group. Please try again." };
  }

  if (!group) {
    return { error: "Invalid invite code" };
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", group.id)
    .eq("user_id", user.id)
    .maybeSingle();

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
