# Shared anniversaries — design

**Status:** approved in chat 2026-09-11, pending written review.
**Builds on:** `_planning/2026-09-10-gift-giving-occasions-design.md` (phases 1–3)
and the follow-ups in `_planning/2026-09-11-gift-giving-occasions-phase-3-followups.md`.

## Goal

A married couple in the same group enters one anniversary between them and sees
**one** occasion, not two. Today each partner's date is an independent
`profile_info` row, so the couple produces two derived occasions, two
materialized `occasions` rows, two claim scopes, and two reminder emails for a
single event.

## Why this is not a display-only change

The obvious cheap version — leave the data alone and merge the two rows when
rendering — does not hold up, because **tagging and claiming key on
`occasionId`**, not on a label:

- `lib/occasions/order.ts:16` partitions by occasion id;
- `itemsTaggedFor` (`:41`) matches tags by occasion id;
- `lib/occasions/taggable.ts` resolves a celebrated tag target to
  `(celebrantId, kind)`, which becomes an id through
  `get_or_create_celebrated_occasion`.

With two rows, tagging a gift from Alex's list and one from Sam's list produces
two different occasion ids carrying identical labels — so the tagging surface
renders two sections both reading "Alex & Sam's Anniversary". The merge has to
be real underneath.

## Decisions

Four forks were settled before design. Each records what was rejected, because
the rejected option is usually the one a later reader will propose again.

### 1. Linking requires mutual confirmation

A picks B; B receives a notification and the occasion merges only once B
accepts.

**Rejected — unilateral linking.** A could assert a relationship B never agreed
to, and B's name would appear on an occasion visible to A's groups. In a family
app that is probably harmless and definitely not something to rely on.

**Rejected — both must independently tag each other**, which is consensual and
needs no accept flow, but nobody is ever prompted, so it only works by
coincidence.

The confirmation prompt lives on `/notifications`, which already exists.

### 2. The merge collapses per viewer

Both names appear only for a viewer who can see **both** partners' dates. A
viewer who can see only Alex's date sees exactly what they see today: "Alex's
Anniversary".

**Rejected — always show both names once linked.** Each anniversary has its own
`can_view_field` gate; naming both to anyone who can see either tells that
viewer B has an anniversary on that date even when B's own privacy hides it. The
leak would be created by A's action, not B's.

**Rejected — hide unless both are visible**, which takes away access a viewer
already legitimately had. Failing in the surprising direction.

### 3. One shared occasion row, under a canonical celebrant

The pair is stored canonically — the lexicographically smaller user id is
`user_a` — and the occasion row's `celebrant_id` is always that canonical
partner, with the other in a new `partner_id` column.

This is what keeps the change contained: **`occasions_celebrant_identity
(kind, celebrant_id, occasion_year)` is untouched**, because a linked couple
only ever produces a row under one of the two ids.

**Rejected — make the anniversary a property of the couple**, replacing both
`profile_info` rows. Cleanest model, but it changes what `profile_info` means,
needs a real data migration, and unlinking has to reconstruct both rows.

### 4. Confirming syncs both partners to one date

B's confirmation prompt names the date — "Alex says your shared anniversary is
12 June" — and accepting **sets B's own anniversary to that date**, overwriting
any existing value. The prompt must say so in those words.

**Rejected — canonical partner's date wins, both fields untouched.** B's profile
would then show a different date from the occasion bearing B's name, with no
signal anything is wrong.

**Rejected — refuse to link unless the dates already match.** A one-day typo
blocks linking with no obvious remedy, and it cannot handle the most common case
of all: B never entered an anniversary.

## Data model

```sql
create table public.anniversary_links (
  id uuid primary key default gen_random_uuid(),
  user_a text not null references public.user_profiles(id) on delete cascade,
  user_b text not null references public.user_profiles(id) on delete cascade,
  status text not null default 'pending',
  initiated_by text not null references public.user_profiles(id) on delete cascade,
  -- The date both partners agree on, captured at request time so the
  -- confirmation prompt can name it and accepting can apply it.
  agreed_date text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint anniversary_links_canonical check (user_a < user_b),
  constraint anniversary_links_status check (status in ('pending', 'confirmed')),
  constraint anniversary_links_distinct check (user_a <> user_b)
);

create unique index anniversary_links_pair on public.anniversary_links (user_a, user_b);
create unique index anniversary_links_one_confirmed_a
  on public.anniversary_links (user_a) where status = 'confirmed';
create unique index anniversary_links_one_confirmed_b
  on public.anniversary_links (user_b) where status = 'confirmed';
```

`user_a < user_b` is enforced rather than assumed: canonicalisation is what
lets the existing identity index keep working, so it must be a constraint, not
a convention callers remember.

The two partial unique indexes prevent one person holding several confirmed
links. They do **not** prevent several pending requests — that is deliberate,
since a pending request is only an invitation.

### RLS on `anniversary_links`

The table is readable **only by its two participants**. Nobody else needs to
read it directly: `get_upcoming_occasions` is `SECURITY DEFINER` and resolves
links on the caller's behalf, so a third party learns a couple is linked only
through an occasion they were already entitled to see.

