# Gift-Giving Occasions — Phase 2 (Item Tagging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people mark which wishlist items they had in mind for which occasion, and let a giver browsing that list see those items first.

**Architecture:** A join table `wishlist_item_occasions` links items to occasions. Birthdays materialize on first use via `get_or_create_occasion()`, which is the piece phase 1 deliberately deferred as dead code. Tagging is owner-only; ordering is viewer-side and never hides anything.

**Tech Stack:** Next.js 16.3.2 (App Router, server actions), Supabase Postgres with RLS, Clerk auth via `requesting_user_id()`, Vitest, Tailwind.

**Spec:** `_planning/2026-09-10-gift-giving-occasions-design.md`
**Predecessor:** `_planning/2026-09-10-gift-giving-occasions-plan.md` (phase 1, merged at `733e072`)

## One documented refinement to the spec

The spec gives the signature `get_or_create_occasion(p_group_id, p_kind, p_celebrant_id, p_date)`. **This plan narrows it to `get_or_create_occasion(p_kind)`** — no celebrant, no date, no group.

Why, and it is the same lesson phase 1's reviews taught twice: every parameter on a `security definer` function granted to `authenticated` is attack surface. A `p_celebrant_id` lets a caller materialize an occasion for somebody whose birthday they may not see, and a `p_date` lets them materialize one on a date that person never entered — a forged row that then renders to everyone who *can* see that celebrant. Deriving both internally from `profile_info` for `requesting_user_id()` removes the forgery vector entirely rather than guarding it.

This is safe because of who actually calls it: **you only tag your own items, and your own items are for occasions where you are the recipient.** You receive gifts on your birthday, not on your mother's. Group dates are already materialized rows created by hand in phase 1, so they need no materialization path at all.

## Global Constraints

Every one of these was learned the hard way during phase 1. They are not style.

- **Every `create policy` needs an explicit `to authenticated`.** No `TO` clause means `PUBLIC`, which includes `anon`, and the anon key ships to every browser. `supabase/tests/rls/06_anon_has_no_reach.sql` fails the whole suite if any `public` policy lacks a named role.
- **Policies and function bodies read `(select public.requesting_user_id())`, wrapped.** `baseline:23-27` documents the wrapper as load-bearing: it lets the planner evaluate the claim once per query rather than once per row. The baseline uses it in 119 call sites and the bare form in zero.
- **No `security definer` function takes a viewer or subject id parameter.** Pin to `requesting_user_id()` internally, as `accept_group_invitation` and `get_upcoming_occasions` do.
- **New RLS test files must be declared in `supabase/tests/rls/MANIFEST`.** The runner fails on undeclared files *and* on declared-but-missing ones.
- **An RLS test's success token is `OK_<filename minus .sql>`**, numeric prefix included — the runner derives it from the filename.
- **An RLS test must reset `role` to the captured `current_user` before its token insert.** `_harness_result` is superuser-owned; inserting as `authenticated` fails `42501`.
- **Owners must never learn anything about claims on their own items.** `getMyWishlist` (`lib/actions/wishlist.ts:53`) strips six claim columns deliberately. Tags are the owner's own intent and are safe to show them; anything claim-derived is not.
- **Untagged items are never hidden.** Every item in the database today is untagged. Occasion filtering highlights and orders; hiding is opt-in and never the default.
- **Every relative day label routes through `components/occasions/RelativeWhen.tsx`** with a server-computed `serverLabel`. Never call `daysUntil` for display in a server component, and never add `suppressHydrationWarning` — Next vendors React 19 for the client layer despite the React 18.3.1 in `package.json`, and React 19 does not patch text under that flag.
- **Never call `getUpcomingOccasions()` on its bare default.** Pass an explicit horizon and justify it at the call site; phase 1 shipped a bug where a group date 106 days out was invisible everywhere including right after creation.
- **`occasionId` is NULL for a derived birthday that has never been materialized** — not a React key on its own.
- Palette tokens, never raw hex. eslint baseline is 64 problems repo-wide; compare, don't count.
- Migrations run against the LINKED PRODUCTION project `xomvbdvvrlbxoyqdsstt`. `npm run test:rls` runs there too, inside rolled-back transactions.

