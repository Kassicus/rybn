-- =============================================================================
-- rybn: get_or_create_occasion() -- upsert and RETURN, don't insert-then-read
-- =============================================================================
--
-- 20260911000000_get_or_create_occasion.sql shipped `on conflict ... do
-- nothing` followed by a separate SELECT to read the row back, because
-- RETURNING produces no row on a do-nothing conflict. Review found two
-- problems with that shape:
--
--   - If the readback found nothing, v_id stayed NULL and the function
--     silently returned a NULL occasion id -- which a phase 3 tag would then
--     insert as its foreign key. Under READ COMMITTED (Postgres' default,
--     and what this project runs) an INSERT that hits a live unique-index
--     conflict always sees the already-committed conflicting row, so this
--     could not currently happen here -- but the readback runs as its own,
--     separately-snapshotted SELECT, and a stricter isolation level could
--     show it a row that committed after that snapshot was taken. RETURNING
--     attaches directly to the INSERT/UPDATE command itself, so this class
--     of gap does not exist for it.
--   - `do nothing` never refreshes a stale occasion_date: a caller who edits
--     their birthday to a different day in the same year keeps the
--     originally-materialized date forever, silently drifting from what
--     get_upcoming_occasions() derives for that same person going forward.
--
-- Fix: `do update set occasion_date = excluded.occasion_date` instead of `do
-- nothing`, with `returning id into v_id` directly on the insert. This closes
-- both problems with one change -- RETURNING now fires on every path (a
-- fresh insert, or an update to the caller's own existing row for this
-- kind/year, matched by occasions_celebrant_identity's own columns), so the
-- separate readback -- and the snapshot race it carried -- is gone entirely.
-- A `v_id is null` check remains as a backstop: it should be unreachable now
-- that RETURNING always produces a row on this path, but an unreachable
-- check costs nothing and a reachable one would mean this analysis was
-- wrong.
--
-- Ships as its own migration rather than editing 20260911000000 in place:
-- that migration already reached production, and a migration is the
-- historical record of what actually ran (same ruling documented in
-- 20260910100003_celebration_date_total.sql).
--
-- CORRECTION to 20260911000000's header: it described this function as
-- "idempotent under concurrency" via occasions_celebrant_identity. What is
-- actually demonstrated -- 13_occasion_materialization.sql's assertion 2 --
-- is SEQUENTIAL idempotency: two calls made one after another, in the same
-- session, return the same id. No test in this codebase exercises two
-- callers truly racing the same insert concurrently. The unique index still
-- makes that race safe (one insert wins, the other lands on the conflict
-- branch and now updates rather than no-oping), but "safe under a
-- concurrent race" and "tested under one" are different claims, and only the
-- first is backed by anything in this repo.
create or replace function public.get_or_create_occasion(
  p_kind public.occasion_kind
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_year    integer := extract(year from current_date)::integer;
  v_value   text;
  v_date    date;
  v_id      uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- A group_date is never derived: it is created explicitly, by a person,
  -- through createGroupDate(). Materializing one here would invent an event
  -- nobody scheduled.
  if p_kind = 'group_date' then
    raise exception 'group dates are created explicitly, not materialized'
      using errcode = '22023';
  end if;

  select pi.field_value into v_value
  from profile_info pi
  where pi.user_id = v_caller
    and pi.category = 'dates'
    and pi.field_name = p_kind::text;

  if v_value is null then
    raise exception 'no % on file for this account', p_kind
      using errcode = '22023';
  end if;

  -- Same this-year-or-next rollover the read path uses, through the same
  -- helper, so a tag and the display it appears under cannot disagree about
  -- which year the occasion falls in.
  v_date := public.celebration_date_in_year(v_value, v_year);
  if v_date is null then
    raise exception 'stored % is not a usable date', p_kind
      using errcode = '22023';
  end if;
  if v_date < current_date then
    v_date := public.celebration_date_in_year(v_value, v_year + 1);
  end if;

  -- do update, not do nothing: RETURNING then fires on every path (a fresh
  -- insert, or the caller's own pre-existing row for this kind/year), which
  -- removes the separate readback -- and its snapshot race -- entirely, and
  -- refreshes occasion_date when the caller's stored date has since changed.
  -- The conflict target's own columns (kind, celebrant_id) guarantee this
  -- can only ever update a row that already belonged to this same caller.
  insert into public.occasions (kind, celebrant_id, occasion_date, created_by)
  values (p_kind, v_caller, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do update set occasion_date = excluded.occasion_date
  returning id into v_id;

  -- Should be unreachable: RETURNING now always produces a row on this path.
  -- Kept as a backstop because an unreachable check costs nothing and a
  -- reachable one would mean the analysis above was wrong.
  if v_id is null then
    raise exception 'get_or_create_occasion failed to materialize an occasion for % (%)',
      v_caller, p_kind
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

grant execute on function public.get_or_create_occasion(public.occasion_kind)
  to authenticated, service_role;
