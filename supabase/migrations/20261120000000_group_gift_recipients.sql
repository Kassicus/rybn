-- =============================================================================
-- rybn: who a group gift is for, and the rules that keep those people out of it
--       (rybn-mobile docs/2026-11-20-mobile-group-gifts-design.md §6.3, §7.3)
-- =============================================================================
--
-- A group gift names the people it is for, and the database keeps each of
-- them out of that gift, whoever writes:
--
--   1. group_gift_recipients: one row for each person a gift is for, a gift
--      and a person. A gift for someone not on Rybn has no row. Row-level
--      security is on and it has no policy, and anon and authenticated hold
--      no privilege on it, so a signed-in person's client can neither read
--      nor write it. The service role reads and writes it, with select,
--      insert, update and delete and no truncate.
--   2. A member row (group_gift_members) for a person the gift is for is
--      refused, on insert and on update (reject_group_gift_recipient_as_member).
--      The rule runs once the row's own policy and the pin on its gift and
--      person (pin_group_gift_member_parent) have let the row be written, so
--      those decide first, and only a caller the policy lets write a member
--      row ever meets this rule.
--   3. A name is refused for someone already in the gift, and for the person
--      who made it (reject_group_gift_member_as_recipient). Rules 2 and 3 each
--      lock the gift's row before they look, so a name and a member row for
--      one person cannot be written for one gift at the same moment.
--   4. A name is never rewritten: its gift and its person are pinned by
--      reject_parent_reassignment().
--   5. A name is deleted only once its gift or its person is gone, which is
--      how the cascade from either one deletes it
--      (reject_group_gift_recipient_removal).
--   6. is_group_gift_member() answers false for a person the gift is for.
--   7. The policy group_gift_members_select lets a gift's maker, and a member
--      of the gift through is_group_gift_member(), read its member rows, and
--      nobody else. A member reads their own row as a member. So no row-level
--      rule lets a person a gift is for read anything of it: its row, its
--      member rows, its chat or the chat's live feed.
--   8. No API role (anon, authenticated or service_role) may execute the
--      three trigger functions; a trigger runs its function without that
--      privilege. group_gifts.target_user_id is not used: who a gift is for is
--      in group_gift_recipients.
--
-- Rules 2 to 5 are triggers, so they hold for every role that writes these
-- tables, the service role included.
--
-- Safe to apply before the code that uses it: the site as it runs never
-- writes the new table, so nobody is named, and nothing the site does is
-- refused.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table of who each gift is for
-- -----------------------------------------------------------------------------
-- A name goes with its gift, and with its person, by cascade. Row-level
-- security is on with no policy, and anon and authenticated hold nothing, so
-- only the service role reaches it. The service role holds select, insert,
-- update and delete and nothing else: a truncate would not run the row
-- trigger of rule 5, so no API role holds truncate.
create table public.group_gift_recipients (
  group_gift_id uuid not null references public.group_gifts(id) on delete cascade,
  user_id text not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_gift_id, user_id)
);

create index idx_group_gift_recipients_user on public.group_gift_recipients (user_id);

alter table public.group_gift_recipients enable row level security;

revoke all on public.group_gift_recipients from anon, authenticated, service_role;
grant select, insert, update, delete on public.group_gift_recipients to service_role;


-- -----------------------------------------------------------------------------
-- 2. Nobody a gift is for can be in it
-- -----------------------------------------------------------------------------
-- After a member row is written, on insert or on update, the function locks
-- the gift's row until the transaction ends, then refuses the row when its
-- person is named on the gift; the refusal undoes the whole statement. It
-- runs after the row's own policy and the pin trigger
-- pin_group_gift_member_parent, so those decide first, and only a caller the
-- policy lets write a member row ever meets this rule. Running as its owner,
-- it sees every name whoever writes.
--
-- The lock is for no key update, the one rule 3 takes, so a name and a member
-- row for one person and one gift are written one after the other, and the
-- second, at the read committed level the site's clients use, sees the first.
-- By the time this rule runs, the member row's foreign key check has taken a
-- key-share lock on the gift's row. For no key update does not conflict with
-- key share, so two member rows added to one gift at the same moment wait for
-- each other in turn, where a for update lock would have each wait on the
-- other's key share. It is also the lock the update of current_amount
-- (update_group_gift_current_amount) takes.
create or replace function public.reject_group_gift_recipient_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from group_gifts where id = new.group_gift_id for no key update;

  if exists (select 1 from group_gift_recipients
              where group_gift_id = new.group_gift_id
                and user_id = new.user_id) then
    raise exception 'GROUP GIFT: a person a group gift is for cannot be in it' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger keep_recipients_out_of_group_gift
  after insert or update on public.group_gift_members
  for each row execute function public.reject_group_gift_recipient_as_member();


-- -----------------------------------------------------------------------------
-- 3. Nobody in a gift, and not its maker, can be named on it
-- -----------------------------------------------------------------------------
-- Before a name is written, the function locks the gift's row (for no key
-- update, the lock rule 2 takes) and reads who made it, then refuses the name
-- when its person made the gift or has a member row in it.
create or replace function public.reject_group_gift_member_as_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maker text;
begin
  select created_by into v_maker from group_gifts where id = new.group_gift_id for no key update;

  if new.user_id = v_maker
     or exists (select 1 from group_gift_members
                 where group_gift_id = new.group_gift_id
                   and user_id = new.user_id) then
    raise exception 'GROUP GIFT: someone in a group gift, or its maker, cannot be a person it is for' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger keep_members_out_of_group_gift_recipients
  before insert on public.group_gift_recipients
  for each row execute function public.reject_group_gift_member_as_recipient();


