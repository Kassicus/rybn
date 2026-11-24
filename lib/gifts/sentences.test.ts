import { describe, it, expect } from "vitest";
import { CHARACTERS_REFUSED } from "@/lib/utils/characters";
import { GIFT_LIMITS, GIFT_SENTENCES } from "./sentences";

describe("the group gift actions' sentences and limits", () => {
  // Written out, so changing a single character of one fails here.
  it("are the contract's words, character for character", () =>
    expect(GIFT_SENTENCES).toEqual({
      chooseWho: "Choose who this gift is for.",
      recipientNotAllowed: "Choose people you share a group with.",
      tooManyRecipients: "A gift can be for up to 20 people.",
      notInGroup: "You must be a member of this group to create a group gift",
      nameMissing: "Give the gift a name.",
      nameTooLong: "Keep the name to 200 characters or fewer.",
      descriptionTooLong: "Keep the description to 1000 characters or fewer.",
      amount: "Enter an amount from 0 to 1,000,000.",
      onlyMakerAdds: "Only the person who made this group gift can add people.",
      cannotAdd: "One of those people can't be added to this gift.",
      onlyMakerDeletes: "Only the creator can delete this group gift",
      messageMissing: "Write a message first.",
      messageTooLong: "Keep the message to 5000 characters or fewer.",
      characters: "That has characters Rybn can't save. Try typing it again.",
      notThere: "Group gift not found",
      createFailed: "Failed to create group gift. Please try again.",
    }));

  it("refuses characters with the words every other form uses", () =>
    expect(GIFT_SENTENCES.characters).toBe(CHARACTERS_REFUSED));

  it("are the contract's limits", () =>
    expect(GIFT_LIMITS).toEqual({
      name: 200,
      description: 1000,
      message: 5000,
      amount: 1000000,
      recipients: 20,
      adding: 50,
      page: 50,
      newer: 200,
    }));
});
