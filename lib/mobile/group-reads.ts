/**
 * One group's columns, and its dates', read with the caller's own client: row-level security shows a group and its dates
 * only to its members, so each read answers null, or nothing, for a group the caller is not in. Each names the columns
 * it reads, and throws on a database error.
 */
import { createClient } from "@/lib/supabase/server";
import { failure } from "./database";
import { groupRole, type GroupRole } from "./groups";
import { inChunks, memberCounts } from "./people-live";
import type { GroupSummary } from "./shopping";
import { mobileGroups } from "./wishlist";

/**
 * The group's id, name and kind with its member count, as `GET /groups` lists it. A group that list leaves out, one
 * stored with an empty name, answers null here too (mobileGroups decides both).
 */
export async function groupSummary(groupId: string): Promise<GroupSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("groups").select("id, name, type").eq("id", groupId).maybeSingle();
  if (error) throw failure("groupSummary", error);
  const [group] = data ? mobileGroups([data]) : [];
  if (!group) return null;
  const counts = await memberCounts([group.id]);
  return { id: group.id, name: group.name, type: group.type, memberCount: counts.get(group.id) ?? 0 };
}

/** The caller's role in the group, or null when they are not in it. */
export async function callerRole(groupId: string, userId: string): Promise<GroupRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw failure("callerRole", error);
  return data ? groupRole(data.role) : null;
}

/** The group's invite code, which lets anyone holding it join: only `GET /groups/{id}/invite` answers it. */
export async function inviteCodeOf(groupId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("groups").select("invite_code").eq("id", groupId).maybeSingle();
  if (error) throw failure("inviteCodeOf", error);
  return data ? data.invite_code : null;
}

/** The group's name. */
export async function groupNameOf(groupId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("groups").select("name").eq("id", groupId).maybeSingle();
  if (error) throw failure("groupNameOf", error);
  return data ? data.name : null;
}

/** A group date's id and the group it is in, or null when there is none the caller can see (they are not in its group). */
export async function groupDateRow(dateId: string): Promise<{ id: string; groupId: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("occasions")
    .select("id, group_id")
    .eq("id", dateId)
    .eq("kind", "group_date")
    .maybeSingle();
  if (error) throw failure("groupDateRow", error);
  return data && data.group_id !== null ? { id: data.id, groupId: data.group_id } : null;
}

/**
 * Who made each of these group dates, by date id: null for a date whose maker's account is gone. Read only for group
 * dates, and only to compare with the caller; a date the caller cannot see is left out.
 */
export async function groupDateMakers(ids: string[]): Promise<Map<string, string | null>> {
  const makers = new Map<string, string | null>();
  if (ids.length === 0) return makers;
  const supabase = await createClient();
  const rows = await inChunks(ids, async (chunk) => {
    const { data, error } = await supabase
      .from("occasions")
      .select("id, created_by")
      .in("id", chunk)
      .eq("kind", "group_date");
    if (error) throw failure("groupDateMakers", error);
    return data ?? [];
  });
  for (const r of rows) makers.set(r.id, r.created_by);
  return makers;
}
