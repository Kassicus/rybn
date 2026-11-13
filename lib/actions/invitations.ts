"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserId, requireAuthWithProfile } from "@/lib/auth/require-auth";
import {
  generateInviteToken,
  getInviteExpiration,
  tidyInviteCode,
} from "@/lib/utils/groups";
import { GROUP_RULES, invitationEmailSchema } from "@/lib/schemas/groups";
import { GROUP_SENTENCES } from "@/lib/groups/sentences";
import { sendGroupInviteEmail } from "@/lib/resend/send";
import { revalidatePath } from "next/cache";

/**
 * What an inviter sees when the send fails (GROUP_SENTENCES.emailNotSent).
 *
 * Deliberately generic, and the genericness is the point. `emailError` holds
 * the provider's own words, which for the failure that prompted this read
 * "The rybn.app domain is not verified. Please, add and verify your domain on
 * https://resend.com/domains" -- a sentence addressed to whoever operates this
 * app, that was being shown verbatim to a group member trying to invite a
 * friend. The detail belongs in the server log, and that is now the only place
 * it goes.
 *
 * "Try resending" is honest advice for every failure shape reaching here: the
 * invitation row is committed before the send is attempted, so a failed email
 * never costs the user the invitation, and resending picks up the same row.
 */
const EMAIL_SEND_FAILED_MESSAGE = GROUP_SENTENCES.emailNotSent;

/** A group's id: anything else names no group, so it is never sent to the database. */
const GROUP_ID = z.guid();

/** What joinGroupByCode answers for any code that opens no group. */
const INVALID_INVITE_CODE = GROUP_SENTENCES.invalidCode;

/** A tidied invite code's only shape; tidyInviteCode puts the dashes back. */
const INVITE_CODE_SHAPE = /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/;

/**
 * Invites an address to a group the caller belongs to, by email.
 *
 * After the sign-in check and before any query: an argument that is not an
 * object answers the email sentence, the address is checked and trimmed, and
 * a group id that cannot be a group's answers "You are not a member of this
 * group", as a group the caller is not in does. Every lookup, the invitation
 * row and the email use the trimmed address. The group's name in the email is
 * read from the caller's own membership, so it is always the name of the
 * group the invitation is for.
 *
 * The membership is read first: someone not in the group is answered "You are
 * not a member of this group" before any other read. An address with an
 * invitation another member sent that has not been accepted answers
 * GROUP_SENTENCES.alreadyInvited, before anything is written.
 *
 * Once the invitation is made it answers `emailSent`, `isResend` (an
 * invitation of the caller's already waiting was sent again) and, when the
 * email did not go, `warning`.
 */