-- -----------------------------------------------------------------------------
-- 4. A name is never rewritten
-- -----------------------------------------------------------------------------
create trigger pin_group_gift_recipient
  before update on public.group_gift_recipients
  for each row execute function public.reject_parent_reassignment('group_gift_id', 'user_id');


-- -----------------------------------------------------------------------------
-- 5. A name comes off only with its gift or its person
-- -----------------------------------------------------------------------------
-- A delete of a name is refused while its gift and its person both exist. This
-- lets the two cascades through: a foreign key's cascade deletes the name after
-- the gift's row, or the person's row, is already gone, and a volatile
-- function, which reads afresh for each statement, sees that it is gone.
create or replace function public.reject_group_gift_recipient_removal()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if exists (select 1 from group_gifts where id = old.group_gift_id)
     and exists (select 1 from user_profiles where id = old.user_id) then
    raise exception 'GROUP GIFT: who a group gift is for cannot be changed' using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

create trigger keep_group_gift_recipients
  before delete on public.group_gift_recipients
  for each row execute function public.reject_group_gift_recipient_removal();


-- -----------------------------------------------------------------------------
-- 6. The membership test answers no for a person a gift is for
-- -----------------------------------------------------------------------------
-- is_group_gift_member(gift, person) is true only when the person is the
-- caller (or the caller already bypasses row-level security), has a member row
-- in the gift, and is not named on it. The pinned first clause and its comment
-- are the baseline's; "the section header" is section 5 of
-- 20260821000000_clerk_native_baseline.sql. create or replace keeps the
-- function's owner and its grant to authenticated and service_role.
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
  ) and not exists (
    select 1 from public.group_gift_recipients r
    where r.group_gift_id = p_group_gift_id and r.user_id = p_user_id
  )
$$;


-- -----------------------------------------------------------------------------
-- 7. No row-level rule shows a person a gift is for their own row
-- -----------------------------------------------------------------------------
-- A gift's maker, and a member of the gift through is_group_gift_member(),
-- read its member rows. A member reads their own row through the second
-- clause; a person the gift is for, for whom is_group_gift_member() is false,
-- reads none.
drop policy "group_gift_members_select" on public.group_gift_members;

create policy "group_gift_members_select"
  on public.group_gift_members for select to authenticated
  using (
    exists (
      select 1 from public.group_gifts gg
      where gg.id = group_gift_members.group_gift_id
        and gg.created_by = (select public.requesting_user_id())
    )
    or public.is_group_gift_member(group_gift_id, (select public.requesting_user_id()))
  );


-- -----------------------------------------------------------------------------
-- 8. Grants and comments
-- -----------------------------------------------------------------------------
revoke execute on function public.reject_group_gift_recipient_as_member() from public, anon, authenticated, service_role;
revoke execute on function public.reject_group_gift_member_as_recipient() from public, anon, authenticated, service_role;
revoke execute on function public.reject_group_gift_recipient_removal() from public, anon, authenticated, service_role;

comment on table public.group_gift_recipients is
  'Who each group gift is for: one row for each person, a gift and a person. A gift for someone not on Rybn has no row. A member row for a person named on a gift is refused (keep_recipients_out_of_group_gift on group_gift_members); a name for someone in the gift, or for its maker, is refused (keep_members_out_of_group_gift_recipients); a name is never rewritten (pin_group_gift_recipient); and a name is deleted only once its gift or its person is gone, by cascade (keep_group_gift_recipients). Row-level security is on with no policy, and anon and authenticated hold no privilege on it: the service role reads and writes it, with select, insert, update and delete; no API role holds truncate, which would not run the row trigger of keep_group_gift_recipients. Added by 20261120000000_group_gift_recipients.sql.';

comment on function public.reject_group_gift_recipient_as_member() is
  'Trigger function of keep_recipients_out_of_group_gift, after insert or update on group_gift_members, so the row''s own policy and the pin trigger pin_group_gift_member_parent decide first: locks the gift''s row (for no key update), then refuses (check_violation) a member row for a person named on that gift in group_gift_recipients, which undoes the statement. Security definer, so it sees every name whoever writes. No API role (anon, authenticated, service_role) may execute it; the trigger runs it without that privilege. Added by 20261120000000_group_gift_recipients.sql.';

comment on function public.reject_group_gift_member_as_recipient() is
  'Trigger function of keep_members_out_of_group_gift_recipients, before insert on group_gift_recipients: locks the gift''s row (for no key update) and reads its maker, then refuses (check_violation) a name for the gift''s maker or for someone with a member row in the gift. Security definer. No API role (anon, authenticated, service_role) may execute it; the trigger runs it without that privilege. Added by 20261120000000_group_gift_recipients.sql.';

comment on function public.reject_group_gift_recipient_removal() is
  'Trigger function of keep_group_gift_recipients, before delete on group_gift_recipients: refuses (check_violation) the delete of a name while its gift and its person both exist. The cascade from a deleted gift or a deleted profile runs after that row is gone, and this volatile function sees it gone, so the cascade passes. Security definer. No API role (anon, authenticated, service_role) may execute it; the trigger runs it without that privilege. Added by 20261120000000_group_gift_recipients.sql.';

comment on column public.group_gifts.target_user_id is 'Not used. Who a group gift is for is in group_gift_recipients.';
