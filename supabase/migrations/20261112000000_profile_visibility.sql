-- =============================================================================
-- rybn: each person's choice of who sees their profile fields
--       (rybn-mobile docs/2026-11-12-mobile-groups-profiles-design.md §7.5, D9-D11)
-- =============================================================================
--
-- Who can see a profile field is stored on the field (profile_info.privacy_settings),
-- and can_view_field() reads it there. This adds:
--
--   1. profile_visibility: one row per person, holding the kinds of group they
--      chose. The Settings page reads and writes it and writes it onto every
--      field; a field added later takes it. No row means all four kinds, a new
--      field's default. A person reads and writes their own row only.
--   2. start_profile_visibility(): for the people given, sets every field that
--      names no kind of group and is not tied to one group to all four kinds
--      (D10), then gives each of them who has fields a row holding the setting
--      most of their fields have (D11; a tie goes to the one naming fewer
--      kinds). Called once below for everyone with fields;
--      23_profile_visibility.sql calls it on its own people. No API role may
--      execute it.
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
  'Each person''s choice of which kinds of group may see their profile fields. Written onto every field by the Settings page; a new field takes it. No row means all four kinds. Read and written by its person only. Added by 20261112000000_profile_visibility.sql.';

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
   order by s.user_id, s.fields desc, cardinality(s.kinds), s.kinds::text
  on conflict (user_id) do nothing;
end;
$$;

revoke execute on function public.start_profile_visibility(text[]) from public, anon, authenticated, service_role;

comment on function public.start_profile_visibility(text[]) is
  'D10 and D11 for the people given: a field naming no kind of group, and not tied to one group, is set to all four kinds; then each of them with fields gets a profile_visibility row holding the setting most of their fields have (ties: fewer kinds). Run once by 20261112000000_profile_visibility.sql; 23_profile_visibility.sql runs it on its own people. Executable by no API role.';

select public.start_profile_visibility(array(select distinct user_id from public.profile_info));
