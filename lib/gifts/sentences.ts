/**
 * Every fixed sentence the group gift and chat actions answer (lib/actions/gifts.ts, lib/actions/messages.ts), and
 * the limits they hold text, amounts and lists to, in one module that is not "use server", so the actions, the
 * website's pages and the app's routes (lib/mobile) read the same words and numbers.
 *
 * "Not authenticated" is answered by every action on the site, and stays with them.
 */

import { CHARACTERS_REFUSED } from "@/lib/utils/characters";

export const GIFT_LIMITS = {
  /** A gift's name, once tidied (tidyGroupText), in UTF-16 units. */
  name: 200,
  /** A gift's description, once trimmed. */
  description: 1000,
  /** A chat message, once trimmed. */
  message: 5000,
  /** The largest target or pledge, in dollars. */
  amount: 1000000,
  /** The most people one gift can be for. */
  recipients: 20,
  /** The most people added to a gift at once. */
  adding: 50,
  /** Messages in one page of the chat. */
  page: 50,
  /** The most newer messages one check for them answers. */
  newer: 200,
} as const;

export const GIFT_SENTENCES = {
  // Starting a gift
  /** Who the gift is for was not answered: no list at all. An empty list is "Someone not on Rybn". */
  chooseWho: "Choose who this gift is for.",
  /** A person who shares no group with the caller, or the caller themselves. */
  recipientNotAllowed: "Choose people you share a group with.",
  tooManyRecipients: "A gift can be for up to 20 people.",
  notInGroup: "You must be a member of this group to create a group gift",
  nameMissing: "Give the gift a name.",
  nameTooLong: "Keep the name to 200 characters or fewer.",
  descriptionTooLong: "Keep the description to 1000 characters or fewer.",
  /** A target or a pledge that is not a number from 0 to 1,000,000. */
  amount: "Enter an amount from 0 to 1,000,000.",

  // Adding people, and deleting
  onlyMakerAdds: "Only the person who made this group gift can add people.",
  /** Any id that cannot be added, whatever the reason: already in it, no shared group, or someone it is for. */
  cannotAdd: "One of those people can't be added to this gift.",
  onlyMakerDeletes: "Only the creator can delete this group gift",

  // The chat
  messageMissing: "Write a message first.",
  messageTooLong: "Keep the message to 5000 characters or fewer.",

  /** A control character other than tab, line feed and carriage return in the description or a message. */
  characters: CHARACTERS_REFUSED,

  /**
   * A gift the caller has no member row in, one that names the caller, and one that does not exist: one sentence for
   * all three, so a person a gift is for cannot tell it from a gift that is not there.
   */
  notThere: "Group gift not found",
  createFailed: "Failed to create group gift. Please try again.",
} as const;
