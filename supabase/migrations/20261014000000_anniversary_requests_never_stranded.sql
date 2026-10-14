-- Anniversary requests are never stranded.
-- Design: _planning/2026-10-14-anniversary-requests-design.md
--
-- Every surface used to read ONE of the caller's anniversary_links rows, so a
-- request sent to someone already linked, the older of two incoming requests,
-- and the caller's own request once someone asked them were all invisible to
-- somebody who needed to act on them (deferred item F4 and two siblings).
-- The read side is fixed in lib/actions/anniversary-links.ts
-- (getMyAnniversaryLinks). This migration makes two invariants true in the
-- database, so that reader can be honest about them:
--
--   I-out:    a person has at most one outgoing pending request;
--   I-linked: a person in a confirmed link has no outgoing pending request,
--             and no pending request of any kind from before their confirm.
--
-- request_anniversary_link: copied verbatim from 20260912000003, plus two
--   refusals after the existing guards. Both concern the CALLER's own status.
--   Refusing because the PARTNER is already linked would make this function an
--   oracle for other people's relationships, so that request still succeeds.
--
-- confirm_anniversary_link: copied verbatim from 20260912000014 (the live
--   body), plus one statement after the anniversary_link_members insert that
--   deletes every other pending link involving either partner. To each of
--   those senders this is indistinguishable from a decline.
--
-- Corrective migration: 20260912000003 and 20260912000014 are applied and are
-- not edited. Function bodies use `--` comments only;
-- 19_anniversary_link_rpcs.sql assertion 12 fails on a block comment.

create or replace function public.request_anniversary_link(
  p_partner_id text,
  p_date text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_a      text;
  v_b      text;
  v_id     uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_partner_id = v_caller then
    raise exception 'you cannot share an anniversary with yourself'
      using errcode = '22023';
  end if;

  -- Enforced here, not only in the picker: this function is reachable directly.
  -- Same message for "no such user" and "not in a group with you", so it is not
  -- a probe for which user ids exist.
  if not exists (select 1 from public.get_shared_groups(v_caller, p_partner_id)) then
    raise exception 'that person is not in any of your groups'
      using errcode = '22023';
  end if;

  if public.celebration_date_in_year(
       p_date, extract(year from current_date)::integer) is null then
    raise exception 'that is not a usable date' using errcode = '22023';
  end if;

  -- The caller's OWN status only. Refusing because the PARTNER is already
  -- linked would make this function an oracle for other people's
  -- relationships (design decision 1), so a request to a linked person
  -- still succeeds below.
  if exists (select 1 from public.anniversary_link_members
              where user_id = v_caller) then
    raise exception 'you already share an anniversary with someone; unlink first'
      using errcode = '22023';
  end if;

  -- At most one outgoing request per person (invariant I-out). Asking the
  -- SAME person again is excluded here and refreshes the existing row
  -- through the upsert below, exactly as before.
  if exists (select 1 from public.anniversary_links
              where status = 'pending'
                and initiated_by = v_caller
                and p_partner_id not in (user_a, user_b)) then
    raise exception 'you already have a request waiting; cancel it first'
      using errcode = '22023';
  end if;

  v_a := least(v_caller, p_partner_id);
  v_b := greatest(v_caller, p_partner_id);

  insert into public.anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
  values (v_a, v_b, 'pending', v_caller, p_date)
  on conflict (user_a, user_b) do update
    set agreed_date  = excluded.agreed_date,
        initiated_by = excluded.initiated_by,
        status       = 'pending',
        created_at   = now()
    -- Re-requesting refreshes a PENDING invitation. It must not quietly
    -- un-confirm a link that already exists: without this predicate, either
    -- partner could reset a confirmed pairing by asking again.
    where anniversary_links.status = 'pending'
  returning id into v_id;

  if v_id is null then
    raise exception 'you already share an anniversary with that person'
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

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

  -- ---- clear every other pending request of either partner -------------
  -- (design decision 1.) Neither partner can confirm another link now, so a
  -- pending row naming either of them is a request nobody can complete.
  -- Deleting it is exactly what a decline does, so a sender sees nothing a
  -- decline would not already show them -- in particular they never learn
  -- that the person they asked is now linked to somebody else.
  --
  -- `status = 'pending'` alone already spares this link, whose status
  -- flipped above; `id <> p_link_id` keeps it spared if this statement is
  -- ever moved above that update.
  delete from public.anniversary_links
   where status = 'pending'
     and id <> p_link_id
     and (user_a in (v_link.user_a, v_link.user_b)
          or user_b in (v_link.user_a, v_link.user_b));

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

grant execute on function public.request_anniversary_link(text, text) to authenticated, service_role;
grant execute on function public.confirm_anniversary_link(uuid) to authenticated, service_role;

comment on function public.request_anniversary_link(text, text) is
  'Creates or refreshes a PENDING anniversary link from the caller to a co-member. Refuses a caller who is already in a confirmed link, or who already has a pending request out to someone else -- both about the caller''s own status, never the partner''s, so a request to someone already linked still succeeds. Live body: 20261014000000_anniversary_requests_never_stranded.sql (20260912000003''s body plus those two refusals).';

comment on function public.confirm_anniversary_link(uuid) is
  'Confirms a pending anniversary link: flips status, inserts both anniversary_link_members rows, deletes every OTHER pending link involving either partner, adopts agreed_date into BOTH partners'' profile_info, and reconciles already-materialized occasions. Live body: 20261014000000_anniversary_requests_never_stranded.sql, which is 20260912000014_confirm_link_reconciles_occasion_date.sql verbatim plus the pending-link cleanup. Two corrections to that body''s inherited comments still apply, and they live in DIFFERENT files: finding M2 (20260912000014''s header, :25-30, mis-dates the profile/occasion divergence -- it predates 20260912000012, which only made it reachable from either side) and finding M4 (20260912000012:63-65 names BYPASSRLS as the only reason the cross-user profile_info write succeeds; table-owner exemption alone would also suffice, since the definer owner owns profile_info and relforcerowsecurity is false). Both are written up in 20260912000017_comment_corrections.sql. The body''s own comment pointing to 20260912000012''s header for the non-exploitability argument is the uncorrected M4 text, carried verbatim; the argument holds, only its "ONLY because" does not.';