```sql
alter table public.anniversary_links enable row level security;

create policy "Participants can see their own anniversary links"
  on public.anniversary_links for select to authenticated
  using (
    user_a = (select public.requesting_user_id())
    or user_b = (select public.requesting_user_id())
  );

grant select on public.anniversary_links to authenticated;
revoke insert, update, delete on public.anniversary_links from authenticated;
```

The explicit `revoke` is not redundant. Supabase's per-role default privileges
grant `authenticated` every DML verb on any new table in `public` regardless of
the table's own `grant` line — verified during phase 3, where the same
assumption was wrong (`pg_default_acl` shows `authenticated=arwdm`). Writes go
through `SECURITY DEFINER` RPCs, so the table needs no INSERT/UPDATE/DELETE
policy at all, and the revoke means the check for one is testing something true.

Those RPCs are `request_anniversary_link(p_partner_id, p_date)`,
`confirm_anniversary_link(p_link_id)`, `decline_anniversary_link(p_link_id)`,
and `unlink_anniversary(p_link_id)`. Each must be `SECURITY DEFINER` — after
the revoke above, a `SECURITY INVOKER` function fails with a bare `42501`
before RLS is ever consulted. Each gates on the caller actually being the
relevant participant: only the *recipient* may confirm or decline, and either
partner may unlink.

`request_anniversary_link` must additionally verify the two users share a group
(`is_group_member` over a common group), so the picker's restriction is enforced
in the database rather than only in the UI — the RPC is granted to
`authenticated` and reachable directly through PostgREST, where nothing upstream
has run.

`occasions` gains:

```sql
alter table public.occasions
  add column partner_id text references public.user_profiles(id) on delete set null;
```

`on delete set null`, not cascade: deleting one partner's account must not
destroy an occasion other people have tagged gifts against. The row survives as
an ordinary single-person anniversary.

## Derivation

`get_upcoming_occasions` gains three returned columns — `partner_id`,
`partner_username`, `partner_display_name` — all null except for a confirmed
couple whose **both** dates the viewer can see.

Changing an RPC's return type requires `drop function` before `create`, so this
ships as a drop-and-recreate in one migration, not a `create or replace`.

The anniversary branch becomes:

- confirmed link exists **and** the viewer passes `can_view_field` for both
  partners' anniversary rows → emit ONE row, `celebrant_id` = canonical,
  partner columns populated;
- otherwise → emit each visible partner's row exactly as today, partner columns
  null.

Birthdays and group dates are untouched.

## Materialization

`get_or_create_celebrated_occasion(p_celebrant_id, p_kind)` resolves
`p_kind = 'anniversary'` through `anniversary_links`: if the caller-supplied
celebrant is half of a confirmed pair, the row is created or fetched under the
canonical partner, with `partner_id` set to the other.

Everything already funnels through this function — phase 2's celebrated tagging
and phase 3's `claimItem` both call it — which is why one resolution point
covers tagging, claiming and auto-release together.

Its existing privacy gate stays: the caller must pass `can_view_field` for the
celebrant **they asked about**. A caller who can see only Sam's date is entitled
to act on Sam's anniversary; canonicalisation is an internal storage detail and
must not become a reason to refuse them.

## The RLS widening, and why it is needed

`occasions`' SELECT policy (`20260910100000_occasions_schema.sql:83-95`) gates a
celebrated row on `can_view_field(celebrant_id, …)`. With a shared row keyed to
Alex, a viewer who can see only Sam's date would be able to *create* a claim
against it and then be unable to *read it back* — the claim would exist and be
invisible to them.

So the policy must admit the partner:

```sql
using (
  celebrant_id is not null
  and (
    exists ( ...existing can_view_field check on celebrant_id... )
    or (
      partner_id is not null
      and exists ( ...same check, on partner_id... )
    )
  )
)
```

**This is a genuine widening of a privacy policy and is the riskiest part of
this change.** It is correct — it is exactly the per-viewer collapse decision 2
chose, expressed in RLS — but it must carry its own assertions:

- a viewer who can see only the partner's date CAN read the shared row;
- a viewer who can see neither date CANNOT;
- an **unlinked** occasion (`partner_id is null`) is unaffected, i.e. the new
  branch cannot admit anything the old policy refused;
- the row's label for a partial viewer names only the partner they can see.

The last one is a read-path concern rather than a policy one, but it is the
observable symptom if the policy and the derivation disagree.

## Reminders

`date_notifications` is unique on
`(notified_user_id, celebrant_id, field_name, notification_year, group_id)`.
For a confirmed couple, generate the anniversary notification for the
**canonical celebrant only**, so one event produces one email rather than two.

Consequence to accept: the reminder names the canonical partner. The email copy
should use the shared label rather than a single name.

## Flows

**Link.** `DatesSection` gains "Share this anniversary with…" once an
anniversary is set. The picker offers only people the user shares a group with —
the link itself is global (a couple is a couple, not a per-group fact), but you
cannot link a stranger.

