# Anniversary requests are never stranded — design

**Status:** approved in chat 2026-10-14, pending written review.
**Builds on:** `_planning/2026-09-11-shared-anniversaries-design.md`, shipped to
production at `a5b8510` on 2026-09-12.
**Closes:** deferred item F4 ("pending-request dead end") from
`.superpowers/sdd/2026-09-11-shared-anniversaries-plan/progress.md:1754-1777`.

## Goal

Every anniversary request is visible to, and answerable by, the person it was
sent to, and no sender waits on a request nobody can see. Nothing here may tell
anyone whether some *other* person is already linked.

## The problem is wider than F4

Every surface reads the caller's links through `getMyAnniversaryLink()`
(`lib/actions/anniversary-links.ts:209`), which returns **one** row: confirmed
before pending, then newest first, `.limit(1)`. A person can hold several rows,
because pending links are deliberately unconstrained. Three kinds of row are
therefore hidden:

1. **A request sent to someone already linked** (F4 as logged). B is confirmed
   with C; A asks B. B's reader returns the confirmed row, so B never sees A's
   request and A sits at "Waiting for them to confirm" forever.
2. **The older of two incoming requests.** A asks B, then D asks B. B sees only
   D's. A waits forever.
3. **Your own request, once someone asks you.** B asks C, then A asks B. B's
   reader returns A's newer incoming row, so B can no longer see or cancel the
   request to C.

There is also an **existing disclosure**. A asks B, then A confirms a link with
C. B presses Confirm on A's still-pending request and
`confirm_anniversary_link` raises "one of you already shares an anniversary
with somebody else" — telling B that A is taken.

## Decisions

### 1. Show every row, and clean up on confirm

The fix has a read half and a write half, and both ship.

- **Read:** every surface sees all of the caller's links, not one.
- **Write:** confirming a link deletes every other pending link involving either
  partner. To each of those senders this is indistinguishable from a decline —
  their request disappears, which a decline already does.

**Rejected — read half only.** It fixes all three hidden cases but leaves
requests sent before a confirm in place until the recipient declines each by
hand, and it leaves the disclosure open.

**Rejected — `request_anniversary_link` refuses a recipient who is already
linked.** That makes the RPC an oracle for other people's relationship status,
which every other message in it was written to avoid. Collapsing the refusal
into the existing "that person is not in any of your groups" is safe but false
for someone who plainly is in your group. (Both rejected in the original F4
ruling; restated here because they are the first fixes a reader will reach for.)

### 2. Two new refusals, both about the caller's own status

`request_anniversary_link` refuses when:

- the **caller** is already in a confirmed link — "you already share an
  anniversary with someone; unlink first";
- the **caller** already has a pending request out to a *different* person —
  "you already have a request waiting; cancel it first".

Neither reveals anything about anyone else. Re-requesting the same person (the
existing upsert that updates the date) is unaffected, and requesting someone who
is already linked still succeeds.

The UI already prevents both states — the picker is hidden while the caller is
linked or waiting — so in practice these stop only direct PostgREST calls. They
exist to make two invariants true in the database rather than merely in the UI:

- **I-out:** a person has at most one outgoing pending request.
- **I-linked:** a person in a confirmed link has no outgoing pending request,
  and no pending request of any kind that predates the confirm.

With those, the reader's shape can be honest (`outgoing` is one row or none)
instead of quietly picking one and re-creating the bug this design fixes.

### 3. A linked recipient can decline but not confirm

A request that reaches someone already linked (hidden case 1) is shown with
**Decline only**, plus a line naming their current partner and saying to unlink
first. This uses only the viewer's own link, so it discloses nothing. Unlinking
and then confirming remains possible.

### 4. An incoming request no longer replaces the picker

Today the profile card shows an incoming request *instead of* the partner
picker. Now the main area shows the caller's own state (confirmed, else
waiting, else picker) and incoming requests are listed beneath it. An unlinked
person with incoming requests can therefore still ask someone else.

## Database — one corrective migration

`supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql`,
re-issuing two functions with `create or replace`. No applied migration is
edited.

### `confirm_anniversary_link(uuid)`

Body copied **verbatim** from its live definition
(`20260912000014_confirm_link_reconciles_occasion_date.sql`), with one step
added after the members insert succeeds:

```sql
delete from public.anniversary_links
 where status = 'pending'
   and id <> p_link_id
   and (user_a in (v_link.user_a, v_link.user_b)
        or user_b in (v_link.user_a, v_link.user_b));
```

Constraints on the re-issue:

- `19_anniversary_link_rpcs.sql` anchors several of this function's lines
  (assertions 10–11) and fails on any `/* */` in its body (assertion 12). Every
  existing line stays byte-identical; added commentary uses `--` only.
- `security definer`, `set search_path = public`, and the existing grants are
  preserved, so `05_definer_pins.sql` is unaffected.

