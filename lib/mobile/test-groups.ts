// Tests only. The groups Task A4's routes and the group date routes (Task A5) act on, and the actions and reads they
// call, answering from world().
import { vi, type Mock } from "vitest";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import type { GroupRole } from "./groups";
import type { GroupSummary } from "./shopping";
import { fixture } from "./test-fixtures";
import { IDS, SAM, world } from "./test-shopping";

/** Rivera Family's invite code. */
export const CODE = "K7P-MXR-4TQ";
/** The group group-request.json makes. */
export const GARCIA = "5a6b7c8d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";
export const RIVERA_DESCRIPTION = "Everyone on Mom's side.";
/** The date group-date-request.json adds to Rivera Family. */
export const GRAN_80TH = "3f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f";
/** Book Club's own date, which Priya made. */
export const BOOK_SWAP = "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b";
/** A group Sam is not in, and one of its dates. */
export const ELSEWHERE = "6c5d4e3f-2a1b-4c0d-9e8f-7a6b5c4d3e2f";
export const ELSEWHERE_DATE = "a7b6c5d4-3e2f-4a1b-8c9d-0e1f2a3b4c5d";

/**
 * Book Club's date as get_upcoming_occasions answers it to Sam. world()'s occasions leave it out, so no fixture shows
 * it; a test adds it to show that a group's page lists only that group's dates.
 */
export function bookSwap(): UpcomingOccasion {
  return {
    occasionId: BOOK_SWAP, kind: "group_date", name: "Book swap", occasionDate: "2026-12-05", celebrantId: null,
    celebrantUsername: null, celebrantDisplayName: null, groupId: IDS.bookClub, groupName: "Book Club",
    partnerId: null, partnerUsername: null, partnerDisplayName: null,
  };
}

const PEOPLE = world().people;

/** Rivera Family: Mom is its owner and Dad an admin. Book Club: Priya is its owner. Everyone else is a member. */
export function roleIn(groupId: string, personId: string): GroupRole {
  if (groupId === IDS.rivera && personId === PEOPLE.mom.id) return "owner";
  if (groupId === IDS.rivera && personId === PEOPLE.dad.id) return "admin";
  if (groupId === IDS.bookClub && personId === PEOPLE.priya.id) return "owner";
  return "member";
}

export type GroupMocks = Record<
  | "createGroup" | "joinGroupByCode" | "sendGroupInvitation" | "leaveGroup" | "deleteGroup"
  | "createGroupDate" | "updateGroupDate" | "deleteGroupDate"
  | "groupSummary" | "callerRole" | "inviteCodeOf" | "groupNameOf" | "groupDateRow",
  Mock
>;

/**
 * The group, invitation and group date actions, each succeeding as the website's does, and the reads of
 * lib/mobile/group-reads as Sam's own client would answer them: the world's two groups, Garcia Cousins once it is made,
 * Rivera Family's two dates (Christmas 2026, and Gran's 80th once it is added), Book Club's book swap, and a date of a
 * group Sam is not in, which his client cannot see.
 */
export function groupMocks(): GroupMocks {
  const w = world();
  const summaries = new Map<string, GroupSummary>(
    [...fixture("group-list").groups, fixture("group-created").group].map((g: GroupSummary) => [g.id, g]),
  );
  const isIn = (groupId: string, personId: string) =>
    groupId === GARCIA ? personId === SAM : (w.members.get(groupId) ?? []).some((p) => p.id === personId);
  const dateGroups = new Map([
    [IDS.xmas, IDS.rivera], [GRAN_80TH, IDS.rivera], [BOOK_SWAP, IDS.bookClub], [ELSEWHERE_DATE, ELSEWHERE],
  ]);

  return {
    // The whole row, as the action answers it.
    createGroup: vi.fn(async (input: { name: string; description?: string; type: string }) => ({
      data: {
        id: GARCIA,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        invite_code: "SECRET12",
        settings: { secretSanta: false },
        created_by: SAM,
        created_at: "2026-11-12T10:00:00.000000+00:00",
        updated_at: "2026-11-12T10:00:00.000000+00:00",
      },
    })),
    joinGroupByCode: vi.fn(async () => ({ data: { id: IDS.rivera } })),
    // As the action answers a first invitation whose email went.
    sendGroupInvitation: vi.fn(async () => ({ emailSent: true, isResend: false })),
    leaveGroup: vi.fn(async () => ({ success: true })),
    deleteGroup: vi.fn(async () => ({ success: true })),
    createGroupDate: vi.fn(async () => ({ data: { id: GRAN_80TH } })),
    updateGroupDate: vi.fn(async (id: string) => ({ data: { id } })),
    deleteGroupDate: vi.fn(async () => ({ ok: true })),
    groupSummary: vi.fn(async (groupId: string) => (isIn(groupId, SAM) ? summaries.get(groupId) ?? null : null)),
    callerRole: vi.fn(async (groupId: string, userId: string) => (isIn(groupId, userId) ? roleIn(groupId, userId) : null)),
    inviteCodeOf: vi.fn(async (groupId: string) => (groupId === IDS.rivera ? CODE : isIn(groupId, SAM) ? "BKC-LUB-234" : null)),
    groupNameOf: vi.fn(async (groupId: string) => (isIn(groupId, SAM) ? summaries.get(groupId)?.name ?? null : null)),
    // A group's dates are seen only by its members. A birthday's or an anniversary's row is no group date, so the read,
    // which asks only for group dates, finds none.
    groupDateRow: vi.fn(async (dateId: string) => {
      const groupId = dateGroups.get(dateId);
      return groupId !== undefined && isIn(groupId, SAM) ? { id: dateId, groupId } : null;
    }),
  };
}
