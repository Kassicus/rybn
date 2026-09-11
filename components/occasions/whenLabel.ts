/**
 * "Today" / "Tomorrow" / "in N days" for a day count that is ALREADY
 * relative to some clock. Pure and clock-agnostic on purpose: it does not
 * call `new Date()` itself, which is what makes it trivial to unit test
 * (see whenLabel.test.ts) and safe to import from either a server or a
 * client module. Choosing WHICH clock produces `days` is the caller's job --
 * see RelativeWhen.tsx, the only caller that matters here.
 */
export function whenLabel(days: number): string {
  // A negative count means the clock that produced `days` has already
  // rolled past the occasion's calendar day. This is reachable even though
  // get_upcoming_occasions() only returns occasions from "today" forward,
  // because that filter runs on the SERVER's clock at fetch time while this
  // label is computed on the VIEWER's clock at render time -- if the
  // viewer's clock reads a day behind the server's (or the tab was left open
  // across a midnight rollover), `days` can go negative for an occasion the
  // server still considers upcoming. Folding that into "Today" rather than
  // e.g. "Yesterday" keeps the label honest about the one thing both clocks
  // still agree on: the occasion has not come back around again.
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}
