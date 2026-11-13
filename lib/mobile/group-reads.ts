/**
 * One group's columns, read with the caller's own client: row-level security shows a group only to its members, so each
 * read answers null for a group the caller is not in. Each names the columns it reads, and throws on a database error.
 */
import { createClient } from "@/lib/supabase/server";
import { failure } from "./database";
import { groupRole, type GroupRole } from "./groups";
import { memberCounts } from "./people-live";
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
