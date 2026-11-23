"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { GroupGiftFormData, ContributionUpdateData } from "@/lib/schemas/gifts";
import {
  GIFT_COLUMNS,
  MEMBERSHIP_COLUMNS,
  giftPeople,
  giftRow,
  groupMates,
  membershipRow,
  recipientIds,
  seeGift,
  type GiftPerson,
  type GiftRow,
  type MembershipRow,
} from "@/lib/gifts/access";
import { byGiftPersonName, giftPersonName } from "@/lib/gifts/names";
import { GIFT_LIMITS, GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { CONTROL_EXCEPT_NOTES_WHITESPACE } from "@/lib/utils/characters";
import { tidyGroupText } from "@/lib/utils/groups";

import { getUserId } from "@/lib/auth/require-auth";

/** The words of an error a shared read threw. */
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** These people, by name (byGiftPersonName); an id with no profile row is left out. */
function peopleFor(ids: readonly string[] | undefined, people: Map<string, GiftPerson>): GiftPerson[] {
  return (ids ?? []).flatMap((id) => people.get(id) ?? []).sort(byGiftPersonName);
}

/**
 * Group id → its name, for those of these groups the caller has a group_members row in, read with the caller's own
 * client: a gift's group is named only to someone in it. Throws the database's message.
 */
async function myGroupNames(userId: string, groupIds: string[]): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_members")
    .select("group_id, groups ( name )")
    .eq("user_id", userId)
    .in("group_id", [...new Set(groupIds)]);
  if (error) throw new Error(error.message);
  const names = new Map<string, string>();
  for (const row of data ?? []) if (row.groups) names.set(row.group_id, row.groups.name);
  return names;
}

/**
 * Start a group gift in one of the caller's groups, saying who it is for: people the caller shares a group with,
 * or nobody (an empty list: someone not on Rybn). Each refusal is a sentence from GIFT_SENTENCES and writes nothing.
 *
 * The gift, its names and its maker's member row are written in that order with the service-role client. If the
 * names or the member row cannot be written, the gift is deleted, which takes its names with it.
 */
export async function createGroupGift(
  formData: GroupGiftFormData
): Promise<{ data: GiftRow; error?: never } | { error: string; data?: never }> {
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  if (!Array.isArray(formData.recipient_ids)) {
    return { error: GIFT_SENTENCES.chooseWho };
  }

  // Tidying turns every control character into a space, so no unsavable character can remain in a name.
  const name = typeof formData.name === "string" ? tidyGroupText(formData.name) : "";
  if (name === "") return { error: GIFT_SENTENCES.nameMissing };
  if (name.length > GIFT_LIMITS.name) return { error: GIFT_SENTENCES.nameTooLong };

  const description = typeof formData.description === "string" ? formData.description.trim() : "";
  if (description.length > GIFT_LIMITS.description) return { error: GIFT_SENTENCES.descriptionTooLong };
  if (CONTROL_EXCEPT_NOTES_WHITESPACE.test(description)) return { error: GIFT_SENTENCES.characters };

  const target: unknown = formData.target_amount;
  if (
    target != null &&
    !(typeof target === "number" && Number.isFinite(target) && target >= 0 && target <= GIFT_LIMITS.amount)
  ) {
    return { error: GIFT_SENTENCES.amount };
  }

  const asked = [...new Set<unknown>(formData.recipient_ids)];
  if (asked.length > GIFT_LIMITS.recipients) return { error: GIFT_SENTENCES.tooManyRecipients };

  const supabase = await createClient();
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", formData.group_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) return { error: membershipError.message };
  if (!membership) return { error: GIFT_SENTENCES.notInGroup };

  // Anyone the caller could add can be named; the caller is not among their own group-mates.
  let named: string[] = [];
  if (asked.length > 0) {
    const mates = await groupMates(userId);
    if ("error" in mates) return { error: mates.error };
    const allowed = new Set(mates.people.map((p) => p.id));
    named = asked.filter((id): id is string => typeof id === "string" && allowed.has(id));
    if (named.length !== asked.length) return { error: GIFT_SENTENCES.recipientNotAllowed };
  }

  const adminClient = createAdminClient();

  const { data: groupGift, error: groupGiftError } = await adminClient
    .from("group_gifts")
    .insert({
      name,
      description: description === "" ? null : description,
      group_id: formData.group_id,
      target_amount: typeof target === "number" && target !== 0 ? target : null,
      is_active: formData.is_active,
      created_by: userId,
    })
    .select(GIFT_COLUMNS)
    .single();

  if (groupGiftError) {
    return { error: groupGiftError.message };
  }

  /** Removes the gift a later write could not finish; its names go with it. */
  const undo = async (what: string, message: string) => {
    console.error(`createGroupGift: ${what} could not be saved:`, message);
    const { error } = await adminClient.from("group_gifts").delete().eq("id", groupGift.id);
    if (error) console.error("createGroupGift: the unfinished gift could not be removed:", error.message);
    return { error: GIFT_SENTENCES.createFailed };
  };

  if (named.length > 0) {
    const { error: namesError } = await adminClient
      .from("group_gift_recipients")
      .insert(named.map((user_id) => ({ group_gift_id: groupGift.id, user_id })));
    if (namesError) return undo("who the gift is for", namesError.message);
  }

  const { error: memberError } = await adminClient.from("group_gift_members").insert({
    group_gift_id: groupGift.id,
    user_id: userId,
    contribution_amount: 0,
    has_paid: false,
  });
  if (memberError) return undo("its maker's member row", memberError.message);

  revalidatePath("/gifts");
  revalidatePath(`/groups/${formData.group_id}`);

  return { data: giftRow(groupGift) };
}