## Current data state, which makes this cheap

Production holds 5 users, 1 group, 1 wishlist item, **0 claims**, and 0 `profile_info` rows. Nothing here needs a backfill and nothing can be broken by one. That window closes as the family starts using the app.

---

### Task 1: `get_or_create_occasion()`

**Files:**
- Create: `supabase/migrations/20260911000000_get_or_create_occasion.sql`
- Create: `supabase/tests/rls/13_occasion_materialization.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.occasions`, `public.celebration_date_in_year(text, integer)`, the `occasions_celebrant_identity` unique index — all from phase 1.
- Produces: `public.get_or_create_occasion(p_kind public.occasion_kind) returns uuid`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: materialize the caller's own celebrated occasion
-- =============================================================================
--
-- Phase 1 derived birthdays for DISPLAY and deliberately materialized nothing,
-- because nothing needed a foreign key yet. Phase 2's tags do: a row in
-- wishlist_item_occasions has to point at something.
--
-- SIGNATURE, and why it is narrower than the design doc's:
--   The spec proposed (p_group_id, p_kind, p_celebrant_id, p_date). Every one
--   of those parameters is attack surface on a SECURITY DEFINER function
--   granted to `authenticated`. p_celebrant_id would let a caller materialize
--   an occasion for somebody whose date they may not see; p_date would let
--   them materialize one on a date that person never entered -- a forged row
--   that then renders to everyone who legitimately CAN see that celebrant.
--
--   Taking no subject at all removes the vector rather than guarding it. The
--   caller is always the celebrant, because you only tag YOUR OWN items, and
--   your own items are for occasions where you are the recipient. Group dates
--   are stored rows created by hand and need no materialization path.
--
-- Idempotent under concurrency via occasions_celebrant_identity: two tags
-- created in the same second resolve to the same row.
create or replace function public.get_or_create_occasion(
  p_kind public.occasion_kind
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_year    integer := extract(year from current_date)::integer;
  v_value   text;
  v_date    date;
  v_id      uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- A group_date is never derived: it is created explicitly, by a person,
  -- through createGroupDate(). Materializing one here would invent an event
  -- nobody scheduled.
  if p_kind = 'group_date' then
    raise exception 'group dates are created explicitly, not materialized'
      using errcode = '22023';
  end if;

  select pi.field_value into v_value
  from profile_info pi
  where pi.user_id = v_caller
    and pi.category = 'dates'
    and pi.field_name = p_kind::text;

  if v_value is null then
    raise exception 'no % on file for this account', p_kind
      using errcode = '22023';
  end if;

  -- Same this-year-or-next rollover the read path uses, through the same
  -- helper, so a tag and the display it appears under cannot disagree about
  -- which year the occasion falls in.
  v_date := public.celebration_date_in_year(v_value, v_year);
  if v_date is null then
    raise exception 'stored % is not a usable date', p_kind
      using errcode = '22023';
  end if;
  if v_date < current_date then
    v_date := public.celebration_date_in_year(v_value, v_year + 1);
  end if;

  insert into public.occasions (kind, celebrant_id, occasion_date, created_by)
  values (p_kind, v_caller, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do nothing;

  -- The insert returns nothing when the row already existed, so read it back
  -- rather than relying on RETURNING.
  select o.id into v_id
  from public.occasions o
  where o.kind = p_kind
    and o.celebrant_id = v_caller
    and o.occasion_year = extract(year from v_date)::integer;

  return v_id;
end;
$$;

grant execute on function public.get_or_create_occasion(public.occasion_kind)
  to authenticated, service_role;
```

- [ ] **Step 2: Apply**

Run: `npx supabase db push`
Expected: applies cleanly. A classifier refusal is not a failure — retry the identical command, never something more destructive.

- [ ] **Step 3: Write the RLS test**

Create `supabase/tests/rls/13_occasion_materialization.sql`, counter-gated, token `OK_13_occasion_materialization`, `role` reset before the token insert. Assert:

1. calling it for a user with a birthday on file creates exactly one row, with `celebrant_id` equal to that caller and `group_id` null;
2. calling it **twice** returns the same uuid and leaves exactly one row — the idempotency the unique index provides;
3. `p_kind => 'group_date'` raises (catch it by asserting the row count is unchanged rather than by an exception handler — the harness rejects those);
4. a caller with no date on file creates no row.

Follow `12_occasion_derivation.sql`'s conventions; it is the closest model.

- [ ] **Step 4: Declare it**

Add `13_occasion_materialization.sql` to `supabase/tests/rls/MANIFEST`.

- [ ] **Step 5: Run and prove it bites**

Run: `npm run test:rls` — all files pass.
Then break it deliberately: change assertion 2's expectation to 2 rows, confirm it FAILS at its own raise, restore, confirm it passes. Paste both outputs.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260911000000_get_or_create_occasion.sql \
        supabase/tests/rls/13_occasion_materialization.sql \
        supabase/tests/rls/MANIFEST
git commit -m "feat(occasions): materialize the caller's own celebrated occasion"
```

---

### Task 2: `wishlist_item_occasions` table

**Files:**
- Create: `supabase/migrations/20260911000001_wishlist_item_occasions.sql`
- Create: `supabase/tests/rls/14_tag_visibility.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.occasions`, `public.wishlist_items`, `public.can_view_wishlist_item(text, text, jsonb)`.
- Produces: table `public.wishlist_item_occasions (item_id uuid, occasion_id uuid, created_at timestamptz)`, primary key `(item_id, occasion_id)`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: which occasions an item was meant for
-- =============================================================================
--
-- A tag is the OWNER'S statement of intent. Only the owner writes one --
-- letting a viewer tag somebody else's item would put words in their mouth,
-- and the item would then render to everyone else as if the owner had said it.
--
-- Reading a tag is gated by the ITEM's visibility, not the occasion's: a tag
-- reveals "this person wants this for their birthday", which is a fact about
-- the item. can_view_wishlist_item() is therefore the right gate, and reusing
-- it means a tag can never be visible where its item is not.
create table public.wishlist_item_occasions (
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  occasion_id uuid not null references public.occasions(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (item_id, occasion_id)
);

comment on table public.wishlist_item_occasions is
  'Owner-asserted link between a wishlist item and an occasion it is meant for. Read gated by the item''s visibility.';

-- Serves "the tags on these items", which is how every read path uses it.
create index wishlist_item_occasions_by_occasion
  on public.wishlist_item_occasions (occasion_id);

alter table public.wishlist_item_occasions enable row level security;

create policy "Tags are visible wherever their item is"
  on public.wishlist_item_occasions for select to authenticated
  using (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_item_occasions.item_id
        and public.can_view_wishlist_item(
          wi.user_id, (select public.requesting_user_id()), wi.privacy_settings)
    )
  );

create policy "Owners tag their own items"
  on public.wishlist_item_occasions for insert to authenticated
  with check (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_item_occasions.item_id
        and wi.user_id = (select public.requesting_user_id())
    )
  );

create policy "Owners untag their own items"
  on public.wishlist_item_occasions for delete to authenticated
  using (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_item_occasions.item_id
        and wi.user_id = (select public.requesting_user_id())
    )
  );

