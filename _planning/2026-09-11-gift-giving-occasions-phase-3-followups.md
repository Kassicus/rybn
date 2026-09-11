# Phase 3 follow-ups — occasion-scoped claiming

Open items at merge of `worktree-occasions-phase-3` (14 commits, 9af27b3..80832ba).
Recorded from the final whole-branch review, which returned **no Critical
findings** and **MERGE WITH FOLLOW-UPS**. None of the Importants below can
manifest while production holds 0 claims; all become reachable once claims exist
and an occasion passes.

Merged and deployed on 2026-09-11. The migrations were already applied to the
linked production project before the merge, so the merge itself was code-only —
a repair of production, which until then ran code writing columns that no longer
existed.

## F1 — DONE (2026-09-11)

Both halves shipped. Kept here rather than deleted because F1b's originally
specified fix **did not work**, and the reason is worth not rediscovering.

**F1a — the two claim surfaces disagreed.** `[itemId]/page.tsx` passed
`kind={null}` unconditionally, so claiming from the detail page produced an
unscoped claim that never auto-releases, while claiming the same item from its
list card produced a scoped one. Both now resolve the occasion identically,
using the rule copied from `user/[userId]/page.tsx:110-117` rather than
reinvented. Commit `858715e`.

**F1b — claimer self-visibility.** Shipped as
`20260911100004_claimer_self_visibility.sql`.

**What this document originally specified was wrong.** It said to add the
disjunct as `wi.user_id <> me AND (can_view_wishlist_item(...) OR claimed_by =
me)` — i.e. inside the policy's existing `EXISTS` over `wishlist_items`. That
subquery is itself subject to `wishlist_items`' RLS for the querying role, so
for the very caller this was meant to help — a claimer who has lost sight of
the item — the `EXISTS` never matches and the added disjunct is unreachable.
It would have shipped, passed review, and done nothing.

Verified rather than reasoned, impersonating a user who cannot see the one live
item:

```
exists (select 1 from wishlist_items wi where wi.id = <item>)  ->  false
```

**The shape that works** puts the new branch at the TOP level, where it never
reads `wishlist_items` as the caller:

```sql
(claimed_by = (select public.requesting_user_id())
   and not public.owns_wishlist_item(wishlist_claims.item_id))
or exists ( ...unchanged owner-excluding visibility check... )
```

`owns_wishlist_item(uuid)` is a new `security definer` helper pinned to
`requesting_user_id()`. It takes no viewer parameter, so it only ever answers
"do I own this", which the caller already knows — not an ownership oracle.

**Why the helper rather than a bare `claimed_by = me` disjunct**, which needs no
new function and looks obviously correct: a bare disjunct re-opens
owner-blindness for any row where the item's owner is also its claimer. Proved
in a rolled-back transaction against production:

```
A_shipped__claimer_sees_own_on_hidden_item       1   <- the fix works
B_shipped__owner_sees_self_claim                 0   <- owner-blindness holds
C_no_self_branch__claimer_sees_own               0   <- assertion 6(b) bites
D_no_ownership_conjunct__OWNER_SEES_OWN_ITEM     1   <- the bare disjunct leaks
```

No such row can be produced through the application today — `claim_wishlist_item()`
raises on self-claim and `authenticated` holds no INSERT privilege on the table
— but that is an invariant maintained elsewhere, and moving owner-blindness into
RLS (20260911100001) was specifically about not relying on those. The helper
keeps the guarantee inside the policy.

`16_claim_visibility.sql` gains assertions 6-8 (floor 8 -> 12), including a
fixture whose claim names the item's owner as claimer. That row cannot arise
through any application path; it exists precisely so the `owns_wishlist_item`
conjunct is falsifiable. Without it the conjunct would be decorative — nothing
else in the file can tell whether it is there.

## F2 — DONE (2026-09-11, commit `2de5b24`)

