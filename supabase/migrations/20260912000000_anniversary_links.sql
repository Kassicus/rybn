-- =============================================================================
-- rybn: a confirmed pair of people who share one anniversary
-- =============================================================================
--
-- Stored CANONICALLY -- user_a is always the lexicographically smaller id --
-- and that is a CHECK rather than a convention, because canonicalisation is
-- what lets occasions_celebrant_identity (kind, celebrant_id, occasion_year)
-- keep working unchanged for a couple. A pair stored either way round would
-- produce two occasion rows for one event, which is the entire defect this
-- feature exists to remove.
create table public.anniversary_links (
  id uuid primary key default gen_random_uuid(),
  user_a text not null references public.user_profiles(id) on delete cascade,
  user_b text not null references public.user_profiles(id) on delete cascade,
  status text not null default 'pending',
  initiated_by text not null references public.user_profiles(id) on delete cascade,
  -- Captured when the request is made, so the confirmation prompt can name the
  -- date and accepting can apply it. Deliberately a snapshot: if the initiator
  -- edits their own anniversary before the partner confirms, both still end up
  -- agreeing with each other -- on the date the prompt actually showed.
  agreed_date text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint anniversary_links_canonical check (user_a < user_b),
  constraint anniversary_links_status check (status in ('pending', 'confirmed')),
  constraint anniversary_links_distinct check (user_a <> user_b)
);

comment on table public.anniversary_links is
  'A pair of people who share one anniversary. user_a is always the lexicographically smaller id; occasions for the pair materialize under user_a.';

create unique index anniversary_links_pair
  on public.anniversary_links (user_a, user_b);

-- CORRECTED (20260912000001): this pair of indexes covers the SAME-side case
-- only -- a second CONFIRMED row naming the same person as user_a (or,
-- separately, as user_b) is rejected here, and gives a clear error at the
-- point of insert. It does NOT, on its own, enforce "one confirmed link per
-- person, from either side": two single-column partial indexes cannot see
-- across columns, so a person confirmed as user_b in one link and as user_a
-- in another satisfies both indexes simultaneously and ends up in two
-- confirmed links at once. That either-side invariant is enforced instead by
-- anniversary_link_members's primary key, added in 20260912000001.
create unique index anniversary_links_one_confirmed_a
  on public.anniversary_links (user_a) where status = 'confirmed';
create unique index anniversary_links_one_confirmed_b
  on public.anniversary_links (user_b) where status = 'confirmed';

alter table public.anniversary_links enable row level security;

-- Readable only by its two participants. Nobody else needs to read it
-- directly: get_upcoming_occasions is SECURITY DEFINER and resolves links on
-- the caller's behalf, so a third party learns a couple is linked only through
-- an occasion they were already entitled to see.
create policy "Participants can see their own anniversary links"
  on public.anniversary_links for select to authenticated
  using (
    user_a = (select public.requesting_user_id())
    or user_b = (select public.requesting_user_id())
  );

-- Writes go through the SECURITY DEFINER RPCs in 20260912000002. No INSERT,
-- UPDATE or DELETE policy exists, deliberately: a direct write could not
-- enforce canonical ordering, the shared-group requirement, or the date sync,
-- so it would fail confusingly rather than safely.
grant select on public.anniversary_links to authenticated;
grant select, insert, update, delete on public.anniversary_links to service_role;

-- Supabase's per-role default privileges grant `authenticated` every DML verb
-- on any NEW table in public regardless of the grant line above -- verified in
-- phase 3, where pg_default_acl showed `authenticated=arwdm`. Without this the
-- privilege assertions in 18_anniversary_links.sql would be testing something
-- already false.
revoke insert, update, delete on public.anniversary_links from authenticated;
