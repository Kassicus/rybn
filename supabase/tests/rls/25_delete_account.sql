-- 20261114000000_delete_account.sql: three foreign keys to user_profiles
-- given an on-delete action (invitations.invited_by on delete cascade;
-- group_gifts.target_user_id and gift_exchange_participants.assigned_to on
-- delete set null); delete_account(), which deletes the caller's account and
-- hands each group they own to its owner if it has another, else an admin,
-- else a member, and among those the one who has been there longest; and no
-- policy that lets a signed-in person delete their profile row directly.
-- This file proves:
--
--   1. The foreign keys (assertions 1-3). Each column has exactly one foreign
--      key on it alone, to user_profiles, with the new on-delete action.
--   2. A profile row is deleted only through delete_account() (assertion 4):
--      user_profiles has no DELETE or ALL policy, among policies that exist.
--   3. The function (assertions 5-11). It takes no argument, so nobody can
--      name someone else; it returns void; it is SECURITY DEFINER with
--      search_path pinned. authenticated may execute it, and neither anon
--      nor service_role may, with no grant to PUBLIC. Its deployed
--      definition holds no block comment and names neither the wishlist
--      items table nor the bought flag. It takes the caller from
--      requesting_user_id() and refuses a signed-out call with 28000 before
--      its first write; it locks the groups it visits (for update of g) and
--      each heir's member row (for update of gm) before it changes a role or
--      deletes a group; and it draws new invite codes from gen_random_uuid()
--      over the website's alphabet, with no call to the non-cryptographic
--      generator.
--   4. The fixture (assertions 12-13). gone owns G1, G2, G3 and G6, is a
--      member of G4 (made by gone long ago, owned by owner4 now) and an admin
--      of G7 (a group with no owner), and has no member row in G5 (made by
--      gone, owned by left5 now), G8 (other4's, where gone made only a group
--      gift) or G9 (early's, where gone made only an exchange). gone holds a
--      row in every column that references user_profiles but one
--      (anniversary_links.user_a: gone is the later id of the link, so the
--      occasion's partner is set null rather than the occasion deleted):
--      profile fields, a stored visibility choice, their own tracker row and
--      gift, a chat message, contributions, date reminders, a birthday
--      occasion, an anniversary link with early, a claimed and tagged item
--      of their own that owner4 tracks, an out-of-stock mark on owner4's
--      item, and a profile field restricted to G3 beside early's item
--      restricted to G3.
--   5. Before the call, gone's own direct delete of their profile row
--      deletes nothing and the row is still there (assertion 14).
--   6. One call by gone (assertions 15-45).
--      - Groups: G1 passes to admin1 (an admin before a member, then the
--        longest-standing admin); G2 to m_early (the longest-standing
--        member); G3, with nobody else in it, is deleted with its date and
--        invitation; G4 stays owner4's and names owner4 as its maker, and
--        gone's invitation there goes while owner4's stays; G5, G8 and G9
--        each have the thing gone made there handed on; G6 passes to pair6;
--        G7 passes to other7.
--      - Group gifts gone made go to their longest-standing contributor who
--        is neither gone nor the person they are for, whether or not that
--        contributor is in the group (Dacc Made to other4, Dacc Outside to
--        m_late, Dacc Left Gift to left5, Dacc Lone Gift to other4), and are
--        deleted when there is no such contributor (Dacc Solo, Dacc Self,
--        Dacc Only). owner4's gift that gone paid into keeps the amount the
--        remaining contributions give, and gone's chat message goes.
--      - Exchanges: the one not yet held, the one with no date and the one
--        in which gone is only someone's match are cleared to be drawn again;
--        the one already held keeps owner4's match, and other4's match to
--        gone is cleared.
--      - Invite codes: every group gone was a member of and that is kept has
--        a new code of the website's shape, different from the old and from
--        each other, and the old code finds nothing; G5, G8 and G9 keep
--        theirs.
--      - What other people keep: owner4's item is claimable again; the item
--        gone bought stays bought; owner4's item is no longer marked out of
--        stock and nothing else on it changed; owner4's tracked gift from
--        gone's item stays, with no item and no occasion; owner4's tracker
--        row for gone stays as a typed name; early keeps their profile, their
--        anniversary field and their anniversary occasion, with no partner
--        and no link; early's item restricted to G3 stays, seen by nobody.
--      - gone has no profile, no membership and no item, and no row in any
--        column that references user_profiles names gone.
--   7. A second call by gone, who now has no profile (assertion 46), raises
--      nothing and changes nothing in the groups this file made, their
--      makers, members, roles and invite codes.
--
-- A SIGNED-OUT CALL IS NOT ATTEMPTED LIVE. It raises 28000, and one uncaught
-- raise ends the whole batch this file is sent as; the runner bans handlers
-- file-wide. It is held by line-anchored checks of the deployed definition
-- (assertion 8), with the no-block-comment floor beneath them (assertion 7),
-- and a check that the refusal comes before the first write.
--
-- THE DIRECT DELETE IS ATTEMPTED LIVE (assertion 14), because it does not
-- raise: authenticated holds DELETE on user_profiles (the baseline's table
-- grant; nothing later revokes it there), which is all the live check needs,
-- so with no delete policy the statement runs and row-level security leaves
-- it no row. Assertion 4 runs first, so a delete policy that came back fails
-- there, by count, before this statement is sent.
--
-- THE SWEEPS (assertions 13 and 45) read every single-column foreign key to
-- user_profiles from the catalog and count, per column, the rows naming
-- gone, with execute and format('%I'); as the connecting role every table
-- is readable, so none of them raises.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. delete_account() is called as the
-- signed-in gone, as the website calls it: request.jwt.claims and role are
-- set around each call and around the direct delete, and `role` goes back to
-- the captured current_user before every catalog read and every read that
-- verifies a write. The direct delete reads its row_count. now() is one value
-- for the whole transaction, so every joined_at is written out.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role     text;
  v_checks        int := 0;
  v_gone          text := 'user_dacc_gone';
  v_early         text := 'user_dacc_early';
  v_admin1        text := 'user_dacc_admin1';
  v_admin2        text := 'user_dacc_admin2';
  v_m_early       text := 'user_dacc_m_early';
  v_m_late        text := 'user_dacc_m_late';
  v_owner4        text := 'user_dacc_owner4';
  v_other4        text := 'user_dacc_other4';
  v_left5         text := 'user_dacc_left5';
  v_pair6         text := 'user_dacc_pair6';
  v_other7        text := 'user_dacc_other7';
  v_g1            uuid;
  v_g2            uuid;
  v_g3            uuid;
  v_g4            uuid;
  v_g5            uuid;
  v_g6            uuid;
  v_g7            uuid;
  v_g8            uuid;
  v_g9            uuid;
  v_made          uuid;
  v_outside       uuid;
  v_solo          uuid;
  v_self          uuid;
  v_shared        uuid;
  v_for           uuid;
  v_only          uuid;
  v_left_gift     uuid;
  v_lone_gift     uuid;
  v_soon          uuid;
  v_held          uuid;
  v_undated       uuid;
  v_matched       uuid;
  v_left_draw     uuid;
  v_lone_draw     uuid;
  v_claimed       uuid;
  v_bought        uuid;
  v_mine          uuid;
  v_stock         uuid;
  v_was_there     uuid;
  v_tracker       uuid;
  v_mom           uuid;
  v_mine_gift     uuid;
  v_bday          uuid;
  v_anniv         uuid;
  v_link          uuid;
  v_count         int;
  v_count2        int;
  v_count3        int;
  v_count4        int;
  v_count5        int;
  v_count6        int;
  v_amount        numeric;
  -- A block-comment opener, built so this file holds none itself.
  v_block_open    text := '/' || '*';
  v_def           text;
  v_pos_refusal   int;
  v_pos_lock      int;
  v_pos_heir      int;
  v_pos_role      int;
  v_pos_delete    int;
  v_nargs         int;
  v_rettype       regtype;
  v_secdef        boolean;
  v_config        text[];
  v_can_authed    boolean;
  v_can_anon      boolean;
  v_can_service   boolean;
  v_acl_set       boolean;
  v_public_exec   boolean;
  v_role          text;
  v_role2         text;
  v_role3         text;
  v_created_by    text;
  v_created_by2   text;
  v_target        text;
  v_celebrant     text;
  v_partner       text;
  v_generated     boolean;
  v_from_list     boolean;
  v_assigned      text;
  v_assigned2     text;
  v_bought_flag   boolean;
  v_person        text;
  v_item          uuid;
  v_occ           uuid;
  v_settings      jsonb;
  v_stock_before  jsonb;
  v_stock_after   jsonb;
  v_codes         text;
  v_fk            record;
  v_n             int;
  v_fk_total      int;
  v_fk_multi      int;
  v_found         text;
  v_fp1           text;
  v_fp2           text;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_gone,    'daccgone',   'Dacc Gone'),
           (v_early,   'daccearly',  'Dacc Early'),
           (v_admin1,  'daccadmin1', 'Dacc Admin1'),
           (v_admin2,  'daccadmin2', 'Dacc Admin2'),
           (v_m_early, 'daccmearly', 'Dacc M Early'),
           (v_m_late,  'daccmlate',  'Dacc M Late'),
           (v_owner4,  'daccowner4', 'Dacc Owner4'),
           (v_other4,  'daccother4', 'Dacc Other4'),
           (v_left5,   'daccleft',   'Dacc Left5'),
           (v_pair6,   'daccpair',   'Dacc Pair6'),
           (v_other7,  'daccother7', 'Dacc Other7');

  -- G1-G7 are made by gone, so add_group_creator_as_owner() makes gone their
  -- owner (joined now()). G8 is other4's and G9 early's, so each of them
  -- owns theirs.
  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Admins', 'custom', 'DACCADM1', v_gone)
    returning id into v_g1;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Members', 'custom', 'DACCMEM1', v_gone)
    returning id into v_g2;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Alone', 'custom', 'DACCALN1', v_gone)
    returning id into v_g3;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Old', 'custom', 'DACCOLD1', v_gone)
    returning id into v_g4;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Left', 'custom', 'DACCLFT1', v_gone)
    returning id into v_g5;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Pair', 'custom', 'DACCPAR1', v_gone)
    returning id into v_g6;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Ownerless', 'custom', 'DACCOWN1', v_gone)
    returning id into v_g7;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Gift Only', 'custom', 'DACCGFT1', v_other4)
    returning id into v_g8;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Draw Only', 'custom', 'DACCDRW1', v_early)
    returning id into v_g9;

  -- G1: early is the longest-standing, but a member; admin1 is the
  -- longer-standing of the two admins. G2: m_early joined before m_late
  -- although inserted after. G4: owner4 owns it. G5: left5 owns it. G6:
  -- pair6 alone besides gone. G7: other7 alone besides gone.
  insert into group_members (group_id, user_id, role, joined_at)
    values (v_g1, v_early,   'member', now() - interval '300 days'),
           (v_g1, v_admin1,  'admin',  now() - interval '200 days'),
           (v_g1, v_admin2,  'admin',  now() - interval '100 days'),
           (v_g2, v_m_late,  'member', now() - interval '100 days'),
           (v_g2, v_m_early, 'member', now() - interval '200 days'),
           (v_g4, v_owner4,  'owner',  now() - interval '400 days'),
           (v_g4, v_other4,  'member', now() - interval '50 days'),
           (v_g5, v_left5,   'owner',  now() - interval '150 days'),
           (v_g6, v_pair6,   'member', now() - interval '100 days'),
           (v_g7, v_other7,  'member', now() - interval '20 days');

  -- gone made G4 long ago and is no longer its owner (Review Focus 1), and
  -- G7 has no owner at all (a role changed by hand).
  update group_members
     set role = 'member'
   where group_id = v_g4 and user_id = v_gone;

  update group_members
     set role = 'admin'
   where group_id = v_g7 and user_id = v_gone;

  -- gone made G5 and has left it.
  delete from group_members
   where group_id = v_g5 and user_id = v_gone;

  -- Occasions: G3's date, made by gone; gone's own birthday; and early's
  -- anniversary, shared with gone (gone its partner).
  insert into occasions (group_id, kind, name, occasion_date, created_by)
    values (v_g3, 'group_date', 'Dacc Day', current_date + 30, v_gone);

  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_gone, 'birthday', '2030-06-15')
    returning id into v_bday;

  insert into occasions (celebrant_id, partner_id, kind, occasion_date)
    values (v_early, v_gone, 'anniversary', '2030-06-20')
    returning id into v_anniv;

  -- gone's invitation to G3, gone's and owner4's to G4.
  insert into invitations (group_id, email, invited_by, token, expires_at)
    values (v_g3, 'alone@example.com',  v_gone,   'dacc_inv_alone',  now() + interval '7 days'),
           (v_g4, 'friend@example.com', v_gone,   'dacc_inv_gone',   now() + interval '7 days'),
           (v_g4, 'pal@example.com',    v_owner4, 'dacc_inv_owner4', now() + interval '7 days');

  -- Items: owner4's Dacc Claimed and Dacc Bought, each claimed by gone (one
  -- of them bought); gone's own Dacc Mine; owner4's Dacc Stock, which gone
  -- marked out of stock and other4 has claimed; and early's Dacc Was There,
  -- restricted to G3.
  insert into wishlist_items (user_id, title, purchased)
    values (v_owner4, 'Dacc Claimed', false)
    returning id into v_claimed;

  insert into wishlist_items (user_id, title, purchased)
    values (v_owner4, 'Dacc Bought', true)
    returning id into v_bought;

  insert into wishlist_items (user_id, title)
    values (v_gone, 'Dacc Mine')
    returning id into v_mine;

  insert into wishlist_items (user_id, title, purchased, out_of_stock_marked_by, out_of_stock_marked_at)
    values (v_owner4, 'Dacc Stock', false, v_gone, now() - interval '1 day')
    returning id into v_stock;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_early, 'Dacc Was There',
            jsonb_build_object('visibleToGroupTypes', '["custom"]'::jsonb,
                               'restrictToGroup', v_g3::text))
    returning id into v_was_there;

  -- Claims: gone's on Dacc Claimed and Dacc Bought; owner4's on Dacc Mine,
  -- filed under gone's birthday; other4's on Dacc Stock.
  insert into wishlist_claims (item_id, occasion_id, claimed_by)
    values (v_claimed, null,   v_gone),
           (v_bought,  null,   v_gone),
           (v_mine,    v_bday, v_owner4),
           (v_stock,   null,   v_other4);

  -- gone's tag of Dacc Mine for their birthday.
  insert into wishlist_item_occasions (item_id, occasion_id)
    values (v_mine, v_bday);

  -- Group gifts. In G4, gone made: Dacc Made for owner4 (contributors gone,
  -- then other4, then admin1, who is not in G4); Dacc Outside for no one
  -- (contributors gone, then m_late, not in G4); Dacc Solo for no one (gone
  -- its only contributor); Dacc Self for owner4 (contributors gone and owner4
  -- themself). owner4 made Dacc Shared for no one (contributors owner4, 20,
  -- and gone, 30) and Dacc For for gone. In G5 gone made Dacc Left Gift for
  -- no one (contributors gone, then left5); in G6 Dacc Only for pair6 (no
  -- contributor); in G8 Dacc Lone Gift for no one (contributors other4, then
  -- gone).
  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc Made', v_owner4, v_gone)
    returning id into v_made;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc Outside', null, v_gone)
    returning id into v_outside;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc Solo', null, v_gone)
    returning id into v_solo;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc Self', v_owner4, v_gone)
    returning id into v_self;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc Shared', null, v_owner4)
    returning id into v_shared;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc For', v_gone, v_owner4)
    returning id into v_for;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g5, 'Dacc Left Gift', null, v_gone)
    returning id into v_left_gift;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g6, 'Dacc Only', v_pair6, v_gone)
    returning id into v_only;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g8, 'Dacc Lone Gift', null, v_gone)
    returning id into v_lone_gift;

  insert into group_gift_members (group_gift_id, user_id, contribution_amount, joined_at)
    values (v_made,      v_gone,   0,  now() - interval '60 days'),
           (v_made,      v_other4, 0,  now() - interval '40 days'),
           (v_made,      v_admin1, 0,  now() - interval '20 days'),
           (v_outside,   v_gone,   0,  now() - interval '60 days'),
           (v_outside,   v_m_late, 0,  now() - interval '30 days'),
           (v_solo,      v_gone,   0,  now() - interval '60 days'),
           (v_self,      v_gone,   0,  now() - interval '60 days'),
           (v_self,      v_owner4, 0,  now() - interval '30 days'),
           (v_shared,    v_owner4, 20, now() - interval '30 days'),
           (v_shared,    v_gone,   30, now() - interval '10 days'),
           (v_left_gift, v_gone,   0,  now() - interval '60 days'),
           (v_left_gift, v_left5,  0,  now() - interval '30 days'),
           (v_lone_gift, v_other4, 0,  now() - interval '30 days'),
           (v_lone_gift, v_gone,   0,  now() - interval '10 days');

  -- gone is named on Dacc For, the gift owner4 made for gone, which gone is
  -- not in: assertion 13 asks gone to hold a row in every column that
  -- references user_profiles, group_gift_recipients.user_id among them.
  insert into group_gift_recipients (group_gift_id, user_id)
    values (v_for, v_gone);

  -- Chat: gone's message on Dacc Shared, other4's on Dacc Made.
  insert into messages (group_gift_id, user_id, content)
    values (v_shared, v_gone,   'Dacc from gone'),
           (v_made,   v_other4, 'Dacc from other4');

  -- Exchanges. In G4: Dacc Soon, gone's, not yet held; Dacc Held, owner4's,
  -- already held; Dacc Undated, owner4's, with no date; each drawn gone ->
  -- owner4 -> other4 -> gone. Dacc Matched, owner4's, not yet held, in which
  -- gone is not a participant but is owner4's match. In G5, Dacc Left Draw,
  -- gone's, not drawn and without gone; in G9, Dacc Lone Draw, the same.
  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g4, 'Dacc Soon', now() + interval '30 days', true, v_gone)
    returning id into v_soon;

  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g4, 'Dacc Held', now() - interval '30 days', true, v_owner4)
    returning id into v_held;

  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g4, 'Dacc Undated', null, true, v_owner4)
    returning id into v_undated;

  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g4, 'Dacc Matched', now() + interval '20 days', true, v_owner4)
    returning id into v_matched;

  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g5, 'Dacc Left Draw', now() + interval '30 days', false, v_gone)
    returning id into v_left_draw;

  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g9, 'Dacc Lone Draw', now() + interval '30 days', false, v_gone)
    returning id into v_lone_draw;

  insert into gift_exchange_participants (exchange_id, user_id, assigned_to)
    values (v_soon,    v_gone,   v_owner4),
           (v_soon,    v_owner4, v_other4),
           (v_soon,    v_other4, v_gone),
           (v_held,    v_gone,   v_owner4),
           (v_held,    v_owner4, v_other4),
           (v_held,    v_other4, v_gone),
           (v_undated, v_gone,   v_owner4),
           (v_undated, v_owner4, v_other4),
           (v_undated, v_other4, v_gone),
           (v_matched, v_owner4, v_gone),
           (v_matched, v_other4, v_owner4);

  -- The gift tracker: owner4's row for gone, and owner4's gift from Dacc
  -- Mine under it, filed under gone's birthday; gone's own row for someone
  -- typed, and a gift under it.
  insert into gift_recipients (user_id, name, person_id)
    values (v_owner4, 'Dacc Gone', v_gone)
    returning id into v_tracker;

  insert into tracked_gifts (user_id, recipient_id, name, wishlist_item_id, from_list, occasion_id)
    values (v_owner4, v_tracker, 'Dacc Mine Gift', v_mine, true, v_bday)
    returning id into v_mine_gift;

  insert into gift_recipients (user_id, name)
    values (v_gone, 'Dacc Mom')
    returning id into v_mom;

  insert into tracked_gifts (user_id, recipient_id, name)
    values (v_gone, v_mom, 'Dacc Scarf');

  -- Profile fields, before the stored choice, so each holds what is written
  -- here: gone's birthday and anniversary, gone's shoe size restricted to G3
  -- (the group-delete clean-up rewrites it), and early's anniversary.
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_gone,  'dates', 'birthday',    '1990-06-15',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'::jsonb),
           (v_gone,  'dates', 'anniversary', '2015-06-20',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'::jsonb),
           (v_gone,  'sizes', 'shoe_size',   '9',
            jsonb_build_object('visibleToGroupTypes', '["custom"]'::jsonb,
                               'restrictToGroup', v_g3::text)),
           (v_early, 'dates', 'anniversary', '2015-06-20',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'::jsonb);

  insert into profile_visibility (user_id, visible_to_group_types)
    values (v_gone, '{family}'::public.group_type[]);

  -- Date reminders in G4: one for gone about owner4, one for owner4 about
  -- gone.
  insert into date_notifications (notified_user_id, celebrant_id, field_name, group_id,
                                  celebration_date, notification_year)
    values (v_gone,   v_owner4, 'birthday', v_g4, '2030-03-03', 2030),
           (v_owner4, v_gone,   'birthday', v_g4, '2030-06-15', 2030);

  -- The anniversary link: early is the lexicographically smaller id, so
  -- user_a; gone asked; it is confirmed, with both membership rows.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_early, v_gone, 'confirmed', v_gone, '2015-06-20', now())
    returning id into v_link;

  insert into anniversary_link_members (user_id, link_id)
    values (v_early, v_link), (v_gone, v_link);

  -- Dacc Stock as it stands, but for the mark and the time of the last
  -- change, for assertion 38.
  select to_jsonb(w) - 'out_of_stock_marked_by' - 'updated_at' into v_stock_before
    from wishlist_items w
   where w.id = v_stock;

  ---------------------------------------------------------------------------
  -- Assertion 1: invitations.invited_by has exactly one foreign key on it
  -- alone, to user_profiles, on delete cascade (confdeltype 'c'): an
  -- invitation goes with the person who sent it.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'c')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.invitations'::regclass
     and c.contype = 'f'
     and a.attname = 'invited_by'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: invitations.invited_by has % foreign key(s) on it alone, % of them to user_profiles on delete cascade; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: group_gifts.target_user_id has exactly one foreign key on
  -- it alone, to user_profiles, on delete set null (confdeltype 'n').
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'n')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.group_gifts'::regclass
     and c.contype = 'f'
     and a.attname = 'target_user_id'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: group_gifts.target_user_id has % foreign key(s) on it alone, % of them to user_profiles on delete set null; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: gift_exchange_participants.assigned_to has exactly one
  -- foreign key on it alone, to user_profiles, on delete set null
  -- (confdeltype 'n').
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'n')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.gift_exchange_participants'::regclass
     and c.contype = 'f'
     and a.attname = 'assigned_to'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: gift_exchange_participants.assigned_to has % foreign key(s) on it alone, % of them to user_profiles on delete set null; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: user_profiles has no DELETE or ALL policy, so a signed-in
  -- person cannot delete their profile row directly; delete_account(), which
  -- runs as its owner, is the only way. Its other policies are there, so
  -- the zero is read from a table this query finds.
  ---------------------------------------------------------------------------
  select count(*) filter (where cmd in ('DELETE', 'ALL')),
         count(*)
    into v_count, v_count2
    from pg_policies
   where schemaname = 'public'
     and tablename = 'user_profiles';

  if v_count <> 0 or v_count2 < 1 then
    raise exception
      'GUARD FAIL: user_profiles has % DELETE or ALL polic(y/ies) among % polic(y/ies) in all; expected 0 among at least 1 -- a profile row is deleted only through delete_account()',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: delete_account() takes no argument (nobody can name
  -- someone else), returns void, and is SECURITY DEFINER with search_path
  -- pinned.
  ---------------------------------------------------------------------------
  select p.pronargs, p.prorettype::regtype, p.prosecdef, p.proconfig
    into v_nargs, v_rettype, v_secdef, v_config
    from pg_proc p
   where p.oid = 'public.delete_account()'::regprocedure;

  if v_nargs is distinct from 0
     or v_rettype is distinct from 'void'::regtype
     or v_secdef is distinct from true
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: delete_account has pronargs %, return type %, prosecdef % and proconfig %; expected 0 arguments, void, prosecdef true and search_path=public among proconfig',
      v_nargs, v_rettype, v_secdef, v_config;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: authenticated may execute it; anon and service_role may
  -- not; and its ACL is set and grants PUBLIC (grantee 0) no EXECUTE.
  ---------------------------------------------------------------------------
  select has_function_privilege('authenticated', 'public.delete_account()', 'execute'),
         has_function_privilege('anon', 'public.delete_account()', 'execute'),
         has_function_privilege('service_role', 'public.delete_account()', 'execute')
    into v_can_authed, v_can_anon, v_can_service;

  select p.proacl is not null,
         exists (select 1
                   from aclexplode(p.proacl) x
                  where x.grantee = 0
                    and x.privilege_type = 'EXECUTE')
    into v_acl_set, v_public_exec
    from pg_proc p
   where p.oid = 'public.delete_account()'::regprocedure;

  if v_can_authed is distinct from true or v_can_anon is distinct from false
     or v_can_service is distinct from false
     or v_acl_set is distinct from true or v_public_exec is distinct from false then
    raise exception
      'GUARD FAIL: delete_account is executable by authenticated: %, anon: %, service_role: %; its ACL is set: % and grants PUBLIC EXECUTE: %; expected true, false, false, true and false',
      v_can_authed, v_can_anon, v_can_service, v_acl_set, v_public_exec;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: its definition holds no block comment (the floor beneath
  -- assertions 8-11) and names neither the wishlist items table nor the
  -- bought flag: a claim goes by its own cascade, and an item the caller
  -- bought stays bought.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.delete_account()'::regprocedure);

  if position(v_block_open in v_def) <> 0
     or position('wishlist_items' in v_def) <> 0
     or position('purchased' in v_def) <> 0 then
    raise exception
      'GUARD FAIL: delete_account''s definition has a block comment at character %, names wishlist_items at character % and purchased at character %; expected 0 for all three',
      position(v_block_open in v_def), position('wishlist_items' in v_def),
      position('purchased' in v_def);
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: it takes the caller from requesting_user_id() and refuses
  -- a signed-out call with 28000, each on a line of its own (so not
  -- line-commented), and the refusal comes before it changes a role and
  -- before it deletes a group.
  ---------------------------------------------------------------------------
  v_pos_refusal := position('raise exception ''not authenticated'' using errcode = ''28000'';' in v_def);
  v_pos_role := position('update group_members' in v_def);
  v_pos_delete := position('delete from groups' in v_def);

  if not v_def ~ '(?n)^\s*v_caller text := \(select public\.requesting_user_id\(\)\);$'
     or not v_def ~ '(?n)^\s*if v_caller is null then$'
     or not v_def ~ '(?n)^\s*raise exception ''not authenticated'' using errcode = ''28000'';$'
     or v_pos_refusal = 0 or v_pos_role = 0 or v_pos_delete = 0
     or v_pos_refusal > v_pos_role or v_pos_refusal > v_pos_delete then
    raise exception
      'GUARD FAIL: delete_account no longer takes the caller from requesting_user_id() and refuses a signed-out call with 28000 before its first write, not line-commented (refusal at character %, role change at %, group delete at %; expected all three present, the refusal first)',
      v_pos_refusal, v_pos_role, v_pos_delete;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: the query that finds the groups locks them (for update of
  -- g, on a line of its own, so not line-commented), before it changes a
  -- role or deletes a group: a join, or another member deleting their
  -- account, waits for this deletion.
  ---------------------------------------------------------------------------
  v_pos_lock := position('for update of g' in v_def);

  if not v_def ~ '(?n)^\s*for update of g$'
     or v_pos_lock = 0 or v_pos_role = 0 or v_pos_delete = 0
     or v_pos_lock > v_pos_role or v_pos_lock > v_pos_delete then
    raise exception
      'GUARD FAIL: delete_account no longer locks the groups it visits before it writes, not line-commented (lock at character %, role change at %, group delete at %; expected all three present, the lock first)',
      v_pos_lock, v_pos_role, v_pos_delete;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: the heir lookup locks the row it picks (for update of gm,
  -- on a line of its own), after the group's lock and before the role
  -- change: the heir cannot leave before they are made owner.
  ---------------------------------------------------------------------------
  v_pos_heir := position('for update of gm' in v_def);

  if not v_def ~ '(?n)^\s*for update of gm;$'
     or v_pos_heir = 0 or v_pos_lock = 0 or v_pos_role = 0
     or v_pos_heir < v_pos_lock or v_pos_heir > v_pos_role then
    raise exception
      'GUARD FAIL: delete_account no longer locks the heir''s member row between the group''s lock and the role change, not line-commented (heir lock at character %, group lock at %, role change at %)',
      v_pos_heir, v_pos_lock, v_pos_role;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: new invite codes are drawn over the website's alphabet
  -- (generateInviteCode's) from gen_random_uuid()'s bytes, and the
  -- definition calls no random(), which is not a cryptographic source.
  ---------------------------------------------------------------------------
  if position('ABCDEFGHJKLMNPQRSTUVWXYZ23456789' in v_def) = 0
     or position('uuid_send(gen_random_uuid())' in v_def) = 0
     or position('get_byte(' in v_def) = 0
     or v_def ~ '(^|[^a-z_])random[[:space:]]*\(' then
    raise exception
      'GUARD FAIL: delete_account''s new invite codes: alphabet at character %, uuid_send(gen_random_uuid()) at %, get_byte( at %, and a call to random(): %; expected the first three present and no random()',
      position('ABCDEFGHJKLMNPQRSTUVWXYZ23456789' in v_def),
      position('uuid_send(gen_random_uuid())' in v_def),
      position('get_byte(' in v_def),
      v_def ~ '(^|[^a-z_])random[[:space:]]*\(';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12: before the call, the fixture is what the rest of this
  -- file assumes. gone is owner of G1, G2, G3 and G6, member of G4 and
  -- admin of G7, in six groups in all, and in none of G5, G8 and G9; G7 has
  -- no owner; left5 owns G5; and Dacc Shared holds the 50 its two
  -- contributions give.
  ---------------------------------------------------------------------------
  select count(*) filter (where gm.group_id in (v_g1, v_g2, v_g3, v_g6) and gm.role = 'owner'),
         count(*) filter (where gm.group_id = v_g4 and gm.role = 'member'),
         count(*) filter (where gm.group_id = v_g7 and gm.role = 'admin'),
         count(*) filter (where gm.group_id in (v_g5, v_g8, v_g9)),
         count(*)
    into v_count, v_count2, v_count3, v_count6, v_count4
    from group_members gm
   where gm.user_id = v_gone;

  select count(*) into v_count5
    from group_members gm
   where gm.group_id = v_g7
     and gm.role = 'owner';

  select gm.role::text into v_role
    from group_members gm
   where gm.group_id = v_g5
     and gm.user_id = v_left5;

  select current_amount into v_amount
    from group_gifts
   where id = v_shared;

  if v_count <> 4 or v_count2 <> 1 or v_count3 <> 1 or v_count4 <> 6 or v_count5 <> 0
     or v_count6 <> 0 or v_role is distinct from 'owner' or v_amount is distinct from 50 then
    raise exception
      'DELETE FAIL: before the call % is owner of % of G1, G2, G3 and G6 (expected 4), member of G4 in % row(s) (expected 1), admin of G7 in % row(s) (expected 1), in % group(s) in all (expected 6), with % row(s) in G5, G8 and G9 (expected 0); G7 has % owner(s) (expected 0), % is % in G5 (expected owner), and Dacc Shared holds % (expected 50) -- the call below would prove nothing',
      v_gone, v_count, v_count2, v_count3, v_count4, v_count6, v_count5, v_left5, v_role, v_amount;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 13: before the call, gone holds a row in every column that
  -- references user_profiles (every single-column foreign key to it, read
  -- from the catalog, at least the 28 this schema has) but one,
  -- anniversary_links.user_a: gone is the link's later id. So the call below
  -- reaches every cascade and set null there is, and a foreign key added
  -- later fails here until this fixture gives gone a row in it.
  ---------------------------------------------------------------------------
  v_fk_total := 0;
  v_found := null;
  for v_fk in
    select n.nspname::text as nsp, r.relname::text as rel, a.attname::text as col
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.user_profiles'::regclass
       and cardinality(c.conkey) = 1
     order by r.relname, a.attname
  loop
    execute format('select count(*) from %I.%I where %I = $1', v_fk.nsp, v_fk.rel, v_fk.col)
      into v_n
      using v_gone;
    v_fk_total := v_fk_total + 1;
    if v_n = 0 then
      v_found := concat_ws(', ', v_found, v_fk.rel || '.' || v_fk.col);
    end if;
  end loop;

  select count(*) into v_fk_multi
    from pg_constraint c
   where c.contype = 'f'
     and c.confrelid = 'public.user_profiles'::regclass
     and cardinality(c.conkey) <> 1;

  if v_fk_total < 28 or v_fk_multi <> 0
     or v_found is distinct from 'anniversary_links.user_a' then
    raise exception
      'DELETE FAIL: before the call, of % single-column foreign key(s) to user_profiles (expected at least 28, and % on more than one column, expected 0), the columns holding no row naming % are: % (expected exactly anniversary_links.user_a)',
      v_fk_total, v_fk_multi, v_gone, coalesce(v_found, 'none');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 14: gone's own direct delete of their profile row deletes
  -- nothing (there is no delete policy, so row-level security leaves it no
  -- row), and the row is still there.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_dacc_gone","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  delete from public.user_profiles where id = 'user_dacc_gone';
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count2
    from user_profiles
   where id = v_gone;

  if v_count <> 0 or v_count2 <> 1 then
    raise exception
      'GUARD FAIL: % deleting their own profile row directly deleted % row(s), and % row(s) of it remain; expected 0 deleted and 1 remaining -- a profile row is deleted only through delete_account()',
      v_gone, v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- gone deletes their account.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_dacc_gone","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.delete_account();

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 15: G1 passes to admin1. An admin comes before a member, and
  -- of the two admins admin1 has been there longer. admin2 stays admin,
  -- early stays member, and G1 has exactly one owner.
  ---------------------------------------------------------------------------
  select (select gm.role::text from group_members gm
           where gm.group_id = v_g1 and gm.user_id = v_admin1),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g1 and gm.user_id = v_admin2),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g1 and gm.user_id = v_early),
         (select count(*) from group_members gm
           where gm.group_id = v_g1 and gm.role = 'owner')
    into v_role, v_role2, v_role3, v_count;

  if v_role is distinct from 'owner' or v_role2 is distinct from 'admin'
     or v_role3 is distinct from 'member' or v_count <> 1 then
    raise exception
      'DELETE FAIL: in G1 % is %, % is % and % is %, with % owner(s); expected owner, admin, member and exactly 1 owner (an admin before a member, then the longest-standing)',
      v_admin1, v_role, v_admin2, v_role2, v_early, v_role3, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 16: G2 passes to m_early, the longer-standing of two members;
  -- m_late stays member.
  ---------------------------------------------------------------------------
  select (select gm.role::text from group_members gm
           where gm.group_id = v_g2 and gm.user_id = v_m_early),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g2 and gm.user_id = v_m_late)
    into v_role, v_role2;

  if v_role is distinct from 'owner' or v_role2 is distinct from 'member' then
    raise exception
      'DELETE FAIL: in G2 % is % and % is %; expected owner and member (the longest-standing member becomes owner)',
      v_m_early, v_role, v_m_late, v_role2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 17: G3, with nobody but gone in it, is deleted, and its date
  -- and gone's invitation to it go by their cascades.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from groups
   where id = v_g3;

  select count(*) into v_count2
    from occasions
   where group_id = v_g3;

  select count(*) into v_count3
    from invitations
   where token = 'dacc_inv_alone';

  if v_count <> 0 or v_count2 <> 0 or v_count3 <> 0 then
    raise exception
      'DELETE FAIL: G3 has % groups row(s), % occasions row(s) and % invitation(s) with token dacc_inv_alone; expected 0 of each',
      v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 18: (Review Focus 1, a group made long ago by someone who is
  -- no longer its owner) G4 stays, now names owner4 as its maker, owner4 is
  -- still owner and other4 still member, and gone has no member row in it.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from groups
   where id = v_g4;

  select (select gm.role::text from group_members gm
           where gm.group_id = v_g4 and gm.user_id = v_owner4),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g4 and gm.user_id = v_other4),
         (select count(*) from group_members gm
           where gm.group_id = v_g4 and gm.user_id = v_gone)
    into v_role, v_role2, v_count2;

  if v_count <> 1 or v_created_by is distinct from v_owner4
     or v_role is distinct from 'owner' or v_role2 is distinct from 'member'
     or v_count2 <> 0 then
    raise exception
      'DELETE FAIL: G4 has % groups row(s) made by %, % is %, % is %, and % has % member row(s) in it; expected 1 row made by %, owner, member and 0 rows',
      v_count, v_created_by, v_owner4, v_role, v_other4, v_role2, v_gone, v_count2, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 19: (Review Focus 1, the invitation the caller sent) no
  -- invitation anywhere names gone as its sender, and owner4's is still
  -- there.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from invitations
   where invited_by = v_gone;

  select count(*) into v_count2
    from invitations
   where token = 'dacc_inv_owner4'
     and invited_by = v_owner4;

  if v_count <> 0 or v_count2 <> 1 then
    raise exception
      'DELETE FAIL: % invitation(s) name % as sender, and % invitation(s) with token dacc_inv_owner4 by % remain; expected 0 and 1',
      v_count, v_gone, v_count2, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 20: Dacc Made, gone's gift for owner4, now names other4 as its
  -- maker: the longest-standing contributor who is neither gone nor the
  -- person it is for (admin1 joined it later). other4 and admin1 still
  -- contribute, gone does not, and other4's message is still there.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from group_gifts
   where id = v_made;

  select count(*),
         count(*) filter (where user_id in (v_other4, v_admin1))
    into v_count2, v_count3
    from group_gift_members
   where group_gift_id = v_made;

  select count(*) into v_count4
    from messages
   where group_gift_id = v_made
     and user_id = v_other4;

  if v_count <> 1 or v_created_by is distinct from v_other4
     or v_count2 <> 2 or v_count3 <> 2 or v_count4 <> 1 then
    raise exception
      'DELETE FAIL: Dacc Made has % row(s) made by %, % contributor row(s), % of them other4''s or admin1''s, and % message(s) by other4; expected 1 row made by %, 2 and 2, and 1',
      v_count, v_created_by, v_count2, v_count3, v_count4, v_other4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 21: Dacc Outside, gone's gift for no one, now names m_late as
  -- its maker: its only other contributor, who is not in G4. A gift passes
  -- to someone already in it, not to the group's heir.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from group_gifts
   where id = v_outside;

  if v_count <> 1 or v_created_by is distinct from v_m_late then
    raise exception
      'DELETE FAIL: Dacc Outside has % row(s) made by %; expected 1 row made by % (its other contributor, not G4''s heir %)',
      v_count, v_created_by, v_m_late, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 22: Dacc Solo, gone's gift that nobody else joined, is
  -- deleted, with gone's contributor row.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from group_gifts
   where id = v_solo;

  select count(*) into v_count2
    from group_gift_members
   where group_gift_id = v_solo;

  if v_count <> 0 or v_count2 <> 0 then
    raise exception
      'DELETE FAIL: Dacc Solo has % row(s) and % contributor row(s); expected 0 and 0 (nobody else joined it)',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 23: Dacc Self, gone's gift for owner4 whose only other
  -- contributor is owner4, is deleted, with owner4's contributor row: it
  -- never passes to the person it is for.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from group_gifts
   where id = v_self;

  select count(*) into v_count2
    from group_gift_members
   where group_gift_id = v_self;

  if v_count <> 0 or v_count2 <> 0 then
    raise exception
      'DELETE FAIL: Dacc Self has % row(s) and % contributor row(s); expected 0 and 0 (its only other contributor is the person it is for)',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 24: Dacc Only, gone's gift for pair6 with no contributor, is
  -- deleted; G6 stays, names pair6 as its maker, and pair6 owns it.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from group_gifts
   where id = v_only;

  select count(*), max(created_by) into v_count2, v_created_by
    from groups
   where id = v_g6;

  select gm.role::text into v_role
    from group_members gm
   where gm.group_id = v_g6
     and gm.user_id = v_pair6;

  if v_count <> 0 or v_count2 <> 1 or v_created_by is distinct from v_pair6
     or v_role is distinct from 'owner' then
    raise exception
      'DELETE FAIL: Dacc Only has % row(s) (expected 0: nobody else joined it); G6 has % groups row(s) made by %, and % is % in it; expected 1 row made by % and owner',
      v_count, v_count2, v_created_by, v_pair6, v_role, v_pair6;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 25: Dacc Shared, owner4's gift that gone paid into, stays
  -- owner4's, with owner4 its only contributor, and holds the 20 the
  -- remaining contribution gives (the baseline's trigger recomputes it);
  -- gone's message on it is gone.
  ---------------------------------------------------------------------------
  select count(*), max(created_by), max(current_amount)
    into v_count, v_created_by, v_amount
    from group_gifts
   where id = v_shared;

  select count(*),
         count(*) filter (where user_id = v_owner4)
    into v_count2, v_count3
    from group_gift_members
   where group_gift_id = v_shared;

  select count(*) into v_count4
    from messages
   where group_gift_id = v_shared;

  if v_count <> 1 or v_created_by is distinct from v_owner4 or v_amount is distinct from 20
     or v_count2 <> 1 or v_count3 <> 1 or v_count4 <> 0 then
    raise exception
      'DELETE FAIL: Dacc Shared has % row(s) made by % holding %, % contributor row(s) (% of them owner4''s) and % message(s); expected 1 row made by % holding 20, 1 and 1, and 0',
      v_count, v_created_by, v_amount, v_count2, v_count3, v_count4, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 26: the group gift for gone, Dacc For, stays, for no one, and
  -- still names owner4 as its maker.
  ---------------------------------------------------------------------------
  select count(*), max(target_user_id), max(created_by)
    into v_count, v_target, v_created_by
    from group_gifts
   where id = v_for;

  if v_count <> 1 or v_target is not null or v_created_by is distinct from v_owner4 then
    raise exception
      'DELETE FAIL: Dacc For has % row(s) for % made by %; expected 1 row for no one (null) made by %',
      v_count, v_target, v_created_by, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 27: the exchange not yet held, Dacc Soon, now names owner4 as
  -- its maker and is no longer drawn: owner4's and other4's rows remain,
  -- both with no match.
  ---------------------------------------------------------------------------
  select max(created_by), bool_and(assignments_generated)
    into v_created_by, v_generated
    from gift_exchanges
   where id = v_soon;

  select count(*),
         count(*) filter (where user_id in (v_owner4, v_other4)),
         count(*) filter (where assigned_to is null)
    into v_count, v_count2, v_count3
    from gift_exchange_participants
   where exchange_id = v_soon;

  if v_created_by is distinct from v_owner4 or v_generated is distinct from false
     or v_count <> 2 or v_count2 <> 2 or v_count3 <> 2 then
    raise exception
      'DELETE FAIL: Dacc Soon is made by % with assignments_generated %, and has % participant row(s), % of them owner4''s or other4''s and % with no match; expected made by %, false, and 2, 2 and 2',
      v_created_by, v_generated, v_count, v_count2, v_count3, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 28: the exchange already held, Dacc Held, stays drawn: two
  -- rows remain, owner4's match is still other4, and other4's match to gone
  -- is cleared.
  ---------------------------------------------------------------------------
  select bool_and(assignments_generated) into v_generated
    from gift_exchanges
   where id = v_held;

  select count(*),
         max(assigned_to) filter (where user_id = v_owner4),
         max(assigned_to) filter (where user_id = v_other4),
         count(*) filter (where user_id = v_other4)
    into v_count, v_assigned, v_assigned2, v_count2
    from gift_exchange_participants
   where exchange_id = v_held;

  if v_generated is distinct from true or v_count <> 2
     or v_assigned is distinct from v_other4
     or v_count2 <> 1 or v_assigned2 is not null then
    raise exception
      'DELETE FAIL: Dacc Held has assignments_generated % and % participant row(s); owner4''s match is % and other4 has % row(s) matched to %; expected true, 2 rows, %, and 1 row with no match (null)',
      v_generated, v_count, v_assigned, v_count2, v_assigned2, v_other4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 29: the exchange with no date, Dacc Undated, counts as not yet
  -- held: it is no longer drawn, and owner4's and other4's rows remain, both
  -- with no match.
  ---------------------------------------------------------------------------
  select bool_and(assignments_generated) into v_generated
    from gift_exchanges
   where id = v_undated;

  select count(*),
         count(*) filter (where user_id in (v_owner4, v_other4)),
         count(*) filter (where assigned_to is null)
    into v_count, v_count2, v_count3
    from gift_exchange_participants
   where exchange_id = v_undated;

  if v_generated is distinct from false
     or v_count <> 2 or v_count2 <> 2 or v_count3 <> 2 then
    raise exception
      'DELETE FAIL: Dacc Undated has assignments_generated % and % participant row(s), % of them owner4''s or other4''s and % with no match; expected false, and 2, 2 and 2 (no date counts as not yet held)',
      v_generated, v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 30: Dacc Matched, not yet held, in which gone is not a
  -- participant but was owner4's match, is no longer drawn: owner4's and
  -- other4's rows remain, both with no match.
  ---------------------------------------------------------------------------
  select bool_and(assignments_generated) into v_generated
    from gift_exchanges
   where id = v_matched;

  select count(*),
         count(*) filter (where user_id in (v_owner4, v_other4)),
         count(*) filter (where assigned_to is null)
    into v_count, v_count2, v_count3
    from gift_exchange_participants
   where exchange_id = v_matched;

  if v_generated is distinct from false
     or v_count <> 2 or v_count2 <> 2 or v_count3 <> 2 then
    raise exception
      'DELETE FAIL: Dacc Matched has assignments_generated % and % participant row(s), % of them owner4''s or other4''s and % with no match; expected false, and 2, 2 and 2 (gone was a match there)',
      v_generated, v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 31: (Review Focus 1, a group made by someone who has left it)
  -- G5 stays, names left5 as its maker, and left5 is still its owner and
  -- its only member; Dacc Left Gift names left5, its other contributor, and
  -- Dacc Left Draw names left5, G5's heir.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from groups
   where id = v_g5;

  select count(*), max(gm.role::text) filter (where gm.user_id = v_left5)
    into v_count2, v_role
    from group_members gm
   where gm.group_id = v_g5;

  select max(created_by) into v_created_by2
    from group_gifts
   where id = v_left_gift;

  select max(created_by) into v_person
    from gift_exchanges
   where id = v_left_draw;

  if v_count <> 1 or v_created_by is distinct from v_left5
     or v_count2 <> 1 or v_role is distinct from 'owner'
     or v_created_by2 is distinct from v_left5 or v_person is distinct from v_left5 then
    raise exception
      'DELETE FAIL: G5 has % groups row(s) made by %, % member row(s) with % as %; Dacc Left Gift is made by % and Dacc Left Draw by %; expected 1 row made by %, 1 member row with % as owner, and both made by %',
      v_count, v_created_by, v_count2, v_left5, v_role, v_created_by2, v_person,
      v_left5, v_left5, v_left5;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 32: G8, other4's, which only a group gift of gone's brought
  -- into the call: Dacc Lone Gift names other4, its other contributor, and
  -- G8 is still other4's, as made.
  ---------------------------------------------------------------------------
  select max(created_by) into v_created_by
    from group_gifts
   where id = v_lone_gift;

  select count(*), max(created_by) into v_count, v_created_by2
    from groups
   where id = v_g8;

  if v_created_by is distinct from v_other4 or v_count <> 1
     or v_created_by2 is distinct from v_other4 then
    raise exception
      'DELETE FAIL: Dacc Lone Gift is made by %, and G8 has % groups row(s) made by %; expected %, and 1 row made by %',
      v_created_by, v_count, v_created_by2, v_other4, v_other4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 33: G9, early's, which only an exchange of gone's brought into
  -- the call: Dacc Lone Draw names early, G9's heir, and G9 is still
  -- early's, as made.
  ---------------------------------------------------------------------------
  select max(created_by) into v_created_by
    from gift_exchanges
   where id = v_lone_draw;

  select count(*), max(created_by) into v_count, v_created_by2
    from groups
   where id = v_g9;

  if v_created_by is distinct from v_early or v_count <> 1
     or v_created_by2 is distinct from v_early then
    raise exception
      'DELETE FAIL: Dacc Lone Draw is made by %, and G9 has % groups row(s) made by %; expected %, and 1 row made by %',
      v_created_by, v_count, v_created_by2, v_early, v_early;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 34: every kept group gone was a member of (G1, G2, G4, G6 and
  -- G7) has a new invite code of the website's shape (three groups of three
  -- from generateInviteCode's alphabet, joined by dashes), none of them the
  -- fixture's, all different from each other.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where invite_code ~ '^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$'),
         count(distinct invite_code),
         count(*) filter (where invite_code in ('DACCADM1', 'DACCMEM1', 'DACCOLD1', 'DACCPAR1', 'DACCOWN1')),
         string_agg(invite_code, ', ' order by invite_code)
    into v_count, v_count2, v_count3, v_count4, v_codes
    from groups
   where id in (v_g1, v_g2, v_g4, v_g6, v_g7);

  if v_count <> 5 or v_count2 <> 5 or v_count3 <> 5 or v_count4 <> 0 then
    raise exception
      'DELETE FAIL: of % kept group(s) gone was in (expected 5), % have a code of the website''s shape, % different codes, and % still a fixture code (%); expected 5, 5 and 0',
      v_count, v_count2, v_count3, v_count4, v_codes;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 35: find_group_by_invite_code, which join_group_with_code
  -- uses, finds no group by any of those five old codes and finds each of
  -- the five groups by its new one; G5, G8 and G9, which gone was not in,
  -- keep their codes.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from unnest(array['DACCADM1', 'DACCMEM1', 'DACCOLD1', 'DACCPAR1', 'DACCOWN1']) o(code)
    cross join lateral public.find_group_by_invite_code(o.code) f;

  select count(*) into v_count2
    from groups g
    cross join lateral public.find_group_by_invite_code(g.invite_code) f
   where g.id in (v_g1, v_g2, v_g4, v_g6, v_g7)
     and f.id = g.id;

  select count(*) into v_count3
    from groups
   where (id = v_g5 and invite_code = 'DACCLFT1')
      or (id = v_g8 and invite_code = 'DACCGFT1')
      or (id = v_g9 and invite_code = 'DACCDRW1');

  if v_count <> 0 or v_count2 <> 5 or v_count3 <> 3 then
    raise exception
      'DELETE FAIL: the five old codes find % group(s), the five new codes find % of their own groups, and % of G5, G8 and G9 keep their codes; expected 0, 5 and 3',
      v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 36: Dacc Claimed has no claim left on it, and no claim
  -- anywhere names gone: the item is claimable again.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from wishlist_claims
   where item_id = v_claimed;

  select count(*) into v_count2
    from wishlist_claims
   where claimed_by = v_gone;

  if v_count <> 0 or v_count2 <> 0 then
    raise exception
      'DELETE FAIL: Dacc Claimed has % claim(s) on it, and % claim(s) name % anywhere; expected 0 and 0',
      v_count, v_count2, v_gone;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 37: Dacc Bought, which gone bought, stays, and stays bought.
  ---------------------------------------------------------------------------
  select count(*), bool_and(purchased) into v_count, v_bought_flag
    from wishlist_items
   where id = v_bought;

  if v_count <> 1 or v_bought_flag is distinct from true then
    raise exception
      'DELETE FAIL: Dacc Bought has % row(s) with purchased %; expected 1 row with purchased true',
      v_count, v_bought_flag;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 38: owner4's Dacc Stock, which gone marked out of stock, is no
  -- longer marked, and nothing else on it changed (every column but the
  -- mark and the time of the last change is as it was, purchased false
  -- among them), and other4's claim on it is as it was.
  ---------------------------------------------------------------------------
  select w.out_of_stock_marked_by, to_jsonb(w) - 'out_of_stock_marked_by' - 'updated_at'
    into v_person, v_stock_after
    from wishlist_items w
   where w.id = v_stock;

  select count(*) into v_count
    from wishlist_claims
   where item_id = v_stock
     and claimed_by = v_other4
     and released_at is null;

  if v_stock_before is null or v_stock_after is distinct from v_stock_before
     or v_person is not null or v_count <> 1 then
    raise exception
      'DELETE FAIL: Dacc Stock is marked by % and otherwise reads % (before the call: %), with % active claim(s) by other4; expected no mark, the same, and 1',
      v_person, v_stock_after, v_stock_before, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 39: owner4's tracked gift from gone's Dacc Mine stays, still
  -- owner4's under the same tracker row and still from a list, with no item
  -- and no occasion; owner4's claim on Dacc Mine and gone's tag of it went
  -- with the item.
  ---------------------------------------------------------------------------
  select count(*), max(wishlist_item_id::text)::uuid, bool_and(from_list), max(occasion_id::text)::uuid
    into v_count, v_item, v_from_list, v_occ
    from tracked_gifts
   where id = v_mine_gift
     and user_id = v_owner4
     and recipient_id = v_tracker;

  select count(*) into v_count2
    from wishlist_claims
   where item_id = v_mine;

  select count(*) into v_count3
    from wishlist_item_occasions
   where item_id = v_mine;

  if v_count <> 1 or v_item is not null or v_from_list is distinct from true or v_occ is not null
     or v_count2 <> 0 or v_count3 <> 0 then
    raise exception
      'DELETE FAIL: owner4''s Dacc Mine Gift has % row(s) under its tracker row, with item %, from_list % and occasion %; % claim(s) and % tag(s) on Dacc Mine remain; expected 1 row with no item, true and no occasion, and 0 and 0',
      v_count, v_item, v_from_list, v_occ, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 40: owner4's tracker row Dacc Gone stays, tied to nobody (a
  -- typed name now).
  ---------------------------------------------------------------------------
  select count(*), max(person_id) into v_count, v_person
    from gift_recipients
   where id = v_tracker;

  if v_count <> 1 or v_person is not null then
    raise exception
      'DELETE FAIL: owner4''s tracker row Dacc Gone has % row(s) tied to %; expected 1 row tied to nobody (null)',
      v_count, v_person;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 41: early, the other person in the anniversary link, keeps
  -- their profile, their anniversary field and their anniversary occasion,
  -- now with no partner; the link and both its membership rows are gone, so
  -- early is free to link again.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from user_profiles
   where id = v_early;

  select count(*) into v_count2
    from profile_info
   where user_id = v_early
     and category = 'dates'
     and field_name = 'anniversary';

  select count(*), max(celebrant_id), max(partner_id)
    into v_count3, v_celebrant, v_partner
    from occasions
   where id = v_anniv;

  select count(*) into v_count4
    from anniversary_links
   where v_early in (user_a, user_b);

  select count(*) into v_count5
    from anniversary_link_members
   where link_id = v_link or user_id = v_early;

  if v_count <> 1 or v_count2 <> 1 or v_count3 <> 1 or v_celebrant is distinct from v_early
     or v_partner is not null or v_count4 <> 0 or v_count5 <> 0 then
    raise exception
      'DELETE FAIL: early has % profile row(s) and % anniversary field(s); their anniversary occasion has % row(s) for % with partner %; % link(s) name early and % membership row(s) remain; expected 1, 1, 1 row for % with no partner, 0 and 0',
      v_count, v_count2, v_count3, v_celebrant, v_partner, v_count4, v_count5, v_early;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 42: early's Dacc Was There, restricted to G3, stays, and the
  -- group-delete clean-up left it seen by nobody but early (no group, no
  -- kind of group).
  ---------------------------------------------------------------------------
  select count(*), max(privacy_settings::text)::jsonb into v_count, v_settings
    from wishlist_items
   where id = v_was_there
     and user_id = v_early;

  if v_count <> 1
     or v_settings->'restrictToGroup' is distinct from 'null'::jsonb
     or v_settings->'visibleToGroupTypes' is distinct from '[]'::jsonb then
    raise exception
      'DELETE FAIL: early''s Dacc Was There has % row(s) with privacy_settings %; expected 1 row with restrictToGroup null and visibleToGroupTypes []',
      v_count, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 43: G7, which had no owner, stays and now names other7 (its
  -- only other member) as its maker; other7 is still a member.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from groups
   where id = v_g7;

  select gm.role::text into v_role
    from group_members gm
   where gm.group_id = v_g7
     and gm.user_id = v_other7;

  if v_count <> 1 or v_created_by is distinct from v_other7
     or v_role is distinct from 'member' then
    raise exception
      'DELETE FAIL: G7 has % groups row(s) made by %, and % is %; expected 1 row made by % and member',
      v_count, v_created_by, v_other7, v_role, v_other7;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 44: gone has no profile, no membership and no item left.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from user_profiles
   where id = v_gone;

  select count(*) into v_count2
    from group_members
   where user_id = v_gone;

  select count(*) into v_count3
    from wishlist_items
   where id = v_mine;

  if v_count <> 0 or v_count2 <> 0 or v_count3 <> 0 then
    raise exception
      'DELETE FAIL: % has % user_profiles row(s), % group_members row(s) and % Dacc Mine item(s) left; expected 0 of each',
      v_gone, v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 45: no row in any column that references user_profiles names
  -- gone (the same catalog read as assertion 13).
  ---------------------------------------------------------------------------
  v_fk_total := 0;
  v_found := null;
  for v_fk in
    select n.nspname::text as nsp, r.relname::text as rel, a.attname::text as col
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.user_profiles'::regclass
       and cardinality(c.conkey) = 1
     order by r.relname, a.attname
  loop
    execute format('select count(*) from %I.%I where %I = $1', v_fk.nsp, v_fk.rel, v_fk.col)
      into v_n
      using v_gone;
    v_fk_total := v_fk_total + 1;
    if v_n <> 0 then
      v_found := concat_ws(', ', v_found, v_fk.rel || '.' || v_fk.col || ' (' || v_n || ')');
    end if;
  end loop;

  if v_fk_total < 28 or v_found is not null then
    raise exception
      'DELETE FAIL: after the call, of % single-column foreign key(s) to user_profiles (expected at least 28), these still hold rows naming %: %; expected none',
      v_fk_total, v_gone, v_found;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- gone, now with no profile, calls again. Each group this file made, its
  -- maker, its invite code and each member's role, in a fixed order, before
  -- and after.
  ---------------------------------------------------------------------------
  select string_agg(g.name || '/' || g.created_by || '/' || g.invite_code || '/' || coalesce(m.members, ''),
                    '|' order by g.name, g.id)
    into v_fp1
    from groups g
    left join lateral (
      select string_agg(gm.user_id || '=' || coalesce(gm.role::text, 'none'),
                        ',' order by gm.user_id) as members
        from group_members gm
       where gm.group_id = g.id
    ) m on true
   where g.name like 'Dacc %';

  perform set_config('request.jwt.claims',
    '{"sub":"user_dacc_gone","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.delete_account();

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 46: the second call, by a caller with no profile, raised
  -- nothing (this line is reached) and changed nothing, invite codes
  -- included.
  ---------------------------------------------------------------------------
  select string_agg(g.name || '/' || g.created_by || '/' || g.invite_code || '/' || coalesce(m.members, ''),
                    '|' order by g.name, g.id)
    into v_fp2
    from groups g
    left join lateral (
      select string_agg(gm.user_id || '=' || coalesce(gm.role::text, 'none'),
                        ',' order by gm.user_id) as members
        from group_members gm
       where gm.group_id = g.id
    ) m on true
   where g.name like 'Dacc %';

  if v_fp1 is null or v_fp2 is distinct from v_fp1 then
    raise exception
      'DELETE FAIL: after a second call by %, who has no profile, the groups this file made read % (before it: %); expected the same, and not null',
      v_gone, v_fp2, v_fp1;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 46 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 46', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_25_delete_account');
end $$;

select token as result from _harness_result;