Fixed by consolidating the rule into `lib/claims/active.ts`, shared by
`getActiveClaims` and `markAsPurchased`, rather than patching the two call
sites into agreement and leaving them free to drift again. Purchase is checked
BEFORE the date deliberately: reversing them refuses the purchaser permission
to undo their own purchase once the occasion has passed. Both new tests
verified by mutation. The false "by construction" invariant in
`markAsPurchased`'s doc comment is corrected. Original description follows.

### Original finding

`lib/actions/claims.ts:224` excludes any claim whose occasion has passed, with no
regard for `purchased`. `supabase/migrations/20260911100002_claim_rpcs.sql:50-52`
treats purchase as terminal **before** reaching the lapse-release at `:97-104`, so
such a claim correctly stays `released_at is null` forever — it is the record of
who bought it.

They disagree, and the disagreement is the normal end state of every fulfilled
gift. For claim -> purchase -> birthday passes:

- every viewer sees a "Purchased" badge (`WishlistItemCard.tsx:193`) **and** an
  "I'll get this" button (`ClaimActions.tsx:259`), because `claimedBy` is now
  null. Clicking always errors with "that item has already been purchased".
- the purchaser loses their own "You purchased this" / Undo / Unclaim controls
  (`ClaimActions.tsx:361`).

`lib/actions/claims.test.ts:368-486` covers past / today-or-future / unscoped and
has **no purchased case** — a test suite green while the behaviour is wrong.

Also in F2:

- **`markAsPurchased` is a fourth expression of "active"** and omits the lapse
  half (`lib/actions/wishlist.ts:324-330`), so a claim the read path has told
  every viewer does not exist still authorizes a purchase. Low reachability (the
  button is hidden), but it is a directly callable server action.
- **Correct the false invariant at `lib/actions/wishlist.ts:311-313`**, which
  claims "a caller holding an active claim on an item can, by construction, see
  it." F1b is the counterexample. Right conclusion for the normal case, wrong
  mechanism — and precisely the sentence a future author reads as "no need to
  handle the empty case."

## F3 — DONE (2026-09-11)

Removed, floor 21 -> 20. The premise was verified independently before deleting
a test: `reject_non_owner_column_change()` compares every changed column in one
set-based pass (`20260822000000_pin_privacy_columns.sql:125-128`) with no
per-column branching, so a one-column write and a four-column write execute
identical code. Assertion 5 wrote `purchased` alone against the same row, as
the same role, in the same statement shape as assertion 6, which writes
`purchased` plus three more -- nothing could fail 5 and pass 6.

Not repointed. The only permitted column assertion 6 never writes is
`updated_at`, and a dedicated assertion for it would have falsifying power but
no value: `pin_wishlist_item_owner_fields` sorts before
`update_wishlist_items_updated_at`, so the pin never sees that trigger's write,
and the app never sets `updated_at` explicitly. Dropping it from the permitted
list would break nothing in production.

Assertion 6 now carries a note that it is the SOLE cover for `purchased`, so a
future narrowing of its column list is recognised as removing coverage rather
than tidying.

That sole-cover claim was proved rather than asserted, in a rolled-back
transaction: with the shipped permitted list assertion 6's write is allowed;
with `purchased` removed from the list it is REJECTED.

**Worth knowing for anyone writing a proof against this trigger:** it flags only
columns whose value actually CHANGED. The first attempt at the proof above
reused one item for both the baseline and the mutation, so the mutation's write
set `purchased = true` on a row where it was already true -- no change, nothing
flagged, and the mutation looked harmless. It needed a second, untouched item.
A proof that reuses a row it has already written is measuring nothing.

### Original finding

`supabase/tests/rls/09_privacy_pins.sql:365-378`. The trigger takes its five
permitted columns as one argument list with no per-column branching, so
assertion 5's `{purchased}` is a strict subset of assertion 6's four columns
under the same role, row and statement shape. Nothing can fail 5 and pass 6.

