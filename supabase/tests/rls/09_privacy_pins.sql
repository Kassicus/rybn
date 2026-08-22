-- The two privacy columns a policy cannot defend must stay pinned:
-- wishlist_items.privacy_settings (and every other owner-only column) against
-- the claimer, and groups.type against the group's own admins.
--
-- HOW THIS FILE IS SHAPED, AND WHY IT IS PART BEHAVIOURAL AND PART CATALOG.
--
-- Both defences are BEFORE UPDATE triggers that RAISE. This harness cannot
-- assert that a write is denied: a denied write raises, which aborts the
-- do-block, and catching it would need an exception handler -- which the
-- runner rejects outright, correctly, because a handler around an assertion
-- turns a real failure into a passing token. 07_write_path_defences.sql says
-- the same thing about the same class of defect.
--
-- So the denials are asserted where their content actually lives: in the
-- trigger definitions. The permitted-column list is passed as trigger
-- ARGUMENTS, not hardcoded in a function body, precisely so that it can be
-- read back out of the catalog as data and compared exactly -- which is a
-- stronger check than matching a substring of a function's source. A
-- definition that no longer names 'type', or one whose wishlist allow-list has
-- grown to include privacy_settings or title, fails here by name.
--
-- The allow path is asserted for real, by executing it. That half matters as
-- much as the denials: an over-tight pin does not leak anything, it just
-- silently stops people claiming gifts, and stops the member-removal flow
-- rotating the invite code -- which would leave a removal that never happens
-- while every screen reports success. Those are the positive controls below,
-- and they are the reason invite_code is deliberately NOT pinned. The last of
-- them covers the schema's own cascade: deleting a group rewrites
-- privacy_settings on OTHER members' items, and the first version of the
-- wishlist pin refused it and broke deleteGroup() outright.
--
-- The denials themselves were executed against the live database with each
-- trigger dropped (both attacks succeeded) and again with it restored (both
-- were refused). That is recorded in the task report, as the convention here
-- requires, not in this file.
--
-- Convention: see 00_harness_smoke.sql. set_config(..., true) is
-- transaction-local and the runner always rolls the transaction back, so the
-- fixtures below never persist.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role text;
  v_def       text;
  v_enabled   text;
  v_text      text;
  v_type      text;
  v_json      jsonb;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- 1. wishlist_items: the pin exists, and its permitted list is EXACTLY the
  --    claim columns.
  --
  --    Everything absent from that list is owner-only, so this single
  --    comparison is what stands between a co-member who can see an item and
  --    a co-member who can rename it, re-price it, re-point it at themselves
  --    or WIDEN its privacy_settings. The claimer only ever needs the seven
  --    columns named here (lib/actions/wishlist.ts: claim, unclaim, purchase,
  --    out-of-stock), and updated_at is among them because
  --    update_wishlist_items_updated_at sorts after 'pin_' and writes it on
  --    the claimer's behalf.
  --
  --    The whole definition is compared, not just the arguments, so a trigger
  --    quietly re-pointed at another function, or demoted from BEFORE to
  --    AFTER (where raising is too late to keep the row unchanged), fails
  --    here too.
  ---------------------------------------------------------------------------
  select replace(pg_get_triggerdef(t.oid), 'FUNCTION public.', 'FUNCTION '),
         t.tgenabled::text
    into v_def, v_enabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'wishlist_items'
     and t.tgname = 'pin_wishlist_item_owner_fields'
     and not t.tgisinternal;

  if v_def is distinct from
     'CREATE TRIGGER pin_wishlist_item_owner_fields BEFORE UPDATE ON public.wishlist_items FOR EACH ROW EXECUTE FUNCTION reject_non_owner_column_change(''claimed_by'', ''claimed_at'', ''purchased'', ''purchased_at'', ''out_of_stock_marked_by'', ''out_of_stock_marked_at'', ''updated_at'')'
  then
    raise exception
      'PRIVACY PIN: the wishlist_items owner-field pin is missing or altered. Found: %. Anything added to that permitted list becomes rewritable by whoever can merely SEE the item -- title, price and privacy_settings included, which is how a claimer widens another user''s audience.',
      coalesce(v_def, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  -- Enabled state is not part of pg_get_triggerdef, so a disabled trigger
  -- would satisfy the comparison above while enforcing nothing.
  if v_enabled is distinct from 'O' then
    raise exception
      'PRIVACY PIN: pin_wishlist_item_owner_fields is not enabled for ordinary writes (tgenabled = %). A disabled trigger still reads correctly in the catalog and stops nothing.',
      coalesce(v_enabled, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 2. groups: type is pinned, and NOTHING ELSE IS.
  --
  --    Both halves are load-bearing. `type` is the axis the entire privacy
  --    model keys on -- can_view_field() and can_view_wishlist_item() both
  --    resolve through get_shared_groups().group_type -- so an admin flipping
  --    a work group to 'family' exposes every member's family-only fields and
  --    items at once.
  --
  --    But this list must not grow. invite_code in particular MUST stay
  --    writable: rotateInviteCode() in lib/actions/groups.ts rotates it as
  --    part of removing a member, through the admin client, which bypasses
  --    RLS but NOT triggers. Pinning it would turn member removal into an
  --    error the caller sees instead of a removal.
  ---------------------------------------------------------------------------
  select replace(pg_get_triggerdef(t.oid), 'FUNCTION public.', 'FUNCTION '),
         t.tgenabled::text
    into v_def, v_enabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'groups'
     and t.tgname = 'pin_group_type'
     and not t.tgisinternal;

  if v_def is distinct from
     'CREATE TRIGGER pin_group_type BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION reject_parent_reassignment(''type'')'
  then
    raise exception
      'PRIVACY PIN: the groups.type pin is missing or altered. Found: %. Expected exactly one pinned column, ''type'' -- fewer and any admin can re-aim the privacy model at a whole group; more and the member-removal invite-code rotation starts failing.',
      coalesce(v_def, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  if v_enabled is distinct from 'O' then
    raise exception
      'PRIVACY PIN: pin_group_type is not enabled for ordinary writes (tgenabled = %). Group type would be rewritable by any admin again.',
      coalesce(v_enabled, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Fixtures for the positive controls.
  --
  --   owner + peer share a FAMILY group, and the item is family-visible, so
  --   the peer genuinely reaches it through
  --   "Users can claim visible wishlist items" rather than through an
  --   accident of the fixture.
  --
  --   admin owns a separate WORK group (add_group_creator_as_owner makes them
  --   its owner on insert), which is what makes is_group_admin() true for the
  --   groups updates below.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name) values
    ('user_pp_owner', 'ppowner', 'PP Owner'),
    ('user_pp_peer',  'pppeer',  'PP Peer'),
    ('user_pp_admin', 'ppadmin', 'PP Admin');

  insert into groups (id, name, type, invite_code, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'PP Family', 'family',
            'PPCODE01', 'user_pp_owner');

  insert into group_members (group_id, user_id, role)
    values ('11111111-1111-1111-1111-111111111111', 'user_pp_peer', 'member')
    on conflict do nothing;

  insert into groups (id, name, type, invite_code, created_by)
    values ('33333333-3333-3333-3333-333333333333', 'PP Work', 'work',
            'PPCODE02', 'user_pp_admin');

  insert into wishlist_items (id, user_id, title, privacy_settings)
    values ('22222222-2222-2222-2222-222222222222', 'user_pp_owner', 'Original Title',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}');

  -- The PEER's item, restricted to the group the OWNER owns. This is what
  -- makes assertion 10 real: deleting that group makes the schema rewrite
  -- privacy_settings on a row belonging to somebody else.
  insert into wishlist_items (id, user_id, title, privacy_settings)
    values ('44444444-4444-4444-4444-444444444444', 'user_pp_peer', 'Peer Item',
            '{"visibleToGroupTypes": [], "restrictToGroup": "11111111-1111-1111-1111-111111111111"}');

  ---------------------------------------------------------------------------
  -- 3. POSITIVE CONTROL: a non-owner can still claim.
  --
  -- The role switch is what makes policies apply at all: the CLI connects as
  -- a role with rolbypassrls, so claims alone would leave every assertion
  -- below vacuous -- and, worse here, would leave the trigger looking
  -- harmless, because the connect role is not the row's owner either.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_peer","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update wishlist_items
     set claimed_by = 'user_pp_peer',
         claimed_at = now()
   where id = '22222222-2222-2222-2222-222222222222'
  returning claimed_by into v_text;

  if v_text is distinct from 'user_pp_peer' then
    raise exception
      'PRIVACY PIN: a co-member could not claim a visible wishlist item (claimed_by is %). The pin is too tight -- claiming a gift is the feature the claim policy exists for.',
      coalesce(v_text, '<no row updated>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 4. POSITIVE CONTROL: the rest of the claim columns, in one write.
  --    markAsPurchased() and markOutOfStock() are separate actions in
  --    lib/actions/wishlist.ts; a permitted list that covered claiming but
  --    not these would break them without breaking assertion 3.
  ---------------------------------------------------------------------------
  update wishlist_items
     set purchased = true,
         purchased_at = now(),
         out_of_stock_marked_by = 'user_pp_peer',
         out_of_stock_marked_at = now()
   where id = '22222222-2222-2222-2222-222222222222'
  returning purchased::text || ' ' || coalesce(out_of_stock_marked_by, '<null>')
    into v_text;

  if v_text is distinct from 'true user_pp_peer' then
    raise exception
      'PRIVACY PIN: a co-member could not record purchase / out-of-stock state (got %, expected "true user_pp_peer"). markAsPurchased() and markOutOfStock() would both fail.',
      coalesce(v_text, '<no row updated>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 5. POSITIVE CONTROL: the OWNER may still edit the very columns the pin
  --    holds shut for everybody else, widening privacy included. The trigger
  --    short-circuits on ownership; if that short-circuit were lost, every
  --    ordinary wishlist edit in the app would start raising.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_owner","role":"authenticated"}', true);

  update wishlist_items
     set title = 'Owner Renamed',
         privacy_settings =
           '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'
   where id = '22222222-2222-2222-2222-222222222222'
  returning title, privacy_settings into v_text, v_json;

  if v_text is distinct from 'Owner Renamed'
     or v_json -> 'visibleToGroupTypes'
        is distinct from '["family", "friends", "work", "custom"]'::jsonb
  then
    raise exception
      'PRIVACY PIN: the owner could not edit their own item (title %, visibleToGroupTypes %). updateWishlistItem() writes both columns on every save.',
      coalesce(v_text, '<no row updated>'),
      coalesce((v_json -> 'visibleToGroupTypes')::text, '<none>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 6. POSITIVE CONTROL: a group admin may still rename the group.
  --    pin_group_type is deliberately narrow; name, description and settings
  --    are not its business.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_admin","role":"authenticated"}', true);

  update groups
     set name = 'PP Work Renamed',
         description = 'still a work group'
   where id = '33333333-3333-3333-3333-333333333333'
  returning name into v_text;

  if v_text is distinct from 'PP Work Renamed' then
    raise exception
      'PRIVACY PIN: a group admin could not rename their own group (name is %). pin_group_type has spread beyond ''type''.',
      coalesce(v_text, '<no row updated>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 7. POSITIVE CONTROL, and the one that would break quietly: invite_code
  --    must still rotate, and rotating it must not disturb type.
  --
  --    rotateInviteCode() runs on the member-removal path, before the
  --    membership delete. If it started raising, leaveGroup() would return
  --    "Failed to rotate the group's invite code" and remove nobody -- a
  --    removal that never happens, reported as an unrelated transient error.
  ---------------------------------------------------------------------------
  update groups
     set invite_code = 'PPROT001'
   where id = '33333333-3333-3333-3333-333333333333'
  returning invite_code, type::text into v_text, v_type;

  if v_text is distinct from 'PPROT001' or v_type is distinct from 'work' then
    raise exception
      'PRIVACY PIN: invite_code rotation failed or disturbed the group type (invite_code %, type %). Removing a member depends on this write.',
      coalesce(v_text, '<no row updated>'), coalesce(v_type, '<none>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 8. POSITIVE CONTROL: the schema's own cascade is not an actor, and must
  --    not be treated as one.
  --
  --    cleanup_privacy_overrides_on_group_delete() clears restrictToGroup on
  --    EVERY item that pointed at a deleted group, so deleting a group you own
  --    rewrites privacy_settings on rows belonging to other members. The first
  --    version of the wishlist pin rejected exactly that, which made
  --    deleteGroup() raise for any group where another member had a restricted
  --    item -- a failure that looks nothing like a privacy trigger from the
  --    outside, and that no amount of testing the pin's own attack surface
  --    would have surfaced.
  --
  --    The delete raising is the assertion. The check afterwards is what
  --    proves the cascade actually RAN, rather than matching no rows and
  --    passing vacuously.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_owner","role":"authenticated"}', true);

  delete from groups where id = '11111111-1111-1111-1111-111111111111';

  -- Back to the connect role: the peer's item is visible to nobody now, and
  -- the token insert below needs this role in any case.
  perform set_config('role', v_orig_role, true);

  select privacy_settings -> 'restrictToGroup' into v_json
    from wishlist_items where id = '44444444-4444-4444-4444-444444444444';

  if v_json is distinct from 'null'::jsonb then
    raise exception
      'PRIVACY PIN: deleting a group did not clear restrictToGroup on another member''s item (got %). The cleanup cascade did not run, so a stale group id is still deciding who can see that item.',
      coalesce(v_json::text, '<no such item>');
  end if;
  v_checks := v_checks + 1;

  if v_checks < 10 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 10. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_09_privacy_pins');
end $$;

select token as result from _harness_result;
