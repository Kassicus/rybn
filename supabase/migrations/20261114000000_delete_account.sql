-- =============================================================================
-- rybn: a person can delete their own account
--       (rybn-mobile docs/2026-11-14-mobile-accounts-and-gaps-design.md §8.5)
-- =============================================================================
--
-- Deleting a person's user_profiles row takes their own rows with it, by the
-- cascades the schema already has. This adds what deleting an account needs
-- beyond those:
--
--   1. On-delete actions for three foreign keys to user_profiles that had
--      none. invitations.invited_by is on delete cascade: an invitation goes
--      with the person who sent it. group_gifts.target_user_id is on delete
--      set null: a group gift for someone who has gone stays with the group,
--      for no one. gift_exchange_participants.assigned_to is on delete set
--      null: a match to someone who has gone is cleared.
--   2. delete_account(), SECURITY DEFINER, with no argument, so it only ever
--      deletes the caller. For each group the caller is in, made, or made a
--      group gift or gift exchange in, the heir is its first member other
--      than the caller by role (owner, admin, member, the enum's order), then
--      the longest-standing, then id: the group's owner whenever it has one
--      besides the caller. A group with no heir is deleted, and its dates,
--      invitations, group gifts and exchanges go by their own cascades.
--      Otherwise, where the caller was owner, the heir becomes owner, and the
--      heir is recorded as the maker of the group and of each group gift and
--      gift exchange the caller made in it. Then each gift exchange the caller
--      is in, or is someone's match in, that has not been held yet has every
--      match cleared and can be drawn again; one already held keeps its
--      matches, and the foreign key clears any match to the caller. Last, the
--      caller's profile row is deleted, and everything else of theirs goes by
--      cascade: their claims are released, and an item they bought for
--      someone stays bought. A second call finds no profile and changes
--      nothing. Signed out raises 28000. Executable by authenticated alone.
--
-- Safe to apply before the code that calls it: it only loosens three foreign
-- keys, and adds a function nothing on the site calls yet.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The three foreign keys
-- -----------------------------------------------------------------------------
alter table public.invitations drop constraint invitations_invited_by_fkey,
  add constraint invitations_invited_by_fkey foreign key (invited_by)
    references public.user_profiles(id) on delete cascade;
alter table public.group_gifts drop constraint group_gifts_target_user_id_fkey,
  add constraint group_gifts_target_user_id_fkey foreign key (target_user_id)
    references public.user_profiles(id) on delete set null;
alter table public.gift_exchange_participants drop constraint gift_exchange_participants_assigned_to_fkey,
  add constraint gift_exchange_participants_assigned_to_fkey foreign key (assigned_to)
    references public.user_profiles(id) on delete set null;


-- -----------------------------------------------------------------------------
-- 2. Deleting the caller's account
-- -----------------------------------------------------------------------------
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_group  uuid;
  v_heir   text;
  v_redraw uuid[];
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Every group the caller is in, made, or made a group gift or gift
  -- exchange in. Every row that names the caller as its maker is in one of
  -- these groups, so none is missed below.
  for v_group in
    select g.id
      from groups g
     where g.created_by = v_caller
        or exists (select 1 from group_members gm
                    where gm.group_id = g.id and gm.user_id = v_caller)
        or exists (select 1 from group_gifts gg
                    where gg.group_id = g.id and gg.created_by = v_caller)
        or exists (select 1 from gift_exchanges ge
                    where ge.group_id = g.id and ge.created_by = v_caller)
     order by g.id
  loop
    -- The heir: the first member other than the caller by role, in the
    -- enum's order (owner, admin, member), then the longest-standing, then
    -- id. So the group's owner, whenever it has one besides the caller.
    select gm.user_id into v_heir
      from group_members gm
     where gm.group_id = v_group
       and gm.user_id <> v_caller
     order by gm.role, gm.joined_at nulls last, gm.id
     limit 1;

    if v_heir is null then
      -- Nobody else is in it. Its dates, invitations, group gifts and
      -- exchanges go by their own cascades.
      delete from groups where id = v_group;
    else
      -- The caller owned it: the heir owns it now (no change when the heir
      -- already does).
      if exists (select 1 from group_members gm
                  where gm.group_id = v_group
                    and gm.user_id = v_caller
                    and gm.role = 'owner') then
        update group_members
           set role = 'owner'
         where group_id = v_group
           and user_id = v_heir
           and role is distinct from 'owner';
      end if;

      -- Then what the caller made in it is recorded as the heir's.
      update groups
         set created_by = v_heir
       where id = v_group
         and created_by = v_caller;

      update group_gifts
         set created_by = v_heir
       where group_id = v_group
         and created_by = v_caller;

      update gift_exchanges
         set created_by = v_heir
       where group_id = v_group
         and created_by = v_caller;
    end if;
  end loop;

  -- Each gift exchange the caller is in, or is someone's match in, that has
  -- not been held yet: every match is cleared, so it can be drawn again
  -- without them. One already held keeps its matches; the foreign key
  -- clears any match to the caller when their profile goes.
  v_redraw := array(
    select ge.id
      from gift_exchanges ge
     where (ge.exchange_date is null or ge.exchange_date > now())
       and exists (select 1 from gift_exchange_participants p
                    where p.exchange_id = ge.id
                      and (p.user_id = v_caller or p.assigned_to = v_caller)));

  update gift_exchange_participants
     set assigned_to = null
   where exchange_id = any(v_redraw);

  update gift_exchanges
     set assignments_generated = false
   where id = any(v_redraw);

  -- Last, the profile. Everything else of the caller's goes by its own
  -- cascade. No row is not an error: a second call changes nothing.
  delete from user_profiles where id = v_caller;
end;
$$;

revoke execute on function public.delete_account() from public, anon, service_role;
grant execute on function public.delete_account() to authenticated;

comment on function public.delete_account() is
  'Deletes the caller''s account. For each group the caller is in, made, or made a group gift or gift exchange in, the heir is its first other member by role (owner, admin, member), then the longest-standing, then id. A group with no heir is deleted; otherwise the heir becomes owner where the caller was owner, and is recorded as the maker of the group and of each group gift and gift exchange the caller made in it. Each gift exchange the caller is in or matched in that has not been held has its matches cleared, to be drawn again. Then the caller''s profile is deleted and the rest of what is theirs goes by cascade. Security definer, no argument. Raises 28000 when signed out; a second call changes nothing. Added by 20261114000000_delete_account.sql.';