/** A group gift in the caller's list, with their own pledge and what the list shows of it. */
export interface MyGroupGift extends GiftRow {
  my_contribution: number | null;
  my_has_paid: boolean | null;
  my_joined_at: string | null;
  member_count: number;
  /** Who it is for, by name; empty when it names nobody. */
  recipients: GiftPerson[];
  /** The gift's group's name, or null when the caller is not in that group. */
  group_name: string | null;
}

/**
 * Every group gift the caller is in, by when they joined it, newest first. A gift that names the caller is left
 * out, and nothing more is read about it.
 */
export async function getMyGroupGifts(): Promise<{ data: MyGroupGift[]; error?: string }> {
  const userId = await getUserId();

  if (!userId) {
    return { data: [] };
  }

  const adminClient = createAdminClient();

  const { data: memberships, error } = await adminClient
    .from("group_gift_members")
    .select(
      "group_gift_id, contribution_amount, has_paid, joined_at, group_gifts ( id, group_id, name, description, target_amount, current_amount, is_active, created_by, created_at )"
    )
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });

  if (error) {
    return { error: error.message, data: [] };
  }

  try {
    const rows = (memberships ?? []).flatMap((m) => (m.group_gifts ? [{ mine: m, gift: m.group_gifts }] : []));
    const names = await recipientIds(adminClient, rows.map((r) => r.gift.id));
    const kept = rows.filter(({ gift }) => !names.get(gift.id)?.includes(userId));
    if (kept.length === 0) return { data: [] };

    const keptIds = kept.map((r) => r.gift.id);
    const [members, people, groupNames] = await Promise.all([
      adminClient.from("group_gift_members").select("group_gift_id").in("group_gift_id", keptIds),
      giftPeople(adminClient, keptIds.flatMap((id) => names.get(id) ?? [])),
      myGroupNames(userId, kept.map((r) => r.gift.group_id)),
    ]);
    if (members.error) return { error: members.error.message, data: [] };

    const counts = new Map<string, number>();
    for (const m of members.data ?? []) counts.set(m.group_gift_id, (counts.get(m.group_gift_id) ?? 0) + 1);

    return {
      data: kept.map(({ mine, gift }) => ({
        ...giftRow(gift),
        my_contribution: mine.contribution_amount,
        my_has_paid: mine.has_paid,
        my_joined_at: mine.joined_at,
        member_count: counts.get(gift.id) ?? 0,
        recipients: peopleFor(names.get(gift.id), people),
        group_name: groupNames.get(gift.group_id) ?? null,
      })),
    };
  } catch (e) {
    return { error: messageOf(e), data: [] };
  }
}

/**
 * Get group gifts for a specific group
 */
export async function getGroupGiftsByGroup(groupId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member of the group
  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .single();

  if (!membership) {
    return { error: "You must be a member of this group" };
  }

  // Get all group gifts for this group
  const { data: groupGifts, error } = await supabase
    .from("group_gifts")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { data: groupGifts || [] };
}

/** A group gift as one of its members sees it. */
export interface SeenGroupGift extends GiftRow {
  /** The maker first, then by when they joined, then by member row id. */
  group_gift_members: (MembershipRow & { user_profiles: GiftPerson | null })[];
  my_membership: MembershipRow;
  /** Who it is for, by name; empty when it names nobody. */
  recipients: GiftPerson[];
  /** The gift's group's name, or null when the caller is not in that group. */
  group_name: string | null;
  /** How many messages the chat holds, and the newest: its sender's name and its text. */
  chat: { count: number; latest: { name: string; text: string } | null };
}

const compare = <T extends string | number>(a: T, b: T) => (a === b ? 0 : a < b ? -1 : 1);

/** When a member joined, in milliseconds; a row without a readable time sorts last. */
function joinedAt(m: MembershipRow): number {
  const at = m.joined_at === null ? NaN : Date.parse(m.joined_at);
  return Number.isNaN(at) ? Infinity : at;
}

