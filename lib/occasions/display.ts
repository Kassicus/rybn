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
    // group_date_shape (20260910100000_occasions_schema.sql) requires name
    // to be set whenever kind = 'group_date', so this fallback is not
    // reachable through any row the database will actually hand back --
    // it exists only as a defensive floor against a malformed input.
    return o.name ?? "Group occasion";
  }

  // celebrated_shape guarantees celebrant_id is set for a birthday/
  // anniversary row, and get_upcoming_occasions always joins it to a
  // user_profiles row to source these two columns, so "Someone" is likewise
  // a defensive floor, not a reachable case.
  const who = o.celebrantDisplayName ?? o.celebrantUsername ?? "Someone";
  // Case-insensitive: display names are free-text user input and can be any
  // case ("CHRIS", "chris", "Chris"). Testing only the lowercase "s" let
  // an uppercase-terminal name double up ("CHRIS's Birthday").
  const possessive = /s$/i.test(who) ? `${who}'` : `${who}'s`;
  return `${possessive} ${KIND_NOUN[o.kind]}`;
}

/**
 * Whole days from `today` to the occasion.
 *
 * `occasionDate` is a calendar day ('YYYY-MM-DD'), not an instant, so it is
 * parsed as one directly. `today` IS an instant, and this function reads it
 * using the LOCAL calendar fields of whatever clock produced it
 * (getFullYear/getMonth/getDate) -- because that is what "today" means to
 * that clock. It does not know or care whose timezone that clock is set to:
 * a caller that wants the label to match a particular viewer's day must
 * construct `today` from that viewer's own clock (e.g. a Date built
 * client-side) and pass it in. Deciding which clock reaches this function is
 * the caller's responsibility, not this function's.
 */
export function daysUntil(occasionDate: string, today: Date = new Date()): number {
  const [y, m, d] = occasionDate.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const from = Date.UTC(
    today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - from) / 86_400_000);
}
