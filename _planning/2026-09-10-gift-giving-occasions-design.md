# Gift-Giving Occasions

Status: proposed
Date: 2026-09-10

## Problem

Rybn has wishlists and claiming, but no notion of *why* anyone is shopping.
A family using it for birthdays has no shared answer to "what are we all
working toward next," and an item on a list carries no signal about which
occasion its owner had in mind. Claims, once made, never release -- so an item
someone claimed for a birthday and never bought stays blocked forever.

This design introduces **occasions**: a first-class gift-giving event that
gives wishlist items context, scopes claims, and surfaces the same shared
answer everywhere in the app.

## What already exists

Read this before assuming anything is missing. A surprising amount is here.

| Thing | Where | Shape |
|---|---|---|
| Birthdays / anniversaries | `profile_info`, `category='dates'` | `field_value` as `YYYY-MM-DD` text, with per-field `privacy_settings` |
| Day-of reminders | `date_notifications` + `checkAndSendDateReminders` cron + `DateReminderBanner` | Fires on the day, keyed per notified-user x celebrant x year x group |
| Exchange-style events | `gift_exchanges` | Secret Santa / white elephant, with `exchange_date`, budget, `registration_deadline`, drawn assignments |
| Pooled gifts | `group_gifts` | Contributions toward a `target_user_id` |
| Private tracking | `gift_recipients`, `tracked_gifts` | Never shared |
| Wishlist items | `wishlist_items` | Privacy, single `claimed_by`, terminal `purchased` |

The gap is narrower than "we have nothing": what is missing is a **non-exchange
occasion** with recipients rather than drawn pairs, and **any link at all**
between an occasion and the items on a list.

## Constraints that shape the design

These are not preferences. Violating either is a security or trust bug.

### 1. Birthday visibility is per-viewer, not per-group

`get_upcoming_dates_for_notifications` gates every row on
`can_view_field(celebrant, viewer, privacy_settings)`. Whether you can see
Mom's birthday depends on your relationship to her -- shared group *type*, or
an explicit single-group restriction -- not merely on sharing a group.

A derived occasion must therefore inherit the birthday's privacy exactly. It
cannot become a back door that reveals a date the profile field would have
hidden. The schema comments record that this function was once "an
unauthenticated dump of the user table"; occasion visibility is treated as
security-sensitive throughout.

### 2. Owners must never see claim state on their own items

`getMyWishlist` (`lib/actions/wishlist.ts:53`) strips `claimed_by`,
`claimed_at`, `purchased`, `purchased_at`, `out_of_stock_marked_by` and
`out_of_stock_marked_at` before returning. The surprise is the product.

This is in direct tension with "reflect the occasion context everywhere," and
the design resolves it explicitly rather than by accident: **occasion context
is symmetric, claim context is not.** Both owner and viewer see the occasion,
its date, and which items are tagged for it. Only a viewer sees anything
claim-derived -- including counts, badges, and "N items already spoken for."

Any new field computed from `wishlist_claims` joins the strip list.

## Data model

### `occasions`

```sql
create type public.occasion_kind as enum ('birthday', 'anniversary', 'group_date');

create table public.occasions (
  id uuid primary key default gen_random_uuid(),
  -- Set for group_date, NULL for birthday/anniversary. A birthday belongs to
  -- the celebrant, not to a group -- see "Why birthdays are not group-scoped".
  group_id uuid references public.groups(id) on delete cascade,
  kind public.occasion_kind not null,
  -- null for derived occasions; the celebrant's name renders them.
  -- Required for group_date.
  name text,
  occasion_date date not null,
  occasion_year integer generated always as
    (extract(year from occasion_date)::integer) stored,
  -- The person being celebrated. NULL means "everyone in the group",
  -- which is what a group_date is.
  celebrant_id text references public.user_profiles(id) on delete cascade,
  created_by text references public.user_profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint group_date_shape check (
    kind <> 'group_date'
    or (name is not null and celebrant_id is null and group_id is not null)),
  constraint celebrated_shape check (
    kind = 'group_date'
    or (celebrant_id is not null and group_id is null)),
  constraint name_length check (name is null or char_length(name) between 1 and 200)
);

-- One row per celebrant per kind per year, deliberately NOT per group.
-- Also makes materialization idempotent under concurrency: two people tagging
-- items for the same birthday in the same second get the same row.
create unique index occasions_celebrant_identity
  on public.occasions (kind, celebrant_id, occasion_year)
  where celebrant_id is not null;
```

`occasion_year` is a stored generated column so the uniqueness constraint can
reference it. `extract(year from <date>)` is immutable for `date`, which
generated columns require.

#### Why birthdays are not group-scoped

Mom has one birthday. If occasions were keyed by group, her birthday would be a
different row in the family group than in the friends group, and she would have
to tag the same items twice for one event -- once per audience -- with the two
sets free to drift apart. Claims would fragment the same way: an item claimed
for "her birthday (family)" would appear unclaimed under "her birthday
(friends)", which is precisely the double-buying that claiming prevents.

