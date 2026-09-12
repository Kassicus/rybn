-- =============================================================================
-- rybn: confirm_anniversary_link must re-derive the canonical partner's
-- ALREADY-MATERIALIZED occasion_date too, not only profile_info
-- =============================================================================
--
-- CORRECTIVE MIGRATION for 20260912000012_confirm_link_reconciles_both_
-- dates.sql, which already reached production -- a migration is the
-- historical record of what actually ran, so that file is not edited in
-- place (its header carries a comment-only pointer to this one). This one
-- supersedes confirm_anniversary_link's body again with `create or replace`.
-- No return-type change (still `returns void`), so no DROP FUNCTION and no
-- grant is disturbed.
--
-- IMPORTANT, round-2 review of Task 5. 20260912000012 fixed
-- `profile_info` -- both partners' anniversary dates now agree after a
-- confirm -- but never touched an anniversary occasion ALREADY
-- materialized under the canonical partner (`v_link.user_a`) before this
-- confirm. Reproduced live: A's anniversary already materialized at +20
-- days (`occasion_date = 2026-10-01`), A requests a link with agreed_date
-- +5 days, B confirms --
--
--   listing shown_date (get_upcoming_occasions, reads profile_info) = 2026-09-16
--   occasion row occasion_date (occasions.occasion_date)             = 2026-10-01
--
-- The identical fixture against the PRE-20260912000012 confirm body matches
-- -- this divergence did not exist before that migration, because before it
-- NEITHER partner's profile_info reliably changed at confirm time, so
-- nothing new drifted out of sync with an already-materialized row. Fixing
-- profile_info without also fixing the materialized row moved the
-- inconsistency, not removed it.
--
-- THE COST IS REAL AND RUNS BOTH WAYS, because `occasion_date` -- not the
-- listing -- is what `claim_wishlist_item`'s lapse check keys off
-- (`20260911100002_claim_rpcs.sql`: `where o.occasion_date < current_date`
-- releases a claim). A claim scoped to the stale occasion stays claimable
-- for however long the OLD date sits after the NEW one (here, roughly 15
-- days past the anniversary the listing now shows) -- or, with the two
-- dates the other way around, the claim LAPSES and frees the item BEFORE
-- the date the couple is actually shown, inviting a duplicate gift. That
-- second case is exactly the failure claiming exists to prevent.
--
-- FIX: extend the reconciliation's existing `partner_id` UPDATE (this
-- function's last statement before its `exception` block) to ALSO
-- re-derive `occasion_date`, in the SAME statement -- it already targets
-- exactly the right rows (`kind = 'anniversary' and celebrant_id =
-- v_link.user_a`, every year the canonical partner has ever materialized,
-- not only the current one). Re-derived via `public.
-- celebration_date_in_year(v_link.agreed_date, occasion_year)` -- the same
-- helper every other materializer in this codebase uses for exactly this
-- month-day-into-a-target-year computation, called once per row with THAT
-- row's own `occasion_year` as the target. This is deliberately NOT a
-- single freshly-computed "current occurrence" date applied to every row:
-- each of the canonical partner's existing occasion rows keeps its own
-- `occasion_year` (so a past year's row, whose own claims -- if any -- have
-- already auto-released against their own occasion_date, is updated to the
-- new month-day within ITS year rather than being touched with a
-- year-crossing value that would change `occasion_year`, a generated
-- column, and risk colliding with the `occasions_celebrant_identity`
-- unique constraint against a different row for that target year).
-- `celebration_date_in_year` additionally reuses its own Feb-29 clamp for
-- free, rather than a raw string-concatenation cast that would raise on a
-- leap-day agreed_date landing on a non-leap occasion_year.
--
-- `agreed_date` is guaranteed calendar-usable here: request_anniversary_
-- link already refuses to create a link at all unless `celebration_date_
-- in_year(p_date, current_year) is not null` (20260912000003:60-63), so
-- this call is not newly capable of raising on a malformed value.
create or replace function public.confirm_anniversary_link(p_link_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_link   record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_link from public.anniversary_links
   where id = p_link_id and status = 'pending';

  -- Only the RECIPIENT may confirm. One message for "no such request", "already
  -- confirmed" and "not yours", so this is not an oracle for other people's
  -- pending requests.
  if v_link is null
     or v_caller not in (v_link.user_a, v_link.user_b)
     or v_caller = v_link.initiated_by
  then
    raise exception 'no anniversary request for you to confirm'
      using errcode = '22023';
  end if;

  -- ---- one confirmed link per person, either side ----------------------
  --
  -- Pre-check: written for a human, and phrased identically for both
  -- partners so it is not an oracle for WHICH of the two already has one.
  -- This alone is not race-free -- two concurrent confirms naming DIFFERENT
  -- links that share a partner could both pass this SELECT before either
  -- commits its INSERT below. The primary key on anniversary_link_members is
  -- what actually closes that window; this check exists so the common,
  -- non-racing case gets a message about the product fact, not a constraint
  -- name.
  if exists (
    select 1 from public.anniversary_link_members
     where user_id in (v_link.user_a, v_link.user_b)
  ) then
    raise exception 'one of you already shares an anniversary with somebody else'
      using errcode = '22023';
  end if;

  update public.anniversary_links
     set status = 'confirmed', confirmed_at = now()
   where id = p_link_id;

  -- The race backstop. Inserted unconditionally -- not only when the
  -- pre-check above found nothing -- so a concurrent confirm that slipped
  -- past that SELECT still collides with the primary key here. Both rows are
  -- inserted in the SAME statement list; if either collides, the exception
  -- handler below rolls the whole confirmation back (PL/pgSQL's implicit
  -- savepoint around a block that carries an EXCEPTION clause discards every
  -- effect since the block began, including the status flip above and
  -- anything already written by the reconciliation further down).
  insert into public.anniversary_link_members (user_id, link_id)
  values (v_link.user_a, p_link_id), (v_link.user_b, p_link_id);

  -- Accepting adopts the agreed date, for BOTH partners. Requires this
  -- function's owner privileges (BYPASSRLS) to write a row that is not
  -- `v_caller`'s own -- see 20260912000012's header for why that is not
  -- exploitable as a general cross-user write, and for the max-visibility
  -- default a newly-created row picks up.
  insert into public.profile_info (user_id, category, field_name, field_value)
  values (v_link.user_a, 'dates', 'anniversary', v_link.agreed_date),
         (v_link.user_b, 'dates', 'anniversary', v_link.agreed_date)
  on conflict on constraint profile_info_user_id_category_field_name_key
  do update set field_value = excluded.field_value;

  -- ---- reconcile anything already materialized -------------------------
  -- Ensure a canonical row exists for every year the non-canonical partner has
  -- one, then move that year's tags and claims onto it and drop the duplicate.
  -- Without this a couple who both already had a materialized anniversary keeps
  -- TWO occasion ids for one event -- the exact defect this feature removes.
  insert into public.occasions (kind, celebrant_id, occasion_date, created_by)
  select 'anniversary', v_link.user_a, o.occasion_date, v_caller
    from public.occasions o
   where o.kind = 'anniversary' and o.celebrant_id = v_link.user_b
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do nothing;

  -- An item may already be tagged for BOTH partners' occasions, so the move can
  -- collide; the survivors are deleted immediately below.
  insert into public.wishlist_item_occasions (item_id, occasion_id)
  select t.item_id, canon.id
    from public.wishlist_item_occasions t
    join public.occasions dup on dup.id = t.occasion_id
    join public.occasions canon
      on canon.kind = 'anniversary'
     and canon.celebrant_id = v_link.user_a
     and canon.occasion_year = dup.occasion_year
   where dup.kind = 'anniversary' and dup.celebrant_id = v_link.user_b
  on conflict (item_id, occasion_id) do nothing;

  delete from public.wishlist_item_occasions t
   using public.occasions dup
   where dup.id = t.occasion_id
     and dup.kind = 'anniversary' and dup.celebrant_id = v_link.user_b;

  -- No collision is possible here: wishlist_claims_one_active keys on
  -- (item_id) where released_at is null and does not include the occasion.
  update public.wishlist_claims c
     set occasion_id = canon.id
    from public.occasions dup
    join public.occasions canon
      on canon.kind = 'anniversary'
     and canon.celebrant_id = v_link.user_a
     and canon.occasion_year = dup.occasion_year
   where c.occasion_id = dup.id
     and dup.kind = 'anniversary' and dup.celebrant_id = v_link.user_b;

  delete from public.occasions
   where kind = 'anniversary' and celebrant_id = v_link.user_b;

  -- FIXED (this migration): `occasion_date` is now re-derived alongside
  -- `partner_id`, in the SAME statement, for every one of the canonical
  -- partner's existing anniversary occasion rows -- not only the row for
  -- whichever year happens to be "current" right now. Each row keeps its
  -- own `occasion_year`; `celebration_date_in_year` recomputes only the
  -- month-day within that year from the freshly-agreed date, so a
  -- generated `occasion_year` never changes and no row can newly collide
  -- with `occasions_celebrant_identity`. See this migration's header for
  -- the reproduction this closes and why the claim lifecycle depends on it.
  update public.occasions
     set partner_id    = v_link.user_b,
         occasion_date = public.celebration_date_in_year(v_link.agreed_date, occasion_year)
   where kind = 'anniversary' and celebrant_id = v_link.user_a;
exception
  -- The primary key on anniversary_link_members fired: somebody else got
  -- there first. Translated to the SAME message the pre-check above gives,
  -- so a race and an ordinary conflict are indistinguishable to the caller --
  -- the same pattern claim_wishlist_item() uses for wishlist_claims_one_active.
  when unique_violation then
    raise exception 'one of you already shares an anniversary with somebody else'
      using errcode = '22023';
end;
$$;
