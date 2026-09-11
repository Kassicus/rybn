-- =============================================================================
-- rybn: gift-giving occasions -- schema
-- =============================================================================
--
-- Two shapes share this table, and the check constraints are what keep them
-- from blurring:
--
--   birthday / anniversary -- celebrant_id set, group_id NULL. Derived from
--     profile_info; one row per celebrant per year, NOT one per group. Mom has
--     one birthday; keying it per group would fragment its tags and claims
--     across audiences. Group membership is a VISIBILITY dimension, which
--     can_view_field() already resolves.
--
--   group_date -- group_id set, celebrant_id NULL, name required. "Christmas
--     2026" in a family group is genuinely a different event from one in a
--     work group, even on the same date.
--
-- Phase 1 stores ONLY group_date rows. Birthdays derive at read time and
-- materialize in phase 2, when tagging first needs a foreign key. There is
-- deliberately NO insert policy for celebrant rows: the only writer will be
-- get_or_create_occasion(), a SECURITY DEFINER function added then. Absent a
-- policy, direct inserts fail closed.
--
-- NAME COLLISION: tracked_gifts.occasion is unrelated free text in the private
-- gift tracker. Not a foreign key, nothing to do with this table.
-- =============================================================================

create type public.occasion_kind as enum ('birthday', 'anniversary', 'group_date');

create table public.occasions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  kind public.occasion_kind not null,
  name text,
  occasion_date date not null,
  -- Stored, so occasions_celebrant_identity can key on it. extract(year from
  -- <date>) is immutable, which generated columns require.
  occasion_year integer generated always as
    (extract(year from occasion_date)::integer) stored,
  celebrant_id text references public.user_profiles(id) on delete cascade,
  created_by text references public.user_profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint group_date_shape check (
    kind <> 'group_date'
    or (name is not null and celebrant_id is null and group_id is not null)),
  constraint celebrated_shape check (
    kind = 'group_date'
    or (celebrant_id is not null and group_id is null)),
  constraint occasion_name_length check (
    name is null or char_length(name) between 1 and 200)
);

comment on table public.occasions is
  'Gift-giving events. Birthdays derive from profile_info and materialize only when a tag or claim needs an FK; group dates are always stored.';

-- One row per celebrant per kind per year, deliberately NOT per group. Also
-- makes phase 2 materialization idempotent under concurrency.
create unique index occasions_celebrant_identity
  on public.occasions (kind, celebrant_id, occasion_year)
  where celebrant_id is not null;

create index occasions_group_date_lookup
  on public.occasions (group_id, occasion_date)
  where group_id is not null;

create trigger update_occasions_updated_at
  before update on public.occasions
  for each row execute function public.update_updated_at_column();

alter table public.occasions enable row level security;

-- Group dates: visible to that group's members.
create policy "Members can view their groups' occasions"
  on public.occasions for select to authenticated
  using (
    group_id is not null
    and public.is_group_member(group_id, public.requesting_user_id())
  );

-- Celebrated occasions inherit the underlying profile field's privacy
-- EXACTLY. Without this the table would be a back door around can_view_field:
-- a materialized birthday row would announce a date the profile field hides.
create policy "Celebrated occasions follow the underlying date's privacy"
  on public.occasions for select to authenticated
  using (
    celebrant_id is not null
    and exists (
      select 1 from public.profile_info pi
      where pi.user_id = occasions.celebrant_id
        and pi.category = 'dates'
        and pi.field_name = occasions.kind::text
        and public.can_view_field(
          pi.user_id, public.requesting_user_id(), pi.privacy_settings)
    )
  );

create policy "Group members can create group dates"
  on public.occasions for insert to authenticated
  with check (
    kind = 'group_date'
    and group_id is not null
    and public.is_group_member(group_id, public.requesting_user_id())
    and created_by = public.requesting_user_id()
  );

-- The WITH CHECK is evaluated against the NEW row, so "you did not change
-- group_id" is inexpressible here -- the same limitation the
-- pin_privacy_columns migration documents. CORRECTION (post-review): the
-- check below is NOT sufficient on its own. The creator branch of the OR
-- never re-tests membership against the NEW group_id, which lets a creator
-- move their own row into any group whose UUID they know and keep permanent
-- write control over it there. See
-- 20260910100001_occasions_schema_policy_fix.sql, which ANDs an
-- unconditional membership test against the NEW group_id ahead of this OR.
--
-- A kind change is blocked by this WITH CHECK's own `kind = 'group_date'`
-- conjunct, not by celebrated_shape -- a row admitted past this check is
-- already guaranteed kind = 'group_date', so celebrated_shape is a secondary
-- net here, not the mechanism.
create policy "Creator or group admin can update group dates"
  on public.occasions for update to authenticated
  using (
    kind = 'group_date'
    and (created_by = public.requesting_user_id()
         or public.is_group_admin(group_id, public.requesting_user_id()))
  )
  with check (
    kind = 'group_date'
    and (created_by = public.requesting_user_id()
         or public.is_group_admin(group_id, public.requesting_user_id()))
  );

create policy "Creator or group admin can delete group dates"
  on public.occasions for delete to authenticated
  using (
    kind = 'group_date'
    and (created_by = public.requesting_user_id()
         or public.is_group_admin(group_id, public.requesting_user_id()))
  );

grant select, insert, update, delete on public.occasions to authenticated;
grant select, insert, update, delete on public.occasions to service_role;
