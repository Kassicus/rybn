-- =============================================================================
-- rybn: structural enforcement of "one CONFIRMED anniversary link per person"
-- =============================================================================
--
-- CORRECTIVE MIGRATION. 20260912000000_anniversary_links.sql shipped a header
-- comment claiming its two partial unique indexes
-- (anniversary_links_one_confirmed_a / _b) enforce one confirmed link per
-- person "from either side". They do not: each index watches a single
-- column, so a person confirmed as user_b in one link and as user_a in a
-- different link satisfies both indexes at once and ends up holding two
-- simultaneous confirmed links. The same-side case (two confirmed rows both
-- naming the same person as user_a, or both as user_b) IS caught -- that part
-- of the original comment was accurate and those two indexes are kept
-- unchanged for it, and for the clearer error they give at the point of
-- insert.
--
-- One confirmed link per person, enforced by a PRIMARY KEY rather than by two
-- partial indexes that can only see one column each. A person appears here at
-- most once, so a second confirmed link for them is impossible no matter which
-- side of the pair they are on -- including for service_role and for any
-- future backfill, which an application-level check would not cover.
--
-- A trigger would express the same rule but not race-free: under READ
-- COMMITTED two concurrent confirms would not see each other's uncommitted
-- row. A primary key has no such window.
--
-- This task does not populate the table. Task 3's confirm RPC inserts two
-- rows here (one per partner) when a link's status moves to 'confirmed', and
-- the FK's `on delete cascade` clears both when the link itself is deleted
-- (unlink). The schema is shipped now so that RPC has something correct to
-- write into.
create table public.anniversary_link_members (
  user_id text primary key references public.user_profiles(id) on delete cascade,
  link_id  uuid not null references public.anniversary_links(id) on delete cascade
);

comment on table public.anniversary_link_members is
  'Membership side table for anniversary_links: one row per person currently in a CONFIRMED link. The primary key on user_id is what actually enforces "at most one confirmed link per person, either side" -- anniversary_links'' own partial unique indexes only cover the same-side case.';

alter table public.anniversary_link_members enable row level security;

create policy "Participants can see their own confirmed membership"
  on public.anniversary_link_members for select to authenticated
  using (user_id = (select public.requesting_user_id()));

-- Writes go through the same SECURITY DEFINER confirm/unlink RPCs that write
-- anniversary_links itself. No INSERT, UPDATE or DELETE policy exists,
-- deliberately, for the same reason as anniversary_links: a direct write here
-- could not keep this table in sync with anniversary_links.status.
grant select on public.anniversary_link_members to authenticated;
grant select, insert, update, delete on public.anniversary_link_members to service_role;

-- Supabase's per-role default privileges grant `authenticated` every DML verb
-- on any NEW table in public regardless of the grant line above -- verified in
-- phase 3 (pg_default_acl showed `authenticated=arwdm`) and again for
-- anniversary_links in this same task. Without this the privilege assertions
-- in 18_anniversary_links.sql would be testing something already false.
revoke insert, update, delete on public.anniversary_link_members from authenticated;
