"use client";

import { daysUntil } from "@/lib/occasions/display";
import { whenLabel } from "./whenLabel";

/**
 * The ONLY clock-sensitive fragment of UpcomingOccasions -- it exists to
 * read `new Date()` from the viewer's own browser, nothing more. See
 * UpcomingOccasions.tsx's doc comment for why the "Today / Tomorrow / in N
 * days" label cannot be computed on the server.
 *
 * Takes `occasionDate` (the calendar-day string), not a pre-computed day
 * count: a server-computed count would bake in the server's clock before it
 * ever reached the client, which is exactly the bug this component exists
 * to avoid.
 *
 * Pre-hydration render: Next.js still prerenders a Client Component's HTML
 * on the server (same as a Server Component), so the very first paint --
 * and the PERMANENT result for a viewer with JS disabled -- uses the
 * server's clock. That is an accepted, deliberate fallback, not an
 * oversight: it is correct every day except during the server's own
 * UTC-rollover window, and a plausible date beats an empty gap popping in
 * once JS loads. The instant React hydrates, this component's render runs
 * again on the client with the browser's own Date, and the corrected label
 * silently replaces the server's guess -- no useEffect/useState round trip
 * needed, since hydration itself re-invokes the render function client-side.
 * `suppressHydrationWarning` accepts that expected, self-correcting
 * mismatch instead of logging it as an error.
 */
export function RelativeWhen({ occasionDate }: { occasionDate: string }) {
  return (
    <span suppressHydrationWarning>{whenLabel(daysUntil(occasionDate))}</span>
  );
}
