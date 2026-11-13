// Tests only. The groups Task A4's routes act on, and the actions and reads they call, answering from world().
import { vi, type Mock } from "vitest";
import type { GroupRole } from "./groups";
import type { GroupSummary } from "./shopping";
import { fixture } from "./test-fixtures";
import { IDS, SAM, world } from "./test-shopping";

/** Rivera Family's invite code. */
export const CODE = "K7P-MXR-4TQ";
/** The group group-request.json makes. */
export const GARCIA = "5a6b7c8d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";
export const RIVERA_DESCRIPTION = "Everyone on Mom's side.";

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
  | "groupSummary" | "callerRole" | "inviteCodeOf" | "groupNameOf",
  Mock
>;

/**
 * The group and invitation actions, each succeeding as the website's does, and the reads of lib/mobile/group-reads as
 * Sam's own client would answer them: the world's two groups, and Garcia Cousins once it is made.
 */
export function groupMocks(): GroupMocks {
  const w = world();
  const summaries = new Map<string, GroupSummary>(
    [...fixture("group-list").groups, fixture("group-created").group].map((g: GroupSummary) => [g.id, g]),
  );
  const isIn = (groupId: string, personId: string) =>
    groupId === GARCIA ? personId === SAM : (w.members.get(groupId) ?? []).some((p) => p.id === personId);

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
    groupSummary: vi.fn(async (groupId: string) => (isIn(groupId, SAM) ? summaries.get(groupId) ?? null : null)),
    callerRole: vi.fn(async (groupId: string, userId: string) => (isIn(groupId, userId) ? roleIn(groupId, userId) : null)),
    inviteCodeOf: vi.fn(async (groupId: string) => (groupId === IDS.rivera ? CODE : isIn(groupId, SAM) ? "BKC-LUB-234" : null)),
    groupNameOf: vi.fn(async (groupId: string) => (isIn(groupId, SAM) ? summaries.get(groupId)?.name ?? null : null)),
  };
}
