-- =============================================================================
-- rybn: the group-delete cascade must fail CLOSED
-- =============================================================================
--
-- cleanup_privacy_overrides_on_group_delete() runs three UPDATEs when a group
-- is deleted. Two of them nulled `restrictToGroup` and stopped there, and that
-- is a privacy widening dressed up as a cleanup.
--
-- The privacy model resolves in exactly one order -- can_view_field() and
-- can_view_wishlist_item() both do this:
--
--     restrictToGroup set    -> visible ONLY to people who share THAT group
--     restrictToGroup null   -> visible to anyone sharing a group whose TYPE
--                               is in visibleToGroupTypes
--     visibleToGroupTypes [] -> visible to the owner and nobody else
--
-- So nulling restrictToGroup does not neutralise the row, it PROMOTES it from
-- "one named group" back to "every group of these types" -- which is the
-- broader audience the owner overrode when they picked a single group. The
-- fallback audience is strictly wider than the choice it replaces, in every
-- case, because a single-group restriction is only ever expressible as a
-- narrowing.
--
-- The attack is one click and needs no privilege the attacker does not already
-- have. If a victim restricts a wishlist item to a group that YOU own, you
-- delete your own group and the item silently re-broadens to everyone who
-- shares any family/friends/work/custom group with the victim -- possibly
-- including you, through an entirely different group. Nothing errors. Nothing
-- is logged. The victim is never told the audience for their surprise gift
-- just grew.
--
-- Fix: make those rows PRIVATE. Clear visibleToGroupTypes to [] as well as
-- nulling restrictToGroup, so the row falls back to nobody rather than to a
-- wider audience. The owner still sees their own row (both functions
-- short-circuit on ownership, and both tables carry an own-rows SELECT policy
-- besides), and can re-share it deliberately. Losing an audience is a
-- recoverable annoyance; gaining one silently is not.
--
-- NOT CHANGED: the first UPDATE, which strips the deleted group's key out of
-- `overrides`. That one is already correct -- an override keyed by a group id
-- is meaningless once the group is gone, and removing the key restores the
-- row's own settings rather than widening anything.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The cascade itself.
--
-- jsonb_set is nested rather than combined with || because the || form would
-- also have to spell out the whole object, and this way the OLD value of every
-- other key -- `overrides` included -- is carried through untouched by
-- construction. It also makes the written value a pure function of the old row,
-- which is what lets the pin trigger below recompute it and compare.
--
-- create_missing defaults to true, so a profile_info row that never had a
-- visibleToGroupTypes key gets one set to []. That is the correct direction:
-- an absent key already means private (can_view_field falls through to
-- `return false`), and writing it makes that explicit rather than implicit.
--
-- wishlist_items.valid_wishlist_privacy_settings requires visibleToGroupTypes
-- to be present and to be an array; [] satisfies it.
-- -----------------------------------------------------------------------------
create or replace function public.cleanup_privacy_overrides_on_group_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Unchanged: a group-keyed override cannot outlive its group.
  update profile_info
  set privacy_settings = jsonb_set(
    privacy_settings,
    '{overrides}',
    coalesce((privacy_settings->'overrides') - old.id::text, '{}'::jsonb)
  )
  where privacy_settings->'overrides' ? old.id::text;

  -- Fail closed, not open. See the header.
  update profile_info
  set privacy_settings = jsonb_set(
    jsonb_set(privacy_settings, '{restrictToGroup}', 'null'::jsonb),
    '{visibleToGroupTypes}', '[]'::jsonb
  )
  where privacy_settings->>'restrictToGroup' = old.id::text;

  update wishlist_items
  set privacy_settings = jsonb_set(
    jsonb_set(privacy_settings, '{restrictToGroup}', 'null'::jsonb),
    '{visibleToGroupTypes}', '[]'::jsonb
  )
  where privacy_settings->>'restrictToGroup' = old.id::text;

  return old;
end;
$$;


-- -----------------------------------------------------------------------------
-- The coupling: pin_wishlist_item_owner_fields must admit the NEW shape.
--
-- 20260822000000_pin_privacy_columns.sql made wishlist_items.privacy_settings
-- owner-only, with one exemption: a write arriving at pg_trigger_depth() > 1 is
-- the schema's own cascade, which has no actor to compare against. That
-- exemption was deliberately bounded to the exact shape the cascade wrote --
-- "restrictToGroup becomes JSON null, nothing else differs" -- so that a
-- cascade doing anything ELSE is still refused.
--
-- The cascade now writes a different shape, so the bound has to move with it or
-- the guard rejects the schema's own cleanup and deleteGroup() raises for any
-- group where another member has a restricted item. That is not theoretical:
-- the first version of this pin did exactly that, and 09_privacy_pins.sql has
-- covered it since.
--
-- The bound MOVES; it does not widen. It is still one target value, still
-- computed entirely from the OLD row, still containing no attacker-chosen
-- input, and it is still the only depth->1 rewrite of privacy_settings this
-- schema permits. The previous shape is deliberately no longer admitted --
-- nothing writes it any more, and an exemption kept alive for a caller that no
-- longer exists is an exemption nobody is checking. A blanket `return new` at
-- depth > 1 would be the easy fix and is the wrong one: it would hand every
-- future trigger on this table an unexamined pass at the column the whole
-- privacy model rests on.
--
-- Everything else in the function is byte-identical to yesterday's; only the
-- expected-shape expression and its error message change.
-- -----------------------------------------------------------------------------
create or replace function public.reject_non_owner_column_change()
returns trigger
language plpgsql
as $$
declare
  v_actor     text  := (select public.requesting_user_id());
  v_old       jsonb := to_jsonb(old);
  v_new       jsonb := to_jsonb(new);
  v_permitted text[];
  v_changed   text;