/**
 * One group gift, for someone in it: its members with their pledges, who it is for, its group's name and its
 * chat's count and newest message. Group gift not found, and nothing more read, for a gift the caller is not in,
 * one that names the caller, and one that does not exist (seeGift).
 */
export async function getGroupGiftById(
  groupGiftId: string
): Promise<{ data: SeenGroupGift; error?: never } | { error: string; data?: never }> {
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const adminClient = createAdminClient();

  const seen = await seeGift(adminClient, groupGiftId, userId);
  if (!seen.ok) return { error: seen.error };
  const { gift, membership } = seen;

  try {
    const [members, names, count, newest, groupNames] = await Promise.all([
      adminClient.from("group_gift_members").select(MEMBERSHIP_COLUMNS).eq("group_gift_id", gift.id),
      recipientIds(adminClient, [gift.id]),
      adminClient.from("messages").select("id", { count: "exact", head: true }).eq("group_gift_id", gift.id),
      adminClient
        .from("messages")
        .select("user_id, content")
        .eq("group_gift_id", gift.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1),
      myGroupNames(userId, [gift.group_id]),
    ]);

    const failed = members.error ?? count.error ?? newest.error;
    if (failed) return { error: failed.message };

    const memberRows = (members.data ?? [])
      .map(membershipRow)
      .sort(
        (a, b) =>
          compare(Number(b.user_id === gift.created_by), Number(a.user_id === gift.created_by)) ||
          compare(joinedAt(a), joinedAt(b)) ||
          compare(a.id, b.id)
      );
    const giftNames = names.get(gift.id) ?? [];
    const latest = newest.data?.[0] ?? null;

    const people = await giftPeople(adminClient, [
      ...memberRows.map((m) => m.user_id),
      ...giftNames,
      ...(latest ? [latest.user_id] : []),
    ]);

    return {
      data: {
        ...gift,
        group_gift_members: memberRows.map((m) => ({ ...m, user_profiles: people.get(m.user_id) ?? null })),
        my_membership: membership,
        recipients: peopleFor(giftNames, people),
        group_name: groupNames.get(gift.group_id) ?? null,
        chat: {
          count: count.count ?? 0,
          latest: latest
            ? {
                name: giftPersonName(people.get(latest.user_id) ?? { display_name: null, username: null }),
                text: latest.content,
              }
            : null,
        },
      },
    };
  } catch (e) {
    return { error: messageOf(e) };
  }
}

/**
 * The caller's groups, and everyone who shares one with them (the caller left out), each with the ids of the
 * caller's groups they are in: who a new group gift can be in, and who it can be for.
 */
export async function getGroupGiftChoices(): Promise<
  | {
      data: { groups: { id: string; name: string }[]; people: (GiftPerson & { group_ids: string[] })[] };
      error?: never;
    }
  | { error: string; data?: never }
> {
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const mates = await groupMates(userId);
  if ("error" in mates) return { error: mates.error };
  return { data: mates };
}

/**
 * Update user's contribution to a group gift
 */
export async function updateMyContribution(
  groupGiftId: string,
  data: ContributionUpdateData
) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Update the membership
  const { error } = await supabase
    .from("group_gift_members")
    .update({
      contribution_amount: data.contribution_amount,
      has_paid: data.has_paid,
    })
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", userId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${groupGiftId}`);
  revalidatePath("/gifts");

  return { success: true };
}

/**
 * Add members to a group gift
 * Any member of the group gift can invite users from groups they share with
 */
