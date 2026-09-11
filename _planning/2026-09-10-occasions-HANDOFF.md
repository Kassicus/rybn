# Gift-Giving Occasions — session handoff

Written 2026-09-10, at the end of the session that built phase 1 and started
phase 2. Read this first if you are picking the work up.

**UPDATE, same day, end of the final whole-branch review's fix wave:** phase 2
is now complete — all 5 tasks implemented, reviewed, and (per this update) the
final whole-branch review's findings addressed. The sections below are kept
largely as originally written, since the incident, the review-model
calibration, and the two closing windows are all still accurate history; the
status lines that were live facts when this doc was written (task counts,
"how to resume") are corrected in place rather than deleted, so this remains
one true record rather than two documents that disagree.

## Where things stand

**Phase 1 (occasions, derivation, UI) — DONE, merged, deployed.**
Merged to `main` at `733e072`, pushed, and confirmed good in production by the
user. Four migrations are live on the linked project `xomvbdvvrlbxoyqdsstt`.

**Phase 2 (item tagging) — DONE.** All 5 tasks are implemented and committed
on branch `worktree-occasions-phase-2`, and the final whole-branch review's
fix wave (three Importants plus several Minors — see `.superpowers/sdd/
2026-09-10-gift-giving-occasions-phase-2-plan/final-fix-report.md`) has been
applied on top. Nothing from phase 2 is merged to `main` yet — that is a
human decision, not a blocked one.

**Phase 3 (occasion-scoped claiming) — NOT STARTED.** Specced only. Also now
where two known gaps this branch shipped with are slated to resolve — see
"Known gaps" in the phase 2 plan and the summary below.

## The two documents that matter

- **Design/spec, all three phases:** `_planning/2026-09-10-gift-giving-occasions-design.md`
- **Phase 2 plan, 5 tasks:** `_planning/2026-09-10-gift-giving-occasions-phase-2-plan.md`
  (committed on `main` as `bc42d7c`, which is **unpushed**; also present
  untracked in the phase 2 worktree)

Phase 1's plan is `_planning/2026-09-10-gift-giving-occasions-plan.md`, merged.

## Exact state of phase 2

Branch `worktree-occasions-phase-2`, worktree at
`.claude/worktrees/occasions-phase-2`, branched from `733e072`.