Remove it and drop the floor 21 -> 20. Repointing has exactly one viable target
(`updated_at` alone, the only permitted column assertion 6 never writes), and
that tests a write shape the app never makes.

## F4 — DONE (2026-09-11)

**Block-comment floor back-ported to `15_celebrated_materialization.sql`**
(floor 12 -> 13). It guards `get_or_create_celebrated_occasion`, the other
SECURITY DEFINER function in this phase taking a subject parameter, and the
file had documented the residue as KNOWN rather than closing it. Its header no
longer describes an open hole: it now says anchoring stops a LINE comment and
points at the floor for the block-comment case.

**The lapse boundary is now pinned on the SQL side too**
(`17_claim_lifecycle.sql`, floor 27 -> 28). `claim_rpcs.sql:102` compares
`o.occasion_date < current_date`; mutating that to `<=` releases a live claim on
the morning of the birthday. The TypeScript side pins the same boundary
behaviourally; this side had nothing, because the file's only lapse fixture is
dated 2000-01-01 and `<` -> `<=` changes none of its outcomes.

**Why it is a shape check rather than the live fixture this document asked for.**
The release is scoped to the item being claimed (`c.item_id = p_item_id`), so
the only way to exercise it is to claim that same item. With the operator
CORRECT a claim dated today survives, the insert collides with
`wishlist_claims_one_active`, and the re-raised `unique_violation` aborts the
file's whole batch. With the operator MUTATED the claim releases and the insert
quietly succeeds. The live test would therefore pass only while the code is
broken and fail the entire file while it is correct -- the same harness
limitation that makes assertions 2/4/7 shape checks, reached from the opposite
direction. The suggestion in this document to assert a today-dated fixture
"untouched after a claim attempt on a different item" would have proved nothing
either: the release never targets another item.

Both proved read-only, by fetching the live definitions and simulating the
mutations textually -- no DDL against production at all:

```
blocked_still_matches_anchor  true   <- the anchored pattern IS defeated by /* */
floor_flags_blocked           true   <- the floor catches exactly that
floor_passes_shipped          true   <- no false positive on the real definition
boundary_matches_shipped      true
boundary_matches_lte          false  <- the `<=` mutation is caught
```

Still open from the original note: `13_occasion_materialization.sql:194` carries
the unanchored `[^;]*22023` pattern that Task 1 round 1 fixed in `15`. It is
phase 2's and pre-existing.

### Original finding

