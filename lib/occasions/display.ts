export type OccasionKind = "birthday" | "anniversary" | "group_date";

export interface UpcomingOccasion {
  /** Null until phase 2 materializes a row for a derived occasion. */
  occasionId: string | null;
  kind: OccasionKind;
  /** Set for group_date only. */
  name: string | null;
  /** Calendar day as 'YYYY-MM-DD'. Not an instant -- see daysUntil. */
  occasionDate: string;
  celebrantId: string | null;
  celebrantUsername: string | null;
  celebrantDisplayName: string | null;
  groupId: string | null;
  groupName: string | null;
}

const KIND_NOUN: Record<Exclude<OccasionKind, "group_date">, string> = {
  birthday: "Birthday",
  anniversary: "Anniversary",
};

/** "Mom's Birthday", "Chris' Birthday", "Christmas 2026". */
export function occasionLabel(o: UpcomingOccasion): string {
  if (o.kind === "group_date") {
    return o.name ?? "Group occasion";
  }

  const who = o.celebrantDisplayName ?? o.celebrantUsername ?? "Someone";
  const possessive = who.endsWith("s") ? `${who}'` : `${who}'s`;
  return `${possessive} ${KIND_NOUN[o.kind]}`;
}

/**
 * Whole days from today to the occasion.
 *
 * occasionDate is a calendar day, so both sides are reduced to UTC midnight
 * before subtracting. Comparing a 'YYYY-MM-DD' against a local-time Date
 * directly slips a day either side of midnight depending on the viewer's
 * offset -- which reads as an off-by-one bug to anyone not in UTC.
 */
export function daysUntil(occasionDate: string, today: Date = new Date()): number {
  const [y, m, d] = occasionDate.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const from = Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - from) / 86_400_000);
}
