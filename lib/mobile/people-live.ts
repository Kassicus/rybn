import { getUpcomingOccasions } from "@/lib/actions/occasions";
import { getSharedGroups } from "@/lib/actions/profile";
import { createClient } from "@/lib/supabase/server";
import { withSignedWishlistImages } from "@/lib/supabase/signed-image";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { databaseFailure } from "./action-response";
import type { LinkedItem } from "./gifts";
import { occasionsInvolving, type OccasionRow, type PersonRow } from "./occasions";

const PERSON_COLUMNS = "id, username, display_name, avatar_url";
const OCCASION_COLUMNS =
  "id, kind, name, occasion_date, celebrant_id, partner_id, group_id, groups ( name )";

type DbError = { message: string };

function failure(fn: string, error: DbError): Error {
  return new Error(`${fn} failed: ${error.message}`);
}

const unique = (ids: string[]) => [...new Set(ids)];

/** The caller's own client throughout: row-level security decides what comes back. */
export async function profiles(ids: string[]): Promise<Map<string, PersonRow>> {
  const wanted = unique(ids);
  const found = new Map<string, PersonRow>();
  if (wanted.length === 0) return found;
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_profiles").select(PERSON_COLUMNS).in("id", wanted);
  if (error) throw failure("profiles", error);
  for (const p of data ?? []) {
    found.set(p.id, { id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url });
  }
  return found;
}

export async function groupMembers(groupIds: string[]): Promise<Map<string, PersonRow[]>> {
  const wanted = unique(groupIds);
  const members = new Map<string, PersonRow[]>();
  if (wanted.length === 0) return members;
  const supabase = await createClient();
  const { data, error } = await supabase.from("group_members").select("group_id, user_id").in("group_id", wanted);
  if (error) throw failure("groupMembers", error);
  const rows = data ?? [];
  const people = await profiles(rows.map((r) => r.user_id));
  for (const r of rows) {
    const person = people.get(r.user_id);
    if (!person) continue;
    const list = members.get(r.group_id) ?? [];
    list.push(person);
    members.set(r.group_id, list);
  }
  return members;
}

function countBy(rows: Record<string, string>[], column: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r[column], (counts.get(r[column]) ?? 0) + 1);
  return counts;
}

export async function memberCounts(groupIds: string[]): Promise<Map<string, number>> {
  const wanted = unique(groupIds);
  if (wanted.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("group_members").select("group_id").in("group_id", wanted);
  if (error) throw failure("memberCounts", error);
  return countBy(data ?? [], "group_id");
}

/** Only what the caller may see is counted: row-level security does the filtering. */
export async function visibleItemCounts(ownerIds: string[]): Promise<Map<string, number>> {
  const wanted = unique(ownerIds);
  if (wanted.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("wishlist_items").select("user_id").in("user_id", wanted);
  if (error) throw failure("visibleItemCounts", error);
  return countBy(data ?? [], "user_id");
}

export async function occasionRows(ids: string[]): Promise<OccasionRow[]> {
  const wanted = unique(ids);
  if (wanted.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("occasions").select(OCCASION_COLUMNS).in("id", wanted);
  if (error) throw failure("occasionRows", error);
  return (data ?? []) as unknown as OccasionRow[];
}

/**
 * The items these gifts point at, as the caller may see them. An item the owner hid or deleted is simply absent:
 * a gift's stored item id proves nothing about what the caller can still see.
 */
export async function linkedItems(ids: string[], viewerId: string): Promise<Map<string, LinkedItem>> {
  const wanted = unique(ids);
  const items = new Map<string, LinkedItem>();
  if (wanted.length === 0) return items;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wishlist_items")
    .select("id, user_id, image_url, purchased")
    .in("id", wanted);
  if (error) throw failure("linkedItems", error);
  const signed = await withSignedWishlistImages(data ?? [], viewerId);
  for (const r of signed) {
    items.set(r.id, { id: r.id, ownerId: r.user_id, purchased: r.purchased === true, imageUrl: r.image_url });
  }
  return items;
}

/** The caller's upcoming occasions a year ahead, or the Response to send instead. */
export async function upcomingForCaller(): Promise<Response | UpcomingOccasion[]> {
  const result = await getUpcomingOccasions(365);
  const failed = databaseFailure(result, "getUpcomingOccasions");
  if (failed) return failed;
  return result.data ?? [];
}

/** §5.1: the occasions that involve one person, among the caller's upcoming. */
export async function occasionsForPerson(personId: string): Promise<Response | UpcomingOccasion[]> {
  const upcoming = await upcomingForCaller();
  if (upcoming instanceof Response) return upcoming;
  const shared = await getSharedGroups(personId);
  const failed = databaseFailure(shared, "getSharedGroups");
  if (failed) return failed;
  const groups = ("data" in shared ? shared.data : undefined) ?? [];
  return occasionsInvolving(personId, upcoming, new Set(groups.map((g: { id: string }) => g.id)));
}
