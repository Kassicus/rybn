-- =============================================================================
-- rybn: each person's choice of who sees their profile fields
--       (rybn-mobile docs/2026-11-12-mobile-groups-profiles-design.md §7.5, D9-D11)
-- =============================================================================
--
-- Who can see a profile field is stored on the field (profile_info.privacy_settings),
-- and can_view_field() reads it there. This adds:
--
--   1. profile_visibility: one row per person, holding the kinds of group they
--      chose. The Settings page reads it, and saves it with
--      set_profile_visibility() (3. below), which writes it onto every field;
--      the website's profile save gives a new field the choice. No row means
--      all four kinds, a new field's default. A person reads and writes their
--      own row only.
--   2. start_profile_visibility(): for the people given, sets every field that
--      names no kind of group and is not tied to one group to all four kinds
--      (D10), then gives each of them who has a field not tied to one group a
--      row holding the setting most of those fields have (D11; a tie goes to
--      the one naming fewer kinds, then to the kinds in the enum's order).
--      Called once below for everyone with fields; 23_profile_visibility.sql
--      calls it on its own people. No API role may execute it.
--   3. set_profile_visibility(p_kinds), SECURITY INVOKER: for the caller,
--      stores the kinds once each in the enum's order in profile_visibility,
--      then sets every one of the caller's profile_info rows to exactly
--      {"visibleToGroupTypes": [those kinds], "restrictToGroup": null}. Both
--      writes happen in the one call, so they succeed or fail together, and
--      row-level security confines each to the caller's own rows. Signed out
--      raises 28000; a null argument raises 22023 and writes nothing. A null
--      element is not a kind and is not stored. Executable by authenticated.
--
--      Lock order: a person's profile_visibility row, then their profile_info
--      rows. set_profile_visibility writes them in that order.
--
-- can_view_field() and every existing policy are unchanged: who can see a
-- field is still decided by the field alone.
-- =============================================================================

create table public.profile_visibility (
  user_id text primary key references public.user_profiles(id) on delete cascade,
  visible_to_group_types public.group_type[] not null
    default array['family', 'friends', 'work', 'custom']::public.group_type[]
);

comment on table public.profile_visibility is
  'Each person''s choice of which kinds of group may see their profile fields. Written onto every field by the Settings page; the website''s profile save gives a new field the choice. No row means all four kinds. Read and written by its person only. Added by 20261112000000_profile_visibility.sql.';

alter table public.profile_visibility enable row level security;

create policy "People can see their own profile visibility"
  on public.profile_visibility for select to authenticated
  using ((select public.requesting_user_id()) = user_id);

create policy "People can set their own profile visibility"
  on public.profile_visibility for insert to authenticated
  with check ((select public.requesting_user_id()) = user_id);

create policy "People can change their own profile visibility"
  on public.profile_visibility for update to authenticated
  using ((select public.requesting_user_id()) = user_id)
  with check ((select public.requesting_user_id()) = user_id);

grant select, insert, update on public.profile_visibility to authenticated;
grant select, insert, update, delete on public.profile_visibility to service_role;
-- Supabase's per-role default privileges give `authenticated` every DML verb on
-- a new public table (20260912000000_anniversary_links.sql). A row goes only
-- with its person.
revoke delete on public.profile_visibility from authenticated;
revoke all on public.profile_visibility from anon;


create or replace function public.start_profile_visibility(p_user_ids text[])
returns void
language plpgsql
set search_path = public
as $$
begin
  -- D10. A field names a kind only with one of the four in an array under
  -- visibleToGroupTypes. Its other keys are kept.
  update profile_info pi
     set privacy_settings =
           (case when jsonb_typeof(pi.privacy_settings) = 'object'
                 then pi.privacy_settings else '{}'::jsonb end)
           || '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb
   where pi.user_id = any(p_user_ids)
     and coalesce(pi.privacy_settings->'restrictToGroup', 'null'::jsonb) = 'null'::jsonb
     and not exists (
       select 1
         from jsonb_array_elements_text(
                case when jsonb_typeof(pi.privacy_settings->'visibleToGroupTypes') = 'array'
                     then pi.privacy_settings->'visibleToGroupTypes' else '[]'::jsonb end) k(kind)
        where k.kind in ('family', 'friends', 'work', 'custom')
     );

  -- D11. A field's setting is the set of valid kinds it names. Fields tied to
  -- one group do not vote. Most fields first, then fewer kinds, then the kinds
  -- in the enum's order, so the result never rests on the database's order.
  insert into profile_visibility (user_id, visible_to_group_types)
  select distinct on (s.user_id) s.user_id, s.kinds
    from (
      select f.user_id, f.kinds, count(*) as fields
        from (
          select pi.user_id,
                 array(
                   select distinct k.kind::public.group_type
                     from jsonb_array_elements_text(
                            case when jsonb_typeof(pi.privacy_settings->'visibleToGroupTypes') = 'array'
                                 then pi.privacy_settings->'visibleToGroupTypes' else '[]'::jsonb end) k(kind)
                    where k.kind in ('family', 'friends', 'work', 'custom')
                    order by 1
                 ) as kinds
            from profile_info pi
           where pi.user_id = any(p_user_ids)
             and coalesce(pi.privacy_settings->'restrictToGroup', 'null'::jsonb) = 'null'::jsonb
        ) f
       group by f.user_id, f.kinds
    ) s
   order by s.user_id, s.fields desc, cardinality(s.kinds), s.kinds
  on conflict (user_id) do nothing;
end;
$$;

revoke execute on function public.start_profile_visibility(text[]) from public, anon, authenticated, service_role;

comment on function public.start_profile_visibility(text[]) is
  'D10 and D11 for the people given: a field naming no kind of group, and not tied to one group, is set to all four kinds; then each of them with a field not tied to one group gets a profile_visibility row holding the setting most of those fields have (ties: fewer kinds, then the enum''s order). Run once, on everyone, by 20261112000000_profile_visibility.sql. After that a field naming no kind is its person''s own choice, so only 23_profile_visibility.sql calls it, on that file''s own people. Executable by no API role.';

select public.start_profile_visibility(array(select distinct user_id from public.profile_info));


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

  -- The stored row first, then the fields: the lock order in the header.
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
  'Saves the caller''s choice of which kinds of group may see their profile fields: stores the kinds (once each, in the enum''s order) in profile_visibility, then sets every one of the caller''s profile_info rows to exactly those kinds with restrictToGroup null, in one call. Security invoker. Raises 28000 when signed out and 22023 for a null argument. Added by 20261112000000_profile_visibility.sql.';
