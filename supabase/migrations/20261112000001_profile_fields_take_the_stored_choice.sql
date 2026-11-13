-- =============================================================================
-- rybn: a new profile field takes its owner's stored choice
--       (follows 20261112000000_profile_visibility.sql)
-- =============================================================================
--
-- profile_visibility holds each person's choice of which kinds of group may
-- see their profile fields. The website's own profile save gives a new field
-- that choice, but a field can be created elsewhere, and a choice can change
-- between a save reading it and the field being written. This adds
-- profile_field_takes_stored_choice(), a before-insert trigger on
-- profile_info:
--
--   - A row tied to one group (restrictToGroup present and not JSON null) is
--     left exactly as given, and so is a row whose owner has no stored
--     choice.
--   - Otherwise the row's privacy_settings is the given object (an empty
--     object when what was given is not an object) with visibleToGroupTypes
--     set to the owner's stored kinds, once each in the enum's order, and
--     restrictToGroup set to JSON null; its other keys are kept.
--
-- So confirm_anniversary_link's new anniversary rows, and a profile save's
-- new rows, carry the choice stored when the row is written.
--
-- WHEN IT IS APPLIED. After the website code that saves a choice with
-- set_profile_visibility (20261112000000) is live. That code writes a choice
-- onto a person's existing fields with an update, which this trigger does not
-- see, and a profile save inserts only the fields it did not find. So no
-- writer sends a setting through an insert onto a field that already exists,
-- except a profile save that meets a field created since it looked, and that
-- field then takes the stored choice, as a new one would. The code before it
-- saved a choice by upserting every existing field with the new setting; with
-- that code live, this trigger would replace the new setting with the one
-- already stored.
--
-- SECURITY INVOKER. The function reads profile_visibility as the role doing
-- the insert, so it can never read a row that role could not read itself.
--   - A signed-in person inserting their own field reads their own row
--     through row-level security.
--   - A signed-in person inserting a row that names someone else reads
--     nothing (the policy shows them their own row only), so the row is left
--     as given, and profile_info's insert policy then refuses it. The trigger
--     never changes user_id, and row-level security checks the row after the
--     trigger, so a refused insert is still refused.
--   - The SECURITY DEFINER functions that write other people's fields,
--     confirm_anniversary_link among them, run as their owner, which owns
--     profile_visibility and reads every row.
--   - The service role bypasses row-level security, and holds SELECT and
--     UPDATE on the table (20261112000000).
--   - The migration role owns the table.
-- As SECURITY DEFINER it would read any person's row on behalf of an insert
-- row-level security is about to refuse.
--
-- FOR SHARE. The stored row is read FOR SHARE: when the owner already has a
-- stored choice, a save of it in progress (set_profile_visibility, which
-- writes profile_visibility before the fields) is waited for, and its new
-- kinds are the ones taken. A share lock needs UPDATE on the table as well as
-- SELECT; every role above has both.
--
-- LOCK ORDER. A person's profile_visibility row, then their profile_info
-- rows. set_profile_visibility takes them in that order, and so does every
-- insert, because this trigger runs before its row is written (a row tied to
-- one group takes no lock). Code that changes a person's profile_info rows
-- and then inserts one for them in the same transaction takes the stored row
-- first:
--   perform 1 from profile_visibility where user_id = <them> for share;
--
-- INSERT ... ON CONFLICT ... DO UPDATE. The trigger runs on the proposed row,
-- so `excluded` holds the row as the trigger left it:
--   - confirm_anniversary_link's `do update set field_value =
--     excluded.field_value` gives a new anniversary row the partner's stored
--     choice, and changes only the value of one that exists;
--   - a profile save's upsert (lib/actions/profile.ts) sets every column it
--     sends from `excluded`, so a new row, or one that appeared since the save
--     read the choice, takes the choice stored now.
-- Every other writer of profile_info updates or deletes rows (a profile
-- save's update of a saved value, set_profile_visibility,
-- start_profile_visibility, the group-delete and member-delete cleanups, and
-- a field's removal), and a before-insert trigger does not fire for those.
--
-- can_view_field(), every policy, confirm_anniversary_link(),
-- start_profile_visibility() and set_profile_visibility() are unchanged.
-- =============================================================================


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
  'Before insert on profile_info: a row not tied to one group, whose owner has a stored choice in profile_visibility, takes those kinds (once each, in the enum''s order) with restrictToGroup null; other keys are kept. Security invoker, so it reads only what the inserting role can read. Reads the stored row for share: a person''s profile_visibility row is taken before their profile_info rows. Added by 20261112000001_profile_fields_take_the_stored_choice.sql.';

create trigger profile_field_takes_stored_choice
  before insert on public.profile_info
  for each row execute function public.profile_field_takes_stored_choice();
