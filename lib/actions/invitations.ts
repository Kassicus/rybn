"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId, requireAuthWithProfile } from "@/lib/auth/require-auth";
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
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Clerk's auth() only returns ids, so the inviter's display details come
  // from their profile row.
  const { data: inviterProfile } = await supabase
    .from("user_profiles")
    .select("username, email")
    .eq("id", userId)
    .maybeSingle();

  const inviterName =
    inviterProfile?.username || inviterProfile?.email || "A friend";

  // Security: Rate limiting - check how many invitations this user has sent in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentInvites, error: rateLimitError } = await supabase
    .from("invitations")
    .select("id")
    .eq("invited_by", userId)
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
    .eq("user_id", userId)
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
        invited_by: userId,
        created_at: new Date().toISOString(), // Update timestamp to reflect resend
      })
      .eq("id", existingInvite.id)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error("Error updating invitation:", updateError);
      console.error("Update error details:", JSON.stringify(updateError, null, 2));
      console.error("Attempted to update invitation ID:", existingInvite.id);
      return { error: "Failed to update invitation. Please try again." };
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
        invited_by: userId,
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

  // Send invitation email.
  //
  // TWO failure shapes here, and they are not interchangeable. The Resend SDK
  // RESOLVES to `{ data: null, error }` for everything the API rejects -- an
  // unverified sending domain, a suspended key, a rate limit -- and throws
  // only when the underlying fetch does. So a bare try/catch is not the whole
  // story, and for a long time it was the only story: every rejected send was
  // recorded as `emailSent = true` and announced to the user as "Invitation
  // sent!", with `console.log("Email sent successfully:", result)` printing
  // the 403 body underneath. Check the resolved value FIRST, then keep the
  // catch for the network.
  let emailSent = false;
  let emailError = null;

  try {
    const { error: sendError } = await sendGroupInviteEmail({
      toEmail: data.email,
      groupName: data.groupName,
      inviterName,
      inviteToken: token,
    });

    if (sendError) {
      console.error("Resend rejected the invite email:", sendError);
      emailError = sendError.message || "Unknown error";
    } else {
      emailSent = true;
    }
  } catch (error) {
    console.error("Failed to send invite email:", error);
    emailError = error instanceof Error ? error.message : "Unknown error";
    // Don't fail the invitation creation if email fails
  }

  if (!emailSent) {
    console.error("Invite email details:", {
      toEmail: data.email,
      groupName: data.groupName,
      inviterName,
    });
  }

  return {
    data: invitation,
    emailSent,
    isResend: existingInvite && !existingInvite.accepted ? true : false,
    warning: !emailSent ? `Invitation created but email failed to send: ${emailError}` : undefined
  };
}

/**
 * Consumes an invitation token for the signed-in user.
 *
 * This does NOT read the invitations table and does NOT insert into
 * group_members. It cannot: group_members has no INSERT policy at all (a
 * self-grantable membership was a self-grantable key to nearly everything the
 * schema protects -- roster, invite code, private wishlist items, profile
 * fields, Secret Santa assignments -- to anyone holding the group UUID, which
 * is in the URL), and the email-based SELECT policy that once let an invitee
 * read their own invitation row is gone too. The invitee presents the token to
 * accept_group_invitation(); they never see the row behind it.
 *
 * The function is SECURITY DEFINER, pins the new member to
 * requesting_user_id(), and takes no user parameter -- so it must be called on
 * the USER-SCOPED client. The admin client would carry no Clerk subject and
 * the call would raise 28000.
 */
export async function acceptInvitation(token: string): Promise<
  | { error: string; data?: never }
  | { data: { id: string }; error?: never }
> {
  // requireAuthWithProfile, not requireAuth/getUserId, and this is load-bearing.
  //
  // app/(auth)/ does not render the dashboard layout, so nothing has
  // provisioned a user_profiles row on this route. /accept-invite embeds
  // Clerk's <SignUp/> with forceRedirectUrl back to itself, which makes
  // accepting the invitation a brand-new user's FIRST authenticated action.
  // group_members.user_id references user_profiles(id), so without the row the
  // insert inside the function fails with 23503 -- confirmed against the live
  // database, not assumed.
  //
  // It throws when signed out; the flow's contract is an error string, so the
  // throw is converted rather than propagated. ensureProfile() behind it is
  // fail-soft, hence the 23503 arm below still exists.
  let userId: string;
  try {
    userId = await requireAuthWithProfile();
  } catch {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data: groupId, error } = await supabase.rpc(
    "accept_group_invitation",
    { p_token: token }
  );

  if (error) {
    switch (error.code) {
      // Unknown, expired and already-accepted tokens all raise this, and the
      // function raises it identically ON PURPOSE. Do not try to tell them
      // apart here: distinguishing them would turn this action into an oracle
      // for which tokens exist. One message covers all three.
      case "22023":
        return { error: "This invitation is invalid or has expired" };
      case "28000":
        return { error: "Not authenticated" };
      case "23503":
        // ensureProfile() is fail-soft, so a Supabase blip during provisioning
        // lands here rather than throwing. Retrying re-runs ensureProfile().
        console.error(
          "acceptInvitation: no user_profiles row for",
          userId,
          error
        );
        return {
          error: "Your account is still being set up. Please try again.",
        };
      default:
        console.error("acceptInvitation: RPC failed", error);
        return { error: "Failed to accept invitation. Please try again." };
    }
  }

  if (!groupId) {
    console.error("acceptInvitation: RPC returned no group id");
    return { error: "Failed to accept invitation. Please try again." };
  }

  revalidatePath("/groups");
  revalidatePath(`/groups/${groupId}`);

  return { data: { id: groupId } };
}

/**
 * Joins the group whose invite code is presented.
 *
 * Same shape as acceptInvitation: the group lookup and the membership insert
 * both happen inside join_group_with_code(), which is SECURITY DEFINER and
 * pins the new member to requesting_user_id(). Reading `groups` by
 * invite_code from here would return nothing anyway -- the groups SELECT
 * policy is membership-only, and a joiner is by definition not a member yet.
 *
 * The code is normalised to upper case inside the function, so the caller does
 * not have to; JoinGroupButton still formats it for display.
 */
export async function joinGroupByCode(inviteCode: string): Promise<
  | { error: string; data?: never }
  | { data: { id: string }; error?: never }
> {
  // Reached from the dashboard, where the layout has already provisioned the
  // profile -- but the same 23503 applies if it ever is not, and the check
  // costs one indexed primary-key lookup. See acceptInvitation.
  let userId: string;
  try {
    userId = await requireAuthWithProfile();
  } catch {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data: groupId, error } = await supabase.rpc("join_group_with_code", {
    p_invite_code: inviteCode,
  });

  if (error) {
    switch (error.code) {
      // Unknown and malformed codes are the same error by design, so a caller
      // cannot use this to discover which codes exist.
      case "22023":
        return { error: "Invalid invite code" };
      case "23505":
        return { error: "You are already a member of this group" };
      case "28000":
        return { error: "Not authenticated" };
      case "23503":
        console.error(
          "joinGroupByCode: no user_profiles row for",
          userId,
          error
        );
        return {
          error: "Your account is still being set up. Please try again.",
        };
      default:
        console.error("joinGroupByCode: RPC failed", error);
        return { error: "Failed to join group. Please try again." };
    }
  }

  if (!groupId) {
    console.error("joinGroupByCode: RPC returned no group id");
    return { error: "Failed to join group. Please try again." };
  }

  revalidatePath("/groups");

  return { data: { id: groupId } };
}