-- No UPDATE policy, deliberately: a tag has no mutable field. Changing which
-- occasion an item is for is a delete plus an insert, both of which the
-- policies above already gate. A tag that could be updated in place would need
-- a WITH CHECK that re-tested ownership of the NEW item_id -- the same shape of
-- hole the occasions UPDATE policy shipped with in phase 1.

grant select, insert, delete on public.wishlist_item_occasions to authenticated;
grant select, insert, delete on public.wishlist_item_occasions to service_role;
```

- [ ] **Step 2: Apply**

Run: `npx supabase db push`

- [ ] **Step 3: Write the RLS test**

Create `supabase/tests/rls/14_tag_visibility.sql`, counter-gated, token `OK_14_tag_visibility`, `role` reset before the token insert. Assert, in both directions:

1. a tag on a **private** item (this schema spells private as an empty `visibleToGroupTypes` array) is invisible to a stranger;
2. the same tag **is** visible to the item's owner — so assertion 1 is not passing vacuously on a table nobody can read;
3. a tag on a **visible** item is readable by a co-member who can see the item, proving the gate follows item visibility rather than blocking everything;
4. a non-owner's INSERT does not create a row. Assert by row count, not by catching an exception — the harness rejects exception handlers.

- [ ] **Step 4: Declare it**

Add `14_tag_visibility.sql` to `supabase/tests/rls/MANIFEST`.

- [ ] **Step 5: Run and prove it bites**

`npm run test:rls` green. Then drop the SELECT policy, confirm assertion 2 fails, recreate it, confirm green. Paste both. Do not leave production without the policy between those steps.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260911000001_wishlist_item_occasions.sql \
        supabase/tests/rls/14_tag_visibility.sql \
        supabase/tests/rls/MANIFEST
git commit -m "feat(occasions): add owner-asserted item tags"
```

