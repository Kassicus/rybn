import Link from "next/link";
import { Cake, Heart, Calendar } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { formatMonthDay } from "@/lib/utils/dates";
import {
  occasionLabel,
  daysUntil,
  type UpcomingOccasion,
} from "@/lib/occasions/display";
import { RelativeWhen } from "./RelativeWhen";
import { whenLabel } from "./whenLabel";
import { hrefFor } from "./hrefFor";
import { GroupDateActions } from "./GroupDateActions";

// Same icon vocabulary DateReminderBanner.tsx already established, so the two
// surfaces do not disagree about what a birthday looks like.
const ICON = {
  birthday: Cake,
  anniversary: Heart,
  group_date: Calendar,
} as const;

// hrefFor moved to ./hrefFor.ts so its "is this the viewer's own occasion"
// rule -- which a collapsed couple's non-canonical partner gets wrong under a
// bare celebrantId comparison -- is unit-testable. Same split, same reason,
// as whenLabel.ts.

interface UpcomingOccasionsProps {
  occasions: UpcomingOccasion[];
  limit?: number;
  /** The signed-in viewer, used only to route their own occasion straight to
   *  /wishlist instead of through the self-redirect. Never used for
   *  filtering or authorization -- `occasions` already arrived pre-filtered
   *  by getUpcomingOccasions(). */
  viewerId?: string | null;
  /**
   * Offers edit/delete on each group-date row via GroupDateActions. Off by
   * default: only the group page's own occasions list should show it, not
   * the dashboard's "Coming up" widget or any wishlist context line, even
   * though they render the same occasion rows.
   */
  manageGroupDates?: boolean;
}

/**
 * Server-rendered EXCEPT the relative day label. `daysUntil` honours
 * whatever clock it is handed, and a server render on Vercel hands it UTC --
 * which is a day ahead of every US viewer each evening (roughly 8pm Eastern
 * onward), prime usage hours for a family gift app. So the absolute date
 * (`formatMonthDay`) renders here, on the server, and the
 * "Today / Tomorrow / in N days" fragment is delegated to `RelativeWhen`, a
 * small "use client" child that calls `daysUntil` against the viewer's own
 * `Date` in the browser. This list stays server-rendered rather than
 * becoming client-side wholesale -- nothing else here is interactive, and it
 * should still render meaningfully with JS disabled (see RelativeWhen.tsx
 * for what that fallback looks like).
 *
 * `RelativeWhen` also gets a `serverLabel`, computed here with THIS
 * component's own (server) clock. That is the pre-hydration fallback only --
 * RelativeWhen replaces it the moment it mounts client-side. It is not the
 * "server-computed day count" the client component must never be handed:
 * that would bake the server's clock in permanently, whereas this value is
 * discarded on mount. See RelativeWhen.tsx for why passing it is still
 * necessary (React 19's hydration does not repaint a suppressed mismatch on
 * its own).
 *
 * Renders NOTHING claim-derived -- no counts, no "N claimed" badges, no
 * purchase state. This component also renders for list owners, and
 * getMyWishlist strips claim state from owners everywhere else in the app
 * on purpose; a count here would leak it back through the side door.
 *
 * `manageGroupDates` opts a row into GroupDateActions, its own small
 * "use client" child (same pattern as RelativeWhen) -- this component
 * itself stays a server component either way.
 */
export function UpcomingOccasions({
  occasions,
  limit = 5,
  viewerId = null,
  manageGroupDates = false,
}: UpcomingOccasionsProps) {
  // No empty state. An empty card would compete with the dashboard tiles for
  // attention while saying nothing.
  if (occasions.length === 0) return null;

  return (
    <section className="space-y-3">
      <Heading level="h2">Coming up</Heading>
      <ul className="space-y-2">
        {occasions.slice(0, limit).map((o) => {
          const Icon = ICON[o.kind];
          // Only a group_date row has anything to edit or delete -- a
          // derived birthday/anniversary has occasionId: null and no row
          // behind it at all.
          const showActions =
            manageGroupDates && o.kind === "group_date" && o.occasionId;
          return (
            <li
              // Derived occasions have no id until phase 2 materializes one,
              // so the key is composed rather than taken from occasionId.
              key={`${o.kind}-${o.occasionId ?? o.celebrantId}-${o.occasionDate}`}
            >
              <div className="flex items-center gap-2 rounded-lg border border-light-border bg-light-background p-3 hover:border-primary">
                <Link
                  href={hrefFor(o, viewerId)}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                  {/* A div, not a span: Text renders a <p>, and a <span> --
                      phrasing content -- may not contain a <p> -- flow
                      content. */}
                  <div className="min-w-0 flex-1">
                    <Text className="font-medium">{occasionLabel(o)}</Text>
                    <Text variant="secondary" size="sm">
                      {formatMonthDay(o.occasionDate)} ·{" "}
                      <RelativeWhen
                        occasionDate={o.occasionDate}
                        serverLabel={whenLabel(daysUntil(o.occasionDate))}
                      />
                      {o.groupName ? ` · ${o.groupName}` : ""}
                    </Text>
                  </div>
                </Link>
                {showActions && (
                  <GroupDateActions
                    occasionId={o.occasionId as string}
                    name={o.name ?? ""}
                    occasionDate={o.occasionDate}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