export async function addMembersToGroupGift(groupGiftId: string, userIds: string[]) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member OR creator of the group gift (using admin client to avoid RLS recursion)
  const { data: groupGift } = await adminClient
    .from("group_gifts")
    .select("created_by, group_id")
    .eq("id", groupGiftId)
    .single();

  if (!groupGift) {
    return { error: "Group gift not found" };
  }

  // Check if user is creator or member
  const isCreator = groupGift.created_by === userId;
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!isCreator && !membership) {
    return { error: "You must be a member of this group gift to invite others" };
  }

  // Get all groups the inviter is a member of
  const { data: inviterGroups } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  if (!inviterGroups || inviterGroups.length === 0) {
    return { error: "You are not a member of any groups" };
  }

  const inviterGroupIds = inviterGroups.map(g => g.group_id);

  // Verify all users being invited are from groups the inviter shares
  const { data: inviteeGroupMemberships } = await supabase
    .from("group_members")
    .select("user_id, group_id")
    .in("user_id", userIds)
    .in("group_id", inviterGroupIds);

  if (!inviteeGroupMemberships) {
    return { error: "Failed to verify user memberships" };
  }

  // Check that each user being invited shares at least one group with the inviter
  const validUserIds = new Set(inviteeGroupMemberships.map(m => m.user_id));
  const invalidUsers = userIds.filter(userId => !validUserIds.has(userId));

  if (invalidUsers.length > 0) {
    return { error: "You can only invite users from groups you're a member of" };
  }

  // Add members using admin client to avoid RLS recursion
  const membersToAdd = userIds.map((userId) => ({
    group_gift_id: groupGiftId,
    user_id: userId,
    contribution_amount: 0,
    has_paid: false,
  }));

  const { error } = await adminClient
    .from("group_gift_members")
    .insert(membersToAdd);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${groupGiftId}`);

  return { success: true };
}

/**
 * Leave a group gift
 */
export async function leaveGroupGift(groupGiftId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Check if user is the creator
  const { data: groupGift } = await supabase
    .from("group_gifts")
    .select("created_by")
    .eq("id", groupGiftId)
    .single();

  if (groupGift?.created_by === userId) {
    return { error: "Creators cannot leave the group gift. Delete it instead." };
  }

  // Remove the member
  const { error } = await supabase
    .from("group_gift_members")
    .delete()
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", userId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gifts");
  return { success: true };
}

/**
 * Delete a group gift (creator only)
 */
export async function deleteGroupGift(groupGiftId: string) {
  const adminClient = createAdminClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator using admin client
  const { data: groupGift } = await adminClient
    .from("group_gifts")
    .select("created_by, group_id")
    .eq("id", groupGiftId)
    .single();

  if (!groupGift || groupGift.created_by !== userId) {
    return { error: "Only the creator can delete this group gift" };
  }

  // Delete the group gift using admin client (cascade will handle members and messages)
  const { error } = await adminClient
    .from("group_gifts")
    .delete()
    .eq("id", groupGiftId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/gifts");
  revalidatePath(`/groups/${groupGift.group_id}`);

  return { success: true };
}

/**
 * Update group gift details (creator only)
 */
export async function updateGroupGift(
  groupGiftId: string,
  updates: Partial<Pick<GroupGiftFormData, "name" | "description" | "target_amount" | "is_active">>
) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Verify user is the creator
  const { data: groupGift } = await supabase
    .from("group_gifts")
    .select("created_by")
    .eq("id", groupGiftId)
    .single();

  if (!groupGift || groupGift.created_by !== userId) {
    return { error: "Only the creator can update this group gift" };
  }

  // Update the group gift
  const { error } = await supabase
    .from("group_gifts")
    .update(updates)
    .eq("id", groupGiftId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${groupGiftId}`);
  revalidatePath("/gifts");

  return { success: true };
}

/**
 * Get available users from all groups the current user is in who can be invited to the group gift
 * Any member of the group gift can invite users from groups they share with
 */
export async function getAvailableGroupMembers(groupGiftId: string) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Get the group gift info (using admin client to avoid RLS issues)
  const { data: groupGift, error: groupGiftError } = await adminClient
    .from("group_gifts")
    .select("group_id, created_by")
    .eq("id", groupGiftId)
    .single();

  if (groupGiftError || !groupGift) {
    return { error: "Group gift not found" };
  }

  // Verify user is a member or creator of the group gift
  const isCreator = groupGift.created_by === userId;
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!isCreator && !membership) {
    return { error: "You must be a member of this group gift to manage members" };
  }

  // Get all groups the current user is a member of
  const { data: userGroups, error: userGroupsError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  if (userGroupsError) {
    return { error: userGroupsError.message };
  }

  if (!userGroups || userGroups.length === 0) {
    return { data: [] };
  }

  const userGroupIds = userGroups.map(g => g.group_id);

  // Get all members from all groups the user is in
  const { data: groupMembers, error: groupMembersError } = await supabase
    .from("group_members")
    .select("user_id")
    .in("group_id", userGroupIds);

  if (groupMembersError) {
    return { error: groupMembersError.message };
  }

  // Get current group gift members (using admin client)
  const { data: currentMembers, error: currentMembersError } = await adminClient
    .from("group_gift_members")
    .select("user_id")
    .eq("group_gift_id", groupGiftId);

  if (currentMembersError) {
    return { error: currentMembersError.message };
  }

  // Filter out users already in the group gift and the current user
  const currentMemberIds = new Set(currentMembers?.map((m) => m.user_id) || []);
  const uniqueUserIds = new Set(groupMembers?.map((gm) => gm.user_id) || []);
  const availableUserIds = Array.from(uniqueUserIds)
    .filter((memberId) => !currentMemberIds.has(memberId) && memberId !== userId);

  if (availableUserIds.length === 0) {
    return { data: [] };
  }

  // Get user profiles for available members
  const { data: profiles, error: profilesError } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", availableUserIds);

  if (profilesError) {
    return { error: profilesError.message };
  }

  return { data: profiles || [] };
}
