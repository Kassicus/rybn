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
--      deletes the caller. In this order:
--      a. Groups. It takes every group the caller is a member of, made
--         (groups.created_by), or made a group gift or gift exchange in, and
--         locks each one's row, in id order, until the transaction ends, so
--         a join, or another member deleting their account, waits. A group's
--         heir is its first member other than the caller by role (owner,
--         admin, member: the enum's order), then the longest-standing
--         (joined_at, nulls last), then id: the group's owner whenever it has
--         one besides the caller. The heir's member row is locked too, until
--         the transaction ends. A group with no heir is deleted, and its
--         dates, invitations, group gifts and exchanges go by their own
--         cascades. In a group with an heir:
--         - where the caller was its owner, the heir becomes its owner;
--         - where the caller was a member, the group gets a new invite code,
--           as leaving a group does, since the code alone lets its holder
--           join: the website's shape (generateInviteCode in
--           lib/utils/groups.ts, three groups of three characters from
--           ABCDEFGHJKLMNPQRSTUVWXYZ23456789, joined by dashes), each
--           character one byte of a gen_random_uuid() value, and a code no
--           group holds. A group the caller made, or made something in, but
--           is not a member of keeps its code;
--         - the heir is recorded as the maker of the group (where the caller
--           made it) and of each gift exchange the caller made in it;
--         - each group gift the caller made there goes to its longest-standing
--           contributor (group_gift_members, by joined_at, nulls last, then
--           id) who is neither the caller nor the person it is for: a group
--           gift is read by its maker, only a contributor can open it, and it
--           is a surprise for that person. A gift with no such contributor
--           is deleted, with its contributions and messages.
--      b. Gift exchanges. Each exchange the caller is a participant in, or
--         is someone's match in, that has not been held yet (exchange_date
--         later than now, or no date) has every match cleared and
--         assignments_generated set false, so it can be drawn again. One
--         already held keeps its matches, and the foreign key clears any
--         match to the caller.
--      c. The profile. The caller's user_profiles row is deleted, and
--         everything else of theirs goes by cascade: their claims are
--         released, and an item they bought for someone stays bought.
--      A second call finds no profile and changes nothing. Signed out raises
--      28000. If five new codes in a row are all in use it raises P0001, and
--      the whole deletion is undone, to be tried again. Executable by
--      authenticated alone.
--   3. The policy "Users can delete their own profile" is dropped: a profile
--      row is deleted only through delete_account(), which runs as its owner
--      and needs no policy.
--
-- Safe to apply before the code that calls it: it loosens three foreign keys,
-- adds a function nothing on the site calls yet, and drops a policy nothing
-- on the site uses, since nothing on the site deletes a profile row directly.
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
  v_role   public.member_role;
  v_member boolean;
  v_code   text;
  v_bytes  bytea;
  v_at     int;
  v_redraw uuid[];
  v_chars  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Every group the caller is in, made, or made a group gift or gift
  -- exchange in. Every row that names the caller as its maker is in one of
  -- these groups, so none is missed below. Each group's row is locked, in id
  -- order, until the transaction ends: a join (whose key check needs the
  -- row) or another member deleting their account waits for this deletion,
  -- then sees what it did.
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
       for update of g
  loop
    -- The heir: the first member other than the caller by role, in the
    -- enum's order (owner, admin, member), then the longest-standing, then
    -- id. So the group's owner, whenever it has one besides the caller. A
    -- statement of its own, after the group's lock, so it sees what has
    -- committed; and the heir's row is locked until the transaction ends, so
    -- the heir cannot leave before they are made owner below.
    select gm.user_id into v_heir
      from group_members gm
     where gm.group_id = v_group
       and gm.user_id <> v_caller
     order by gm.role, gm.joined_at nulls last, gm.id
     limit 1
       for update of gm;

    if v_heir is null then
      -- Nobody else is in it. Its dates, invitations, group gifts (whoever
      -- pays into them) and exchanges go by their own cascades.
      delete from groups where id = v_group;
    else
      -- The caller's own place in it, if they have one.
      select gm.role into v_role
        from group_members gm
       where gm.group_id = v_group
         and gm.user_id = v_caller;
      v_member := found;

      -- The caller owned it: the heir owns it now (no change when the heir
      -- already does).
      if v_role = 'owner' then
        update group_members
           set role = 'owner'
         where group_id = v_group
           and user_id = v_heir
           and role is distinct from 'owner';
      end if;

      -- The caller was in it: it gets a new invite code, as leaving a group
      -- does, since the code alone lets its holder join. The shape is the
      -- website's (generateInviteCode in lib/utils/groups.ts): nine
      -- characters from v_chars, in three groups of three joined by dashes.
      -- Each character is one byte of a gen_random_uuid() value, which comes
      -- from the server's cryptographic random source; only the bytes that
      -- carry no fixed version or variant bits are used (all but 6 and 8),
      -- and 256 is a multiple of 32, so a byte modulo 32 is uniform over the
      -- alphabet. Five tries for a code no group holds; the unique constraint
      -- is the backstop. If all five are in use the deletion fails whole and
      -- can be tried again.
      if v_member then
        v_code := null;
        for v_try in 1..5 loop
          v_bytes := uuid_send(gen_random_uuid());
          v_code := '';
          foreach v_at in array array[0, 1, 2, 3, 4, 5, 7, 9, 10] loop
            v_code := v_code || substr(v_chars, get_byte(v_bytes, v_at) % 32 + 1, 1);
          end loop;
          v_code := substr(v_code, 1, 3) || '-' || substr(v_code, 4, 3) || '-' || substr(v_code, 7, 3);
          exit when not exists (select 1 from groups held where held.invite_code = v_code);
          v_code := null;
        end loop;

        if v_code is null then
          raise exception 'could not choose a new invite code for a group';
        end if;

        update groups
           set invite_code = v_code
         where id = v_group;
      end if;

      -- The group, where the caller made it, and each gift exchange the
      -- caller made in it are recorded as the heir's.
      update groups
         set created_by = v_heir
       where id = v_group
         and created_by = v_caller;

      update gift_exchanges
         set created_by = v_heir
       where group_id = v_group
         and created_by = v_caller;

      -- Each group gift the caller made goes to the first of its
      -- contributors (group_gift_members, the people who can open it), by
      -- when they joined it, then id, who is neither the caller nor the
      -- person it is for: a group gift is read by its maker and is a
      -- surprise for that person. A gift for no one excludes only the caller.
      with keeper as (
        select gg.id,
               (select ggm.user_id
                  from group_gift_members ggm
                 where ggm.group_gift_id = gg.id
                   and ggm.user_id <> v_caller
                   and ggm.user_id is distinct from gg.target_user_id
                 order by ggm.joined_at nulls last, ggm.id
                 limit 1) as user_id
          from group_gifts gg
         where gg.group_id = v_group
           and gg.created_by = v_caller
      )
      update group_gifts gg
         set created_by = k.user_id
        from keeper k
       where gg.id = k.id
         and k.user_id is not null;

      -- A group gift the caller made that nobody else has joined, or whose
      -- only other contributor is the person it is for, was theirs alone and
      -- is deleted. Its contributions and messages go by their own cascades.
      delete from group_gifts
       where group_id = v_group
         and created_by = v_caller;
    end if;
  end loop;

  -- Each gift exchange the caller is in, or is someone's match in, that has
  -- not been held yet (no date counts as not yet held): every match is
  -- cleared, so it can be drawn again without them. One already held keeps
  -- its matches; the foreign key clears any match to the caller when their
  -- profile goes.
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
  'Deletes the caller''s account. Takes every group the caller is a member of, made, or made a group gift or gift exchange in, locking each one''s row in id order until the transaction ends. A group''s heir is its first other member by role (owner, admin, member), then the longest-standing, then id, and the heir''s member row is locked too. A group with no heir is deleted. Otherwise: the heir becomes owner where the caller was owner; the group gets a new invite code of the website''s shape (generateInviteCode), drawn from gen_random_uuid(), where the caller was a member; the heir is recorded as the maker of the group and of each gift exchange the caller made in it; and each group gift the caller made goes to its longest-standing contributor who is neither the caller nor the person it is for, or is deleted when there is none. Each gift exchange the caller is in or matched in that has not been held (or has no date) has its matches cleared, to be drawn again. Then the caller''s profile is deleted and the rest of what is theirs goes by cascade. Security definer, no argument. Raises 28000 when signed out, and P0001 when five new invite codes in a row are all in use; a second call changes nothing. Added by 20261114000000_delete_account.sql.';


-- -----------------------------------------------------------------------------
-- 3. A profile row is deleted only through delete_account()
-- -----------------------------------------------------------------------------
drop policy "Users can delete their own profile" on public.user_profiles;
