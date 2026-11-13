import { describe, it, expect } from "vitest";
import { GROUP_RULES as FORM_RULES } from "@/lib/schemas/groups";
import { GROUP_RULES, GROUP_SENTENCES } from "./sentences";

describe("the group and invitation actions' sentences", () => {
  // Written out, so changing a single character of one fails here.
  it("are the words the actions answer, character for character", () =>
    expect(GROUP_SENTENCES).toEqual({
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
      hourlyLimit: "Rate limit exceeded. You can send up to 10 invitations per hour. Please try again later.",
      alreadyInGroup: "This user is already a member of the group",
      updateInvitationFailed: "Failed to update invitation. Please try again.",
      createInvitationFailed: "Failed to create invitation. Please try again.",
      emailNotSent: "The invitation is saved, but we couldn't send the email just now. Try resending it in a moment.",
      invitationInvalid: "This invitation is invalid or has expired",
      acceptFailed: "Failed to accept invitation. Please try again.",
      invalidCode: "Invalid invite code",
      alreadyMember: "You are already a member of this group",
      joinFailed: "Failed to join group. Please try again.",
      stillSettingUp: "Your account is still being set up. Please try again.",
    }));

  it("passes on the forms' sentences as they are", () => expect(GROUP_RULES).toBe(FORM_RULES));
});