### `request_anniversary_link(text, text)`

Body copied verbatim from `20260912000003_anniversary_link_rpcs.sql`, with two
checks added after the existing guards (self, shared group, usable date) and
before the insert. File 19 anchors each existing guard separately, never across
the gap these go into, so its checks still match:

```sql
if exists (select 1 from public.anniversary_link_members
            where user_id = v_caller) then
  raise exception 'you already share an anniversary with someone; unlink first'
    using errcode = '22023';
end if;
if exists (select 1 from public.anniversary_links
            where status = 'pending'
              and initiated_by = v_caller
              and p_partner_id not in (user_a, user_b)) then
  raise exception 'you already have a request waiting; cancel it first'
    using errcode = '22023';
end if;
```

Both use errcode `22023`, so `requestAnniversaryLink` passes their messages
straight through with no TypeScript change.

### Live-body pointers

`20260912000017` and `20260912000018` attached `comment on function` notes
naming each function's live body. Both functions' comments are re-issued to name
this migration — the M1/M4 lesson: a correction goes where the reader will be.

## Reader — `getMyAnniversaryLinks()`

Replaces `getMyAnniversaryLink()` in `lib/actions/anniversary-links.ts`:

```ts
export type MyAnniversaryLinks = {
  confirmed: AnniversaryLink | null; // at most one: anniversary_link_members' PK
  outgoing: AnniversaryLink | null;  // at most one: I-out
  incoming: AnniversaryLink[];       // every pending request sent to me, newest first
};

export async function getMyAnniversaryLinks(): Promise<
  { data: MyAnniversaryLinks } | { error: string }
>;
```

- **One** `anniversary_links` select, no `.limit()`, ordered `created_at desc`.
  RLS (participant-only SELECT) already limits it to the caller's rows. Rows are
  classified in TypeScript: `status = 'confirmed'` → `confirmed`; pending with
  `initiated_by = me` → `outgoing`; pending otherwise → `incoming`.
- **One** `user_profiles` lookup, `.in("id", partnerIds)`, covering every row's
  partner. A partner whose profile RLS no longer returns (no shared group any
  more) keeps null name fields; the UI falls back to a generic label, as today.
- `sharedDate` is looked up for the confirmed row only, exactly as now.
- Should a second outgoing row exist anyway (a row created before the migration;
  see Rollout), the newest wins and the rest are logged with `console.warn`,
  not silently dropped.
- Error handling is unchanged: a failed links or profiles query returns
  `{ error }`; a failed shared-date query falls back to `sharedDate: null`.

`AnniversaryLink` itself is unchanged.

### Callers

| Caller | Change |
|---|---|
| `app/(dashboard)/layout.tsx` | reads `getMyAnniversaryLinks()`; passes the result to `unreadCount` |
| `app/(dashboard)/notifications/page.tsx` | same; passes `links` to `NotificationsList` |
| `components/notifications/NotificationsList.tsx` | renders one `AnniversaryRequestCard` per `incoming` row |
| `components/profile/AnniversaryPartner.tsx` | main state from `confirmed` / `outgoing`; `incoming` listed beneath |

Both server-component callers keep their fail-quiet posture: an error result is
treated as "no links".

## Unread count

`lib/notifications/unread.ts`:

```ts
export function unreadCount(
  reminders: Array<{ banner_dismissed: boolean }> | null | undefined,
  links?: MyAnniversaryLinks | null,
): number; // unread reminders + links.incoming.length
```

`isIncomingAnniversaryRequest` is removed; `incoming` is already exactly the set
it filtered for. The bell and the page keep sharing this one function.

## Screens

### `components/notifications/AnniversaryRequestCard.tsx` (new, client)

Props: one incoming `AnniversaryLink`, and the caller's `confirmed` link or
null. Each card owns its loading and error state, so acting on one card does
not disable the others. After a successful action it calls `router.refresh()`
(and an optional `onChanged` callback, which the profile card uses to re-load).

- **Caller not linked** — today's copy, moved verbatim from `NotificationsList`:
  "{name} wants to share an anniversary with you" / "{name} says your shared
  anniversary is {date}. Confirming will set your anniversary to that date."
  Buttons: Confirm, Decline. The consequence line keeps its no-`truncate` rule.
- **Caller already linked** — "{name} wants to share an anniversary with you.
  You already share one with {partner}. To accept this, unlink on your profile
  first." Button: Decline only, plus a link to `/profile/edit`.

Mobile layout follows `76c1214`: stack below `sm:`, `min-w-0` on the text
block, `shrink-0` on the icon well, and `truncate` only on name-only nodes.

### `NotificationsList`

One `AnniversaryRequestCard` per `incoming` row, above the reminders. The
"Nothing new" empty state shows only when there are no reminders **and** no
incoming requests. The component's own request-handling state moves into the
card.

