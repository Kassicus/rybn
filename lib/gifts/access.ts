/**
 * The one check every read of a group gift goes through, and the reads the group gift actions share.
 *
 * A gift's rows are read with the service-role client, which the caller passes in: only it can read who a gift is
 * for (group_gift_recipients), and every action has already checked who is asking. Who shares a group with the
 * caller is read with the caller's own client, so row-level security decides what comes back.
 *
 * Not "use server", so nothing here can be called from a browser; never imported by a client component.
 */
import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { byGiftPersonName } from "./names";
import { GIFT_SENTENCES } from "./sentences";

/** A group gift's columns, named: target_user_id is neither read nor written. */
export const GIFT_COLUMNS =
  "id, group_id, name, description, target_amount, current_amount, is_active, created_by, created_at";
/** A member row's columns. */
export const MEMBERSHIP_COLUMNS = "id, group_gift_id, user_id, contribution_amount, has_paid, joined_at";
/** A person's columns: never an email. */
export const PERSON_COLUMNS = "id, username, display_name, avatar_url";

export interface GiftRow {
  id: string;
  group_id: string;
  name: string;
  description: string | null;
  target_amount: number | null;
  current_amount: number | null;
  is_active: boolean | null;
  created_by: string;
  created_at: string | null;
}

export interface MembershipRow {
  id: string;
  group_gift_id: string;
  user_id: string;
  contribution_amount: number | null;
  has_paid: boolean | null;
  joined_at: string | null;
}

export interface GiftPerson {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

export type Seen = { ok: true; gift: GiftRow; membership: MembershipRow } | { ok: false; error: string };

// Named fields only, so an answer never carries a column it was not asked for.

export function giftRow(r: GiftRow): GiftRow {
  return {
    id: r.id,
    group_id: r.group_id,
    name: r.name,
    description: r.description,
    target_amount: r.target_amount,
    current_amount: r.current_amount,
    is_active: r.is_active,
    created_by: r.created_by,
    created_at: r.created_at,
  };
}

export function membershipRow(r: MembershipRow): MembershipRow {
  return {
    id: r.id,
    group_gift_id: r.group_gift_id,
    user_id: r.user_id,
    contribution_amount: r.contribution_amount,
    has_paid: r.has_paid,
    joined_at: r.joined_at,
  };
}

export function giftPerson(r: GiftPerson): GiftPerson {
  return { id: r.id, username: r.username, display_name: r.display_name, avatar_url: r.avatar_url };
}

/**
 * The gift and the caller's row in it. ok false with GIFT_SENTENCES.notThere when the caller has no member row in
 * it, is named on it, or it does not exist; ok false with the database's message when a read fails.
 *
 * The database already refuses a member row for a person a gift names; this check holds even if one existed.
 */
export async function seeGift(admin: Admin, groupGiftId: string, userId: string): Promise<Seen> {
  const [gift, membership, named] = await Promise.all([
    admin.from("group_gifts").select(GIFT_COLUMNS).eq("id", groupGiftId).maybeSingle(),
    admin
      .from("group_gift_members")
      .select(MEMBERSHIP_COLUMNS)
      .eq("group_gift_id", groupGiftId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("group_gift_recipients")
      .select("user_id")
      .eq("group_gift_id", groupGiftId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const failed = gift.error ?? membership.error ?? named.error;
  if (failed) return { ok: false, error: failed.message };
  if (!gift.data || !membership.data || named.data) return { ok: false, error: GIFT_SENTENCES.notThere };
  return { ok: true, gift: giftRow(gift.data), membership: membershipRow(membership.data) };
}

/** Gift id → who it is for, by user_id. A gift with no names has no entry. Throws the database's message. */
export async function recipientIds(admin: Admin, groupGiftIds: string[]): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  if (groupGiftIds.length === 0) return names;
  const { data, error } = await admin
    .from("group_gift_recipients")
    .select("group_gift_id, user_id")
    .in("group_gift_id", [...new Set(groupGiftIds)]);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const list = names.get(row.group_gift_id) ?? [];
    list.push(row.user_id);
    names.set(row.group_gift_id, list);
  }
  return names;
}

/** These people's named columns, by id; someone with no profile row is absent. Throws the database's message. */
export async function giftPeople(admin: Admin, ids: string[]): Promise<Map<string, GiftPerson>> {
  const people = new Map<string, GiftPerson>();
  if (ids.length === 0) return people;
  const { data, error } = await admin
    .from("user_profiles")
    .select(PERSON_COLUMNS)
    .in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) people.set(row.id, giftPerson(row));
  return people;
}

/**
 * Everyone who shares a group with the caller, the caller left out, read with the caller's own client. The groups
 * are the caller's, by name; each person carries the ids of the caller's groups they are in, in that order. People
 * are by name (byGiftPersonName).
 */
export async function groupMates(userId: string): Promise<
  | { groups: { id: string; name: string }[]; people: (GiftPerson & { group_ids: string[] })[] }
  | { error: string }
> {
  const supabase = await createClient();

  const mine = await supabase.from("group_members").select("group_id, groups ( id, name )").eq("user_id", userId);
  if (mine.error) return { error: mine.error.message };
  const groups = (mine.data ?? [])
    .flatMap((row) => (row.groups ? [{ id: row.groups.id, name: row.groups.name }] : []))
    .sort((a, b) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (groups.length === 0) return { groups: [], people: [] };

  const members = await supabase
    .from("group_members")
    .select("group_id, user_id")
    .in(
      "group_id",
      groups.map((g) => g.id),
    );
  if (members.error) return { error: members.error.message };

  const groupsOf = new Map<string, Set<string>>();
  for (const row of members.data ?? []) {
    if (row.user_id === userId) continue;
    const set = groupsOf.get(row.user_id) ?? new Set<string>();
    set.add(row.group_id);
    groupsOf.set(row.user_id, set);
  }
  if (groupsOf.size === 0) return { groups, people: [] };

  const profiles = await supabase
    .from("user_profiles")
    .select(PERSON_COLUMNS)
    .in("id", [...groupsOf.keys()]);
  if (profiles.error) return { error: profiles.error.message };

  const people = (profiles.data ?? [])
    .map((row) => ({
      ...giftPerson(row),
      group_ids: groups.filter((g) => groupsOf.get(row.id)?.has(g.id)).map((g) => g.id),
    }))
    .sort(byGiftPersonName);

  return { groups, people };
}
