// Tests only. The group gifts the group gift routes act on, and the actions they call, answering as they would to Sam.
import { vi, type Mock } from "vitest";
import type { MyGroupGift, SeenGroupGift } from "@/lib/actions/gifts";
import type { ChatRow } from "@/lib/actions/messages";
import type { GiftPerson, GiftRow } from "@/lib/gifts/access";
import { GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { ELSEWHERE } from "./test-groups";
import { IDS, SAM, world } from "./test-shopping";

/** The three gifts group-gifts.json lists. */
export const GIFT_IDS: { weekend: string; teacher: string; coach: string } = {
  weekend: "5a1c9e2b-3d4f-4a6b-8c7d-9e0f1a2b3c4d",
  teacher: "6b2d0f3c-4e5a-4b7c-9d8e-0f1a2b3c4d5e",
  coach: "7c3e1a4d-5f6b-4c8d-8e9f-1a2b3c4d5e6f",
};

const PEOPLE = world().people;
const person = (p: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }): GiftPerson => ({
  id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url,
});
const [sam, mom, dad, alex, jordan, gran, priya] = [
  PEOPLE.sam, PEOPLE.mom, PEOPLE.dad, PEOPLE.alex, PEOPLE.jordan, PEOPLE.gran, PEOPLE.priya,
].map(person);

const weekendRow: GiftRow = {
  id: GIFT_IDS.weekend, group_id: IDS.rivera, name: "Anniversary weekend away", description: "Two nights at the coast.",
  target_amount: 600, current_amount: 340, is_active: true, created_by: SAM, created_at: "2026-11-14T09:00:00.000000+00:00",
};

/** What getMyGroupGifts answers for group-gifts.json: Sam's gifts, the one he joined last first. */
export function myGroupGifts(): MyGroupGift[] {
  return [
    {
      ...weekendRow, my_contribution: 120, my_has_paid: false, my_joined_at: "2026-11-14T09:00:00+00:00",
      member_count: 3, recipients: [dad, mom], group_name: "Rivera Family",
    },
    {
      id: GIFT_IDS.teacher, group_id: IDS.bookClub, name: "Teacher thank-you", description: null, target_amount: null,
      current_amount: 45, is_active: true, created_by: priya.id, created_at: "2026-11-12T09:00:00.000000+00:00",
      my_contribution: 15, my_has_paid: true, my_joined_at: "2026-11-12T10:00:00+00:00",
      member_count: 4, recipients: [], group_name: "Book Club",
    },
    {
      // Sam has left the group this gift was made in, so it has no group name for him.
      id: GIFT_IDS.coach, group_id: ELSEWHERE, name: "Coach's send-off", description: "A card and a voucher.",
      target_amount: 200, current_amount: 60, is_active: false, created_by: alex.id, created_at: "2026-11-10T09:00:00.000000+00:00",
      my_contribution: 0, my_has_paid: false, my_joined_at: "2026-11-10T10:00:00+00:00",
      member_count: 3, recipients: [], group_name: null,
    },
  ];
}

/** What getGroupGiftById answers for group-gift.json: Anniversary weekend away, seen by Sam, who made it. */
export function seenWeekend(): SeenGroupGift {
  const member = (id: string, user: GiftPerson, amount: number, paid: boolean, joined: string) => ({
    id, group_gift_id: GIFT_IDS.weekend, user_id: user.id, contribution_amount: amount, has_paid: paid, joined_at: joined,
    user_profiles: user,
  });
  const members = [
    member("c0000000-0000-4000-8000-000000000001", sam, 120, false, "2026-11-14T09:00:00+00:00"),
    member("c0000000-0000-4000-8000-000000000002", alex, 120, true, "2026-11-14T09:30:00+00:00"),
    member("c0000000-0000-4000-8000-000000000003", jordan, 100, true, "2026-11-14T10:00:00+00:00"),
  ];
  const { user_profiles: _profile, ...mine } = members[0];
  void _profile;
  return {
    ...weekendRow,
    group_gift_members: members,
    my_membership: mine,
    recipients: [dad, mom],
    group_name: "Rivera Family",
    chat: { count: 3, latest: { name: "Alex Rivera", text: "I can book it on Friday" } },
  };
}

/** What getGroupGiftChoices answers to Sam: his groups and everyone he shares one with, each by name. */
export function groupMateRows(): { groups: { id: string; name: string }[]; people: (GiftPerson & { group_ids: string[] })[] } {
  const inRivera = [alex, dad, gran, jordan, mom].map((p) => ({ ...p, group_ids: [IDS.rivera] }));
  return {
    groups: [{ id: IDS.bookClub, name: "Book Club" }, { id: IDS.rivera, name: "Rivera Family" }],
    people: [...inRivera, { ...priya, group_ids: [IDS.bookClub] }],
  };
}

export type GroupGiftMocks = Record<
  | "createGroupGift" | "getMyGroupGifts" | "getGroupGiftById" | "getGroupGiftChoices"
  | "updateMyContribution" | "getAvailableGroupMembers" | "addMembersToGroupGift" | "deleteGroupGift" | "getMessages"
  | "sendMessage",
  Mock
>;

const message = (n: number, user: GiftPerson, content: string, created: string): ChatRow => ({
  id: `a1000000-0000-4000-8000-00000000000${n}`, user_id: user.id, content, attachment_url: null, is_edited: false,
  created_at: created, updated_at: created, user_profiles: user,
});

/**
 * The group gift and chat actions, each succeeding as the website's does for Sam: the three gifts of group-gifts.json
 * (only Anniversary weekend away can be read whole), a gift made from the request fixture, and the chat's three messages.
 */
export function groupGiftMocks(): GroupGiftMocks {
  const messages = [
    message(1, alex, "Found a place with a sea view. $580 for two nights.", "2026-11-16T18:02:11.000000+00:00"),
    message(2, sam, "Perfect. I'm in for 120.", "2026-11-16T18:05:40.000000+00:00"),
    message(3, alex, "I can book it on Friday", "2026-11-18T09:14:27.000000+00:00"),
  ];
  return {
    createGroupGift: vi.fn(async () => ({ data: { ...weekendRow } })),
    getMyGroupGifts: vi.fn(async () => ({ data: myGroupGifts() })),
    getGroupGiftById: vi.fn(async (id: string) =>
      id === GIFT_IDS.weekend ? { data: seenWeekend() } : { error: GIFT_SENTENCES.notThere }),
    getGroupGiftChoices: vi.fn(async () => ({ data: groupMateRows() })),
    updateMyContribution: vi.fn(async () => ({ success: true })),
    // Everyone in Sam's groups who is not in the weekend gift and is not who it is for.
    getAvailableGroupMembers: vi.fn(async () => ({ data: [gran, priya] })),
    addMembersToGroupGift: vi.fn(async () => ({ success: true })),
    deleteGroupGift: vi.fn(async () => ({ success: true })),
    getMessages: vi.fn(async () => ({ data: messages, hasEarlier: false })),
    sendMessage: vi.fn(async (input: { group_gift_id: string; content: string }) => ({
      data: message(4, sam, input.content, "2026-11-18T09:20:03.000000+00:00"),
    })),
  };
}
