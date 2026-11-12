import {
  occasionLabel,
  type OccasionKind,
  type UpcomingOccasion,
} from "@/lib/occasions/display";
import { isOccasionFor, occasionCelebrantIds } from "@/lib/occasions/celebrant";

/** The columns of user_profiles these shapes read. */
export interface PersonRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface MobilePerson {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

const blank = (v: string | null | undefined): v is null | undefined => v == null || v.trim() === "";

/** Named fields only: never a row spread, never an email. */
export function mobilePerson(row: PersonRow): MobilePerson {
  return {
    id: row.id,
    name: !blank(row.display_name) ? row.display_name : !blank(row.username) ? row.username : "Someone",
    username: row.username,
    avatarUrl: row.avatar_url,
  };
}

export function byPersonName(a: MobilePerson, b: MobilePerson): number {
  return a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");
}

/**
 * Names an occasion whether or not it has a row yet: a group date by its row, a birthday or anniversary by what the
 * row's unique index uses (kind, celebrant, year).
 */
export function occasionKey(o: UpcomingOccasion): string {
  if (o.kind === "group_date") return `group_date:${o.occasionId ?? ""}`;
  return `${o.kind}:${o.celebrantId ?? ""}:${o.occasionDate.slice(0, 4)}`;
}

export interface MobileOccasion {
  key: string;
  kind: OccasionKind;
  title: string;
  date: string;
  group: { id: string; name: string } | null;
}

export function mobileOccasion(o: UpcomingOccasion): MobileOccasion {
  return {
    key: occasionKey(o),
    kind: o.kind,
    title: occasionLabel(o),
    date: o.occasionDate,
    group: o.kind === "group_date" && o.groupId !== null ? { id: o.groupId, name: o.groupName ?? "" } : null,
  };
}

/** The columns of an occasions row (with its group's name) that occasionFromRow reads. */
export interface OccasionRow {
  id: string;
  kind: OccasionKind;
  name: string | null;
  occasion_date: string;
  celebrant_id: string | null;
  partner_id: string | null;
  group_id: string | null;
  groups: { name: string } | null;
}

export function occasionFromRow(row: OccasionRow, profiles: ReadonlyMap<string, PersonRow>): UpcomingOccasion {
  const celebrant = row.celebrant_id === null ? undefined : profiles.get(row.celebrant_id);
  const partner = row.partner_id === null ? undefined : profiles.get(row.partner_id);
  return {
    occasionId: row.id,
    kind: row.kind,
    name: row.name,
    occasionDate: row.occasion_date,
    celebrantId: row.celebrant_id,
    celebrantUsername: celebrant?.username ?? null,
    celebrantDisplayName: celebrant?.display_name ?? null,
    groupId: row.group_id,
    groupName: row.groups?.name ?? null,
    partnerId: row.partner_id,
    partnerUsername: partner?.username ?? null,
    partnerDisplayName: partner?.display_name ?? null,
  };
}

/** §4.2: not the caller's own birthday, and their own anniversary only with a linked partner. */
export function homeOccasions(upcoming: UpcomingOccasion[], callerId: string): UpcomingOccasion[] {
  return upcoming.filter((o) => {
    if (o.kind === "birthday") return o.celebrantId !== callerId;
    if (o.kind === "anniversary") return !isOccasionFor(o, callerId) || o.partnerId !== null;
    return true;
  });
}

/** §5.1: birthdays and anniversaries that are the person's, and the group dates of groups they share with the caller. */
export function occasionsInvolving(
  personId: string,
  upcoming: UpcomingOccasion[],
  sharedGroupIds: ReadonlySet<string>,
): UpcomingOccasion[] {
  return upcoming.filter((o) =>
    o.kind === "group_date"
      ? o.groupId !== null && sharedGroupIds.has(o.groupId)
      : isOccasionFor(o, personId));
}

export function shoppingPeople(
  o: UpcomingOccasion,
  callerId: string,
  members: ReadonlyMap<string, PersonRow[]>,
  profiles: ReadonlyMap<string, PersonRow>,
): PersonRow[] {
  let people: PersonRow[];
  if (o.kind === "group_date") {
    people = (o.groupId === null ? [] : members.get(o.groupId) ?? []).filter((p) => p.id !== callerId);
  } else {
    people = occasionCelebrantIds(o)
      .filter((id) => id !== callerId)
      .map((id): PersonRow => {
        const known = profiles.get(id);
        if (known) return known;
        const isPartner = id === o.partnerId && id !== o.celebrantId;
        return {
          id,
          username: isPartner ? o.partnerUsername : o.celebrantUsername,
          display_name: isPartner ? o.partnerDisplayName : o.celebrantDisplayName,
          avatar_url: null,
        };
      });
  }
  return [...people].sort((a, b) => byPersonName(mobilePerson(a), mobilePerson(b)));
}

/** The ids of the groups in `members` that contain `personId`. */
export function sharedGroupIds(personId: string, members: ReadonlyMap<string, PersonRow[]>): Set<string> {
  const ids = new Set<string>();
  for (const [groupId, people] of members) if (people.some((p) => p.id === personId)) ids.add(groupId);
  return ids;
}
