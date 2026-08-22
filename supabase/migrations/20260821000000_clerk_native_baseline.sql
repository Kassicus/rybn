-- =============================================================================
-- rybn: Clerk-native baseline schema
-- =============================================================================
--
-- Replaces the 56 archived migrations (supabase/migrations_archive/) with a
-- single baseline written for Clerk from the start.
--
-- What changed, and why:
--
--   1. IDENTITY IS TEXT. Clerk issues string user IDs such as
--      'user_2abc123...'. Every column that holds a user identity is `text`.
--      Non-identity `id` columns stay `uuid primary key default
--      gen_random_uuid()`.
--
--   2. user_profiles IS THE IDENTITY ROOT. It has a `text` primary key and no
--      foreign key into the Supabase auth schema. Every other identity
--      column references public.user_profiles(id). Nothing in this file names
--      that schema at all -- the plan's Step 12 grep gate depends on that
--      staying true in prose as well as in code -- and there is no signup
--      trigger: the profile row is upserted by the application on first
--      request (Task 7).
--
--   3. POLICIES READ (select public.requesting_user_id()). The Supabase uid()
--      helper cannot work here: it is declared to return uuid and would
--      return null for a Clerk subject. The `select` wrapper is not
--      decoration -- it lets the planner evaluate the claim once per query
--      instead of once per row.
--
--   4. THE group_members RECURSION IS BROKEN WITH SECURITY DEFINER HELPERS.
--      A policy on group_members that queries group_members re-enters itself
--      and surfaces as `stack depth limit exceeded`. The archived migrations
--      contain four separate attempts to paper over this. is_group_member(),
--      is_group_admin(), is_group_owner(), is_group_gift_member() and
--      is_exchange_participant() run as the function owner with RLS
--      suspended, so the policy never re-enters the table it guards.
--
--   5. GROUPS ARE NO LONGER WORLD-READABLE. The archived
--      "Authenticated users can view groups by invite code" policy was
--      `USING (true)`, which exposed every group's name, description and
--      invite code to every signed-in user. It is replaced by a membership
--      test plus find_group_by_invite_code(), a SECURITY DEFINER lookup that
--      returns one group for an exact invite code and nothing else.
--
--   6. SECURITY DEFINER FUNCTIONS PIN THEIR OWN SUBJECT. A definer function
--      runs with RLS suspended, so its arguments are attacker-controlled input
--      and the EXECUTE grant is its only other defence. get_shared_groups(),
--      can_view_field(), can_view_wishlist_item() and get_dates_today_for_user()
--      each compare their subject against requesting_user_id() rather than
--      trusting the caller, and section 9 grants EXECUTE per object with
--      nothing at all to anon.
--
-- Privacy model (unchanged from the archive, only the parameter types move
-- from uuid to text): privacy_settings is
--   {"visibleToGroupTypes": [<group_type>...], "restrictToGroup": <uuid|null>}
-- restrictToGroup, when set, is an exact per-group override and takes
-- precedence. An empty visibleToGroupTypes array with no restrictToGroup
-- means private.
-- =============================================================================


-- =============================================================================
-- 1. Enumerated types
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'group_type') then
    create type public.group_type as enum ('family', 'friends', 'work', 'custom');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'member_role') then
    create type public.member_role as enum ('owner', 'admin', 'member');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'gift_status') then
    create type public.gift_status as enum ('planned', 'ordered', 'arrived', 'wrapped', 'given');
  end if;

  -- Retained because types/privacy.ts and types/database.ts still name it.
  -- No column uses it; the live privacy model is the jsonb shape above.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'privacy_level') then
    create type public.privacy_level as enum ('private', 'group', 'friends', 'family', 'public');
  end if;
end $$;


-- =============================================================================
-- 2. Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- user_profiles -- the identity root.
--
-- `id` holds the Clerk user id. `username` is nullable because Clerk may hand
-- us a user before a username exists; the application upserts the profile on
-- first request and the user picks a username afterwards.
-- -----------------------------------------------------------------------------
create table public.user_profiles (
  id text primary key,
  username text unique,
  display_name text,
  email text,
  avatar_url text,
  bio text,
  email_preferences jsonb default '{
    "email_group_invites": true,
    "email_date_reminders": true,
    "email_gift_updates": true,
    "email_exchange_notifications": true,
    "email_marketing": false
  }'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint username_length check (
    username is null or (char_length(username) between 3 and 30)),
  constraint username_format check (
    username is null or username ~ '^[a-zA-Z0-9_-]+$'),
  constraint bio_length check (bio is null or char_length(bio) <= 500)
);

comment on table public.user_profiles is
  'Identity root. id is the Clerk user id. Nothing references the Supabase auth schema.';


-- -----------------------------------------------------------------------------
-- groups and membership
-- -----------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type public.group_type not null default 'custom',
  invite_code text unique not null,
  settings jsonb default '{}'::jsonb,
  created_by text not null references public.user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  user_id text references public.user_profiles(id) on delete cascade,
  role public.member_role default 'member',
  joined_at timestamptz default now(),
  constraint group_members_group_id_user_id_key unique (group_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  email text not null,
  invited_by text not null references public.user_profiles(id),
  accepted boolean default false,
  accepted_at timestamptz,
  token text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);


-- -----------------------------------------------------------------------------
-- profile fields and wishlists -- the two tables the privacy model guards
-- -----------------------------------------------------------------------------
create table public.profile_info (
  id uuid primary key default gen_random_uuid(),
  user_id text references public.user_profiles(id) on delete cascade,
  category text not null,
  field_name text not null,
  field_value text,
  privacy_settings jsonb not null default
    '{"restrictToGroup": null, "visibleToGroupTypes": ["family", "friends", "work", "custom"]}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint valid_category check (
    category = any (array['sizes', 'preferences', 'vehicles', 'personal', 'dates'])),
  constraint profile_info_user_id_category_field_name_key
    unique (user_id, category, field_name)
);

create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.user_profiles(id) on delete cascade,
  title text not null,
  description text,
  url text,
  price numeric,
  image_url text,
  priority text,
  category text,
  privacy_settings jsonb not null default
    '{"restrictToGroup": null, "visibleToGroupTypes": ["family", "friends", "work", "custom"]}'::jsonb,
  claimed_by text references public.user_profiles(id),
  claimed_at timestamptz,
  purchased boolean default false,
  purchased_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  out_of_stock_marked_by text references public.user_profiles(id) on delete set null,
  out_of_stock_marked_at timestamptz,
  constraint title_length check (char_length(title) between 1 and 200),
  constraint valid_price check (price is null or price >= 0),
  constraint wishlist_items_priority_check check (
    priority = any (array['low', 'medium', 'high', 'must-have'])),
  constraint valid_wishlist_privacy_settings check (
    (privacy_settings ? 'visibleToGroupTypes')
    and jsonb_typeof(privacy_settings -> 'visibleToGroupTypes') = 'array'
    and (
      not (privacy_settings ? 'restrictToGroup')
      or jsonb_typeof(privacy_settings -> 'restrictToGroup') = 'null'
      or jsonb_typeof(privacy_settings -> 'restrictToGroup') = 'string'
    ))
);


-- -----------------------------------------------------------------------------
-- group gifts and their chat
-- -----------------------------------------------------------------------------
create table public.group_gifts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  description text,
  target_user_id text references public.user_profiles(id),
  target_amount numeric,
  current_amount numeric default 0,
  is_active boolean default true,
  created_by text not null references public.user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint name_length check (char_length(name) between 1 and 200),
  constraint valid_target_amount check (target_amount is null or target_amount >= 0),
  constraint valid_current_amount check (current_amount >= 0)
);

create table public.group_gift_members (
  id uuid primary key default gen_random_uuid(),
  group_gift_id uuid not null references public.group_gifts(id) on delete cascade,
  user_id text not null references public.user_profiles(id) on delete cascade,
  contribution_amount numeric default 0,
  has_paid boolean default false,
  joined_at timestamptz default now(),
  constraint gift_group_members_gift_group_id_user_id_key unique (group_gift_id, user_id),
  constraint valid_contribution_amount check (
    contribution_amount is null or contribution_amount >= 0)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  group_gift_id uuid not null references public.group_gifts(id) on delete cascade,
  user_id text not null references public.user_profiles(id) on delete cascade,
  content text not null,
  attachment_url text,
  is_edited boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint content_length check (char_length(content) between 1 and 5000)
);