---

### Task 3: Tag actions and tag-carrying reads

**Files:**
- Create: `lib/actions/item-occasions.ts`
- Create: `lib/actions/item-occasions.test.ts`
- Modify: `types/database.ts`

**Interfaces:**
- Consumes: `get_or_create_occasion(p_kind)`, `wishlist_item_occasions`, `getUserId` from `@/lib/auth/require-auth`, `createClient` from `@/lib/supabase/server`.
- Produces:
  - `export async function tagItemForMyOccasion(itemId: string, kind: "birthday" | "anniversary"): Promise<{ data: { occasionId: string } } | { error: string }>`
  - `export async function tagItemForGroupDate(itemId: string, occasionId: string): Promise<{ data: { occasionId: string } } | { error: string }>`
  - `export async function untagItem(itemId: string, occasionId: string): Promise<{ ok: true } | { error: string }>`
  - `export async function getTagsForItems(itemIds: string[]): Promise<{ data: Record<string, string[]> } | { error: string }>` — item id → occasion ids.

- [ ] **Step 1: Write the failing tests**

Create `lib/actions/item-occasions.test.ts` following the mocked-Supabase pattern in `lib/actions/occasions.test.ts`. Cover:

- `tagItemForMyOccasion` calls `get_or_create_occasion` with the given kind and then inserts `(item_id, occasion_id)` — assert both, in that order
- a `22023` from the RPC (no date on file) returns "Add your birthday to your profile first", not a generic failure
- a `42501` from the insert (not the owner) returns "You can only tag your own items"
- `untagItem` deleting zero rows returns the same message whether it did not exist or was not theirs — no oracle
- `getTagsForItems([])` returns `{}` **without** calling the database
- signed out returns `{ error: "Not authenticated" }` without touching the database

Use distinct identifiable values per field so a transposition fails loudly.

- [ ] **Step 2: Run, confirm they fail**

Run: `npx vitest run lib/actions/item-occasions.test.ts`
Expected: FAIL — cannot resolve `./item-occasions`.

- [ ] **Step 3: Write the actions**

Create `lib/actions/item-occasions.ts` as a `"use server"` module exporting exactly the four functions above and nothing else — every export becomes an HTTP endpoint. Use the **user-scoped** client throughout so the Task 2 policies apply; the admin client would bypass every one of them.

Shape each action on `lib/actions/occasions.ts`: `getUserId()` first, generic caller-facing messages with the provider detail logged server-side, and `revalidatePath("/wishlist")` plus `revalidatePath("/wishlist/user/${ownerId}")` after a write.

