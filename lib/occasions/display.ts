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
  /**
   * Set only when the viewer can see BOTH partners' anniversary dates --
   * get_upcoming_occasions collapses a confirmed couple's anniversary to one
   * row, per viewer, and leaves these null otherwise. A viewer entitled to
   * see only one partner gets that person's row with these null, exactly as
   * before this feature existed -- that is the correct rendering for them,
   * not a missing-data fallback.
   *
   * Optional (rather than required-but-nullable) so that existing
   * constructors of this type -- lib/actions/occasions.ts's RPC mapper
   * (Task 8's to wire up) and lib/occasions/taggable.test.ts's fixtures --
   * do not need touching just to keep typechecking; occasionLabel treats a
   * missing key the same as an explicit null.
   */
  partnerId?: string | null;
  partnerUsername?: string | null;
  partnerDisplayName?: string | null;
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

  // partner_id, partner_username and partner_display_name are set together
  // or not at all (get_upcoming_occasions' couple arm joins all three from
  // the same user_profiles row) -- null only when the viewer cannot see
  // both partners' dates, in which case this is the correct single-name
  // rendering, not a fallback for missing data. Resolved the same way as
  // the celebrant, so a partner with a username but no display name renders
  // consistently with a celebrant in that state.
  const partnerWho = o.partnerId == null
    ? null
    : o.partnerDisplayName ?? o.partnerUsername ?? "Someone";

  const names = partnerWho == null ? who : `${who} & ${partnerWho}`;
  // Case-insensitive, and applied to the joined string rather than either
  // name individually: since `names` always ENDS with the second name (or
  // the only name, when there is no partner), checking the combined
  // string's tail is equivalent to checking the second name's tail --
  // "Alex & Sam's", "Alex & CHRIS'" -- without special-casing which half to
  // test. Display names are free-text user input and can be any case
  // ("CHRIS", "chris", "Chris"). Testing only the lowercase "s" let an
  // uppercase-terminal name double up ("CHRIS's Birthday").
  const possessive = /s$/i.test(names) ? `${names}'` : `${names}'s`;
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
