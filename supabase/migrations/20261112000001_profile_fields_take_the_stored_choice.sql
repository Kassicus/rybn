-- =============================================================================
-- rybn: a new profile field takes its owner's stored choice, and a choice is
--       saved in one step
--       (follows 20261112000000_profile_visibility.sql)
-- =============================================================================
--
-- profile_visibility holds each person's choice of which kinds of group may
-- see their profile fields. The website's own profile save gives a new field
-- that choice, but a field can be created elsewhere, and a choice can change
-- between a save reading it and the field being written. This adds:
--
--   1. profile_field_takes_stored_choice(), a before-insert trigger on
--      profile_info. A row tied to one group (restrictToGroup present and not
--      JSON null) is left exactly as given, and so is a row whose owner has no
--      stored choice. Otherwise the row's privacy_settings is the given object
--      (an empty object when what was given is not an object) with
--      visibleToGroupTypes set to the owner's stored kinds, once each in the
--      enum's order, and restrictToGroup set to JSON null; its other keys are
--      kept. So confirm_anniversary_link's new anniversary rows, and a profile
--      save's new rows, carry the choice stored when the row is written.
--
--      The function is SECURITY INVOKER: it reads profile_visibility as the
--      role doing the insert, so it can never read a row that role could not
--      read itself.
--        - A signed-in person inserting their own field reads their own row
--          through row-level security.
--        - A signed-in person inserting a row that names someone else reads
--          nothing (the policy shows them their own row only), so the row is
--          left as given, and profile_info's insert policy then refuses it.
--          The trigger never changes user_id, and row-level security checks
--          the row after the trigger, so a refused insert is still refused.
--        - The SECURITY DEFINER functions that write other people's fields,
--          confirm_anniversary_link among them, run as their owner, which
--          owns profile_visibility and reads every row.
--        - The service role bypasses row-level security, and holds SELECT and
--          UPDATE on the table (20261112000000).
--        - The migration role owns the table.
--      As SECURITY DEFINER it would read any person's row on behalf of an
--      insert row-level security is about to refuse.
--
--      The stored row is read FOR SHARE: a save of the choice in progress
--      (set_profile_visibility below, which writes profile_visibility before
--      the fields) is waited for, and its new kinds are the ones taken. A
--      share lock needs UPDATE on the table as well as SELECT; every role
--      above has both.
--
--      With insert ... on conflict ... do update, the trigger runs on the
--      proposed row, so `excluded` holds the row as the trigger left it:
--        - confirm_anniversary_link's `do update set field_value =
--          excluded.field_value` gives a new anniversary row the partner's
--          stored choice, and changes only the value of one that exists;
--        - a profile save's upsert (lib/actions/profile.ts) sets every column
--          it sends from `excluded`, so a new row, or one that appeared since
--          the save read the choice, takes the choice stored now.
--      Every other writer of profile_info updates or deletes rows (a profile
--      save's update of a saved value, set_profile_visibility below,
--      start_profile_visibility, the group-delete cleanup), and a
--      before-insert trigger does not fire for those.
--
--   2. set_profile_visibility(p_kinds), SECURITY INVOKER: for the caller,
--      stores the kinds once each in the enum's order in profile_visibility,
--      then sets every one of the caller's profile_info rows to exactly
--      {"visibleToGroupTypes": [those kinds], "restrictToGroup": null}. Both
--      writes happen in the one call, so they succeed or fail together.
--      Signed out raises 28000; a null argument raises 22023 and writes
--      nothing. A null element is not a kind and is not stored.
--
-- can_view_field(), every policy, confirm_anniversary_link() and
-- start_profile_visibility() are unchanged.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A new field takes its owner's stored choice
-- -----------------------------------------------------------------------------
create or replace function public.profile_field_takes_stored_choice()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kinds public.group_type[];
begin
  -- Tied to one group: left exactly as given.
  if coalesce(new.privacy_settings->'restrictToGroup', 'null'::jsonb) <> 'null'::jsonb then
    return new;
  end if;

  select pv.visible_to_group_types into v_kinds
    from profile_visibility pv
   where pv.user_id = new.user_id
   for share;

  -- No stored choice that this role can read: left exactly as given.
  if not found then
    return new;
  end if;

  new.privacy_settings :=
    (case when jsonb_typeof(new.privacy_settings) = 'object'
          then new.privacy_settings else '{}'::jsonb end)
    || jsonb_build_object(
         'visibleToGroupTypes',
         to_jsonb(array(select distinct u.k from unnest(v_kinds) as u(k)
                         where u.k is not null order by u.k)),
         'restrictToGroup', 'null'::jsonb);

  return new;
end;
$$;

-- A trigger function needs no EXECUTE grant to fire (PostgreSQL checks it
-- when the trigger is created), so nobody is given one.
revoke execute on function public.profile_field_takes_stored_choice()
  from public, anon, authenticated, service_role;

comment on function public.profile_field_takes_stored_choice() is
  'Before insert on profile_info: a row not tied to one group, whose owner has a stored choice in profile_visibility, takes those kinds (once each, in the enum''s order) with restrictToGroup null; other keys are kept. Security invoker, so it reads only what the inserting role can read. Added by 20261112000001_profile_fields_take_the_stored_choice.sql.';

create trigger profile_field_takes_stored_choice
  before insert on public.profile_info
  for each row execute function public.profile_field_takes_stored_choice();


-- -----------------------------------------------------------------------------
-- 2. Saving a choice in one step
-- -----------------------------------------------------------------------------
create or replace function public.set_profile_visibility(p_kinds public.group_type[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_kinds  public.group_type[];
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_kinds is null then
    raise exception 'choose which kinds of group can see your details' using errcode = '22023';
  end if;

  v_kinds := array(select distinct u.k from unnest(p_kinds) as u(k)
                    where u.k is not null order by u.k);

  -- The stored choice first: a field being inserted meanwhile waits for this
  -- row (its trigger reads it for share) and then takes these kinds.
  insert into profile_visibility (user_id, visible_to_group_types)
  values (v_caller, v_kinds)
  on conflict (user_id) do update
    set visible_to_group_types = excluded.visible_to_group_types;

  -- Every field of the caller's, a field tied to one group included.
  update profile_info
     set privacy_settings = jsonb_build_object(
           'visibleToGroupTypes', to_jsonb(v_kinds),
           'restrictToGroup', 'null'::jsonb)
   where user_id = v_caller;
end;
$$;

revoke execute on function public.set_profile_visibility(public.group_type[]) from public, anon;
grant execute on function public.set_profile_visibility(public.group_type[]) to authenticated;

comment on function public.set_profile_visibility(public.group_type[]) is
  'Saves the caller''s choice of which kinds of group may see their profile fields: stores the kinds (once each, in the enum''s order) in profile_visibility, then sets every one of the caller''s profile_info rows to exactly those kinds with restrictToGroup null, in one call. Security invoker. Raises 28000 when signed out and 22023 for a null argument. Added by 20261112000001_profile_fields_take_the_stored_choice.sql.';
