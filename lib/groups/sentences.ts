/**
 * Every fixed sentence the group and invitation actions answer
 * (lib/actions/groups.ts, lib/actions/invitations.ts), in one module that is
 * not "use server", so the actions and the app's routes (lib/mobile) read the
 * same words.
 *
 * Two kinds of sentence live elsewhere. The sentences for a group or an
 * address the website's forms refuse are GROUP_RULES (lib/schemas/groups.ts),
 * re-exported here. "Not authenticated" is answered by every action on the
 * site, and stays with them.
 */

export { GROUP_RULES } from "@/lib/schemas/groups";

export const GROUP_SENTENCES = {
  // Groups
  groupNotFound: "Group not found",
  notAMember: "You are not a member of this group",
  loadFailed: "Failed to load group. Please try again.",
  createFailed: "Failed to create group. Please try again.",
  uniqueCodeFailed: "Failed to generate unique invite code. Please try again.",
  newCodeFailed: "Failed to generate a new invite code. Please try again.",
  rotateFailed: "Failed to rotate the group's invite code. Please try again.",
  verifyFailed: "Failed to verify group membership. Please try again.",
  ownerCannotLeave: "Owners cannot leave the group. Transfer ownership or delete the group.",
  leaveFailed: "Failed to leave the group. Please try again.",
  onlyOwnerDeletes: "Only the owner can delete this group",

  // Invitations
  hourlyLimit: "Rate limit exceeded. You can send up to 10 invitations per hour. Please try again later.",
  alreadyInGroup: "This user is already a member of the group",
  updateInvitationFailed: "Failed to update invitation. Please try again.",
  createInvitationFailed: "Failed to create invitation. Please try again.",
  /**
   * The warning an inviter sees when the email did not go, whatever the
   * provider said: its own words go only to the server log. The invitation is
   * saved before the email is sent, and sending again uses the same one.
   */
  emailNotSent: "The invitation is saved, but we couldn't send the email just now. Try resending it in a moment.",
  invitationInvalid: "This invitation is invalid or has expired",
  acceptFailed: "Failed to accept invitation. Please try again.",

  // Joining with a code
  /** Any code that opens no group, whatever is wrong with it. */
  invalidCode: "Invalid invite code",
  alreadyMember: "You are already a member of this group",
  joinFailed: "Failed to join group. Please try again.",
  /** Joining or accepting before the person's profile row exists. */
  stillSettingUp: "Your account is still being set up. Please try again.",
} as const;