So group membership is a **visibility** dimension, not an **identity** one.
`can_view_field` already collapses it correctly: it loops the groups a viewer
and celebrant share and returns true if any of them qualifies. One occasion,
one set of tags, one claim -- shown to whoever is allowed to see the underlying
birthday.

Group dates are the opposite and genuinely do belong to a group: "Christmas
2026" in the family group is a different event from one in a work group, even
on the same date. Those carry `group_id` and no celebrant.

### `wishlist_item_occasions`

```sql
create table public.wishlist_item_occasions (
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  occasion_id uuid not null references public.occasions(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (item_id, occasion_id)
);
```

### `wishlist_claims`

```sql
create table public.wishlist_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  -- on delete set null, not cascade: deleting an occasion must not silently
  -- destroy the record of who claimed what. The claim survives as an
  -- unscoped one.
  occasion_id uuid references public.occasions(id) on delete set null,
  claimed_by text not null references public.user_profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz default now()
);

-- At most one live claim per item, across all occasions. See "One active
-- claim per item" below for why this is not per-occasion.
create unique index wishlist_claims_one_active
  on public.wishlist_claims (item_id) where released_at is null;
```

### Changes to existing tables

- `gift_exchanges` gains `occasion_id uuid references public.occasions(id) on
  delete set null`. Nullable, unused by existing rows. A Christmas Secret
  Santa becomes an exchange *inside* the Christmas occasion; nothing about the
  existing exchange flow changes.
- `wishlist_items.claimed_by` and `claimed_at` are **dropped** in phase 3,
  after backfill. See "Migration path".
- `wishlist_items.purchased` / `purchased_at` **stay**. Purchase is terminal
  and item-level.

## Deriving vs materializing

Birthdays live in `profile_info` and must stay there -- one source of truth,
edits take effect immediately, privacy is already modelled. But tags and claims
need a real foreign key to point at. The design splits the two paths:

**Display is derived.** `get_upcoming_occasions(p_days_ahead)` is a
`security definer` function that takes **no viewer parameter** and pins the
viewer to `requesting_user_id()` internally.

That is not a stylistic choice. `get_upcoming_dates_for_notifications` takes a
day window and a year with no caller filter, which is exactly why the baseline
grants it to `service_role` only -- the anon key ships to every browser and
PostgREST exposes public functions at `/rest/v1/rpc/`, so an authenticated
grant there would be a dump of the user table. A `p_viewer_id` parameter would
reproduce that hole: any signed-in caller could ask for anyone else's view.
Taking no such parameter is the same defence `accept_group_invitation` and
`join_group_with_code` already use, and it lets this function be granted to
`authenticated`.

It returns the union of:

1. birthday and anniversary occasions computed live from `profile_info`, one
   per celebrant per year, gated on `can_view_field(celebrant, viewer,
   privacy_settings)`; and
2. stored `group_date` rows for the viewer's groups.

Derived rows carry the id of their materialized twin when one exists, and null
otherwise. Nothing is written on a read.

**Writes materialize.** `get_or_create_occasion(p_kind, p_celebrant_id,
p_date)` returns the existing row or inserts one, made idempotent by
`occasions_celebrant_identity`. It is called only when a foreign
key is genuinely needed: the first tag or the first claim for that occasion.

The shared date arithmetic is factored into one immutable helper,
`celebration_date_in_year(field_value text, target_year integer) returns date`,
used by both `get_upcoming_occasions` and
`get_upcoming_dates_for_notifications`.

This also fixes a latent crash in the existing function. It computes the
celebration date as `(target_year || '-' || substring(field_value from 6 for
5))::date`, so a birthday of `2000-02-29` in a non-leap target year casts
`'2027-02-29'` and raises `date/time field value out of range`. The date is
computed in the WHERE clause across every `profile_info` dates row, so a single
Feb-29 birthday anywhere in the table takes down the reminder run for every
user. The helper clamps Feb 29 to Feb 28 in non-leap years.

Consequences worth stating: no cron, no yearly generation job, no backfill when
someone joins a group or edits their birthday, and no rows for occasions nobody
has engaged with.

## Item tagging

Tagging answers "what did this person have in mind for this occasion."

**Untagged items stay visible.** An untagged item is not "for no occasion" --
it is "for any." Occasion filtering *highlights and orders*; it never hides.
Hiding untagged items would silently break every list that exists today, since
every item in the database right now is untagged.

The wishlist views gain an occasion-aware ordering: items tagged for the
occasion in view sort first and carry a badge; everything else follows in its
current order. A viewer can filter down to tagged items only; that is opt-in
and not the default.

Owners tag their own items. Nobody else can tag another person's item -- the
tag expresses the owner's intent, and letting a viewer assert it would put
words in the owner's mouth.

## Claims

### One active claim per item

