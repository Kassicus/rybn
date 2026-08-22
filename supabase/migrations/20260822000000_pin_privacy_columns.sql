-- =============================================================================
-- rybn: pin the two columns RLS cannot defend
-- =============================================================================
--
-- Both defects below are the same shape as the ones the baseline already
-- closes with public.reject_parent_reassignment(): a WITH CHECK sees only the
-- NEW row, so "you did not change that column" is inexpressible in a policy.
-- The USING clause gates who may update the row at all; once past it, every
-- column absent from the check is the updater's to rewrite. Where the column
-- in question IS the privacy model, that is not a data-integrity nit -- it is
-- the product feature failing open, silently, with no error to notice.
--
--   D1  "Users can claim visible wishlist items" is USING = WITH CHECK =
--       can_view_wishlist_item(...). It exists so a co-member can claim a gift.
--       A more-visible item still satisfies the check, so the claimer could
--       also rewrite title, description, url, price -- and WIDEN
--       privacy_settings. Demonstrated: a co-member renamed another user's
--       item to 'VANDALISED' and broadened its audience.
--
--   D2  The groups UPDATE policy's WITH CHECK is is_group_admin(id, me) and
--       nothing else, so any admin could rewrite `type`. `type` is the axis
--       the entire privacy model keys on -- can_view_field() and
--       can_view_wishlist_item() both resolve through
--       get_shared_groups().group_type -- so flipping a work group to 'family'
--       exposes every member's family-only profile fields and wishlist items
--       at once. Demonstrated: an admin read a victim's family-only field this
--       way.
--
-- COVERAGE NOTE, same as the baseline's: the RLS harness cannot assert that a
-- write is DENIED. A denied write raises, which aborts the test block, and
-- catching it would need an exception handler, which the runner rejects
-- outright. So supabase/tests/rls/09_privacy_pins.sql asserts the trigger
-- definitions (which is where the permitted-column list lives) plus the
-- positive controls that prove the allow path still works. Each attack was
-- executed against the live database with the trigger dropped and again with
-- it restored; that is recorded in the task report rather than in the suite.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- T1 -- wishlist_items: a non-owner may touch the claim columns and nothing
-- else.
--
-- The permitted list is passed as trigger arguments rather than hardcoded in
-- the body, for the same reason reject_parent_reassignment() takes its columns
-- that way: the guarantee is then legible at the CREATE TRIGGER site, and it
-- is readable back out of the catalog as data, so a test can assert the exact
-- list instead of pattern-matching a function body.
--
-- Everything NOT in that list is owner-only -- privacy_settings, title,
-- description, url, price, image_url, priority, category, and user_id itself.
-- Listing the permitted columns rather than the forbidden ones is deliberate:
-- a column added by a future migration then arrives owner-only by default,
-- which is the safe direction to be wrong in.
--
-- The owner short-circuit keeps ordinary edits untouched: this trigger exists
-- only to bound what somebody ELSE may do to the row. `is not distinct from`
-- rather than `=` so an anonymous actor (requesting_user_id() null) is treated
-- as a non-owner rather than making the comparison null.
--
-- Requires the table to have a `user_id` owner column, which is checked by
-- PostgreSQL the first time the trigger fires on a given table.
--
-- NOTE FOR WHOEVER WRITES THE NEXT DATA MIGRATION. A backfill that touches
-- wishlist_items as `postgres` -- or any write from the admin client -- carries
-- no Clerk claim, so requesting_user_id() is null, the row is treated as
-- somebody else's, and every column outside the claim list is refused. That is
-- the safe direction and it fails loudly rather than quietly, but it will stop
-- an ordinary-looking backfill dead. Wrap such a migration in
-- `alter table public.wishlist_items disable trigger pin_wishlist_item_owner_fields`
-- / `enable trigger`, deliberately and in the same transaction, rather than
-- weakening the pin.
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
  -- clears restrictToGroup on EVERY item that pointed at a deleted group, so
  -- deleting a group you own rewrites privacy_settings on rows belonging to
  -- other people. Without this clause deleteGroup() raises the moment any
  -- other member has an item restricted to that group -- verified against the
  -- live database before the clause was added, and covered by the last two
  -- assertions in 09_privacy_pins.sql.
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
  -- writes exactly one column, one key, one literal, from a fixed SET list with
  -- no attacker-chosen input -- so privacy_settings joins the permitted set
  -- here, and only when the sole difference is restrictToGroup becoming JSON
  -- null. A depth-2 write that touched anything else, or that rewrote
  -- privacy_settings any other way, is still refused.
  if pg_trigger_depth() > 1 then
    if v_old -> 'privacy_settings' is distinct from v_new -> 'privacy_settings'
       and jsonb_set(v_old -> 'privacy_settings', '{restrictToGroup}', 'null'::jsonb)
           is distinct from v_new -> 'privacy_settings'
    then
      raise exception
        'CASCADE SHAPE: %.privacy_settings was rewritten by a trigger cascade in a way the schema''s own cleanup never performs (% -> %). The only permitted cascade edit is restrictToGroup becoming null.',
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

