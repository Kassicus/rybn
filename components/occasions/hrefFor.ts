import { isOccasionFor } from "@/lib/occasions/celebrant";
import type { UpcomingOccasion } from "@/lib/occasions/display";

/**
 * Where a row in the "Coming up" list links to.
 *
 * A giver needs the list, not the group. Celebrated occasions therefore link
 * to the celebrant's wishlist; only a group date has nowhere better to go.
 *
 * The VIEWER'S OWN celebrated occasion is the one exception:
 * /wishlist/user/<self> only ever redirects straight back to /wishlist (see
 * wishlist/user/[userId]/page.tsx's "Don't allow viewing your own wishlist
 * through this route" guard), so this links there directly and skips the
 * redirect hop. `viewerId` is optional and defaults to never matching,
 * because not every caller of UpcomingOccasions knows the viewer (there is
 * none to know from a logged-out render), and skipping the special case then
 * just falls back to the redirect, not a broken link.
 *
 * "The viewer's own" is isOccasionFor(), not `celebrantId === viewerId`. A
 * confirmed couple's anniversary is stored under the canonical (user_a)
 * partner, so for the NON-canonical partner an id comparison sends them to
 * `/wishlist/user/<their partner>` -- their own anniversary linking to
 * somebody else's list.
 *
 * Extracted from UpcomingOccasions.tsx so it can be unit tested: this repo's
 * vitest config collects `*.test.ts` only, and there is no React testing
 * library to exercise the component. Same split, for the same reason, as
 * whenLabel.ts.
 */
export function hrefFor(
  o: UpcomingOccasion,
  viewerId: string | null
): string {
  if (o.kind === "group_date" && o.groupId) return `/groups/${o.groupId}`;
  if (o.celebrantId) {
    return isOccasionFor(o, viewerId)
      ? "/wishlist"
      : `/wishlist/user/${o.celebrantId}`;
  }
  return "/dashboard";
}