begin
  v_permitted := tg_argv;

  if v_actor is not distinct from (v_old ->> 'user_id') then
    return new;
  end if;

  -- A cascade from another trigger in this schema is not an actor's write, and
  -- there is no actor to compare it against -- it is the schema maintaining
  -- its own invariant.
  --
  -- This is not hypothetical. cleanup_privacy_overrides_on_group_delete()
  -- makes EVERY item that pointed at a deleted group private, so deleting a
  -- group you own rewrites privacy_settings on rows belonging to other people.
  -- Without this clause deleteGroup() raises the moment any other member has an
  -- item restricted to that group -- verified against the live database before
  -- the clause was added, and covered by 09_privacy_pins.sql.
  --
  -- A client's own UPDATE reaches this trigger at pg_trigger_depth() = 1 and
  -- the cascade at 2 (both measured, not assumed), and no client statement can
  -- nest itself: the only trigger function in this schema that touches
  -- wishlist_items is that cleanup, and the only way to reach it is deleting a
  -- group the caller OWNS, which the groups DELETE policy already gates. That
  -- inventory is asserted, not merely asserted-in-a-comment: 09_privacy_pins.sql
  -- fails by name if another trigger appears.
  --
  -- The exemption is the SHAPE of that cleanup, not a blanket pass. The cascade
  -- writes exactly one column, from a fixed SET list with no attacker-chosen
  -- input, to a value that is a pure function of the old row -- so
  -- privacy_settings joins the permitted set here, and only when the result is
  -- byte-for-byte the value that cleanup would have written. A depth-2 write
  -- that touched anything else, or that rewrote privacy_settings any other way,
  -- is still refused.
  if pg_trigger_depth() > 1 then
    if v_old -> 'privacy_settings' is distinct from v_new -> 'privacy_settings'
       and jsonb_set(
             jsonb_set(v_old -> 'privacy_settings', '{restrictToGroup}', 'null'::jsonb),
             '{visibleToGroupTypes}', '[]'::jsonb)
           is distinct from v_new -> 'privacy_settings'
    then
      raise exception
        'CASCADE SHAPE: %.privacy_settings was rewritten by a trigger cascade in a way the schema''s own cleanup never performs (% -> %). The only permitted cascade edit is restrictToGroup becoming null AND visibleToGroupTypes becoming [], together.',
        tg_table_name,
        coalesce((v_old -> 'privacy_settings')::text, '<none>'),
        coalesce((v_new -> 'privacy_settings')::text, '<none>')
        using errcode = 'check_violation';
    end if;

    -- Cast is load-bearing: an untyped literal on the right of || against a
    -- text[] is resolved as an array literal, not an element.
    v_permitted := v_permitted || 'privacy_settings'::text;
  end if;

  -- Compared as text through jsonb, exactly as reject_parent_reassignment()
  -- does, so `is distinct from` gives NULL transitions the right answer in
  -- both directions and no per-type comparison operator is needed.
  select string_agg(k.key, ', ' order by k.key) into v_changed
    from jsonb_each_text(v_old) as k
   where not (k.key = any (v_permitted))
     and k.value is distinct from (v_new ->> k.key);

  if v_changed is not null then
    raise exception
      'OWNER-ONLY COLUMN: %.% may be changed only by the row''s owner (actor: %)',
      tg_table_name, v_changed, coalesce(v_actor, '<anonymous>')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- Grants. `create or replace function` preserves the existing ACL, so both
-- functions keep what section 9 of the baseline (and yesterday's migration)
-- left them with. Restated anyway, because "it was already revoked" is a fact
-- about another file, and a trigger function that becomes callable over
-- /rest/v1/rpc/ is not the kind of thing to leave depending on one.
-- -----------------------------------------------------------------------------
revoke execute on function public.reject_non_owner_column_change()
  from public, anon, authenticated, service_role;
revoke execute on function public.cleanup_privacy_overrides_on_group_delete()
  from public, anon, authenticated, service_role;
