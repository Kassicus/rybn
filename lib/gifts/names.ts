/**
 * The words that say who a group gift is for, and a person's name as the app's routes write it (mobilePerson in
 * lib/mobile/occasions.ts). Pure, and not "use server": the website's pages and the actions both use them.
 */

/** "Dad", "Mom and Dad", "Mom, Dad and Gran"; "" for nobody. */
export function joinedNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "For Mom and Dad", over a gift's page; null for a gift that names nobody. */
export function forLine(names: readonly string[]): string | null {
  return names.length === 0 ? null : `For ${joinedNames(names)}`;
}

/** Under forLine: "Dad can't see this gift or its chat." for one, "They can't see…" for more; null for nobody. */
export function hiddenLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `${names.length === 1 ? names[0] : "They"} can't see this gift or its chat.`;
}

/** In the New sheet once someone is ticked: "Mom and Dad will never see this gift, its pledges or its chat." */
export function neverLine(names: readonly string[]): string | null {
  return names.length === 0 ? null : `${joinedNames(names)} will never see this gift, its pledges or its chat.`;
}

const blank = (v: string | null | undefined): v is null | undefined => v == null || v.trim() === "";

/** The display name, else the username, else "Someone"; a name of nothing but white space counts as none. */
export function giftPersonName(p: { display_name: string | null; username: string | null }): string {
  return !blank(p.display_name) ? p.display_name : !blank(p.username) ? p.username : "Someone";
}

/** People by giftPersonName without regard to case, then by id, so two people of one name keep one order. */
export function byGiftPersonName(
  a: { id: string; display_name: string | null; username: string | null },
  b: { id: string; display_name: string | null; username: string | null },
): number {
  return (
    giftPersonName(a).localeCompare(giftPersonName(b), "en", { sensitivity: "accent" }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