- [ ] **Step 4: Run, confirm they pass**

Run: `npx vitest run lib/actions/item-occasions.test.ts`

- [ ] **Step 5: Add the types**

Hand-add `wishlist_item_occasions` to `types/database.ts` and `get_or_create_occasion` to its `Functions` block. **Hand-edit — do not regenerate**: four `StoredImageValue` annotations in that file are load-bearing and `lib/storage/image-value.ts` fails to compile without them. Phase 1 lost a whole review round to a `Functions` entry that no task's brief asked for; this step is that lesson.

- [ ] **Step 6: Verify and commit**

`npx vitest run`, `npx tsc --noEmit` clean.

```bash
git add lib/actions/item-occasions.ts lib/actions/item-occasions.test.ts types/database.ts
git commit -m "feat(occasions): add item tagging actions"
```

---

### Task 4: Owner tagging UI on `/wishlist`

**Files:**
- Create: `components/wishlist/ItemOccasionTags.tsx`
- Modify: `app/(dashboard)/wishlist/page.tsx`
- Modify: `components/wishlist/WishlistItemCard.tsx`

**Interfaces:**
- Consumes: `tagItemForMyOccasion`, `tagItemForGroupDate`, `untagItem`, `getTagsForItems` (Task 3); `getUpcomingOccasions` and `occasionLabel` from phase 1.
- Produces: `export function ItemOccasionTags({ itemId, taggedOccasionIds, availableOccasions }: { itemId: string; taggedOccasionIds: string[]; availableOccasions: UpcomingOccasion[] })`

- [ ] **Step 1: Build the component**

A `"use client"` component rendering the occasions this item is tagged for as removable chips, plus a control to add one from `availableOccasions`.

Requirements:
- **Render nothing claim-derived.** This is the owner's own list; `getMyWishlist` strips claim state deliberately and a tag control must not reintroduce it.
- A birthday the owner has never materialized has `occasionId: null` — tagging it calls `tagItemForMyOccasion(itemId, kind)`, which materializes it. A group date has a real id and calls `tagItemForGroupDate`.
- Show the action's error text as returned. Do not add a permissions check of your own; the RLS policy decides.
- Empty state: if `availableOccasions` is empty, render a quiet line pointing at the profile — "Add your birthday to your profile to tag items for it" — not a disabled control with no explanation.

- [ ] **Step 2: Render it from the card**

`WishlistItemCard.tsx` currently takes `{ item, isOwnWishlist, currentUserId, claimerInfo }`. Add two optional props and render accordingly:

```tsx
  /** Occasion ids this item is tagged for. Empty array, never undefined, so
      the card never has to distinguish "no tags" from "tags not loaded". */
  taggedOccasionIds?: string[];
  /** Only supplied on the owner's own list, where tagging is permitted. */
  availableOccasions?: UpcomingOccasion[];
```

Render `<ItemOccasionTags>` **only when `isOwnWishlist` is true and `availableOccasions` is supplied.** A viewer must never see a tag control on somebody else's item — the RLS policy would refuse the write anyway, but offering a control that always fails is worse than not offering it.

The card is shared between the owner's list and a viewer's list, so this prop pair is what keeps the two behaviours apart. Do not branch on `currentUserId === item.user_id` instead; `isOwnWishlist` is the prop the page already passes for exactly this purpose.

- [ ] **Step 3: Wire it into the page**

In `app/(dashboard)/wishlist/page.tsx`, fetch tags for the rendered items with `getTagsForItems` and pass each item's tags plus `getUpcomingOccasions(365)` down. Use 365 here, not the 30 the context line uses: the context line asks "is this soon?" while tagging asks "what could this be for?", and a birthday eleven months out is still a legitimate tag target. Comment that at the call site.

- [ ] **Step 4: Verify**

`npx tsc --noEmit`, `npx vitest run`, `npx next build` green; eslint no worse than the 64-problem baseline.

- [ ] **Step 5: Commit**