**Confirm.** The partner sees a notification naming the date and stating that
accepting will set their own anniversary to match. Accepting, in one
transaction: sets `status = 'confirmed'`, writes `agreed_date` into the
accepting partner's `profile_info` anniversary row (creating it if absent), and
reconciles any already-materialized occasions (below).

**Decline.** Deletes the pending row. No notification back to the initiator;
they simply never see it confirm. (Telling A that B declined is a social
disclosure this app does not need to make.)

**Unlink.** Either partner may unlink. The `anniversary_links` row is deleted
and `partner_id` is cleared on the couple's occasion rows, so each reverts to an
ordinary anniversary belonging to the canonical partner. Existing tags and claims
keep pointing at that row and are **not** deleted; they stop being labelled as
shared.

The asymmetry this leaves is deliberate and worth stating: after unlinking, the
non-canonical partner has no occasion row of their own for years already
materialized, and gifts tagged for the couple stay attached to the canonical
partner's. Reconstructing a separate row and splitting the tags between them
would be guesswork about which gift was for whom. The next materialization for a
new year produces separate rows for both, as it would for any unlinked pair.

## Reconciling already-materialized occasions

If both partners already have a materialized anniversary occasion for a year at
the moment they confirm, the non-canonical row must be retired or the couple
keeps two ids for one event — the exact defect this design exists to prevent.

On confirmation, inside the same transaction, for every year that has both:

1. re-point `wishlist_item_occasions` rows from the non-canonical occasion to
   the canonical one, `on conflict do nothing` (an item may already be tagged
   for both);
2. re-point `wishlist_claims.occasion_id` likewise — no collision is possible,
   since `wishlist_claims_one_active` keys on `(item_id) where released_at is
   null` and does not include the occasion;
3. delete any now-duplicate `wishlist_item_occasions` rows left by step 1;
4. delete the non-canonical occasion row.

Production currently holds one wishlist item and zero claims, so this path is
nearly free today. It will not stay that way.

## Label

`UpcomingOccasion` (`lib/occasions/display.ts:3`) gains `partnerId`,
`partnerUsername`, `partnerDisplayName`. `occasionLabel` renders
"Alex & Sam's Anniversary" when the partner fields are present, applying the
existing case-insensitive possessive rule to the **second** name only. The
existing single-name path is unchanged.

## Testing

Beyond the project's standing falsifiability requirement — every test states
what change would make it fail **and** what would not be caught:

- **RLS** (`supabase/tests/rls/`): the four policy assertions listed above, each
  proved to bite inside `begin; … rollback;`. The unlinked-occasion assertion
  matters most: it is what proves the new branch did not widen anything beyond
  linked couples.
- **Canonicalisation**: `get_or_create_celebrated_occasion` called with each
  partner in turn returns the **same** occasion id. This is the assertion the
  whole design rests on.
- **Derivation**: a viewer who can see both dates gets one row; a viewer who can
  see one gets one row with null partner columns; a viewer who can see neither
  gets none.
- **Reconciliation**: confirming with pre-existing separate occasions leaves one
  occasion, with every tag and claim preserved and re-pointed.
- **Label**: both-names and single-name forms, including a partner whose display
  name ends in "s".
- **RPC authorization**, each reachable directly through PostgREST: only the
  recipient may confirm or decline; either partner may unlink; a stranger may do
  none of these; and `request_anniversary_link` refuses two users who share no
  group. These are denial paths, so in this harness they are asserted as
  anchored source checks rather than live calls — an uncaught `raise` aborts the
  batch (`scripts/test-rls.sh:276-279`). Every pattern carries its own `(?n)`,
  is line-anchored, sits beneath a `position('/*' in definition) = 0` floor, and
  scopes its `pg_proc` lookup by exact `::regprocedure`. Phase 3 established
  each of those the hard way.
- Any date-dependent fixture uses a pinned clock or a fixed calendar anchor.
  Phase 3 lost two review rounds to calendar-dependent fixtures.

## Out of scope

- Groups of more than two people sharing an occasion.
- Per-group links — a couple is a couple in every group they share.
- Any history of past pairings; unlinking leaves no record.
- Shared **birthdays** (twins). The same machinery would extend, but no one has
  asked and the label and reminder copy would both need rethinking.
- Notifying the initiator when a request is declined.

## Known risks

1. **The RLS widening** is the only change here that can leak data if it is
   wrong. It is deliberately expressed as an additional disjunct guarded on
   `partner_id is not null`, so an unlinked row cannot reach the new branch at
   all.
2. **`agreed_date` is captured at request time.** If the initiator edits their
   anniversary between requesting and the partner confirming, the prompt's date
   is stale. Accepting applies `agreed_date`, not the current value, so the two
   partners still end up agreeing with each other — but possibly on the older
   date. Acceptable: the prompt names the date being agreed to.
3. **The canonical partner is an implementation detail that surfaces** in
   reminder emails and in `celebrant_id`. If either ever becomes
   user-visible as "whose anniversary it is", it will look arbitrary.