export async function sendGroupInvitation(data: {
  groupId: string;
  email: string;
}) {
  const supabase = await createClient();

  // Get current user
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  if (typeof data !== "object" || data === null) {
    return { error: GROUP_RULES.email };
  }

  const parsedEmail = invitationEmailSchema.safeParse(data.email);
  if (!parsedEmail.success) {
    return { error: GROUP_RULES.email };
  }
  const email = parsedEmail.data;

  if (!GROUP_ID.safeParse(data.groupId).success) {
    return { error: GROUP_SENTENCES.notAMember };
  }

  // Check if user is a member of the group, reading the group's name with it.
  // This is the first read, so someone not in the group is told so whatever
  // else is true of them.
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("role, groups ( name )")
    .eq("group_id", data.groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    console.error("Membership check failed:", membershipError);
    return { error: GROUP_SENTENCES.verifyFailed };
  }

  // A row with no group is no membership. The name itself may be any string
  // the group was stored with, the empty one included.
  if (!membership || !membership.groups) {
    return { error: GROUP_SENTENCES.notAMember };
  }
  const groupName = membership.groups.name;

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
    return { error: GROUP_SENTENCES.hourlyLimit };
  }

  // Check if email is already a member
  const { data: existingUser } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    const { data: alreadyMember } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", data.groupId)
      .eq("user_id", existingUser.id)
      .maybeSingle();

    if (alreadyMember) {
      return { error: GROUP_SENTENCES.alreadyInGroup };
    }
  }

  // Check for existing pending invitation
  // Use order by and limit to handle potential duplicates gracefully
  const { data: existingInvites } = await supabase
    .from("invitations")
    .select("id, accepted, invited_by")
    .eq("group_id", data.groupId)
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1);

  const existingInvite = existingInvites && existingInvites.length > 0 ? existingInvites[0] : null;

  // An invitation another member sent that has not been accepted is theirs:
  // the caller is told so before anything is written. The caller's own is
  // sent again below.
  if (existingInvite && !existingInvite.accepted && existingInvite.invited_by !== userId) {
    return { error: GROUP_SENTENCES.alreadyInvited };
  }

  // Generate invitation token
  const token = generateInviteToken();
  const expiresAt = getInviteExpiration();

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
      return { error: GROUP_SENTENCES.updateInvitationFailed };
    }

    if (!updatedInvite) {
      console.error("No invitation returned after update for ID:", existingInvite.id);
      return { error: GROUP_SENTENCES.updateInvitationFailed };
    }

    console.log("Successfully updated invitation:", updatedInvite.id);
  } else {
    // Create new invitation
    const { data: newInvite, error: inviteError } = await supabase
      .from("invitations")
      .insert({
        group_id: data.groupId,
        email,
        invited_by: userId,
        token,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .maybeSingle();

    if (inviteError) {
      console.error("Error creating invitation:", inviteError);
      return { error: GROUP_SENTENCES.createInvitationFailed };
    }

    if (!newInvite) {
      console.error("No invitation returned after insert");
      return { error: GROUP_SENTENCES.createInvitationFailed };
    }
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
      toEmail: email,
      groupName,
      inviterName,
      inviteToken: token,
      // Looked up above, to check whether this person is already in the
      // group. Reused rather than re-queried -- and it is the reason the
      // template can stop telling account holders to create an account.
      isNewUser: !existingUser,
    });

    if (sendError) {
      emailError = sendError.message || "Unknown error";
    } else {
      emailSent = true;
    }
  } catch (error) {
    emailError = error instanceof Error ? error.message : "Unknown error";
    // Don't fail the invitation creation if email fails
  }

  if (!emailSent) {
    // The provider's own words stop here. See EMAIL_SEND_FAILED_MESSAGE.
    console.error("Invite email failed to send:", {
      reason: emailError,
      toEmail: email,
      groupName,
      inviterName,
    });
  }

  const isResend = existingInvite && !existingInvite.accepted ? true : false;

  // The answer is whether the email went and whether the invitation was sent
  // again, with the warning when the email did not go. The invitation's row
  // stays on the server.
  if (emailSent) {
    return { emailSent, isResend };
  }
  return { emailSent, isResend, warning: EMAIL_SEND_FAILED_MESSAGE };
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
        return { error: GROUP_SENTENCES.invitationInvalid };
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
        return { error: GROUP_SENTENCES.stillSettingUp };
      default:
        console.error("acceptInvitation: RPC failed", error);
        return { error: GROUP_SENTENCES.acceptFailed };
    }
  }

  if (!groupId) {
    console.error("acceptInvitation: RPC returned no group id");
    return { error: GROUP_SENTENCES.acceptFailed };
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
 * The code is tidied here with tidyInviteCode (letters and digits only, upper
 * case, dashes put back), so a code typed with spaces or in lower case joins
 * from any caller; the website's join box tidies with the same function. A
 * code that is not a string, or that is not shaped ABC-DEF-GHI once tidied,
 * answers "Invalid invite code" without asking the database: the same
 * sentence the database's answer for an unknown code gets.
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

  if (typeof inviteCode !== "string") {
    return { error: INVALID_INVITE_CODE };
  }

  const code = tidyInviteCode(inviteCode);
  if (!INVITE_CODE_SHAPE.test(code)) {
    return { error: INVALID_INVITE_CODE };
  }

  const supabase = await createClient();

  const { data: groupId, error } = await supabase.rpc("join_group_with_code", {
    p_invite_code: code,
  });

  if (error) {
    switch (error.code) {
      // Unknown and malformed codes are the same error by design, so a caller
      // cannot use this to discover which codes exist.
      case "22023":
        return { error: INVALID_INVITE_CODE };
      case "23505":
        return { error: GROUP_SENTENCES.alreadyMember };
      case "28000":
        return { error: "Not authenticated" };
      case "23503":
        console.error(
          "joinGroupByCode: no user_profiles row for",
          userId,
          error
        );
        return { error: GROUP_SENTENCES.stillSettingUp };
      default:
        console.error("joinGroupByCode: RPC failed", error);
        return { error: GROUP_SENTENCES.joinFailed };
    }
  }

  if (!groupId) {
    console.error("joinGroupByCode: RPC returned no group id");
    return { error: GROUP_SENTENCES.joinFailed };
  }

  revalidatePath("/groups");

  return { data: { id: groupId } };
}
