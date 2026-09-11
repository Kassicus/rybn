-- The privacy columns a policy cannot defend must stay pinned, and the one
-- rewrite the schema performs on them by itself must fail CLOSED.
--
-- Two defences live here:
--
--   * wishlist_items.privacy_settings (and every other owner-only column)
--     against the claimer, and groups.type against the group's own admins.
--     20260822000000_pin_privacy_columns.sql.
--
--   * the group-delete cascade. Deleting a group used to null restrictToGroup
--     and stop, which reverts the row to its visibleToGroupTypes audience --
--     BROADER than the single group its owner chose. Anyone owning a group a
--     victim had restricted an item to could widen that item by deleting their
--     own group. 20260823000000_cascade_fails_closed.sql makes those rows
--     private instead.
--
-- HOW THIS FILE IS SHAPED, AND WHY IT IS PART BEHAVIOURAL AND PART CATALOG.
--
-- The pins are BEFORE UPDATE triggers that RAISE. This harness cannot assert
-- that a write is denied: a denied write raises, which aborts the do-block, and
-- catching it would need a handler -- which the runner rejects outright, and
-- correctly, because a handler wrapped around an assertion turns a real failure
-- into a passing token. 07_write_path_defences.sql says the same thing about
-- the same class of defect.
--
-- So the denials are asserted where their content actually lives: in the
-- trigger definitions. The permitted-column list is passed as trigger
-- ARGUMENTS, not hardcoded in a function body, precisely so that it can be read
-- back out of the catalog as data and compared exactly -- which is a stronger
-- check than matching a substring of a function's source. A definition that no
-- longer names 'type', or one whose wishlist allow-list has grown to include
-- privacy_settings or title, fails here by name.
--
-- The CASCADE, by contrast, is asserted behaviourally, because that is the only
-- way to catch the defect it was written for. Reading the JSON back proves the
-- cleanup wrote what it meant to; it does NOT prove that what it meant to write
-- is private. `{"restrictToGroup": null, "visibleToGroupTypes": ["family"]}`
-- inspects as a perfectly tidy cleanup and is a live leak. So a third party is
-- fixtured who genuinely reaches the victim through a DIFFERENT family group,
-- and the assertion is that they cannot read the item after the delete. Under
-- the old cleanup they could -- verified, see the task report.
--
-- Two catalog assertions guard the wishlist pin's only exemption. Writes
-- arriving at pg_trigger_depth() > 1 are the schema's own cascade rather than
-- an actor's, and are admitted in the exact shape that cascade uses. That is
-- sound only while (a) the inventory of trigger functions reaching
-- wishlist_items stays known and (b) the shape check is still a shape check.
-- Both are asserted rather than described. (b) matters because it is the one
-- direction with no behavioural signal: an exemption that is too TIGHT breaks
-- deleteGroup() loudly and is caught below, while an exemption widened to a
-- blanket pass breaks nothing, leaks quietly, and would otherwise be caught by
-- nothing at all.
--
-- The allow path is asserted for real, by executing it. That half matters as
-- much as the denials: an over-tight pin does not leak anything, it just
-- silently stops people claiming gifts, and stops the member-removal flow
-- rotating the invite code -- which would leave a removal that never happens
-- while every screen reports success. Those are the positive controls below,
-- and they are the reason invite_code is deliberately NOT pinned.
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
  v_src       text;
  v_text      text;
  v_type      text;
  v_json      jsonb;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- 1. wishlist_items: the pin exists, and its permitted list is EXACTLY the
  --    non-owner write surface: purchase and out-of-stock state.
  --
  --    Everything absent from that list is owner-only, so this single
  --    comparison is what stands between a co-member who can see an item and
  --    a co-member who can rename it, re-price it, re-point it at themselves
  --    or WIDEN its privacy_settings. A non-owner only ever needs the five
  --    columns named here (lib/actions/wishlist.ts: purchase, out-of-stock;
  --    claiming itself is no longer a write to this table at all -- it goes
  --    through wishlist_claims / claim_wishlist_item(), which this trigger
  --    never sees), and updated_at is among them because
  --    update_wishlist_items_updated_at sorts after 'pin_' and writes it on
  --    the non-owner's behalf.
  --
  --    The whole definition is compared, not just the arguments, so a trigger
  --    quietly re-pointed at another function, or demoted from BEFORE to
  --    AFTER (where raising is too late to keep the row unchanged), fails
  --    here too.
  --
  --    claimed_by/claimed_at left this list in 20260911100003_drop_item_claim_
  --    columns.sql -- claiming moved to wishlist_claims / claim_wishlist_item()
  --    (Task 2/3) -- so the permitted set is now exactly the five columns a
  --    non-owner still writes directly on the item: purchase and out-of-stock
  --    state, plus updated_at, which update_wishlist_items_updated_at sorts
  --    after 'pin_' and writes on the claimer's behalf.
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
     'CREATE TRIGGER pin_wishlist_item_owner_fields BEFORE UPDATE ON public.wishlist_items FOR EACH ROW EXECUTE FUNCTION reject_non_owner_column_change(''purchased'', ''purchased_at'', ''out_of_stock_marked_by'', ''out_of_stock_marked_at'', ''updated_at'')'
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
  -- 2. THE CASCADE EXEMPTION MUST STILL BE A SHAPE CHECK.
  --
  --    reject_non_owner_column_change() lets privacy_settings through at
  --    pg_trigger_depth() > 1, but only when the new value is byte-for-byte
  --    what cleanup_privacy_overrides_on_group_delete() would have written --
  --    restrictToGroup null AND visibleToGroupTypes [], together, computed
  --    from the old row. Replacing that with a bare `return new` at depth > 1
  --    is the obvious way to make a failing deleteGroup() go away, and it hands
  --    every future trigger on this table an unexamined pass at the column the
  --    whole privacy model rests on.
  --
  --    This is a source check, which is weaker than the catalog checks above,
  --    and it is here because it is the only check available in this direction:
  --    an exemption that is too tight fails assertion 13 loudly, an exemption
  --    that is too loose fails nothing. Both markers are required -- the raise
  --    (so the branch still refuses something) and the second key (so the shape
  --    is the current one and not a revert to the restrictToGroup-only form
  --    that the cascade no longer writes).
  ---------------------------------------------------------------------------
  select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'reject_non_owner_column_change';

  if v_src is null
     or position('CASCADE SHAPE' in v_src) = 0
     or position('visibleToGroupTypes' in v_src) = 0
  then
    raise exception
      'PRIVACY PIN: reject_non_owner_column_change() no longer bounds its depth > 1 exemption to the cascade''s shape (CASCADE SHAPE raise present: %, visibleToGroupTypes present: %). A blanket pass at depth > 1 lets any future trigger rewrite privacy_settings on rows it does not own.',
      coalesce((position('CASCADE SHAPE' in v_src) > 0)::text, '<no such function>'),
      coalesce((position('visibleToGroupTypes' in v_src) > 0)::text, '<no such function>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 3. NOTHING ELSE MAY REACH wishlist_items FROM A TRIGGER.
  --
  --    The depth exemption is sound only while the inventory of trigger
  --    functions touching this table is known: today it is exactly
  --    cleanup_privacy_overrides_on_group_delete(), reachable only by deleting
  --    a group you own. A trigger added later would inherit the exemption
  --    silently, and a comment cannot stop that -- this can.
  --
  --    Matched on prosrc, so a function that merely NAMES the table is caught.
  --    Being over-broad is the right direction here: a false positive costs a
  --    one-line edit to the expected string, a false negative is a bypass
  --    nobody sees.
  ---------------------------------------------------------------------------
  select coalesce(string_agg(t.tgname || '/' || p.proname, ', '
                             order by t.tgname, p.proname), '<none>')
    into v_text
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and p.prosrc ilike '%wishlist_items%'
     and p.proname <> 'reject_non_owner_column_change';

  if v_text is distinct from
     'cleanup_privacy_on_group_delete/cleanup_privacy_overrides_on_group_delete'
  then
    raise exception
      'PRIVACY PIN: the set of triggers whose function touches wishlist_items has changed. Expected exactly cleanup_privacy_on_group_delete/cleanup_privacy_overrides_on_group_delete, found: %. Every entry writes at pg_trigger_depth() > 1 and is therefore exempt from the owner check -- read the new one before widening this expectation.',
      v_text;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 4. groups: type is pinned, and NOTHING ELSE IS.
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
  -- FIXTURES.
  --
  -- The cast, and what each part of it is for:
  --
  --   owner + peer share FAMILY GROUP ONE, and owner's item is family-visible,
  --   so the peer genuinely reaches it through "Users can claim visible
  --   wishlist items" rather than through an accident of the fixture.
  --
  --   admin owns a separate WORK group (add_group_creator_as_owner makes them
  --   its owner on insert), which is what makes is_group_admin() true for the
  --   groups updates below.
  --
  --   peer is the VICTIM of the cascade defect. Their restricted item and
  --   restricted profile field both point at FAMILY GROUP ONE -- a group the
  --   OWNER owns and can delete at will.
  --
  --   third and outsider are the two people the widening would expose:
  --     third    is in group one AND in FAMILY GROUP TWO with the peer, so
  --              they can see the restricted item BEFORE the delete, through
  --              exactly the group its owner named.
  --     outsider is in group two ONLY, so they cannot see it before the
  --              delete -- and, under the old cleanup, could see it after.
  --   Group two is what makes both of them still share a 'family' group with
  --   the peer once group one is gone, which is the entire mechanism of the
  --   widening.
  --
  --   The control item and control field are the peer's, family-visible and
  --   NOT restricted, so the cascade has no business touching them. They are
  --   what makes the invisibility assertions non-vacuous: without them, an
  --   outsider who could see nothing at all -- a broken fixture, a
  --   get_shared_groups() that returned nothing -- would pass every one.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name) values
    ('user_pp_owner',    'ppowner',    'PP Owner'),
    ('user_pp_peer',     'pppeer',     'PP Peer'),
    ('user_pp_admin',    'ppadmin',    'PP Admin'),
    ('user_pp_third',    'ppthird',    'PP Third'),
    ('user_pp_outsider', 'ppoutsider', 'PP Outsider');

  -- FAMILY GROUP ONE -- owned by user_pp_owner, the group the victim restricts to.
  insert into groups (id, name, type, invite_code, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'PP Family', 'family',
            'PPCODE01', 'user_pp_owner');

  insert into group_members (group_id, user_id, role) values
    ('11111111-1111-1111-1111-111111111111', 'user_pp_peer',  'member'),
    ('11111111-1111-1111-1111-111111111111', 'user_pp_third', 'member')
    on conflict do nothing;

  -- FAMILY GROUP TWO -- owned by the victim. Survives the delete, and is what
  -- gives third and outsider a 'family' relationship with the victim
  -- afterwards. This is the wider audience the old cleanup fell back to.
  insert into groups (id, name, type, invite_code, created_by)
    values ('55555555-5555-5555-5555-555555555555', 'PP Family Two', 'family',
            'PPCODE03', 'user_pp_peer');

  insert into group_members (group_id, user_id, role) values
    ('55555555-5555-5555-5555-555555555555', 'user_pp_third',    'member'),
    ('55555555-5555-5555-5555-555555555555', 'user_pp_outsider', 'member')
    on conflict do nothing;

  -- WORK GROUP -- unrelated to the cascade; the pin_group_type controls use it.
  insert into groups (id, name, type, invite_code, created_by)
    values ('33333333-3333-3333-3333-333333333333', 'PP Work', 'work',
            'PPCODE02', 'user_pp_admin');

  insert into wishlist_items (id, user_id, title, privacy_settings)
    values ('22222222-2222-2222-2222-222222222222', 'user_pp_owner', 'Original Title',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}');

  -- The VICTIM's restricted item. Note visibleToGroupTypes is NOT empty: that
  -- is the fallback audience the old cleanup promoted it back to.
  insert into wishlist_items (id, user_id, title, privacy_settings)
    values ('44444444-4444-4444-4444-444444444444', 'user_pp_peer', 'Peer Restricted Item',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": "11111111-1111-1111-1111-111111111111"}');

  -- The victim's control item: same audience, no restriction, so the cascade
  -- must leave it exactly as it is.
  insert into wishlist_items (id, user_id, title, privacy_settings)
    values ('66666666-6666-6666-6666-666666666666', 'user_pp_peer', 'Peer Control Item',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings) values
    ('user_pp_peer', 'personal', 'pp_phone', '555-0100',
     '{"visibleToGroupTypes": ["family"], "restrictToGroup": "11111111-1111-1111-1111-111111111111"}'),
    ('user_pp_peer', 'personal', 'pp_nickname', 'Peep',
     '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'),
    -- Carries a group-keyed override for BOTH groups. Only the deleted group's
    -- key may be stripped, and nothing else on this row may move: it is not
    -- restricted, so the fail-closed update has no business reaching it.
    ('user_pp_peer', 'sizes', 'pp_shirt', 'M',
     '{"visibleToGroupTypes": ["family"], "restrictToGroup": null,
       "overrides": {"11111111-1111-1111-1111-111111111111": ["family"],
                     "33333333-3333-3333-3333-333333333333": ["work"]}}');

  ---------------------------------------------------------------------------
  -- Impersonate a non-owning co-member for the positive controls below.
  --
  -- The role switch is what makes policies apply at all: the CLI connects as
  -- a role with rolbypassrls, so claims alone would leave every assertion
  -- below vacuous -- and, worse here, would leave the trigger looking
  -- harmless, because the connect role is not the row's owner either.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_peer","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  ---------------------------------------------------------------------------
  -- 6. POSITIVE CONTROL: every column a non-owner may write, in one write.
  --    markAsPurchased() and markOutOfStock() are separate actions in
  --    lib/actions/wishlist.ts; a permitted list that covered claiming but
  --    not these would break them without breaking assertion 1.
  --
  --    THIS IS NOW THE SOLE COVER FOR `purchased`. A separate single-column
  --    assertion used to precede this one, writing `purchased` alone. It was
  --    removed because it had no independent falsifying power:
  --    reject_non_owner_column_change() compares every changed column in one
  --    set-based pass (20260822000000_pin_privacy_columns.sql:125-128) with no
  --    per-column branching, so a one-column write and a four-column write run
  --    identical code -- nothing could fail the narrower assertion and pass
  --    this one. If this write is ever narrowed, `purchased` loses its cover
  --    entirely; widen it or add back a dedicated assertion rather than
  --    trimming the column list.
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
  -- 7. POSITIVE CONTROL: the OWNER may still edit the very columns the pin
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
  -- 8. POSITIVE CONTROL: a group admin may still rename the group.
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
  -- 9. POSITIVE CONTROL, and the one that would break quietly: invite_code
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
  -- 10. BEFORE THE DELETE: the restriction is doing real work, and the
  --     fixture is real.
  --
  --     Read as the OUTSIDER. They share family group two with the victim, so
  --     the control item -- family-visible, unrestricted -- must be readable.
  --     The restricted item points at family group ONE, which they are not in,
  --     so it must not be.
  --
  --     Both halves in one assertion because neither means anything alone:
  --     "cannot see the restricted item" is satisfied by an outsider who can
  --     see nothing, and that is exactly the failure mode that would make
  --     assertion 14 -- the one that matters -- pass without proving anything.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_outsider","role":"authenticated"}', true);

  select count(*) filter (where id = '44444444-4444-4444-4444-444444444444')::text
         || '/' ||
         count(*) filter (where id = '66666666-6666-6666-6666-666666666666')::text
    into v_text
    from wishlist_items
   where user_id = 'user_pp_peer';

  if v_text is distinct from '0/1' then
    raise exception
      'PRIVACY PIN: before the group delete an outsider saw restricted/control = % (expected 0/1). Either restrictToGroup is not gating the restricted item, or the outsider cannot reach the victim at all -- in which case every invisibility assertion below is vacuous.',
      coalesce(v_text, '<no rows>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 11. BEFORE THE DELETE: the third party CAN see the restricted item,
  --     through the one group its owner named. This is the "before" half of
  --     the defect: they see it because of family group one, and after the
  --     delete they must not see it at all -- not through family group two,
  --     not through anything.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_third","role":"authenticated"}', true);

  select count(*)::text into v_text
    from wishlist_items
   where id = '44444444-4444-4444-4444-444444444444';

  if v_text is distinct from '1' then
    raise exception
      'PRIVACY PIN: before the group delete a member of the restricted group could not see the restricted item (count %). restrictToGroup is not granting access, so the fixture does not reproduce the situation the cascade is about.',
      coalesce(v_text, '<no rows>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 12. BEFORE THE DELETE: the same, for a profile field. profile_info runs
  --     through can_view_field(), a separate function with the same
  --     precedence rules, and the cascade updates it with a separate
  --     statement -- so it gets its own coverage rather than riding on the
  --     wishlist result.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_outsider","role":"authenticated"}', true);

  select count(*) filter (where field_name = 'pp_phone')::text
         || '/' ||
         count(*) filter (where field_name = 'pp_nickname')::text
    into v_text
    from profile_info
   where user_id = 'user_pp_peer';

  if v_text is distinct from '0/1' then
    raise exception
      'PRIVACY PIN: before the group delete an outsider saw restricted/control profile fields = % (expected 0/1). Same problem as assertion 10, on the profile_info path.',
      coalesce(v_text, '<no rows>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 13. THE CASCADE MUST SUCCEED. This is the coupling, and it is the
  --     assertion that pays for the exemption in
  --     reject_non_owner_column_change().
  --
  --     cleanup_privacy_overrides_on_group_delete() rewrites privacy_settings
  --     on EVERY row that pointed at the deleted group -- including rows
  --     belonging to other members -- so this DELETE drives a depth-2 write
  --     into a table whose privacy_settings column is owner-only. The first
  --     version of the wishlist pin refused it, which made deleteGroup() raise
  --     for any group where another member had a restricted item: a failure
  --     that looks nothing like a privacy trigger from the outside.
  --
  --     Any change to what the cleanup WRITES has to move the exemption's
  --     expected shape with it, or this assertion is where that is discovered.
  --
  --     RETURNING is the assertion, not just decoration: a DELETE the policy
  --     silently matched no rows for would leave every check below inspecting
  --     an untouched fixture and passing for the wrong reason.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_owner","role":"authenticated"}', true);

  delete from groups
   where id = '11111111-1111-1111-1111-111111111111'
  returning id::text into v_text;

  if v_text is distinct from '11111111-1111-1111-1111-111111111111' then
    raise exception
      'PRIVACY PIN: the group owner could not delete their own group (returned %). deleteGroup() is broken -- most likely the cascade''s depth > 1 write of privacy_settings is no longer the shape reject_non_owner_column_change() admits.',
      coalesce(v_text, '<no row deleted>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 14. THE DEFECT. After the delete the outsider must STILL not see the
  --     restricted item -- and must still see the control item.
  --
  --     Under the old cleanup this read 1/1: nulling restrictToGroup reverted
  --     the item to its visibleToGroupTypes audience, family group two made
  --     the outsider part of that audience, and an item its owner had scoped
  --     to a single group became readable by somebody who was never in it.
  --     The owner of family group one caused that by deleting their OWN group.
  --
  --     The control half is what distinguishes "the cascade made it private"
  --     from "the cascade broke every row it could reach".
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_outsider","role":"authenticated"}', true);

  select count(*) filter (where id = '44444444-4444-4444-4444-444444444444')::text
         || '/' ||
         count(*) filter (where id = '66666666-6666-6666-6666-666666666666')::text
    into v_text
    from wishlist_items
   where user_id = 'user_pp_peer';

  if v_text is distinct from '0/1' then
    raise exception
      'CASCADE FAILS OPEN: after deleting a group, an outsider saw restricted/control = % (expected 0/1). A wishlist item restricted to the deleted group fell back to its visibleToGroupTypes audience instead of becoming private, so deleting a group WIDENED who can see another user''s item.',
      coalesce(v_text, '<no rows>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 15. The third party who COULD see it before -- legitimately, through the
  --     group its owner named -- must not see it now. Their access ended with
  --     the group it was granted through; family group two is not a
  --     replacement for it.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_third","role":"authenticated"}', true);

  select count(*)::text into v_text
    from wishlist_items
   where id = '44444444-4444-4444-4444-444444444444';

  if v_text is distinct from '0' then
    raise exception
      'CASCADE FAILS OPEN: after deleting the restricted group, a member of it still sees the item (count %). Access granted by restrictToGroup must end with the group, not silently continue through whatever other group happens to share its type.',
      coalesce(v_text, '<no rows>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 16. The same defect on the profile_info path, which the cascade updates
  --     with its own statement.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_pp_outsider","role":"authenticated"}', true);

  select count(*) filter (where field_name = 'pp_phone')::text
         || '/' ||
         count(*) filter (where field_name = 'pp_nickname')::text
    into v_text
    from profile_info
   where user_id = 'user_pp_peer';

  if v_text is distinct from '0/1' then
    raise exception
      'CASCADE FAILS OPEN: after deleting a group, an outsider saw restricted/control profile fields = % (expected 0/1). A profile field restricted to the deleted group fell back to its visibleToGroupTypes audience instead of becoming private.',
      coalesce(v_text, '<no rows>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Back to the connect role for the stored-value checks. The three
  -- assertions below read what the cascade actually WROTE. They are the
  -- weaker half -- the behavioural ones above are what prove the audience is
  -- empty -- but they pin the exact value, which is what the exemption in
  -- reject_non_owner_column_change() recomputes and compares against.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- 17. The restricted item is now private, in full: restrictToGroup null AND
  --     visibleToGroupTypes empty. Compared as a whole object, not key by
  --     key, because "restrictToGroup is null" was exactly the check that
  --     passed for two days while the row stayed visible.
  ---------------------------------------------------------------------------
  select privacy_settings into v_json
    from wishlist_items where id = '44444444-4444-4444-4444-444444444444';

  if v_json is distinct from
     '{"restrictToGroup": null, "visibleToGroupTypes": []}'::jsonb
  then
    raise exception
      'CASCADE FAILS OPEN: the restricted wishlist item''s privacy_settings after the delete are % (expected restrictToGroup null and visibleToGroupTypes []). An empty visibleToGroupTypes is what can_view_wishlist_item() reads as invisible-to-everyone-but-the-owner; anything else is an audience.',
      coalesce(v_json::text, '<no such item>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 18. The same for the restricted profile field.
  ---------------------------------------------------------------------------
  select privacy_settings into v_json
    from profile_info
   where user_id = 'user_pp_peer' and field_name = 'pp_phone';

  if v_json is distinct from
     '{"restrictToGroup": null, "visibleToGroupTypes": []}'::jsonb
  then
    raise exception
      'CASCADE FAILS OPEN: the restricted profile field''s privacy_settings after the delete are % (expected restrictToGroup null and visibleToGroupTypes []).',
      coalesce(v_json::text, '<no such field>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 19. The overrides stripping still works, and only it touched this row.
  --
  --     The cleanup's FIRST update is unchanged and must stay that way: a
  --     group-keyed override cannot outlive its group, and dropping the key
  --     restores the row's own settings rather than widening anything. The
  --     surviving work-group key proves the strip was targeted at the deleted
  --     group rather than clearing the object. The untouched restrictToGroup
  --     and visibleToGroupTypes prove the new fail-closed update kept to the
  --     rows it was aimed at -- this row was never restricted, so making it
  --     private would be the cascade destroying an audience nobody asked it
  --     to touch.
  ---------------------------------------------------------------------------
  select privacy_settings into v_json
    from profile_info
   where user_id = 'user_pp_peer' and field_name = 'pp_shirt';

  if v_json is distinct from
     '{"restrictToGroup": null, "visibleToGroupTypes": ["family"],
       "overrides": {"33333333-3333-3333-3333-333333333333": ["work"]}}'::jsonb
  then
    raise exception
      'PRIVACY PIN: the overrides cleanup did not behave. privacy_settings on the override-carrying field are % -- expected the deleted group''s key stripped, the work group''s key kept, and restrictToGroup/visibleToGroupTypes untouched.',
      coalesce(v_json::text, '<no such field>');
  end if;
  v_checks := v_checks + 1;

  if v_checks < 20 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 21. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_09_privacy_pins');
end $$;

select token as result from _harness_result;