| Task | State |
|---|---|
| 1. `get_or_create_occasion()` | **complete**, review clean — `c50f8d1`, `f9c9b8f` |
| 2. `wishlist_item_occasions` table | **complete**, review clean — `edce36f`, `997a129`; see the incident below for how it got there |
| 3. Tag actions and tag-carrying reads | **complete** — `c6b75d1` |
| 4. Owner tagging UI on `/wishlist` | **complete** — `b9aff50` (plus `aa7fbaf`, a fix for `tagItemForGroupDate`'s occasion verification) |
| 5. Occasion-aware ordering for viewers | **complete** — `bddb99d` |

**What shipped in Tasks 3-5, briefly:** `lib/actions/item-occasions.ts` adds
the four tagging actions (`tagItemForMyOccasion`, `tagItemForGroupDate`,
`untagItem`, `getTagsForItems`), all user-scoped so Task 2's RLS policies
apply. `ItemOccasionTags` (rendered from `WishlistItemCard`) gives an owner
removable chips on their own `/wishlist` cards, restricted to their own
birthday/anniversary plus visible group dates (`taggableOccasions()` in
`lib/occasions/taggable.ts` — now enforced INSIDE the component itself, not
just by a doc comment on its caller, per the final review's fix wave).
`SortableWishlistItems` partitions a viewer's list into "tagged for the
occasion in view" and "everything else" (`lib/occasions/order.ts`), with an
opt-in filter that defaults off so untagged items are never hidden, and
`WishlistItemCard` carries a matching badge.

**Two known gaps shipped with this** — declared, not silent, both written up
in `_planning/2026-09-10-gift-giving-occasions-phase-2-plan.md` under "Known
gaps" by the final review's fix wave:

1. **Group-date tags are owner-visible only.** An owner can tag an item for a
   group date, but no viewer surface groups by it — the only ordering surface
   keys off `celebrantId`, which a group_date never has. Deliberately not
   built (it is a group roster, not a single wishlist — a design question) and
   deliberately not removed from the picker either (it is a capability the
   spec grants and the tag already means something to its owner). Phase 3's
   claiming is where this gets a read path.
2. **Two spec Surfacing rows were never built:** item detail showing which
   occasions an item is tagged for, and the dashboard's per-occasion "N items
   tagged" for viewers. Neither was ever asked for by a task in this plan, so
   this only surfaced in the final whole-branch review.

Migrations applied to production by phase 2 so far:
`20260911000000_get_or_create_occasion.sql`,
`20260911000001_get_or_create_occasion_returning.sql`,
`20260911000002_wishlist_item_occasions.sql`,
`20260911000003_tag_created_at_not_null.sql`.

## Incident: the Task 2 fix-round agent stalled and left a live hole

It was killed by the watchdog after 600s without progress, during the
not-vacuous *proof* phase — after most of the implementation. On resume the
controller found it had left a deliberately-permissive attack-scenario policy
**live on production**:

    INSERT | "Anyone who can see an item may also tag it (bug)" | {authenticated}

RLS policies for one command OR together, so while it existed any authenticated
user who could see an item could tag it — asserting another person's intent on
their own wishlist. It was dropped, production verified back to the schema's
three policies, and the full suite run: **15/15 green**. It appeared in no
migration file.

It had also left `20260911000003` applied to production with its file
uncommitted. That is the drift direction that matters — a clean checkout would
have made the schema unreproducible. Committed in `997a129`, which is
**controller-made and has not been reviewed**; its message names exactly what is
done and what is still open.

**Nothing is open on Task 2.** It is complete — all five Important findings
were addressed in `997a129`, all eight assertions were proven falsifiable in
round 2, and the scoped re-review passed.

Correcting an error this document originally carried: `997a129`'s commit
message claimed assertion 4's pattern and the UPDATE-policy guard were "still
open" when both were complete in that same diff, and this handoff repeated it.
The re-review caught it. No harm followed — round 2 verified and stopped rather
than redoing settled work, and its proofs were genuinely missing — but the
commit message misdescribes its own payload if anyone reads it later.

**The lesson, and it is not about this agent.** Every not-vacuous proof in this
project works by deliberately breaking something and restoring it. If the agent
dies between break and restore, *the break is what survives*. Phase 1's Task 5
got this right by doing the break inside a **rolled-back transaction**, so a
crash undoes it automatically. Make that the required form for every proof from
here on, and say so in the dispatch.

**The ledger is the source of truth**, at
`.superpowers/sdd/2026-09-10-gift-giving-occasions-phase-2-plan/progress.md`
inside the worktree. It is git-ignored, so it is also copied to the session
scratchpad. It records every ruling with what it costs if wrong.

## How to resume — superseded, kept for history

The four steps below were live instructions when this doc was written, with
only Tasks 1-2 complete. They no longer apply: all 5 tasks are done, the final
whole-branch review has run, and its fix wave is applied. Kept rather than
deleted so the "resume the loop" instruction that Task 2's incident (below)
refers to stays legible in context.

1. `EnterWorktree` with `path: .claude/worktrees/occasions-phase-2` — the
   worktree already has `node_modules`, `.env.local`, `supabase/.temp` and an
   untracked copy of the plan. Do not recreate them.
2. Invoke `superpowers:subagent-driven-development` with the phase 2 plan.
3. Read the ledger. A task with a `Task N: complete` line is done — do not
   re-dispatch it. Task 2's last line is a fix round, so **resume that loop at
   the next round** rather than starting the task over.
4. Task 2's open findings are recorded in the ledger under its review entry.

**What actually happens next from here** is a human decision: merge
`worktree-occasions-phase-2` to `main`, per "Decide about `bc42d7c`" and the
rest of "Things only a human can do" below.

## Things only a human can do

1. **The two-account owner-blindness check, still outstanding from phase 1.**
   A claims an item on B's list; sign in as B, open `/wishlist`, confirm
   nothing reveals it. The final reviewer's judgement: "the structural argument
   is as strong as it can get short of running it — I'd gate on it, but I would
   not expect it to find anything." This is live in production now.
2. **Add birthdays.** `profile_info` holds **zero rows**, so "Coming up" is
   empty for everyone and phase 2's tagging has nothing to tag against. This is
   the single step that makes the whole feature visible.
3. **Decide about `bc42d7c`** — the phase 2 plan commit sits unpushed on
   `main`. Pushing it triggers a no-op production build; leaving it is fine.

## Two windows that are closing

Both are cheap now and stop being cheap once the family starts using the app.

1. **Phase 3's data migration is currently a no-op.** Production has **0
   claims**. Phase 3's riskiest step — backfilling live claim data and dropping
   `wishlist_items.claimed_by` — has nothing to migrate. The first real claim
   closes this.
2. **A CHECK constraint on `profile_info.field_value` is free today**, because
   that table is empty. Recommended by phase 1's review as the durable fix for
   malformed dates: the app currently accepts `1990-06-31` into storage. It can
   no longer crash anything (the date helper is total now), but the data is
   still wrong. Its own small change; not part of phase 2 or 3.

## Deferred minors — triaged by the final whole-branch review

This section's heading used to say "for whoever does the final whole-branch
review" — that review has now happened. Outcome for each item raised while
Tasks 1-2 were in flight:

- `set search_path = public` omits `pg_temp` in `get_or_create_occasion` and in
  all 21 migrations that declare it. Not reachable through PostgREST (no DDL).
  **Still deferred** — ruled explicitly out of scope for the final review's fix
  wave too (codebase-wide follow-up, not a phase 2 change).
- Task 1's fix report elides the scratch function used for its commented-guard
  experiment, so "a faithful copy" cannot be confirmed from the report alone.
  The controller independently validated the anchored regex against sample
  strings. **No further action** — historical note about report completeness,
  not an open risk.
- Nothing constrains which `occasion_id` a tag may reference; the FK check runs
  RLS-suspended. Harmless today because rendering still requires passing
  `occasions`' own RLS. **Still deferred, explicitly** — the final review ruled
  this a phase 3 change, since `occasion_id` constraints are where phase 3's
  auto-release semantics on `occasion_date` live too; folding it in now would
  mean touching the same surface twice.

The final review also found three Importants that no single task's reviewer
could see from inside its own diff — see "Known gaps" in the phase 2 plan for
two of them (group-date tags have no read path; two spec Surfacing rows were
never built) and this document's own "Where things stand" update above for
the third (this document itself was stale). All Minors it raised alongside
those are fixed in the same wave; see `.superpowers/sdd/
2026-09-10-gift-giving-occasions-phase-2-plan/final-fix-report.md` for the
full list.

Phase 1's deferred minors were triaged by its final review and are recorded in
that phase's ledger, copied to the scratchpad.

## The one pattern worth carrying forward

**Four tests on this project have passed because they were structurally
incapable of failing:**

1. An RLS test token that could never match the runner's derived value.
2. A `TZ=UTC` test suite under which the broken and fixed `daysUntil`
   implementations agree exactly.
3. A guard-inventory check matching `pg_get_functiondef()`, which retains
   comments — so commenting the guard out left it green.
4. Task 2's assertion 4, which passes through both a disjunctive weakening and
   a dropped join correlation.

In every case the suite was green, the build passed, and only a reviewer asked
specifically about *falsifiability* caught it. Every task dispatch from Task 2
onward therefore requires the implementer to state, for each assertion, the
code change that would make it fail — **and** what change would not be caught.

Note that this is necessary but not sufficient: Task 2's implementer produced a
falsifiability analysis that was itself wrong in one place (it claimed dropping
`can_view_wishlist_item` from the tag SELECT policy would break assertion 1; it
would not, because the policy's subquery is already filtered by
`wishlist_items`' own RLS). Have the reviewer derive falsifiability
independently rather than grade the report's version.

## Review model selection, as calibrated by this work

- **Schema, RLS policies, `security definer` functions → opus.** It found a
  Critical RLS hole in phase 1 and five Importants in phase 2's Task 2 that
  every test passed straight through.
- **Display logic, types, actions → sonnet.** Adequate, and phase 1's Task 4
  cleared on the first pass at that tier.
- **Scoped re-reviews of fix diffs → sonnet.**
- **Final whole-branch review → opus.** Phase 1's found three Importants that
  no single task's reviewer could see, including a group date being invisible
  the moment it was created.