-- -----------------------------------------------------------------------------
-- gift exchanges
-- -----------------------------------------------------------------------------
create table public.gift_exchanges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  description text,
  exchange_type text default 'secret_santa',
  budget_min numeric,
  budget_max numeric,
  exchange_date timestamptz,
  exchange_location text,
  exchange_details text,
  registration_deadline timestamptz,
  is_active boolean default true,
  assignments_generated boolean default false,
  created_by text not null references public.user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint name_length check (char_length(name) between 1 and 200),
  constraint gift_exchanges_exchange_type_check check (
    exchange_type = any (array['secret_santa', 'white_elephant', 'yankee_swap', 'custom'])),
  constraint valid_budget_min check (budget_min is null or budget_min >= 0),
  constraint valid_budget_max check (budget_max is null or budget_max >= 0),
  constraint valid_budget_range check (
    budget_min is null or budget_max is null or budget_min <= budget_max)
);

create table public.gift_exchange_participants (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.gift_exchanges(id) on delete cascade,
  user_id text not null references public.user_profiles(id) on delete cascade,
  opted_in boolean default true,
  assigned_to text references public.user_profiles(id),
  wishlist_shared boolean default false,
  gift_sent boolean default false,
  gift_received boolean default false,
  notes text,
  preferences text,
  joined_at timestamptz default now(),
  constraint gift_exchange_participants_exchange_id_user_id_key unique (exchange_id, user_id),
  constraint no_self_assignment check (user_id <> assigned_to or assigned_to is null),
  constraint notes_length check (notes is null or char_length(notes) <= 1000)
);


-- -----------------------------------------------------------------------------
-- date reminders
-- -----------------------------------------------------------------------------
create table public.date_notifications (
  id uuid primary key default gen_random_uuid(),
  notified_user_id text not null references public.user_profiles(id) on delete cascade,
  celebrant_id text not null references public.user_profiles(id) on delete cascade,
  field_name text not null,
  group_id uuid not null references public.groups(id) on delete cascade,
  celebration_date date not null,
  notification_year integer not null,
  email_sent boolean default false,
  email_sent_at timestamptz,
  banner_shown boolean default true,
  banner_dismissed boolean default false,
  banner_dismissed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint date_notifications_field_name_check check (
    field_name = any (array['birthday', 'anniversary'])),
  constraint date_notifications_notified_user_id_celebrant_id_field_name_key
    unique (notified_user_id, celebrant_id, field_name, notification_year, group_id)
);


-- -----------------------------------------------------------------------------
-- private gift tracker (never shared with anyone)
-- -----------------------------------------------------------------------------
create table public.gift_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.user_profiles(id) on delete cascade,
  name text not null,
  notes text,
  is_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint recipient_name_length check (char_length(name) between 1 and 100),
  constraint recipient_notes_length check (notes is null or char_length(notes) <= 500),
  constraint gift_recipients_user_id_name_key unique (user_id, name)
);

create table public.tracked_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.user_profiles(id) on delete cascade,
  recipient_id uuid not null references public.gift_recipients(id) on delete cascade,
  name text not null,
  description text,
  photo_url text,
  product_link text,
  price numeric,
  status public.gift_status not null default 'planned',
  status_changed_at timestamptz default now(),
  occasion text,
  season_year integer default extract(year from now()),
  notes text,
  is_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint gift_name_length check (char_length(name) between 1 and 200),
  constraint gift_description_length check (description is null or char_length(description) <= 1000),
  constraint gift_notes_length check (notes is null or char_length(notes) <= 1000),
  constraint gift_occasion_length check (occasion is null or char_length(occasion) <= 100),
  constraint gift_price_positive check (price is null or price >= 0)
);


-- =============================================================================
-- 3. Indexes
-- =============================================================================

create index idx_user_profiles_username on public.user_profiles (username);
create index idx_user_profiles_email on public.user_profiles (email);
create index idx_user_profiles_email_preferences on public.user_profiles using gin (email_preferences);

create index idx_groups_created_by on public.groups (created_by);
create index idx_groups_invite_code on public.groups (invite_code);

create index idx_group_members_group_id on public.group_members (group_id);
create index idx_group_members_user_id on public.group_members (user_id);
create index idx_group_members_user_group on public.group_members (user_id, group_id);

create index idx_invitations_group_id on public.invitations (group_id);
create index idx_invitations_email on public.invitations (email);
create index idx_invitations_token on public.invitations (token);
create index idx_invitations_group_email on public.invitations (group_id, email, created_at desc);
create unique index invitations_group_email_unique_pending
  on public.invitations (group_id, email) where (accepted = false);

create index idx_profile_info_user_id on public.profile_info (user_id);
create index idx_profile_info_category on public.profile_info (category);
create index idx_profile_info_user_category on public.profile_info (user_id, category);
create index idx_profile_info_privacy_settings on public.profile_info using gin (privacy_settings);

create index idx_wishlist_items_user_id on public.wishlist_items (user_id);
create index idx_wishlist_items_category on public.wishlist_items (category);
create index idx_wishlist_items_priority on public.wishlist_items (priority);
create index idx_wishlist_items_claimed_by on public.wishlist_items (claimed_by);
create index idx_wishlist_items_privacy on public.wishlist_items using gin (privacy_settings);
create index idx_wishlist_items_out_of_stock on public.wishlist_items (out_of_stock_marked_by)
  where (out_of_stock_marked_by is not null);

create index idx_group_gifts_group_id on public.group_gifts (group_id);
create index idx_group_gifts_created_by on public.group_gifts (created_by);
create index idx_group_gifts_target_user on public.group_gifts (target_user_id);
create index idx_group_gifts_is_active on public.group_gifts (is_active);

create index idx_group_gift_members_group_gift on public.group_gift_members (group_gift_id);
create index idx_group_gift_members_user on public.group_gift_members (user_id);

create index idx_messages_group_gift on public.messages (group_gift_id);
create index idx_messages_user on public.messages (user_id);
create index idx_messages_created_at on public.messages (created_at desc);

create index idx_gift_exchanges_group_id on public.gift_exchanges (group_id);
create index idx_gift_exchanges_created_by on public.gift_exchanges (created_by);
create index idx_gift_exchanges_is_active on public.gift_exchanges (is_active);
create index idx_gift_exchanges_exchange_date on public.gift_exchanges (exchange_date);

create index idx_gift_exchange_participants_exchange on public.gift_exchange_participants (exchange_id);
create index idx_gift_exchange_participants_user on public.gift_exchange_participants (user_id);
create index idx_gift_exchange_participants_assigned_to on public.gift_exchange_participants (assigned_to);

create index idx_date_notifications_notified_user on public.date_notifications (notified_user_id);
create index idx_date_notifications_celebrant on public.date_notifications (celebrant_id);
create index idx_date_notifications_year on public.date_notifications (notification_year);
create index idx_date_notifications_banner on public.date_notifications
  (notified_user_id, banner_shown, banner_dismissed)
  where (banner_shown = true and banner_dismissed = false);

create index idx_gift_recipients_user_id on public.gift_recipients (user_id);
create index idx_gift_recipients_archived on public.gift_recipients (user_id, is_archived);

create index idx_tracked_gifts_user_id on public.tracked_gifts (user_id);
create index idx_tracked_gifts_recipient_id on public.tracked_gifts (recipient_id);
create index idx_tracked_gifts_status on public.tracked_gifts (user_id, status);
create index idx_tracked_gifts_season on public.tracked_gifts (user_id, season_year);
create index idx_tracked_gifts_archived on public.tracked_gifts (user_id, is_archived);


-- =============================================================================
-- 4. Identity helper
--
-- The single source of "who is asking". Every policy calls it wrapped in a
-- scalar subselect -- (select public.requesting_user_id()) -- so the planner
-- evaluates it once per query rather than once per row.
-- =============================================================================

create or replace function public.requesting_user_id()
returns text
language sql
stable
as $$
  select auth.jwt()->>'sub'
$$;

-- Is the caller a role that bypasses RLS anyway?
--
-- This is how the privileged internal path is ASSERTED rather than inferred.
-- The previous version treated "requesting_user_id() is null" as proof of an
-- internal call, which conflates unauthenticated with trusted: it worked only
-- because legacy service-role JWTs happen to carry no `sub` claim. A JWT
-- signing-key migration that added one would have silently switched the date
-- reminder job off -- no error, no log, reminders simply stop.
--
-- current_setting('role') is the caller's SET ROLE, and it survives into a
-- SECURITY DEFINER body (current_user does NOT -- inside a definer function
-- that is the owner). Verified on this database:
--     role=authenticated + user claims  -> role_guc=authenticated
--     role=service_role,  no claims     -> role_guc=service_role
--     role=service_role + svc claims    -> role_guc=service_role
-- so the answer no longer depends on which claims an external system happens
-- to mint. Resolving it through rolbypassrls rather than a hardcoded name
-- states the actual reason the caller is trusted: it can already read these
-- tables directly, so pinning its subject would buy nothing.
--
-- 'none' (a direct database connection that never issued SET ROLE) resolves to
-- false, i.e. NOT privileged. That is deliberate: fail closed.
create or replace function public.is_service_context()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select r.rolbypassrls
       from pg_roles r
      where r.rolname = nullif(current_setting('role', true), 'none')),
    false)
