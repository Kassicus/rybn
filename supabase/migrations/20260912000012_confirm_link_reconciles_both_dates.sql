-- =============================================================================
-- rybn: confirm_anniversary_link must reconcile BOTH partners' dates, not
-- just the confirmer's
-- =============================================================================
--
-- CORRECTIVE MIGRATION for 20260912000003_anniversary_link_rpcs.sql, which
-- already reached production -- a migration is the historical record of what
-- actually ran, so that file is not edited in place; this one supersedes its
-- confirm_anniversary_link body with `create or replace`. No return-type
-- change (still `returns void`), so this is a plain replace -- DROP FUNCTION
-- is neither needed nor used, and no grant is disturbed.
--
-- CRITICAL, round-1 review of Task 5. Round-1 review's own reproduction,
-- built entirely through the shipped RPCs and confirmed live inside
-- begin/rollback:
--
--   1. A requests a link with B, agreed_date = current_date + 9 (9 days out).
--   2. B confirms.
--   3. A's OWN profile_info anniversary is UNCHANGED (still whatever it was
--      before -- in the reproduction, a date ~92 days out). B's profile_info
--      anniversary is updated to the agreed date, 9 days out.
--   4. A viewer who can see BOTH A's and B's dates calls
--      get_upcoming_occasions(30) (the app's own default window). Result:
--      ZERO rows. Against the pre-Task-5 function body the identical fixture
--      returns ONE row (B's, unmerged, since Task 5 did not exist yet to
--      merge anything).
--
-- ROOT CAUSE: the shipped body's date-adoption step,
--
--   insert into public.profile_info (user_id, category, field_name, field_value)
--   values (v_caller, 'dates', 'anniversary', v_link.agreed_date)
--   on conflict on constraint profile_info_user_id_category_field_name_key
--   do update set field_value = excluded.field_value;
--
-- writes ONLY `v_caller` -- and confirm_anniversary_link's own precondition
-- two blocks above requires the caller to be the RECIPIENT, never the
-- initiator (`v_caller = v_link.initiated_by` is refused). So confirming
-- ALWAYS updates the recipient's date and NEVER the initiator's.
-- request_anniversary_link writes no profile_info at all. The result: the
-- two partners' dates agree only when the agreed date happens to already
-- match what the initiator had on file before requesting -- true by
-- coincidence, never by construction. This is the shipped implementation of
-- planning decision 4 ("Exactly one date afterwards, both profiles agree")
-- falling short of what it specifies, not a bug introduced by Task 5 -- Task
-- 5 only exposed it, by being the first code path that reads BOTH partners'
-- dates independently and requires them to individually satisfy a window
-- check.
--
-- FIX: adopt the agreed date for BOTH `v_link.user_a` and `v_link.user_b`
-- explicitly, regardless of which of the two is `v_caller`. This is what
-- actually implements "both profiles agree" -- not a workaround scoped to
-- this one reproduction. A partner who had no anniversary profile_info row
-- at all before confirming (nothing in either RPC requires one to request or
-- to be requested) now gets one created here, same as the confirmer already
-- did.
--
-- This does not, on its own, make date drift permanently impossible: either
-- partner can edit their own anniversary in profile_info at any later time,
-- and nothing re-syncs the other one's. That gap is real but out of this
-- migration's scope -- reconciling *at confirm time* is what planning
-- decision 4 specifies, and per-edit re-sync would be a materially larger
-- feature (would it silently overwrite the OTHER partner's date on every
-- edit? require a fresh confirmation instead?) that nothing in this plan
-- has designed. The derivation-side guard fix
-- (20260912000011_derivation_partner.sql's exclusion, corrected in place by
-- this same round -- see that file's own header) is what keeps
-- get_upcoming_occasions correct even when dates DO later diverge again,
-- which is the belt to this fix's braces.
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

  -- Accepting adopts the agreed date, for BOTH partners.
  --
  -- FIXED (this migration): the shipped body wrote only `v_caller` -- always
  -- the RECIPIENT, since only the recipient may reach this point -- leaving
  -- the INITIATOR's own profile_info date untouched. Writing both
  -- `v_link.user_a` and `v_link.user_b` explicitly, unconditionally, is what
  -- actually implements planning decision 4 ("both profiles agree"): the
  -- confirmer's row updates exactly as before, and the other partner's row
  -- is now created (if absent) or overwritten (if present) with the same
  -- agreed_date, in the same statement.
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

  update public.occasions
     set partner_id = v_link.user_b
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
