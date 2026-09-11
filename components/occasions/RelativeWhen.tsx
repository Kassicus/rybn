"use client";

import { useEffect, useState } from "react";
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
 * to avoid. `serverLabel` is different -- it is only ever shown before this
 * component has mounted client-side, and is replaced the instant it has.
 *
 * WHY THE MOUNT FLAG IS REQUIRED, NOT OPTIONAL:
 *
 * Next.js still prerenders a Client Component's HTML on the server, same as
 * a Server Component, so a naive version of this component (just
 * `whenLabel(daysUntil(occasionDate))`, no state) computes its label twice:
 * once on the server (server's clock) for the initial HTML, and again when
 * React hydrates on the client (browser's clock). It is tempting to assume
 * hydration re-running the render function is enough -- React reads the new
 * value, so surely it repaints the DOM with it. It does not, on the React
 * version this app actually ships:
 *
 * `package.json` pins `react-dom@18.3.1`, but the App Router never loads
 * that copy. Next aliases `react-dom` to its own vendored copy for the
 * client bundle (`create-compiler-aliases.js`), and that copy is React 19
 * (`next/dist/compiled/react-dom`, `19.3.0-canary-...`). In React 19's
 * hydration path (`react-dom-client.development.js`, the host-singleton
 * text-hydration branch), a text child has exactly three outcomes: the
 * server and client strings match, so React attaches listeners and moves
 * on; `suppressHydrationWarning` is true, so React ALSO attaches listeners
 * and moves on -- WITHOUT writing the client's string to the DOM; or
 * neither, in which case React discards the server subtree and does a full
 * client render. There is no fourth branch that patches the text. A
 * previous version of this component set `suppressHydrationWarning` and
 * relied on the belief that hydration would repaint -- it would have on
 * React 18 (whose hydration DOES set an update payload outside the suppress
 * guard), but on this app's actual React 19 runtime the DOM keeps the
 * server's (potentially wrong) string forever, since this component never
 * naturally re-renders again on its own. Verified against the compiled
 * source and reproduced end-to-end (SSR under TZ=UTC, hydrate under
 * TZ=America/New_York against the real compiled bundle in a DOM): the
 * mismatched span's live `textContent` stayed the server's value
 * indefinitely.
 *
 * The mount flag sidesteps the hydration path entirely. The first render
 * (server AND the client's initial hydration pass) renders `serverLabel`
 * verbatim, so there is no mismatch to hydrate past. Only after mount does
 * `setMounted(true)` fire, which is a normal POST-hydration update, not a
 * hydration reconciliation -- and a normal update always writes its new
 * text to the DOM. No `suppressHydrationWarning` is used or needed, because
 * there is nothing to suppress: the two passes agree on purpose.
 *
 * Pre-hydration render / no-JS fallback: `serverLabel`, computed by
 * UpcomingOccasions.tsx with the server's own clock. Correct except during
 * the server's own UTC-rollover window, and a plausible date beats an empty
 * gap popping in once JS loads -- see that file's doc comment for why this
 * is a deliberate choice, not the bug this component exists to fix.
 */
export function RelativeWhen({
  occasionDate,
  serverLabel,
}: {
  occasionDate: string;
  serverLabel: string;
}) {
  const [mounted, setMounted] = useState(false);
  // The "extra cascading render" this rule warns about is the fix, not a
  // side effect to avoid: it is the one genuine post-hydration update that
  // actually writes the corrected label to the DOM (see the doc comment
  // above). There is no external system to synchronize with here other than
  // "has this component mounted on the client yet," which has no
  // representation other than an effect firing once.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
  useEffect(() => setMounted(true), []);

  return (
    <span>
      {mounted ? whenLabel(daysUntil(occasionDate)) : serverLabel}
    </span>
  );
}