$$;

comment on function public.requesting_user_id() is
  'The Clerk user id of the caller, from the JWT sub claim. Replaces the Supabase uid() helper, which returns uuid and is null for a Clerk subject.';


-- =============================================================================
-- 5. Membership helpers (SECURITY DEFINER)
--
-- These exist to break RLS recursion. A policy on group_members that queries
-- group_members re-enters itself; running the lookup as the function owner,
-- with RLS suspended, terminates that.
--
-- Being a pure boolean predicate is NOT on its own a reason they are safe.
-- They are SECURITY DEFINER, executable by `authenticated`, and PostgREST
-- exposes them at /rest/v1/rpc/, so an unpinned version answers precisely the
-- questions RLS refuses: is_group_gift_member(<gift>, 'alice') and
-- is_exchange_participant(<exchange>, 'bob') ARE the secrets a surprise-gift
-- app exists to keep, and a group UUID kept after leaving a group would make
-- that oracle permanent.
--
-- So every one of them is pinned to the caller: p_user_id must be the
-- requesting user, or the caller must already bypass RLS. Every policy that
-- calls one -- 21 of the 59 in this schema, covering groups, group_members,
-- invitations, messages, gift_exchanges, gift_exchange_participants,
-- group_gifts and group_gift_members -- passes
-- (select public.requesting_user_id()) as p_user_id, so the pin is a no-op on
-- every real call path, and no application code calls them directly.
--
-- Counted against the live database, not against this file: policies are
-- dropped and replaced further down, so counting `create policy` here
-- overstates it (67 statements, 8 of them on storage.objects).
-- =============================================================================

create or replace function public.is_group_member(p_group_id uuid, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Pinned: see the section header. `and` short-circuits, so an unrelated
  -- caller never reaches the table at all.
  select (
    p_user_id is not distinct from (select public.requesting_user_id())
    or public.is_service_context()
  ) and exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  )
$$;