- **The block-comment floor did not propagate.** Task 3 ruled
  `position('/*' in definition) = 0` "the total fix, not a per-pattern one"; it
  landed at `17_claim_lifecycle.sql:762-770` but was never back-ported to
  `15_celebrated_materialization.sql`, which still documents the residue at
  `:68` while guarding `get_or_create_celebrated_occasion` — the other definer
  function with a subject parameter. One line.
  (`13_occasion_materialization.sql:194` also still carries the unanchored
  `[^;]*22023` pattern fixed in 15. Phase 2's, pre-existing.)
- **The lapse boundary is pinned in TypeScript and unpinned in SQL.**
  `claim_rpcs.sql:102` is `o.occasion_date < current_date`, but `17`'s only lapse
  fixture is dated `2000-01-01`, so mutating `<` to `<=` ships green — and that
  mutation releases a live claim on the **morning of the birthday**. Add a
  fixture occasion dated `current_date` with a pre-existing claim, asserted
  untouched after a claim attempt on a different item.

## F5 — DONE (2026-09-11)

`ClaimActions` gained an optional `onChanged` callback, invoked after all FOUR
state-changing handlers -- claim, unclaim, mark-purchased and out-of-stock --
not just claim. Every one of them changes state the detail page renders, and
every one had the same problem.

The detail page passes `onChanged={() => loadData("saved")}`. `"saved"` rather
than `"refresh"` matters: `refresh` is dropped outright when another load is in
flight, and short-circuits inside `SIGNED_IMAGE_REFRESH_MS` -- which is exactly
the window a user is in immediately after clicking. `saved` waits its turn and
bypasses the age check.

Server-rendered callers (the list page) pass nothing and keep relying on
`router.refresh()`, which is sufficient there.

### Original finding

`ClaimActions.handleClaim` calls `router.refresh()`, which does not re-run that
page's client effect, and `loadData("refresh")` short-circuits for
`SIGNED_IMAGE_REFRESH_MS` (`[itemId]/page.tsx:98-103`). Pre-existing and
unchanged by phase 3 — verified byte-identical pre- and post-task — but phase 3
makes the claim badge the whole point of that page. A callback prop invoking
`loadData("saved")` covers it.

## Outstanding and owned by the project owner

**The two-account owner-blindness check has never been run, in any phase.**
Two accounts: A claims an item on B's list for B's birthday; confirm A sees
"Claimed for ..." and B's own `/wishlist` shows no claim indication of any kind.

Everything verified so far is the data layer and the render paths. Three
independent structural guarantees were traced — the owner's page never imports
`getActiveClaims`, `user/[userId]/page.tsx:39-41` redirects before the call is
reached, and `[itemId]/page.tsx` branches on `ownItem` and skips it — plus
belt-and-braces gating in the component. But that is a genuinely different
mechanism from two real browsers, and it is exactly the gap the plan's Step 5
named. Worth more now than in phase 1: owner-blindness moved from a strip list in
application code to an RLS policy.

## Accepted, deliberately not fixed

- **`getActiveClaims` fails open when a claim's occasion exists but its date is
  hidden from the viewer** by the celebrant's privacy. The claim renders as
  active. Verified reachable: `occasions`' celebrated policy gates on
  `can_view_field` against the celebrant's date privacy, independent of the
  `wishlist_items.privacy_settings` that admitted the claim row. Failing open
  prevents a double purchase; excluding would show an item as available while
  somebody holds it, which is the exact failure claiming exists to prevent.
  Consequence to know: nothing ever lapses the claim for that viewer, and the
  RPC's lapse-release only fires when somebody who *can* see the date attempts a
  claim — so a celebrant hiding their date from everyone leaves the item
  displayed as claimed indefinitely.
- **The occasion gate does not require the occasion to relate to the item's
  owner**, so a caller may label Alice's item with Bob's visible birthday. No
  escalation exists: `p_occasion_id = null` is accepted unconditionally and
  already yields a claim that never releases, so mislabelling buys strictly less
  than null does. Residual is cosmetic — a mislabelled occasion is filtered out
  by `user/[userId]/page.tsx:161-168` and renders plain "Claimed".
- **Assertions 2, 4 and 7 in `17_claim_lifecycle.sql` are shape checks, not
  behavioural**, because a denied call raises and `scripts/test-rls.sh:276-279`
  bans exception handlers while shipping each file as one batch. Mitigated: every
  pattern is `(?n)`-per-regex and line-anchored, all `pg_proc` lookups are
  `::regprocedure`-scoped, a no-block-comment floor sits beneath them, the
  `o.id = p_occasion_id` occurrence count of exactly 2 distinguishes both-arms
  from one-arm, and both arms have live positive paths.
- **UTC agreement is load-bearing and undocumented.** `claims.ts:211` uses
  `toISOString().slice(0,10)` (UTC); Postgres `current_date` uses session
  TimeZone, verified live as `UTC`. They agree by configuration, not by
  construction.
- **A celebrant editing their date silently shifts existing claims' release
  date**, because `on conflict ... do update set occasion_date = excluded.
  occasion_date` rewrites the shared occasion row. Same family as the year-bucket
  question, still open as a product decision.
- **"Terminal" is terminal only while `purchased` is true** —
  `markAsPurchased(itemId, false)` re-opens claiming. Pre-existing and probably
  intended; stated so nobody reads the design doc's "purchase is terminal" as
  absolute.
