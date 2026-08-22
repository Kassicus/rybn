-- =============================================================================
-- rybn: rate-limit ledger for the link-preview fetcher
-- =============================================================================
--
-- Rate-limit ledger for the link-preview fetcher.
--
-- Even with SSRF closed, an authenticated user can aim the fetcher at arbitrary
-- public hosts and use rybn as a scanner. This bounds that.
--
-- RLS is enabled with NO policies, so anon and authenticated can do nothing at
-- all. Only the service role touches it, and only from the server action. It
-- holds no user content -- an id and a timestamp -- so there is nothing here
-- for a user to legitimately read.
create table public.link_fetch_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.user_profiles(id) on delete cascade,
  fetched_at timestamptz not null default now()
);

create index idx_link_fetch_log_user_time on public.link_fetch_log (user_id, fetched_at desc);

alter table public.link_fetch_log enable row level security;

-- The baseline's default privileges already revoke everything on future tables
-- from anon, but NOT from authenticated -- that role keeps the DML verbs
-- Supabase's default ACL hands out. Stated explicitly for both, because "it
-- was already revoked" is a fact about another file that this table's safety
-- should not depend on.
revoke all on public.link_fetch_log from anon, authenticated;