Claims are *labeled* with an occasion but are **not scoped per occasion for
mutual exclusion**. If exclusion were per-occasion, headphones could be
claimed for Mom's birthday by one person and for Christmas by another
simultaneously -- two people buying the same thing, which is the exact failure
claiming exists to prevent.

So: one live claim per item, tagged with the occasion it was made for, and it
auto-releases when that occasion passes unfulfilled.

### Active is computed, expiry self-heals on write

A claim is active when:

```
released_at is null
and (occasion_id is null or occasion.occasion_date >= current_date)
```

Reads use that definition, so a lapsed claim never renders as live.

Writes cannot rely on it, because the unique index only sees `released_at is
null` and would block a new claim behind an expired row. `claim_wishlist_item`
is therefore a `security definer` function that, in one transaction:

1. sets `released_at = now()` on any claim for that item whose occasion has
   passed;
2. inserts the new claim.

The unique index remains the race backstop. No release cron exists, and none
is needed.

An unscoped claim (`occasion_id is null`) never auto-releases. That is what
existing claims become on migration, preserving today's behaviour exactly for
claims already out there.

### Purchase

`purchased` stays on `wishlist_items` and stays terminal. A purchased item
accepts no new claims and its fulfilling claim is left unreleased as the record
of who bought it. Purchase state remains stripped from the owner.

## Surfacing

The same shared answer, rendered for the right audience:

| Where | Owner sees | Viewer sees |
|---|---|---|
| Dashboard | "Next up: your birthday, Oct 29" + upcoming occasions across groups | Same list, plus per-occasion "N items tagged" |
| Group page | That group's group-dates, plus member birthdays the viewer may see | Same, plus claim progress |
| Own wishlist | "Your birthday is in 3 weeks -- tag what you'd like for it" | n/a |
| Someone's wishlist | n/a | "Mom's birthday, Oct 29" + tagged items first + claim badges |
| Item detail | Which occasions this item is tagged for | Tags + claim state |

One shared server action, `getUpcomingOccasions()`, backs all of these, so the
"next event" never disagrees between two screens.

## Interplay with the existing reminder system

`date_notifications` fires **on the day**; occasions are the **lead-up**. They
are complementary and the reminder system is not modified, beyond factoring
out the shared derivation helper described above. Phase 1 does not touch
`checkAndSendDateReminders`, its cron, or its email.

Occasion-based lead-up email is explicitly **out of scope** here. It is a
natural follow-up and should be its own design.

## Testing

**Vitest** for pure logic, matching the existing style in
`lib/wishlist/privacy-choice.test.ts`:

- occasion date maths -- this year vs next year rollover, Feb 29 birthdays
- the active-claim predicate, including the expired-occasion case
- untagged-item ordering defaults

**RLS suite** (`supabase/tests/rls/`, `npm run test:rls`). New files must be
added to `MANIFEST` -- the runner fails on undeclared files *and* on declared
files that are missing, and every file must use the counter-gated
`_harness_result` pattern. New coverage:

- `11_occasion_visibility.sql` -- a derived occasion is invisible to exactly
  the viewers `can_view_field` would refuse, including the
  `restrictToGroup` case
- `12_claim_scoping.sql` -- one active claim per item holds under concurrent
  claims; an expired claim does not block a new one; a released claim is not
  resurrected

**Owner-blindness regression** -- an explicit test that no occasion or claim
field leaks through `getMyWishlist`. This is the invariant most likely to be
broken by a later well-meaning change, so it gets a named test rather than
relying on review.

## Migration path

Three phases, each shipping standalone value. Phase 1 is usable in the family
group immediately.

**Phase 1 -- occasions and context.** `occasions` table, the derived function,
`get_or_create_occasion`, `getUpcomingOccasions()`, group-date create/edit UI,
and the dashboard / group / wishlist surfacing. No change to items or claims.

**Phase 2 -- tagging.** `wishlist_item_occasions`, tag UI on the owner's items,
occasion-aware ordering and the opt-in filter.

**Phase 3 -- occasion-scoped claiming.** The riskiest step, and the only one
touching live claim data:

1. create `wishlist_claims`;
2. backfill from `wishlist_items` where `claimed_by is not null`, with
   `occasion_id = null`;
3. switch reads and writes to the new table and the new RPC;
4. update the RLS policies that reference `claimed_by`;
5. drop `wishlist_items.claimed_by` and `claimed_at`.

Steps 1-5 land in **one migration**. Splitting them leaves a dual-write window
with two sources of truth for the same fact, which is worse than a larger
single migration. The gate on phase 3 is the full RLS suite passing, including
the new files.

## Out of scope

Deliberately excluded. Each is a reasonable follow-up and none is a
prerequisite.

- Occasion-based lead-up email
- Recurring or custom-cadence occasions beyond annual birthdays
- Per-occasion budgets (`gift_exchanges` already has budgets for exchanges)
- Narrowing a group-date's recipients below the whole group
- Consumable / repeatable items -- purchase stays terminal
- Migrating `gift_exchanges` into `occasions`