-- Fires before update_wishlist_items_updated_at (triggers run in name order,
-- and 'pin_' sorts before 'update_'), which is why updated_at is permitted:
-- that trigger would otherwise be rejected on behalf of the claimer.
--
-- Dropped first so this file can be re-applied. `create or replace function`
-- above is already idempotent; `create trigger` is not, and a migration that
-- can only be applied once is a migration you cannot correct in place.
drop trigger if exists pin_wishlist_item_owner_fields on public.wishlist_items;

create trigger pin_wishlist_item_owner_fields
  before update on public.wishlist_items
  for each row execute function public.reject_non_owner_column_change(
    'claimed_by', 'claimed_at', 'purchased', 'purchased_at',
    'out_of_stock_marked_by', 'out_of_stock_marked_at', 'updated_at');


-- -----------------------------------------------------------------------------
-- T2 -- groups.type is immutable after creation.
--
-- Deliberately narrow, and the narrowness is the point. `name`, `description`
-- and `settings` stay editable, and invite_code MUST stay writable: the
-- member-removal path rotates it (rotateInviteCode() in lib/actions/groups.ts,
-- through the admin client, which bypasses RLS but NOT triggers). Pinning it
-- here would leave removal silently failing to remove anyone -- the departing
-- member keeps a working code.
--
-- Accepted consequence: a group's type cannot be changed after creation. The
-- application has no flow that changes it -- `groups` has exactly one UPDATE
-- writer in the codebase, and it writes invite_code -- so this costs nothing
-- today, and re-creating the group is the honest way to do it in any case: a
-- type change retroactively rewrites who could see what, for every member,
-- with no notice to any of them.
-- -----------------------------------------------------------------------------
drop trigger if exists pin_group_type on public.groups;

create trigger pin_group_type
  before update on public.groups
  for each row execute function public.reject_parent_reassignment('type');


-- -----------------------------------------------------------------------------
-- Grants. Section 9 of the baseline revokes EXECUTE on every function in
-- `public` from everyone and hands back only what is demonstrably needed, and
-- note (e) there records that trigger functions are granted to nobody:
-- PostgreSQL checks EXECUTE on a trigger function when the trigger is CREATED,
-- not when it fires.
--
-- That revoke was one-shot, and the default privileges left behind still grant
-- EXECUTE on FUTURE functions to authenticated and service_role (only anon was
-- revoked by default). So a function added by this migration arrives
-- authenticated-executable unless it is revoked explicitly. Directly calling a
-- trigger function only raises 'can only be called as a trigger', but leaving
-- it on /rest/v1/rpc/ contradicts the discipline the baseline states, and the
-- next such function might not be inert.
-- -----------------------------------------------------------------------------
revoke execute on function public.reject_non_owner_column_change()
  from public, anon, authenticated, service_role;