create or replace function public.is_group_admin(p_group_id uuid, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Pinned: see the section header. `and` short-circuits, so an unrelated
  -- caller never reaches the table at all.
  select (
    p_user_id is not distinct from (select public.requesting_user_id())
    or public.is_service_context()
  ) and exists (
    select 1 from public.group_members
    where group_id = p_group_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  )
$$;

create or replace function public.is_group_owner(p_group_id uuid, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Pinned: see the section header. `and` short-circuits, so an unrelated
  -- caller never reaches the table at all.
  select (
    p_user_id is not distinct from (select public.requesting_user_id())
    or public.is_service_context()
  ) and exists (
    select 1 from public.group_members
    where group_id = p_group_id
      and user_id = p_user_id
      and role = 'owner'
  )
$$;

create or replace function public.is_group_gift_member(p_group_gift_id uuid, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Pinned: see the section header. `and` short-circuits, so an unrelated
  -- caller never reaches the table at all.
  select (
    p_user_id is not distinct from (select public.requesting_user_id())
    or public.is_service_context()
  ) and exists (
    select 1 from public.group_gift_members
    where group_gift_id = p_group_gift_id and user_id = p_user_id
  )
$$;

create or replace function public.is_exchange_participant(p_exchange_id uuid, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Pinned: see the section header. `and` short-circuits, so an unrelated
  -- caller never reaches the table at all.
  select (
    p_user_id is not distinct from (select public.requesting_user_id())
    or public.is_service_context()
  ) and exists (
    select 1 from public.gift_exchange_participants
    where exchange_id = p_exchange_id and user_id = p_user_id
  )
$$;


-- =============================================================================
-- 6. Domain functions
--
-- Carried over from the archive. Only the user-identity parameters change
-- from uuid to text; the bodies are otherwise unchanged, except that
-- get_upcoming_dates_for_notifications no longer joins the Supabase auth
-- users table for email addresses -- it reads user_profiles.email, which is
-- the same value.
-- =============================================================================

create or replace function public.get_shared_groups(user_a text, user_b text)
returns table(group_id uuid, group_type public.group_type)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
begin
  -- SECURITY DEFINER runs this with RLS suspended, so the two parameters
  -- cannot be trusted on their own. A signed-in caller may only ask about a
  -- pair they are part of; without this, any authenticated user could map the
  -- group graph between any two Clerk IDs.
  --
  -- The internal callers are the SECURITY DEFINER chain from
  -- can_view_field()/can_view_wishlist_item() (which have already pinned the
  -- viewer, so v_caller matches user_a) and the reminder job, which is
  -- admitted by is_service_context() on the strength of its ROLE rather than
  -- of a missing claim.
  if not public.is_service_context()
     and v_caller is distinct from user_a
     and v_caller is distinct from user_b then
    return;
  end if;

  return query
  select distinct g.id, g.type
  from groups g
  inner join group_members gm1 on g.id = gm1.group_id
  inner join group_members gm2 on g.id = gm2.group_id
  where gm1.user_id = user_a
    and gm2.user_id = user_b;
end;
$$;

create or replace function public.can_view_field(
  field_owner_id text,
  viewer_id text,
  privacy_settings jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visible_group_types text[];
  restrict_to_group uuid;
  shared_group record;
  viewer_group_type public.group_type;
  v_caller text := (select public.requesting_user_id());
begin
  -- A signed-in caller does not get to choose whose eyes to look through.
  -- This function is SECURITY DEFINER and would otherwise be a boolean oracle
  -- over other people's group memberships. Every policy already passes
  -- requesting_user_id() as the viewer, so this is a no-op on the policy path.
  -- The reminder job is admitted by is_service_context(), which asserts the
  -- caller's role rather than inferring trust from an absent claim.
  if not public.is_service_context() and v_caller is distinct from viewer_id then
    return false;
  end if;

  -- Owner can always view their own fields
  if field_owner_id = viewer_id then
    return true;
  end if;

  -- Check for single group restriction first
  if privacy_settings ? 'restrictToGroup' and privacy_settings->>'restrictToGroup' is not null then
    restrict_to_group := (privacy_settings->>'restrictToGroup')::uuid;

    for shared_group in
      select * from get_shared_groups(viewer_id, field_owner_id)
    loop
      if shared_group.group_id = restrict_to_group then
        return true;
      end if;
    end loop;

    return false;
  end if;

  -- No group restriction, check visibleToGroupTypes
  if privacy_settings ? 'visibleToGroupTypes' then
    visible_group_types := array(
      select jsonb_array_elements_text(privacy_settings->'visibleToGroupTypes')
    );

    if array_length(visible_group_types, 1) is null or array_length(visible_group_types, 1) = 0 then
      return false;
    end if;

    for shared_group in
      select * from get_shared_groups(viewer_id, field_owner_id)
    loop
      viewer_group_type := shared_group.group_type;

      if viewer_group_type::text = any(visible_group_types) then
        return true;
      end if;
    end loop;

    return false;
  end if;

  -- If no privacy settings, default to private
  return false;
end;
$$;

create or replace function public.can_view_wishlist_item(
  item_owner_id text,
  viewer_id text,
  privacy_settings jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visible_group_types text[];
  restrict_to_group uuid;
  shared_group record;
  viewer_group_type public.group_type;
  v_caller text := (select public.requesting_user_id());
begin
  -- A signed-in caller does not get to choose whose eyes to look through.
  -- This function is SECURITY DEFINER and would otherwise be a boolean oracle
  -- over other people's group memberships. Every policy already passes
  -- requesting_user_id() as the viewer, so this is a no-op on the policy path.
  -- The reminder job is admitted by is_service_context(), which asserts the
  -- caller's role rather than inferring trust from an absent claim.
  if not public.is_service_context() and v_caller is distinct from viewer_id then
    return false;
  end if;

  -- Owner can always view their own items
  if item_owner_id = viewer_id then
    return true;
  end if;

  if privacy_settings ? 'restrictToGroup' and privacy_settings->>'restrictToGroup' is not null then
    restrict_to_group := (privacy_settings->>'restrictToGroup')::uuid;

    for shared_group in
      select * from get_shared_groups(viewer_id, item_owner_id)
    loop
      if shared_group.group_id = restrict_to_group then
        return true;
      end if;
    end loop;

    return false;
  end if;

  if privacy_settings ? 'visibleToGroupTypes' then
    visible_group_types := array(
      select jsonb_array_elements_text(privacy_settings->'visibleToGroupTypes')
    );

    if array_length(visible_group_types, 1) is null or array_length(visible_group_types, 1) = 0 then
      return false;
    end if;

    for shared_group in
      select * from get_shared_groups(viewer_id, item_owner_id)
    loop
      viewer_group_type := shared_group.group_type;

      if viewer_group_type::text = any(visible_group_types) then
        return true;
      end if;
    end loop;

    return false;
  end if;

  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- find_group_by_invite_code
--
-- Replaces the archived `USING (true)` SELECT policy on groups. Joining by
-- code needs to read exactly one group before you are a member of it; it does
-- not need every group in the database to be readable. This returns a single
-- group for an exact code and deliberately does not echo the invite code back.
-- -----------------------------------------------------------------------------
create or replace function public.find_group_by_invite_code(p_invite_code text)
returns table(id uuid, name text, description text, type public.group_type)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name, g.description, g.type
  from public.groups g
  where g.invite_code = upper(p_invite_code)
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- The only two ways to join a group.
--
-- Both are SECURITY DEFINER because they must write group_members, which has no
-- INSERT policy. Both pin the new member to requesting_user_id(): the caller can
-- only ever add THEMSELVES, never a third party. Both take a secret (a code, a
-- token) rather than an identity, which is the whole point -- an RLS policy
-- cannot be handed a secret to check, a function can.
-- -----------------------------------------------------------------------------

create or replace function public.join_group_with_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     text := (select public.requesting_user_id());
  v_group_id uuid;
begin
  if v_user is null then
    raise exception 'NOT AUTHENTICATED' using errcode = '28000';
  end if;

  -- Reuses the existing resolver, which normalises case and returns exactly one
  -- group. It does not return the invite code, so nothing is echoed back that
  -- the caller did not already hold.
  select f.id into v_group_id
    from public.find_group_by_invite_code(p_invite_code) f;

  -- Deliberately the same error whether the code is unknown or malformed: a
  -- caller must not be able to use this to discover which codes exist.
  if v_group_id is null then
    raise exception 'INVALID INVITE CODE' using errcode = '22023';
  end if;

  if exists (select 1 from public.group_members
              where group_id = v_group_id and user_id = v_user) then
    raise exception 'ALREADY A MEMBER' using errcode = '23505';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_user, 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

create or replace function public.accept_group_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text := (select public.requesting_user_id());
  v_id   uuid;
  v_gid  uuid;
begin
  if v_user is null then
    raise exception 'NOT AUTHENTICATED' using errcode = '28000';
  end if;

  -- The token is the capability. `for update` closes the race where two calls
  -- accept the same invitation concurrently.
  select i.id, i.group_id into v_id, v_gid
    from public.invitations i
   where i.token = p_token
     and i.accepted = false
     and i.expires_at > now()
   for update;

  -- One error for unknown, already-accepted and expired alike.
  if v_id is null then
    raise exception 'INVALID OR EXPIRED INVITATION' using errcode = '22023';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_gid, v_user, 'member')
  on conflict (group_id, user_id) do nothing;

  update public.invitations
     set accepted = true, accepted_at = now()
   where id = v_id;

  return v_gid;
end;
$$;

create or replace function public.get_dates_today_for_user(p_user_id text)
returns table(
  celebrant_id text,
  celebrant_username text,
  celebrant_display_name text,
  field_name text,
  celebration_date date,
  group_id uuid,
  group_name text,
  group_type public.group_type,
  notification_id uuid,
  banner_dismissed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    dn.celebrant_id,
    up.username as celebrant_username,
    up.display_name as celebrant_display_name,
    dn.field_name,
    dn.celebration_date,
    dn.group_id,
    g.name as group_name,
    g.type as group_type,
    dn.id as notification_id,
    dn.banner_dismissed
  from date_notifications dn
  inner join user_profiles up on dn.celebrant_id = up.id
  inner join groups g on dn.group_id = g.id
  where
    -- NOT `= p_user_id`. This is SECURITY DEFINER, so trusting the parameter
    -- would drive straight around the date_notifications SELECT policy and
    -- hand any caller any other user's celebrant names, dates and groups.
    -- p_user_id is kept only so the existing call sites still type-check;
    -- it is deliberately not used. Both callers
    -- (lib/actions/date-reminders.ts, app/api/test-reminders/route.ts) pass
    -- the signed-in user's own id, so pinning it changes nothing for them.
    dn.notified_user_id = (select public.requesting_user_id())
    and dn.notification_year = extract(year from current_date)::integer
    and dn.celebration_date = current_date
    and dn.banner_shown = true
    and dn.banner_dismissed = false
  order by dn.created_at desc;
end;
$$;

create or replace function public.get_upcoming_dates_for_notifications(
  days_ahead integer default 1,
  target_year integer default (extract(year from current_date))::integer
)
returns table(
  celebrant_id text,
  celebrant_username text,
  field_name text,
  field_value text,
  celebration_date date,
  group_id uuid,
  group_name text,
  group_type public.group_type,
  notified_user_id text,
  notified_user_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select distinct
    pi.user_id as celebrant_id,
    up.username as celebrant_username,
    pi.field_name,
    pi.field_value,
    (target_year || '-' || substring(pi.field_value from 6 for 5))::date as celebration_date,
    g.id as group_id,
    g.name as group_name,
    g.type as group_type,
    gm.user_id as notified_user_id,
    notified.email as notified_user_email
  from profile_info pi
  inner join user_profiles up on pi.user_id = up.id
  inner join group_members gm_celebrant on pi.user_id = gm_celebrant.user_id
  inner join groups g on gm_celebrant.group_id = g.id
  inner join group_members gm on g.id = gm.group_id and gm.user_id <> pi.user_id
  inner join user_profiles notified on gm.user_id = notified.id
  where
    pi.category = 'dates'
    and pi.field_name in ('birthday', 'anniversary')
    and pi.field_value is not null
    and pi.field_value <> ''
    and (target_year || '-' || substring(pi.field_value from 6 for 5))::date
      between current_date and (current_date + (days_ahead || ' days')::interval)::date
    and can_view_field(pi.user_id, gm.user_id, pi.privacy_settings)
    and not exists (
      select 1 from date_notifications dn
      where dn.celebrant_id = pi.user_id
        and dn.notified_user_id = gm.user_id
        and dn.field_name = pi.field_name
        and dn.notification_year = target_year
        and dn.group_id = g.id
    );
end;
$$;


-- =============================================================================
-- 7. Trigger functions and triggers
-- =============================================================================

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.update_date_notifications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.update_gift_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.update_group_gift_current_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_gifts
  set current_amount = (
    select coalesce(sum(contribution_amount), 0)
    from group_gift_members
    where group_gift_id = coalesce(new.group_gift_id, old.group_gift_id)
  )
  where id = coalesce(new.group_gift_id, old.group_gift_id);

  return coalesce(new, old);
end;
$$;

create or replace function public.add_group_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

-- Group-scoped privacy overrides must not outlive the group, or the
-- membership, they refer to.
create or replace function public.cleanup_privacy_overrides_on_group_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profile_info
  set privacy_settings = jsonb_set(
    privacy_settings,
    '{overrides}',
    coalesce((privacy_settings->'overrides') - old.id::text, '{}'::jsonb)
  )
  where privacy_settings->'overrides' ? old.id::text;

  update profile_info
  set privacy_settings = jsonb_set(privacy_settings, '{restrictToGroup}', 'null'::jsonb)
  where privacy_settings->>'restrictToGroup' = old.id::text;

  update wishlist_items
  set privacy_settings = jsonb_set(privacy_settings, '{restrictToGroup}', 'null'::jsonb)
  where privacy_settings->>'restrictToGroup' = old.id::text;

  return old;
end;
$$;

create or replace function public.cleanup_privacy_overrides_on_group_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profile_info
  set privacy_settings = jsonb_set(
    privacy_settings,
    '{overrides}',
    coalesce((privacy_settings->'overrides') - old.group_id::text, '{}'::jsonb)
  )
  where user_id = old.user_id
    and privacy_settings->'overrides' ? old.group_id::text;

  return old;
end;
$$;

-- COVERAGE NOTE: the RLS harness cannot assert that a write is DENIED -- a
-- denied write raises, which aborts the test block, and catching it would need
-- an exception handler, which the runner rejects outright. So the defences in
-- this section are covered by supabase/tests/rls/07_write_path_defences.sql
-- asserting that the OBJECTS still exist, not by executing the denied write.
-- Each attack was executed against the live database and refused; that is
-- recorded in the task report rather than in the suite.
--
-- Pins columns that a policy cannot. RLS has no access to the OLD row, so
-- "this column may not change" is inexpressible in a WITH CHECK. For most
-- tables the parent can still be constrained indirectly -- messages, for
-- instance, can require is_group_gift_member() on the NEW group_gift_id,
-- because that reads a DIFFERENT table. For a membership table it cannot: the
-- row being updated IS the membership row, so a self-referential check depends
-- on statement snapshot visibility. This trigger settles it deterministically.
create or replace function public.reject_parent_reassignment()
returns trigger
language plpgsql
as $$
declare
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if to_jsonb(old)->>v_col is distinct from to_jsonb(new)->>v_col then
      raise exception
        'IMMUTABLE COLUMN: %.% cannot be reassigned by update (% -> %)',
        tg_table_name, v_col, to_jsonb(old)->>v_col, to_jsonb(new)->>v_col
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

-- Repointing a group_gift_members row at another gift would grant SELECT on
-- that gift's chat through is_group_gift_member(); repointing a
-- gift_exchange_participants row would expose another exchange's roster and
-- its Secret Santa assignments.
create trigger pin_group_gift_member_parent
  before update on public.group_gift_members
  for each row execute function public.reject_parent_reassignment('group_gift_id', 'user_id');

create trigger pin_exchange_participant_parent
  before update on public.gift_exchange_participants
  for each row execute function public.reject_parent_reassignment('exchange_id', 'user_id');

-- date_notifications belongs in this list too, and was missed the first time.
-- Its UPDATE policy pins only notified_user_id, so celebrant_id and group_id
-- stayed rewritable on your own row -- and get_dates_today_for_user() is
-- SECURITY DEFINER and joins user_profiles and groups on exactly those
-- columns. Repointing them returned an arbitrary user's username and display
-- name, plus a private group's name and type, straight past both tables'
-- SELECT policies. The only legitimate update is banner dismissal
-- (lib/actions/date-reminders.ts), which touches none of these columns.
-- group_members.user_id was pinned nowhere. Its UPDATE policy checks
-- is_group_admin(group_id, me) on both sides, which stops the ROW being moved
-- to another group but not the row being pointed at another PERSON: an
-- owner/admin could rewrite user_id to an arbitrary Clerk id and conscript that
-- user into a group of the attacker's chosen type, then read everything the
-- victim shares with that type. No consent, no notification.
create trigger pin_group_member_subject
  before update on public.group_members
  for each row execute function public.reject_parent_reassignment('group_id', 'user_id');

-- invitations.group_id was rewritable after insert: the UPDATE policy is
-- `invited_by = me` on both sides and never re-checks is_group_member. On its
-- own that was latent. accept_group_invitation() made it a front door --
-- create a throwaway group, invite yourself into it, repoint group_id at a
-- victim group, redeem your own token. Precondition: know a group UUID, which
-- is in the URL. That path was opened by the very commit that closed the
-- self-grant, which is exactly why the pin belongs next to it.
create trigger pin_invitation_parent
  before update on public.invitations
  for each row execute function public.reject_parent_reassignment('group_id', 'invited_by');

create trigger pin_date_notification_subject
  before update on public.date_notifications
  for each row execute function public.reject_parent_reassignment(
    'celebrant_id', 'group_id', 'field_name', 'notification_year', 'celebration_date');

create trigger update_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.update_updated_at_column();

create trigger update_groups_updated_at
  before update on public.groups
  for each row execute function public.update_updated_at_column();

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.add_group_creator_as_owner();

create trigger cleanup_privacy_on_group_delete
  before delete on public.groups
  for each row execute function public.cleanup_privacy_overrides_on_group_delete();

create trigger cleanup_privacy_on_group_member_delete
  before delete on public.group_members
  for each row execute function public.cleanup_privacy_overrides_on_group_member_delete();

create trigger update_profile_info_updated_at
  before update on public.profile_info
  for each row execute function public.update_updated_at_column();

create trigger update_wishlist_items_updated_at
  before update on public.wishlist_items
  for each row execute function public.update_updated_at_column();

create trigger update_group_gifts_updated_at
  before update on public.group_gifts
  for each row execute function public.update_updated_at_column();

create trigger update_group_gift_amount_on_contribution
  after insert or delete or update on public.group_gift_members
  for each row execute function public.update_group_gift_current_amount();

create trigger update_messages_updated_at
  before update on public.messages
  for each row execute function public.update_updated_at_column();

create trigger update_gift_exchanges_updated_at
  before update on public.gift_exchanges
  for each row execute function public.update_updated_at_column();

create trigger update_date_notifications_updated_at_trigger
  before update on public.date_notifications
  for each row execute function public.update_date_notifications_updated_at();

create trigger update_gift_recipients_updated_at
  before update on public.gift_recipients
  for each row execute function public.update_updated_at_column();

create trigger update_tracked_gifts_updated_at
  before update on public.tracked_gifts
  for each row execute function public.update_updated_at_column();

create trigger update_tracked_gifts_status_changed_at
  before update on public.tracked_gifts
  for each row execute function public.update_gift_status_changed_at();


-- =============================================================================
-- 8. Row level security
--
-- Every table is deny-by-default. Policies are scoped `to authenticated`:
-- there is no unauthenticated read path in this application, and every
-- predicate additionally requires a matching Clerk subject, so an anonymous
-- caller is denied twice over.
-- =============================================================================

alter table public.user_profiles              enable row level security;
alter table public.groups                     enable row level security;
alter table public.group_members              enable row level security;
alter table public.invitations                enable row level security;
alter table public.profile_info               enable row level security;
alter table public.wishlist_items             enable row level security;
alter table public.group_gifts                enable row level security;
alter table public.group_gift_members         enable row level security;
alter table public.messages                   enable row level security;
alter table public.gift_exchanges             enable row level security;
alter table public.gift_exchange_participants enable row level security;
alter table public.date_notifications         enable row level security;
alter table public.gift_recipients            enable row level security;
alter table public.tracked_gifts              enable row level security;


-- -----------------------------------------------------------------------------
-- user_profiles
-- -----------------------------------------------------------------------------
create policy "Users can view their own profile"
  on public.user_profiles for select to authenticated
  using ((select public.requesting_user_id()) = id);

create policy "Users can view profiles of group members"
  on public.user_profiles for select to authenticated
  using (exists (
    select 1 from public.get_shared_groups((select public.requesting_user_id()), user_profiles.id)
  ));

create policy "Users can create their own profile"
  on public.user_profiles for insert to authenticated
  with check ((select public.requesting_user_id()) = id);

create policy "Users can update their own profile"
  on public.user_profiles for update to authenticated
  using ((select public.requesting_user_id()) = id)
  with check ((select public.requesting_user_id()) = id);

create policy "Users can delete their own profile"
  on public.user_profiles for delete to authenticated
  using ((select public.requesting_user_id()) = id);


-- -----------------------------------------------------------------------------
-- groups
--
-- No `USING (true)` here. Lookup by invite code goes through
-- find_group_by_invite_code().
-- -----------------------------------------------------------------------------
create policy "Users can view groups they are members of"
  on public.groups for select to authenticated
  using (public.is_group_member(id, (select public.requesting_user_id())));

create policy "Users can create groups"
  on public.groups for insert to authenticated
  with check ((select public.requesting_user_id()) = created_by);

create policy "Group owners and admins can update groups"
  on public.groups for update to authenticated
  using (public.is_group_admin(id, (select public.requesting_user_id())))
  with check (public.is_group_admin(id, (select public.requesting_user_id())));

create policy "Group owners can delete groups"
  on public.groups for delete to authenticated
  using (public.is_group_owner(id, (select public.requesting_user_id())));


-- -----------------------------------------------------------------------------
-- group_members
--
-- Every predicate that needs to know about membership goes through a
-- SECURITY DEFINER helper. Reading group_members from inside a group_members
-- policy is the recursion this schema kept hitting.
-- -----------------------------------------------------------------------------
create policy "Users can view members of their groups"
  on public.group_members for select to authenticated
  using (
    user_id = (select public.requesting_user_id())
    or public.is_group_member(group_id, (select public.requesting_user_id()))
  );

-- THERE IS DELIBERATELY NO INSERT POLICY ON group_members.
--
-- The archived policy was `with check (requesting_user_id() = user_id)`, i.e.
-- "you may add yourself" -- and nothing else. No invitation, no code, no
-- relationship to the group. The archive's own migration
-- (20250203000000_fix_group_members_insert_rls.sql) admitted this in a comment:
-- "The actual authorization ... is handled in the application layer before the
-- insert." That is not a boundary. The anon key ships to every browser, so a
-- caller reaches PostgREST directly and skips whatever the server action
-- checked. The group id is not a secret either -- it is in the URL.
--
-- COUNT CAREFULLY. Membership is created by three things, but only because two
-- further MUTATION paths are pinned shut. Without those pins the list is five:
-- rewriting group_members.user_id to conscript a stranger, and repointing an
-- invitation's group_id before redeeming your own token. Both are closed by the
-- pin_group_member_subject and pin_invitation_parent triggers in section 7
-- ABOVE this one, and 07_write_path_defences.sql fails if either goes away.
--
-- WHAT REMOVAL ACHIEVES, AND WHERE IT IS ENFORCED. Removing a member is
-- enforceable against the TOKEN path BY THIS SCHEMA: they cannot self-insert,
-- their pending invitations can be revoked by any group admin, and the
-- invitations UPDATE policy below re-checks membership, so they cannot
-- resurrect a spent invitation they once sent.
--
-- The INVITE CODE path is NOT closed here, and cannot be. A removed member
-- still knows the group's invite_code and could hand it to
-- join_group_with_code() to walk back in. Closing that needs the code to be
-- ROTATED on removal, which is an application change rather than a policy one:
-- no `with check` can express "and destroy the credential the departing member
-- memorised", while admins can already write groups.invite_code.
--
-- That rotation now exists, in leaveGroup() in lib/actions/groups.ts, which
-- rotates BEFORE it deletes the membership row so a failed rotation aborts the
-- removal rather than silently leaving a removed member holding a live key.
-- Nothing in this file enforces that ordering -- if that function ever stops
-- rotating, removal quietly stops removing again, and this schema will not
-- notice.
--
-- The consequences were not subtle: anyone holding a group id could join, and
-- then read the roster, every member's profile, their private wishlist items
-- and profile fields, and the group's exchanges. A REMOVED MEMBER COULD SIMPLY
-- REJOIN, which made removal unenforceable. And because is_group_member() is
-- the predicate under most of this schema, a self-grantable membership is a
-- self-grantable key to nearly all of it.
--
-- RLS cannot fix this: a policy cannot take a parameter, so no `with check`
-- can ever verify "the caller presented a valid invite code or token". So the
-- decision moves server-side. Membership is created by exactly three things:
--
--   * add_group_creator_as_owner()  -- the trigger, on group creation
--   * join_group_with_code(text)    -- proves possession of the invite code
--   * accept_group_invitation(text) -- proves possession of the token
--
-- All three are SECURITY DEFINER and so are unaffected by the absence of an
-- INSERT policy. Everything else is denied.
--
-- NOTE FOR THE APPLICATION TASKS: lib/actions/invitations.ts inserts into
-- group_members directly in two places (acceptInvitation, joinGroupByCode).
-- Both now fail and must call the functions above instead.

create policy "Owners and admins can update member roles"
  on public.group_members for update to authenticated
  using (public.is_group_admin(group_id, (select public.requesting_user_id())))
  with check (public.is_group_admin(group_id, (select public.requesting_user_id())));

create policy "Members can remove themselves, owners and admins can remove others"
  on public.group_members for delete to authenticated
  using (
    user_id = (select public.requesting_user_id())
    or public.is_group_admin(group_id, (select public.requesting_user_id()))
  );


-- -----------------------------------------------------------------------------
-- invitations
-- -----------------------------------------------------------------------------
create policy "Group members can view group invitations"
  on public.invitations for select to authenticated
  using (public.is_group_member(group_id, (select public.requesting_user_id())));

create policy "Users can view invitations they sent"
  on public.invitations for select to authenticated
  using (invited_by = (select public.requesting_user_id()));

-- user_profiles.email is plain text, not unique, and the user writes it. The
-- two policies that used to live here treated it as an identity claim: set your
-- profile email to a victim's address and you could read their invitation
-- (group, token, sender) and accept it in their place. Acceptance now goes
-- through accept_group_invitation(token), so the invitee never needs to SELECT
-- the row, and the class is removed rather than patched.
--
-- invited_by is pinned, matching groups.created_by, gift_exchanges.created_by
-- and group_gifts.created_by. Without it an ordinary member could forge an
-- invitation attributed to the group owner.
create policy "Group members can create invitations"
  on public.invitations for insert to authenticated
  with check (
    public.is_group_member(group_id, (select public.requesting_user_id()))
    and invited_by = (select public.requesting_user_id())
    and expires_at > now()
    and expires_at <= now() + interval '30 days'
  );

-- Membership is re-checked on BOTH sides, not just `invited_by = me`.
--
-- Without it, a removed member kept write control over every invitation they
-- ever sent, including SPENT ones: un-accept a used invitation, roll
-- expires_at forward, re-token it, and redeem it -- or hand the fresh token to
-- a stranger. The owner's obvious remedy, deleting the PENDING invitations,
-- removes nothing, because the dangerous row is an accepted one. Revocation
-- would have meant deleting every invitation that member ever sent, spent ones
-- included, which no sane UI offers.
--
-- accepted/accepted_at are not pinned by a trigger because they legitimately
-- change -- accept_group_invitation() writes them. That function is SECURITY
-- DEFINER, so it is unaffected by this policy.
--
-- The cap is repeated here on UPDATE, not only on INSERT, because an
-- insert-only cap is not a cap: the sender could otherwise extend the row
-- afterwards. Note precisely what it buys -- it bounds a SINGLE expiry at 30
-- days, not the lifetime of an invitation. A sender who is still a member can
-- roll it forward to now() + 29 days as often as they like and keep a row
-- alive forever. Treat it as a 30-day notice window, not a 30-day lifetime.
-- The application uses 7 days (getInviteExpiration).
create policy "Invitation senders can update their invitations"
  on public.invitations for update to authenticated
  using (
    invited_by = (select public.requesting_user_id())
    and public.is_group_member(group_id, (select public.requesting_user_id()))
  )
  with check (
    invited_by = (select public.requesting_user_id())
    and public.is_group_member(group_id, (select public.requesting_user_id()))
    and expires_at <= now() + interval '30 days'
  );

-- Group admins can revoke, not just the sender. Otherwise a member plants an
-- invitation, is removed, and the owner can SEE the planted row but neither
-- delete nor expire it -- both policies keyed on invited_by -- so the removed
-- member replays their own token and is back in. Rotating the invite code does
-- not help; the token path is separate.
create policy "Invitation senders and group admins can delete invitations"
  on public.invitations for delete to authenticated
  using (
    invited_by = (select public.requesting_user_id())
    or public.is_group_admin(group_id, (select public.requesting_user_id()))
  );


-- -----------------------------------------------------------------------------
-- profile_info -- guarded by can_view_field
-- -----------------------------------------------------------------------------
create policy "Users can view their own profile info"
  on public.profile_info for select to authenticated
  using ((select public.requesting_user_id()) = user_id);

create policy "Users can view profile info based on privacy settings"
  on public.profile_info for select to authenticated
  using (
    (select public.requesting_user_id()) is not null
    and public.can_view_field(user_id, (select public.requesting_user_id()), privacy_settings)
  );

create policy "Users can create their own profile info"
  on public.profile_info for insert to authenticated
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can update their own profile info"
  on public.profile_info for update to authenticated
  using ((select public.requesting_user_id()) = user_id)
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can delete their own profile info"
  on public.profile_info for delete to authenticated
  using ((select public.requesting_user_id()) = user_id);


-- -----------------------------------------------------------------------------
-- wishlist_items -- guarded by can_view_wishlist_item
-- -----------------------------------------------------------------------------
create policy "Users can view their own wishlist items"
  on public.wishlist_items for select to authenticated
  using ((select public.requesting_user_id()) = user_id);

create policy "Users can view wishlist items based on privacy"
  on public.wishlist_items for select to authenticated
  using (
    (select public.requesting_user_id()) is not null
    and (select public.requesting_user_id()) <> user_id
    and public.can_view_wishlist_item(user_id, (select public.requesting_user_id()), privacy_settings)
  );

create policy "Users can create their own wishlist items"
  on public.wishlist_items for insert to authenticated
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can update their own wishlist items"
  on public.wishlist_items for update to authenticated
  using ((select public.requesting_user_id()) = user_id)
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can claim visible wishlist items"
  on public.wishlist_items for update to authenticated
  using (
    (select public.requesting_user_id()) is not null
    and (select public.requesting_user_id()) <> user_id
    and public.can_view_wishlist_item(user_id, (select public.requesting_user_id()), privacy_settings)
  )
  -- Without this the claimer could rewrite user_id to themselves (stealing the
  -- item) or loosen privacy_settings, since Postgres reuses USING as the check
  -- and neither column would be constrained on the new row.
  with check (
    (select public.requesting_user_id()) is not null
    and (select public.requesting_user_id()) <> user_id
    and public.can_view_wishlist_item(user_id, (select public.requesting_user_id()), privacy_settings)
  );

create policy "Users can delete their own wishlist items"
  on public.wishlist_items for delete to authenticated
  using ((select public.requesting_user_id()) = user_id);


-- -----------------------------------------------------------------------------
-- group_gifts
--
-- Deliberately unchanged in scope from the archive: only the creator reads
-- the group gift row itself. A group gift is frequently a surprise FOR
-- someone in the same group, so widening this is a privacy decision, not a
-- translation, and is out of scope here.
-- -----------------------------------------------------------------------------
create policy "group_gifts_select"
  on public.group_gifts for select to authenticated
  using (created_by = (select public.requesting_user_id()));

create policy "group_gifts_insert"
  on public.group_gifts for insert to authenticated
  with check (
    created_by = (select public.requesting_user_id())
    and public.is_group_member(group_id, (select public.requesting_user_id()))
  );

create policy "group_gifts_update"
  on public.group_gifts for update to authenticated
  using (created_by = (select public.requesting_user_id()))
  with check (
    created_by = (select public.requesting_user_id())
    and public.is_group_member(group_id, (select public.requesting_user_id()))
  );

create policy "group_gifts_delete"
  on public.group_gifts for delete to authenticated
  using (created_by = (select public.requesting_user_id()));


-- -----------------------------------------------------------------------------
-- group_gift_members
-- -----------------------------------------------------------------------------
create policy "group_gift_members_select"
  on public.group_gift_members for select to authenticated
  using (
    user_id = (select public.requesting_user_id())
    or exists (
      select 1 from public.group_gifts gg
      where gg.id = group_gift_members.group_gift_id
        and gg.created_by = (select public.requesting_user_id())
    )
    or public.is_group_gift_member(group_gift_id, (select public.requesting_user_id()))
  );

create policy "group_gift_members_insert"
  on public.group_gift_members for insert to authenticated
  with check (exists (
    select 1 from public.group_gifts gg
    where gg.id = group_gift_members.group_gift_id
      and gg.created_by = (select public.requesting_user_id())
  ));

create policy "group_gift_members_update"
  on public.group_gift_members for update to authenticated
  using (user_id = (select public.requesting_user_id()))
  with check (user_id = (select public.requesting_user_id()));

create policy "group_gift_members_delete"
  on public.group_gift_members for delete to authenticated
  using (user_id = (select public.requesting_user_id()));


-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
create policy "Users can view messages in their gift groups"
  on public.messages for select to authenticated
  using (public.is_group_gift_member(group_gift_id, (select public.requesting_user_id())));

create policy "Users can send messages to their gift groups"
  on public.messages for insert to authenticated
  with check (
    (select public.requesting_user_id()) = user_id
    and public.is_group_gift_member(group_gift_id, (select public.requesting_user_id()))
  );

create policy "Users can update their own messages"
  on public.messages for update to authenticated
  using ((select public.requesting_user_id()) = user_id)
  with check (
    (select public.requesting_user_id()) = user_id
    and public.is_group_gift_member(group_gift_id, (select public.requesting_user_id()))
  );

create policy "Users can delete their own messages"
  on public.messages for delete to authenticated
  using ((select public.requesting_user_id()) = user_id);


-- -----------------------------------------------------------------------------
-- gift_exchanges
-- -----------------------------------------------------------------------------
create policy "Users can view gift exchanges in their groups"
  on public.gift_exchanges for select to authenticated
  using (public.is_group_member(group_id, (select public.requesting_user_id())));

create policy "Users can create gift exchanges in their groups"
  on public.gift_exchanges for insert to authenticated
  with check (
    (select public.requesting_user_id()) = created_by
    and public.is_group_member(group_id, (select public.requesting_user_id()))
  );

create policy "Creators can update gift exchanges"
  on public.gift_exchanges for update to authenticated
  using ((select public.requesting_user_id()) = created_by)
  with check (
    (select public.requesting_user_id()) = created_by
    and public.is_group_member(group_id, (select public.requesting_user_id()))
  );

create policy "Creators can delete gift exchanges"
  on public.gift_exchanges for delete to authenticated
  using ((select public.requesting_user_id()) = created_by);


-- -----------------------------------------------------------------------------
-- gift_exchange_participants
--
-- The archived SELECT policy queried gift_exchange_participants from inside
-- its own policy. Same recursion class as group_members; same fix.
-- -----------------------------------------------------------------------------
create policy "Participants can view exchange participants"
  on public.gift_exchange_participants for select to authenticated
  using (public.is_exchange_participant(exchange_id, (select public.requesting_user_id())));

-- The group-membership requirement is not decoration. Without it, holding an
-- exchange UUID is enough to insert yourself as a participant, and the
-- participant SELECT policy then hands over the whole roster INCLUDING the
-- Secret Santa assignments -- in an app whose entire purpose is keeping those
-- secret. group_gifts_insert above has always carried the equivalent check;
-- this policy was missing it.
--
-- The check is on the CALLER, not on the row's user_id, and it has to be:
-- is_group_member() is pinned to requesting_user_id(), so asking it about
-- somebody else always returns false. Checking the caller is also what keeps
-- exchange creation working, where the creator inserts a participant row for
-- every member of the group at once.
create policy "Users can join gift exchanges"
  on public.gift_exchange_participants for insert to authenticated
  with check (
    (
      user_id = (select public.requesting_user_id())
      or exists (
        select 1 from public.gift_exchanges ge
        where ge.id = gift_exchange_participants.exchange_id
          and ge.created_by = (select public.requesting_user_id())
      )
    )
    and public.is_group_member(
      (select ge.group_id from public.gift_exchanges ge
        where ge.id = gift_exchange_participants.exchange_id),
      (select public.requesting_user_id()))
  );

create policy "Users can update their own participation"
  on public.gift_exchange_participants for update to authenticated
  using ((select public.requesting_user_id()) = user_id)
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can leave gift exchanges"
  on public.gift_exchange_participants for delete to authenticated
  using ((select public.requesting_user_id()) = user_id);

create policy "Creators can remove participants"
  on public.gift_exchange_participants for delete to authenticated
  using (exists (
    select 1 from public.gift_exchanges ge
    where ge.id = gift_exchange_participants.exchange_id
      and ge.created_by = (select public.requesting_user_id())
  ));


-- -----------------------------------------------------------------------------
-- date_notifications
--
-- Rows are written by the reminder job, which runs with the service role and
-- bypasses RLS. There is deliberately no INSERT policy for `authenticated`:
-- the archived one was `WITH CHECK (true)`, which let any signed-in user
-- fabricate a notification naming any other user as the celebrant.
-- -----------------------------------------------------------------------------
create policy "Users can view their own notifications"
  on public.date_notifications for select to authenticated
  using ((select public.requesting_user_id()) = notified_user_id);

create policy "Users can update their own notifications"
  on public.date_notifications for update to authenticated
  using ((select public.requesting_user_id()) = notified_user_id)
  with check ((select public.requesting_user_id()) = notified_user_id);


-- -----------------------------------------------------------------------------
-- gift_recipients and tracked_gifts -- strictly private to their owner
-- -----------------------------------------------------------------------------
create policy "Users can view their own recipients"
  on public.gift_recipients for select to authenticated
  using ((select public.requesting_user_id()) = user_id);

create policy "Users can create their own recipients"
  on public.gift_recipients for insert to authenticated
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can update their own recipients"
  on public.gift_recipients for update to authenticated
  using ((select public.requesting_user_id()) = user_id)
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can delete their own recipients"
  on public.gift_recipients for delete to authenticated
  using ((select public.requesting_user_id()) = user_id);

create policy "Users can view their own tracked gifts"
  on public.tracked_gifts for select to authenticated
  using ((select public.requesting_user_id()) = user_id);

create policy "Users can create their own tracked gifts"
  on public.tracked_gifts for insert to authenticated
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can update their own tracked gifts"
  on public.tracked_gifts for update to authenticated
  using ((select public.requesting_user_id()) = user_id)
  with check ((select public.requesting_user_id()) = user_id);

create policy "Users can delete their own tracked gifts"
  on public.tracked_gifts for delete to authenticated
  using ((select public.requesting_user_id()) = user_id);


-- =============================================================================
-- 9. Grants
--
-- "RLS decides which rows come back, not the grant" is true for TABLES and
-- FALSE for SECURITY DEFINER FUNCTIONS: those run as their owner with RLS
-- suspended, so for them the EXECUTE grant IS the entire access control. This
-- baseline introduces eleven such functions, so every grant below is explicit
-- and per-object, and `anon` receives nothing at all.
--
-- Two defaults have to be actively undone, or a blanket grant hides them:
--
--   * PostgreSQL grants EXECUTE on every new function to PUBLIC. It shows in
--     the ACL as a leading `=X/postgres` and is NOT removed by
--     `revoke ... from anon`, so PUBLIC must be named explicitly.
--   * Supabase's default privileges grant ALL on new public tables to anon and
--     authenticated -- TRUNCATE included. Both are revoked and re-granted
--     narrowly.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- Tables. `authenticated` gets the four DML verbs and nothing else; anon gets
-- nothing. anon has no unauthenticated read path in this application, and a
-- future policy written without an explicit `TO` clause defaults to PUBLIC --
-- which would silently become an anonymous read if the grant were sitting
-- there waiting for it.
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Functions. Strip the automatic PUBLIC grant first, then hand back only what
-- is demonstrably needed.
revoke execute on all functions in schema public
  from public, anon, authenticated, service_role;

-- (a) Policy helpers. RLS policy expressions are evaluated with the privileges
--     of the QUERYING role, so `authenticated` must be able to execute every
--     function any policy calls. Verified: with EXECUTE on
--     requesting_user_id() revoked, an ordinary authenticated SELECT fails
--     with `42501: permission denied for function requesting_user_id`.
--     None of these goes to anon.
grant execute on function public.requesting_user_id() to authenticated, service_role;
grant execute on function public.is_group_member(uuid, text) to authenticated, service_role;
grant execute on function public.is_group_admin(uuid, text) to authenticated, service_role;
grant execute on function public.is_group_owner(uuid, text) to authenticated, service_role;
grant execute on function public.is_group_gift_member(uuid, text) to authenticated, service_role;
grant execute on function public.is_exchange_participant(uuid, text) to authenticated, service_role;
grant execute on function public.can_view_field(text, text, jsonb) to authenticated, service_role;
grant execute on function public.can_view_wishlist_item(text, text, jsonb) to authenticated, service_role;

-- (b) Called directly by the application over PostgREST /rest/v1/rpc/. Each one
--     pins its subject to requesting_user_id() internally; see their bodies.
grant execute on function public.get_shared_groups(text, text) to authenticated, service_role;
grant execute on function public.get_dates_today_for_user(text) to authenticated, service_role;
grant execute on function public.find_group_by_invite_code(text) to authenticated, service_role;
-- The only two writers of group_members besides the creation trigger. They add
-- the CALLER and nobody else, and each requires a secret the caller must
-- already hold.
grant execute on function public.join_group_with_code(text) to authenticated, service_role;
grant execute on function public.accept_group_invitation(text) to authenticated, service_role;

-- (c) The reminder job, and nothing else. This function returns every user's
--     email address, birthdate, username, group names and Clerk id in a single
--     call, and it has no caller filter at all -- its only two arguments are a
--     day window and a year. NEXT_PUBLIC_SUPABASE_ANON_KEY ships to every
--     browser and PostgREST exposes public functions at /rest/v1/rpc/, so an
--     EXECUTE grant to anon here is an unauthenticated dump of the user table.
--     The archive granted it TO service_role only; so does this.
--     lib/actions/date-reminders.ts reaches it through createAdminClient().
grant execute on function public.get_upcoming_dates_for_notifications(integer, integer)
  to service_role;

-- (d) is_service_context() is granted to nobody. It is only ever called from
--     inside SECURITY DEFINER bodies, where the effective user is the owner,
--     so it needs no grant -- and not granting it keeps one more definer
--     function off /rest/v1/rpc/.
--
-- (e) Trigger functions are granted to nobody, deliberately. PostgreSQL checks
--     EXECUTE on a trigger function when the trigger is CREATED, not when it
--     fires. Verified: with EXECUTE revoked from authenticated, an
--     authenticated INSERT firing add_group_creator_as_owner() and an UPDATE
--     firing update_updated_at_column() both still succeed.


-- ---------------------------------------------------------------------------
-- Default privileges, so the next migration does not undo all of the above.
--
-- Everything above is one-shot: it fixes the objects that exist right now.
-- Supabase ships default privileges that grant ALL on every FUTURE table in
-- this schema to anon -- select, insert, update, delete AND truncate -- and
-- EXECUTE on every future function. PostgreSQL adds its own EXECUTE-to-PUBLIC
-- on top. So without this block, the very next migration's table arrives
-- anon-readable, anon-writable and anon-truncatable, reopening the exact class
-- of hole this section exists to close.
--
-- Note these apply to objects created by THIS role (postgres), which is how
-- migrations run. A parallel set of defaults owned by supabase_admin also
-- exists and is out of reach here (postgres is not a member of supabase_admin);
-- that path is Supabase's own tooling, not this application's migrations.
--
-- NOT fixed by this block, and worth knowing: a new table still arrives with
-- RLS DISABLED, and no grant can express otherwise. An event trigger could,
-- and this role CAN create one -- postgres is a member of
-- supabase_privileged_role here (verified: `create event trigger` succeeds,
-- even though postgres is not a superuser). One is deliberately NOT created: a
-- faulty event trigger on ddl_command_end blocks ALL DDL, including the
-- migration that would remove it, which is a worse failure than the one it
-- prevents. Every table in this baseline enables RLS explicitly, any future
-- migration must do the same, and 06_anon_has_no_reach.sql fails the suite if
-- one ever does not.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- PostgreSQL's own EXECUTE-to-PUBLIC default -- the one that is invisible until
-- you look at an ACL and see a leading `=X`.
--
-- THE SCOPE MATTERS, and it is the opposite of what you would guess. The
-- `IN SCHEMA public` form CANNOT remove this: PostgreSQL merges the GLOBAL
-- default-ACL slot with the per-schema one, and when the global slot is empty
-- the hardwired `{=X/owner}` stands in for it -- so a per-schema entry can only
-- ever ADD to `=X/PUBLIC`, never subtract from it. The database-wide form,
-- below, writes the global slot and does work. Verified in a rolled-back
-- transaction on this database:
--
--   before:  =X/postgres , postgres=X , authenticated=X , service_role=X   anon=true
--   after:             postgres=X , authenticated=X , service_role=X       anon=false
--   also after: a PROCEDURE -> anon=false; a function in a brand new schema
--               -> anon=false; authenticated still executes public functions.
--
-- anon is a member of PUBLIC, so without this a function added by a FUTURE
-- migration would be anon-executable -- exactly the shape of the hole that
-- made get_upcoming_dates_for_notifications an unauthenticated dump of the
-- user table.
--
-- CAVEAT: being database-wide, this applies to every schema for objects
-- created by THIS role. A future `create extension ... schema x` run as
-- postgres would also get its functions without PUBLIC execute, which may then
-- need an explicit grant. `authenticated` and `service_role` are unaffected in
-- `public` -- they hold their EXECUTE through the per-schema default above.
alter default privileges revoke execute on functions from public;

-- Kept as well. It is a no-op for PUBLIC (see above), but it is the statement
-- that carries the per-schema intent, and it is harmless.
alter default privileges in schema public revoke execute on functions from public;

-- Match what section 9 grants existing tables: DML only, no TRUNCATE.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;


-- =============================================================================
-- 10. Realtime
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;


-- =============================================================================
-- 11. Storage buckets
--
-- Both buckets are public-read; writes are confined to a folder named for the
-- uploader's Clerk user id.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wishlist-images', 'wishlist-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gift-photos', 'gift-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

-- storage.objects survives a public-schema reset, so these are dropped first.
drop policy if exists "Users can upload wishlist images" on storage.objects;
drop policy if exists "Users can update own wishlist images" on storage.objects;
drop policy if exists "Users can delete own wishlist images" on storage.objects;
drop policy if exists "Public read access for wishlist images" on storage.objects;
drop policy if exists "Users can upload gift photos" on storage.objects;
drop policy if exists "Users can update own gift photos" on storage.objects;
drop policy if exists "Users can delete own gift photos" on storage.objects;
drop policy if exists "Public read access for gift photos" on storage.objects;

create policy "Users can upload wishlist images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'wishlist-images'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy "Users can update own wishlist images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'wishlist-images'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  )
  with check (
    bucket_id = 'wishlist-images'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy "Users can delete own wishlist images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'wishlist-images'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy "Public read access for wishlist images"
  on storage.objects for select to public
  using (bucket_id = 'wishlist-images');

create policy "Users can upload gift photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'gift-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy "Users can update own gift photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'gift-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  )
  with check (
    bucket_id = 'gift-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy "Users can delete own gift photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'gift-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy "Public read access for gift photos"
  on storage.objects for select to public
  using (bucket_id = 'gift-photos');