```bash
git add components/wishlist/ItemOccasionTags.tsx app/\(dashboard\)/wishlist/page.tsx components/wishlist/WishlistItemCard.tsx
git commit -m "feat(occasions): let owners tag items for an occasion"
```

---

### Task 5: Occasion-aware ordering for viewers

**Files:**
- Modify: `components/wishlist/SortableWishlistItems.tsx`
- Modify: `components/wishlist/WishlistItemCard.tsx` (the badge — Task 4 added the props it hangs off)
- Modify: `app/(dashboard)/wishlist/user/[userId]/page.tsx`
- Create: `lib/occasions/order.ts`
- Create: `lib/occasions/order.test.ts`

**Interfaces:**
- Consumes: `getTagsForItems` (Task 3), `getUpcomingOccasions` (phase 1).
- Produces:
  - `export function partitionByOccasion<T extends { id: string }>(items: T[], taggedIds: Set<string>): { tagged: T[]; rest: T[] }`
  - `export function itemsTaggedFor(tagsByItem: Record<string, string[]>, occasionId: string | null): Set<string>`

**The shape change between Task 3 and here, stated explicitly because it is the seam where this goes wrong:** `getTagsForItems` returns `Record<itemId, occasionIds[]>` — every tag on every item. `partitionByOccasion` needs a `Set<itemId>` containing only the items tagged for the **one occasion currently in view**. The obvious wrong conversion is "every item that has any tag at all", which would surface Christmas-tagged items while a viewer is looking at somebody's birthday. `itemsTaggedFor` exists to make that conversion one named, tested function rather than an inline `Object.keys()` somebody writes from memory.

- [ ] **Step 1: Write the failing test**

Create `lib/occasions/order.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { partitionByOccasion, itemsTaggedFor } from "./order";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("partitionByOccasion", () => {
  it("puts tagged items first and keeps the rest in their given order", () => {
    const { tagged, rest } = partitionByOccasion(items, new Set(["b"]));
    expect(tagged).toEqual([{ id: "b" }]);
    expect(rest).toEqual([{ id: "a" }, { id: "c" }]);
  });

  // The spec's rule: untagged means "for any occasion", never "hide me".
  it("returns everything when nothing is tagged", () => {
    const { tagged, rest } = partitionByOccasion(items, new Set());
    expect(tagged).toEqual([]);
    expect(rest).toEqual(items);
  });

  // Order within each partition must survive, because the caller has already
  // applied the viewer's chosen sort and this only re-groups.
  it("preserves relative order within each partition", () => {
    const { tagged } = partitionByOccasion(items, new Set(["c", "a"]));
    expect(tagged).toEqual([{ id: "a" }, { id: "c" }]);
  });
});

describe("itemsTaggedFor", () => {
  const tags = { a: ["occ-1"], b: ["occ-1", "occ-2"], c: ["occ-2"] };

  it("selects only items tagged for the occasion in view", () => {
    expect(itemsTaggedFor(tags, "occ-1")).toEqual(new Set(["a", "b"]));
  });

  // The failure this function exists to prevent: treating "has any tag" as
  // "is for this occasion" would put c in the set while viewing occ-1.
  it("excludes items tagged only for a different occasion", () => {
    expect(itemsTaggedFor(tags, "occ-1").has("c")).toBe(false);
  });

  // A derived birthday nobody has tagged anything for was never materialized,
  // so it has no id -- and nothing can be tagged for it. The list must then
  // render exactly as it did before this feature existed.
  it("returns an empty set for an unmaterialized occasion", () => {
    expect(itemsTaggedFor(tags, null)).toEqual(new Set());
  });

  it("returns an empty set when the item has no tags at all", () => {
    expect(itemsTaggedFor({}, "occ-1")).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run, confirm it fails**

Run: `npx vitest run lib/occasions/order.test.ts`
Expected: FAIL — cannot resolve `./order`.

- [ ] **Step 3: Implement**

```ts
/**
 * Splits an already-sorted list into "tagged for the occasion in view" and
 * everything else, preserving the order the caller established.
 *
 * A partition rather than a sort comparator, deliberately: the viewer has
 * already chosen a sort in SortableWishlistItems, and occasion relevance is a
 * grouping applied ON TOP of that choice rather than a replacement for it.
 * Folding it into the comparator would silently override whatever the viewer
 * picked.
 */
