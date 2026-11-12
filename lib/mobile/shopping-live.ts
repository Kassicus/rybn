import { getGroupById, getMyGroups } from "@/lib/actions/groups";
import { getActiveClaims } from "@/lib/actions/claims";
import { getTagsForItems } from "@/lib/actions/item-occasions";
import { getUserWishlist } from "@/lib/actions/wishlist";
import { getSharedGroups } from "@/lib/actions/profile";
import { todayISO } from "@/lib/claims/active";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { GROUP_NOT_FOUND, NOT_A_MEMBER, NOT_SIGNED_IN, databaseFailure } from "./action-response";
import { PERSON_ID, pathUuid } from "./database";
import { createGiftStore } from "./gift-store-live";
import { loadGiftViews } from "./gift-views-live";
import type { PersonRow } from "./occasions";
import {
  groupMembers,
  memberCounts,
  profiles,
  upcomingForCaller,
  visibleItemCounts,
} from "./people-live";
import { reconcileGifts } from "./reconcile";
import { mobileError } from "./route";
import {
  buildGroupList,
  buildGroupPage,
  buildHome,
  buildPersonList,
  type GroupPage,
  type GroupSummary,
  type ListItemRow,
  type PersonListAnswer,
  type ShoppingOccasion,
} from "./shopping";
import type { GroupRow, MobileGroup } from "./wishlist";

/** The celebrants and partners of these occasions, whose names the occasions are titled with. */
const celebrantIds = (upcoming: UpcomingOccasion[]) =>
  upcoming.flatMap((o) => [o.celebrantId, o.partnerId].filter((id): id is string => id !== null));

export async function homeAnswer(userId: string): Promise<Response | { occasions: ShoppingOccasion[] }> {
  const today = todayISO();
  const store = await createGiftStore(userId);
  await reconcileGifts(store, today);
  const upcoming = await upcomingForCaller();
  if (upcoming instanceof Response) return upcoming;
  const groupIds = upcoming.flatMap((o) => (o.kind === "group_date" && o.groupId !== null ? [o.groupId] : []));
  const [members, people, views] = await Promise.all([
    groupMembers(groupIds),
    profiles(celebrantIds(upcoming)),
    loadGiftViews(userId, store, today),
  ]);
  return buildHome({ callerId: userId, upcoming, members, profiles: people, views });
}

export async function groupListAnswer(): Promise<Response | { groups: GroupSummary[] }> {
  const result = await getMyGroups();
  const failed = databaseFailure(result, "getMyGroups");
  if (failed) return failed;
  const rows = result.data as GroupRow[];
  const ids = rows.flatMap((r) => (typeof r.id === "string" ? [r.id] : []));
  return buildGroupList(rows, await memberCounts(ids));
}

interface GroupData {
  id: string;
  name: string;
  type: MobileGroup["type"] | null;
  group_members: { user_profiles: PersonRow | null }[];
}

export async function groupAnswer(userId: string, rawGroupId: string): Promise<Response | GroupPage> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  const today = todayISO();
  const store = await createGiftStore(userId);
  await reconcileGifts(store, today);

  const result = await getGroupById(groupId);
  if ("error" in result && result.error) {
    if (result.error === NOT_SIGNED_IN) return mobileError("unauthorized");
    if (result.error === GROUP_NOT_FOUND || result.error === NOT_A_MEMBER) return mobileError("not_found");
    throw new Error(`getGroupById failed: ${result.error}`);
  }
  const group = (result as { data: GroupData }).data;
  // Named columns only: the group's invite code and settings never leave this function.
  const members: PersonRow[] = group.group_members.flatMap((m) =>
    m.user_profiles === null
      ? []
      : [{
          id: m.user_profiles.id,
          username: m.user_profiles.username,
          display_name: m.user_profiles.display_name,
          avatar_url: m.user_profiles.avatar_url,
        }]);

  const itemCounts = await visibleItemCounts(members.map((m) => m.id));
  const upcoming = await upcomingForCaller();
  if (upcoming instanceof Response) return upcoming;
  const [people, views] = await Promise.all([profiles(celebrantIds(upcoming)), loadGiftViews(userId, store, today)]);
  return buildGroupPage({
    callerId: userId,
    group: { id: group.id, name: group.name, type: group.type ?? "custom" },
    members,
    itemCounts,
    upcoming,
    profiles: people,
    views,
  });
}

export async function personListAnswer(
  userId: string,
  personId: string,
  occasionKey: string | null,
): Promise<Response | PersonListAnswer> {
  if (!PERSON_ID.test(personId)) return mobileError("not_found");
  const today = todayISO();
  const store = await createGiftStore(userId);
  await reconcileGifts(store, today);

  const found = (await profiles([personId])).get(personId);
  if (!found) return mobileError("not_found");

  if (personId === userId) {
    // §5.5: the caller's own list is their items alone. No claims, tags, gifts or occasions are read.
    const own = await getUserWishlist(userId);
    const failed = databaseFailure(own, "getUserWishlist");
    if (failed) return failed;
    return buildPersonList({
      callerId: userId,
      person: found,
      upcoming: [],
      sharedGroupIds: new Set(),
      occasionKey,
      rows: (own as { data: ListItemRow[] }).data,
      claims: {},
      tags: {},
      views: [],
    });
  }

  const [upcoming, shared, list] = await Promise.all([
    upcomingForCaller(),
    getSharedGroups(personId),
    getUserWishlist(personId),
  ]);
  if (upcoming instanceof Response) return upcoming;
  const failedShared = databaseFailure(shared, "getSharedGroups");
  if (failedShared) return failedShared;
  const failedList = databaseFailure(list, "getUserWishlist");
  if (failedList) return failedList;
  const rows = (list as { data: ListItemRow[] }).data;
  const itemIds = rows.map((r) => r.id);

  const [claims, tags] = await Promise.all([getActiveClaims(itemIds), getTagsForItems(itemIds)]);
  const failedClaims = databaseFailure(claims, "getActiveClaims");
  if (failedClaims) return failedClaims;
  const failedTags = databaseFailure(tags, "getTagsForItems");
  if (failedTags) return failedTags;

  const views = await loadGiftViews(userId, store, today);
  return buildPersonList({
    callerId: userId,
    person: found,
    upcoming,
    sharedGroupIds: new Set(((shared as { data: { id: string }[] }).data ?? []).map((g) => g.id)),
    occasionKey,
    rows,
    claims: (claims as { data: Record<string, { claimedBy: string }> }).data,
    tags: (tags as { data: Record<string, string[]> }).data,
    views,
  });
}
