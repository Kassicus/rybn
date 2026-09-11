-- =============================================================================
-- rybn: requesting, confirming, declining and undoing an anniversary link
-- =============================================================================
--
-- All four are SECURITY DEFINER and granted to `authenticated`, so all four are
-- reachable directly through PostgREST with nothing upstream having run. Every
-- rule the UI appears to enforce is therefore enforced here as well.
--
-- CORRECTION to the original task-3 brief, load-bearing: public.anniversary_
-- link_members (20260912000001) exists to enforce "one CONFIRMED anniversary
-- link per person, either side" -- a cross-column invariant anniversary_links'
-- own two partial unique indexes cannot express, since each of those watches
-- only one column (user_a or user_b) and neither ever sees the same person
-- appear as user_a in one confirmed link and user_b in another. That table's
-- primary key is what actually enforces the invariant, but only once
-- something writes to it -- nothing did, until this migration.
-- confirm_anniversary_link() is therefore the writer, and it follows the same
-- pattern claim_wishlist_item() uses (20260911100002_claim_rpcs.sql): a
-- pre-check for a message written for a human, a real constraint as the race
-- backstop, and an `exception when unique_violation` handler translating a
-- collision on that backstop to the SAME message a normal pre-check refusal
-- gives, so a race and an ordinary conflict are indistinguishable to the
-- caller. Both partner rows are inserted regardless of the pre-check's
-- outcome, so a concurrent confirm that slipped past it still collides with
-- the primary key rather than silently succeeding.

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

  -- Accepting adopts the agreed date. The UI states this outright; it is the
  -- whole reason the two partners end up with one date instead of two that
  -- drift.
  insert into public.profile_info (user_id, category, field_name, field_value)
  values (v_caller, 'dates', 'anniversary', v_link.agreed_date)
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

create or replace function public.decline_anniversary_link(p_link_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_deleted int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Only the recipient may decline, and only a pending row. Returns false
  -- rather than raising when there is nothing to decline: declining something
  -- already gone is not an error, and a DELETE filtered to zero rows is
  -- expressible in the RLS harness where a raise is not.
  delete from public.anniversary_links
   where id = p_link_id
     and status = 'pending'
     and initiated_by <> v_caller
     and v_caller in (user_a, user_b);

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

create or replace function public.unlink_anniversary(p_link_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_link    record;
  v_deleted int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_link from public.anniversary_links where id = p_link_id;

  if v_link is null or v_caller not in (v_link.user_a, v_link.user_b) then
    return false;
  end if;

  delete from public.anniversary_links where id = p_link_id;
  get diagnostics v_deleted = row_count;

  -- The occasion row survives with its tags and claims intact and simply stops
  -- being shared. Splitting those between the two people would be guesswork
  -- about which gift was for whom.
  --
  -- anniversary_link_members needs no explicit cleanup here: its link_id FK
  -- is ON DELETE CASCADE, so deleting the anniversary_links row above already
  -- removed both membership rows.
  update public.occasions
     set partner_id = null
   where kind = 'anniversary' and celebrant_id = v_link.user_a;

  return v_deleted > 0;
end;
$$;

grant execute on function public.request_anniversary_link(text, text) to authenticated, service_role;
grant execute on function public.confirm_anniversary_link(uuid) to authenticated, service_role;
grant execute on function public.decline_anniversary_link(uuid) to authenticated, service_role;
grant execute on function public.unlink_anniversary(uuid) to authenticated, service_role;