export function partitionByOccasion<T extends { id: string }>(
  items: T[],
  taggedIds: Set<string>
): { tagged: T[]; rest: T[] } {
  const tagged: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (taggedIds.has(item.id) ? tagged : rest).push(item);
  }
  return { tagged, rest };
}

/**
 * The item ids tagged for ONE occasion, from the all-tags map the action
 * returns.
 *
 * This exists as a named function rather than an inline expression because
 * the wrong version is so easy to write: taking every key of the map treats
 * "has any tag" as "is for this occasion", and would surface a Christmas-
 * tagged item to somebody looking at a birthday list.
 *
 * A null occasionId means the occasion has no materialized row -- a derived
 * birthday nobody has tagged anything for. Nothing can be tagged for it, so
 * the empty Set is the honest answer and the list renders as it always did.
 */
export function itemsTaggedFor(
  tagsByItem: Record<string, string[]>,
  occasionId: string | null
): Set<string> {
  if (occasionId === null) return new Set();

  const ids = new Set<string>();
  for (const [itemId, occasionIds] of Object.entries(tagsByItem)) {
    if (occasionIds.includes(occasionId)) ids.add(itemId);
  }
  return ids;
}
```

- [ ] **Step 4: Run, confirm it passes**

- [ ] **Step 5: Wire into the viewer's list**

In `SortableWishlistItems.tsx`, accept an optional `occasionTaggedIds?: Set<string>` and an `occasionLabel?: string`. When present, apply `partitionByOccasion` to `sortedItems`, render the tagged group under a heading naming the occasion, and render the rest below under "Everything else".

Add an **opt-in** "only show items for this occasion" toggle, default off. Untagged items must remain visible until the viewer explicitly asks otherwise.

In `app/(dashboard)/wishlist/user/[userId]/page.tsx`, fetch the tags with `getTagsForItems`, convert them with `itemsTaggedFor(tags, theirOccasion?.occasionId ?? null)`, and pass the resulting Set down alongside the occasion already surfaced there.

Note what happens when that celebrant has never tagged anything: their birthday was never materialized, `occasionId` is `null`, `itemsTaggedFor` returns an empty Set, and the list renders exactly as it does today. That is the correct behaviour, not a case to special-case around.

- [ ] **Step 6: Add the badge the spec calls for**

The spec's rule is that tagged items "sort first **and carry a badge**". The grouping heading alone is not enough: once a viewer scrolls, or once the opt-in filter is on and only tagged items remain, the heading is off-screen and nothing on the item itself says why it is there.

In `WishlistItemCard.tsx`, when `taggedOccasionIds` contains the occasion currently in view, render a small badge on the card reading the occasion's label. Pass the in-view occasion id down from `SortableWishlistItems`.

Use the same palette tokens as the existing priority pill on that card so it reads as part of the card's existing vocabulary rather than a bolted-on marker. Render nothing when the item is untagged — an "untagged" badge would turn the absence of an owner's statement into a visible label about them.

- [ ] **Step 7: Verify**

`npx vitest run`, `npx tsc --noEmit`, `npx next build` green; eslint at baseline. Confirm by reading the diff that a viewer with the toggle off still sees every item they saw before this change.

- [ ] **Step 8: Commit**

```bash
git add components/wishlist/SortableWishlistItems.tsx components/wishlist/WishlistItemCard.tsx lib/occasions/order.ts lib/occasions/order.test.ts app/\(dashboard\)/wishlist/user/\[userId\]/page.tsx
git commit -m "feat(occasions): order a viewer's list by the occasion in view"
```

---

## Phase 2 done when

- An owner can tag an item for their own birthday and for a group date, and the birthday materializes on first tag without them doing anything.
- A giver opening that person's wishlist during the occasion window sees tagged items first, with everything else still visible below.
- Nothing claim-derived appears anywhere on an owner's own list.
- `npm run test:rls` passes with `13_occasion_materialization.sql` and `14_tag_visibility.sql` declared and proven to bite.

## Out of scope

Phase 3 — occasion-scoped claiming, `wishlist_claims`, and dropping `wishlist_items.claimed_by` — is a separate plan. Do not start it here, and do not modify `claimWishlistItem`, `unclaimWishlistItem`, or `markAsPurchased`.

## Known gaps

Written during the final whole-branch review's fix wave. Both below are deliberate scope calls, not bugs — recorded here so they are visible on `main` rather than silent.

### Known gap: group-date tags are owner-visible only

**What works:** An owner can tag one of their own items for a group date (a shared occasion any member of the group can see, e.g. "Christmas 2026"), the same way they tag one for their own birthday or anniversary. The tag is stored in `wishlist_item_occasions` exactly like a birthday/anniversary tag, gated by the same RLS policies, and renders as a chip on the owner's own `/wishlist` card via `ItemOccasionTags`.

**What does not work:** No giver-facing surface ever groups an item by a group-date tag. The only viewer ordering surface, `/wishlist/user/[userId]`, selects "the occasion in view" with `occasions.find(o => o.celebrantId === userId)` (`app/(dashboard)/wishlist/user/[userId]/page.tsx:110-111`) — and a `group_date` row always has `celebrant_id: null`, so it can never match there. The group page links a group date to `/groups/{id}`, never to any wishlist. A tag written against a group date is therefore stored, correctly access-controlled, and rendered back to its own owner — but invisible to every other member of the group who might act on it. Half the tag-target surface is write-only today.

**Why it was not built:** Threading a group-date occasion through to a read path is not a small wire. A birthday or anniversary has exactly one celebrant, so "whose wishlist does this occasion belong to" is unambiguous. A group date applies to everyone in the group — "see what people want for Christmas" is inherently a roster across every member's wishlist, not one person's list ordered around it. That is a real design question (a new page? a section on the group page? which items, in what order, for whom?), and a scope decision like that belongs to a human, not something to improvise inside a fix wave.

**Why the picker still offers group dates, rather than removing them:** Removing `group_date` from `taggableOccasions()` (`lib/occasions/taggable.ts`) would take away a capability the spec's Surfacing table grants, and a tag an owner has already made still means something to them today — it is their own recorded intent, visible on their own card, exactly as a birthday tag is. Silently disabling the option would be a regression with no compensating fix, in exchange for closing a gap that removing the option does not actually close (existing tags would still have no read path; only new ones would stop being created).

**Resolution:** Phase 3 (occasion-scoped claiming) is where group dates get a real read path — claiming is inherently the roster-across-the-group view this needs, so the two land together rather than this phase building a one-off list page that phase 3 would have to redesign anyway.

### Known gap: two spec Surfacing rows were never built

The spec's Surfacing table promises two views this phase never built. Neither was ever asked for by any task in this plan, so no task's reviewer could have flagged the gap — it surfaced only in the final whole-branch review, which is exactly the kind of thing a whole-branch pass exists to catch.

- **Item detail** (`app/(dashboard)/wishlist/[itemId]/page.tsx`): the spec says the owner should see "which occasions this item is tagged for" here. That page currently renders zero occasion content — tags are visible only from the `/wishlist` card list (`ItemOccasionTags`), never from an item's own detail page.
- **Dashboard "N items tagged"**: the spec calls for a per-occasion count of tagged items, shown to viewers on the dashboard. No dashboard surface in this branch computes or renders that count.

Both are legitimate scope cuts for phase 2 — not oversights to quietly patch later without a plan of their own. Building either is future work.