### `AnniversaryPartner` (profile)

Main area, by priority:

1. `confirmed` → partner name, shared date, Unlink (unchanged).
2. else `outgoing` → "Waiting for them to confirm {date}…", Cancel (unchanged).
3. else the partner picker (unchanged).

Below the main area, one `AnniversaryRequestCard` per `incoming` row, passing
`onChanged` so the profile card re-loads. The component's own incoming-request
state and its Confirm handler are removed.

## Testing

The project's standing rule applies: every test states what change would make
it fail **and** what it would not catch.

### vitest

- `lib/actions/anniversary-links.test.ts` — the `getMyAnniversaryLink` block is
  replaced by `getMyAnniversaryLinks`, pinned to the three hidden cases:
  1. confirmed plus a newer incoming request → both returned;
  2. two incoming requests → both returned, newest first;
  3. an outgoing request plus a newer incoming one → both returned.

  Each must fail if `.limit(1)` is reintroduced; the mock already applies
  `.order()`/`.limit()` for real. Also: one `user_profiles` call covering every
  partner id; partner id resolved from either canonical side; `sharedDate` only
  for the confirmed row; the error paths; signed-out never reaching Supabase.
- `lib/notifications/unread.test.ts` — two incoming requests count as two;
  reminders and requests add; null links count zero.

### RLS — `supabase/tests/rls/21_anniversary_request_rules.sql` (new, added to `MANIFEST`)

Live, because none of these paths raises:

- **Cleanup:** confirming A–B deletes A's other outgoing request, B's other
  incoming request, and every other pending row of either partner, and leaves an
  unrelated couple's pending request untouched.
- **No oracle:** with B confirmed with C, a co-member's request to B
  **succeeds** and yields exactly one pending row. This is the privacy
  assertion; it is what fails if someone later "fixes" F4 by refusing.
- **Same-pair re-request** still succeeds and updates `agreed_date`.

Anchored source, because these paths raise and the harness rejects any
`exception when` in a test file, so an uncaught `raise` fails the whole file
(`scripts/test-rls.sh:274-280`):

- both new `request_anniversary_link` refusals, each wired to its message,
  errcode and `end if`;
- the new `delete` in `confirm_anniversary_link`, including its
  `status = 'pending'` and `id <> p_link_id` conjuncts (dropping either would
  delete the link being confirmed, or a confirmed link);
- a `position('/*' in definition) = 0` floor for both functions.

Every pattern carries its own `(?n)`, is line-anchored, and scopes its
`pg_proc` lookup by exact `::regprocedure`. The file's `v_checks` floor equals
its real increment count. `19_anniversary_link_rpcs.sql` must still pass
unchanged against the re-issued `confirm`.

### Gates

vitest, `tsc --noEmit`, eslint (baseline 61), `next build`, `npm run test:rls`
across all 22 files.

## Rollout

1. **Check production first.** Count rows that break the new invariants: people
   with more than one outgoing pending request, and pending requests initiated
   by someone now in a confirmed link. Report them; change nothing.
2. **Apply the migration** with `supabase db push`, with the owner's go-ahead.
   It is additive in effect: old deployed code reading through the old
   single-row reader still works against the new functions, and the new code
   works against the old ones. So the deploy order does not matter, but database
   first remains the habit.
3. **`npm run test:rls`**, with the owner's go-ahead — it writes fixtures to the
   production database. Never concurrently with other database work.
4. **Code gates**, then commit on a branch. Merging and deploying are the
   owner's call.

## Out of scope

- The doubled `getMyAnniversaryLinks()` call per page load (layout and page) —
  deferred item F3. A `cache()` wrapper needs checking against this Next
  version's `"use server"` export rules first.
- Notifying a sender that their request was declined or cleared (already out of
  scope in the original design).
- The other deferred cleanups: the `anniversary_link_members.link_id` index,
  `items-center` with wrapped text, test 20's dead null check, and the
  reminder-footer copy pass.
- The owner's two-account browser check of the shipped feature. Checking this
  change by hand would need three accounts.

## Known risks

1. **A same-instant race** reopens the disclosure narrowly: A sends a request
   while, in the same moment, A confirms a different one. The request's
   "already linked" check can pass before the confirm's cleanup commits. This
   reveals only A's own status, and only through A's own action, so it is
   accepted rather than closed with advisory locks.
2. **Re-issuing `confirm_anniversary_link`** — the most-revised function in the
   feature — risks drifting from its live body. Mitigation: copy from the live
   definition, then diff the re-issued body against `…0014`'s; the only
   difference should be the added block and its comments. File 19's anchored
   checks also catch drift in the guarded lines.
3. **Clearing on confirm is silent to the senders.** A sender sees their request
   vanish, exactly as on a decline, with no explanation. That is the point — an
   explanation would be the oracle — but it may read as a decline they never
   received.
