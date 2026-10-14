-- Pins the rules 20261014000000_anniversary_requests_never_stranded.sql adds
-- (design: _planning/2026-10-14-anniversary-requests-design.md).
--
--   Assertions 1-5 (live): confirm_anniversary_link deletes every OTHER
--     pending link involving either partner, and nothing else.
--   Assertion 6 (live): request_anniversary_link still ACCEPTS a request to
--     someone already linked. Refusing would be an oracle for that person's
--     relationship status. This is the privacy assertion: it is what fails if
--     someone later "fixes" a stranded request by refusing it at the source.
--   Assertion 7 (live): asking the same person again still refreshes the one
--     pending row (the new I-out refusal must exclude the same pair).
--   Assertions 8-10 (anchored source): the two new caller-status refusals and
--     the cleanup's WHERE clause, uncommented and wired to their messages.
--   Assertion 11 (2 checks): block-comment floor for both functions.
--
-- The refusals RAISE, and this harness rejects `exception when` in a test
-- file (scripts/test-rls.sh:274-280), so an uncaught raise fails the whole
-- file. That is why they are anchored source checks, not live calls.
--
-- Fixtures are canonicalised with least()/greatest() so no assertion depends
-- on how the fixture ids happen to sort.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role  text;
  v_checks     int := 0;
  v_count      int;
  v_id         uuid;
  v_id2        uuid;
  v_pos        int;

  -- assertions 1-5: cleanup on confirm. cl_b asked cl_a (the link confirmed
  -- below); cl_a also has an outgoing request to cl_x; cl_y asked cl_b;
  -- cl_z asked cl_a; cl_u1 asked cl_u2 (unrelated to the couple).
  v_cl_a   text := 'user_annreq_cl_a';
  v_cl_b   text := 'user_annreq_cl_b';
  v_cl_x   text := 'user_annreq_cl_x';
  v_cl_y   text := 'user_annreq_cl_0y';  -- sorts BEFORE cl_b: puts cl_b on the user_b side
  v_cl_z   text := 'user_annreq_cl_z';
  v_cl_u1  text := 'user_annreq_cl_u1';
  v_cl_u2  text := 'user_annreq_cl_u2';
  v_link_main      uuid;
  v_link_a_out     uuid;
  v_link_b_in      uuid;
  v_link_a_in      uuid;
  v_link_unrelated uuid;

  -- assertion 6: no oracle. no_linked is confirmed with no_partner; no_asker
  -- shares a group with no_linked and asks them anyway.
  v_no_linked  text := 'user_annreq_no_linked';
  v_no_partner text := 'user_annreq_no_partner';
  v_no_asker   text := 'user_annreq_no_asker';
  v_no_group   uuid;
  v_no_link    uuid;

  -- assertion 7: same-pair re-request.
  v_rr_a     text := 'user_annreq_rr_a';
  v_rr_b     text := 'user_annreq_rr_b';
  v_rr_group uuid;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, written as the connecting role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name) values
    (v_cl_a,       'annreqcla',       'AnnReq CL A'),
    (v_cl_b,       'annreqclb',       'AnnReq CL B'),
    (v_cl_x,       'annreqclx',       'AnnReq CL X'),
    (v_cl_y,       'annreqcl0y',      'AnnReq CL 0Y'),
    (v_cl_z,       'annreqclz',       'AnnReq CL Z'),
    (v_cl_u1,      'annreqclu1',      'AnnReq CL U1'),
    (v_cl_u2,      'annreqclu2',      'AnnReq CL U2'),
    (v_no_linked,  'annreqnolinked',  'AnnReq NO Linked'),
    (v_no_partner, 'annreqnopartner', 'AnnReq NO Partner'),
    (v_no_asker,   'annreqnoasker',   'AnnReq NO Asker'),
    (v_rr_a,       'annreqrra',       'AnnReq RR A'),
    (v_rr_b,       'annreqrrb',       'AnnReq RR B');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (least(v_cl_a, v_cl_b), greatest(v_cl_a, v_cl_b), 'pending', v_cl_b, '2014-04-04')
    returning id into v_link_main;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (least(v_cl_a, v_cl_x), greatest(v_cl_a, v_cl_x), 'pending', v_cl_a, '2014-05-05')
    returning id into v_link_a_out;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (least(v_cl_b, v_cl_y), greatest(v_cl_b, v_cl_y), 'pending', v_cl_y, '2014-06-06')
    returning id into v_link_b_in;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (least(v_cl_a, v_cl_z), greatest(v_cl_a, v_cl_z), 'pending', v_cl_z, '2014-07-07')
    returning id into v_link_a_in;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (least(v_cl_u1, v_cl_u2), greatest(v_cl_u1, v_cl_u2), 'pending', v_cl_u1, '2014-08-08')
    returning id into v_link_unrelated;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (least(v_no_linked, v_no_partner), greatest(v_no_linked, v_no_partner),
            'confirmed', v_no_partner, '2015-05-05', now())
    returning id into v_id;

  insert into anniversary_link_members (user_id, link_id)
    values (v_no_linked, v_id), (v_no_partner, v_id);

  -- add_group_creator_as_owner() adds the creator; the second member joins.
  insert into groups (name, type, invite_code, created_by)
    values ('AnnReq NoOracle Group', 'family', 'ANNREQNO', v_no_asker)
    returning id into v_no_group;
  insert into group_members (group_id, user_id, role)
    values (v_no_group, v_no_linked, 'member')
    on conflict do nothing;

  insert into groups (name, type, invite_code, created_by)
    values ('AnnReq ReRequest Group', 'family', 'ANNREQRR', v_rr_a)
    returning id into v_rr_group;
  insert into group_members (group_id, user_id, role)
    values (v_rr_group, v_rr_b, 'member')
    on conflict do nothing;

  ---------------------------------------------------------------------------
  -- cl_a, the recipient, confirms cl_b's request.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_cl_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.confirm_anniversary_link(v_link_main);

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 1: the confirmed link itself survives the cleanup.
  --
  -- FALSIFIABLE: drop BOTH `status = 'pending'` and `id <> p_link_id` from
  -- the cleanup and this fails (the link just confirmed is deleted). NOT
  -- caught: dropping only one of them -- either alone spares this row, which
  -- is why assertion 10 pins both textually.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from anniversary_links where id = v_link_main and status = 'confirmed';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: the confirmed link % resolves to % confirmed row(s) after confirm, expected 1 -- the cleanup deleted the link it was confirming',
      v_link_main, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertions 2-4: each other pending row of either partner is gone.
  --
  -- FALSIFIABLE: delete the cleanup statement and all three fail. Narrow it
  -- to `user_a in (...)` only, or `user_b in (...)` only, and at least one
  -- fails: cl_a is the user_a side of the cl_x row, and cl_b is the
  -- user_b side of the cl_0y row ('0y' sorts before 'b'). Narrow it to
  -- the caller only (cl_a) and assertion 3 fails. NOT caught: a cleanup
  -- that also deleted CONFIRMED links of other people -- assertion 5 covers
  -- unrelated PENDING rows only.
  ---------------------------------------------------------------------------
  select count(*) into v_count from anniversary_links where id = v_link_a_out;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: cl_a''s own outgoing request % still exists after cl_a confirmed another link -- invariant I-linked is broken',
      v_link_a_out;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_b_in;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: the request % sent to cl_b (the initiator of the confirmed link) still exists after confirm -- the cleanup only covers the caller',
      v_link_b_in;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_a_in;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: a second incoming request % to cl_a still exists after cl_a confirmed -- its sender would wait on a request nobody can complete',
      v_link_a_in;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: an unrelated couple's pending request is untouched.
  --
  -- FALSIFIABLE: drop the `user_a in (...) or user_b in (...)` conjunct (so
  -- the cleanup deletes every pending row in the table) and this fails. NOT
  -- caught: a cleanup scoped to some OTHER wrong set that happens to exclude
  -- this one row.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from anniversary_links where id = v_link_unrelated and status = 'pending';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: the unrelated pending request % resolves to % row(s) after an unrelated confirm, expected 1 -- the cleanup is too broad',
      v_link_unrelated, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: a request to someone already linked SUCCEEDS.
  --
  -- FALSIFIABLE: add any refusal keyed on the PARTNER's membership (for
  -- example `where user_id = p_partner_id`) and the call below raises, which
  -- fails this whole file. Same if the first new refusal checks
  -- `user_id in (v_caller, p_partner_id)`. NOT caught: a refusal that leaks
  -- through a different channel, such as timing.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_no_asker || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.request_anniversary_link(v_no_linked, '2016-06-06') into v_no_link;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from anniversary_links
   where id = v_no_link
     and status = 'pending'
     and initiated_by = v_no_asker
     and v_no_linked in (user_a, user_b);
  if v_count <> 1 then
    raise exception
      'RPC FAIL: a co-member''s request to the already-linked % resolves to % pending row(s), expected 1',
      v_no_linked, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7 (2 checks): asking the same person twice refreshes one row.
  --
  -- FALSIFIABLE: drop `and p_partner_id not in (user_a, user_b)` from the
  -- I-out refusal and the second call raises, which fails this whole file.
  -- Break the upsert so it inserts a second row and check (b) fails. NOT
  -- caught: the upsert's other effects (initiated_by, created_at refresh),
  -- which 19_anniversary_link_rpcs.sql assertion 8 covers for the first call.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_rr_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.request_anniversary_link(v_rr_b, '2017-07-07') into v_id;
  select public.request_anniversary_link(v_rr_b, '2018-08-08') into v_id2;

  perform set_config('role', v_orig_role, true);

  if v_id is distinct from v_id2 then
    raise exception
      'RPC FAIL: re-requesting the same person returned a different link id (% then %), expected the same row refreshed',
      v_id, v_id2;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from anniversary_links
   where user_a = least(v_rr_a, v_rr_b) and user_b = greatest(v_rr_a, v_rr_b)
     and agreed_date = '2018-08-08';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: % row(s) for the re-requested pair carry the second date 2018-08-08, expected exactly 1',
      v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: the "caller already linked" refusal, contiguous from `if`
  -- to `end if;`.
  --
  -- FALSIFIABLE: comment out any of its lines, change its message or
  -- errcode, or detach the raise from the condition, and the count drops to
  -- 0. NOT caught: the guard being moved after the insert (it would still
  -- match, but no longer prevent the row) -- assertion 6's shape does not
  -- exercise a linked CALLER.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*if exists \(select 1 from public\.anniversary_link_members$'
        || E'\n' || '\s*where user_id = v_caller\) then$'
        || E'\n' || '\s*raise exception ''you already share an anniversary with someone; unlink first''$'
        || E'\n' || '\s*using errcode = ''22023'';$'
        || E'\n' || '\s*end if;$');
  if v_count <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its "caller already linked" refusal, uncommented and wired to its message and errcode (matched % definition(s), expected 1)',
      v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: the "caller already has a request waiting" refusal (I-out),
  -- contiguous, including the same-pair exclusion.
  --
  -- FALSIFIABLE: drop any conjunct (including `p_partner_id not in (user_a,
  -- user_b)`), change the message or errcode, or comment out a line, and the
  -- count drops to 0. NOT caught: the same guard placed after the insert.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*if exists \(select 1 from public\.anniversary_links$'
        || E'\n' || '\s*where status = ''pending''$'
        || E'\n' || '\s*and initiated_by = v_caller$'
        || E'\n' || '\s*and p_partner_id not in \(user_a, user_b\)\) then$'
        || E'\n' || '\s*raise exception ''you already have a request waiting; cancel it first''$'
        || E'\n' || '\s*using errcode = ''22023'';$'
        || E'\n' || '\s*end if;$');
  if v_count <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its one-outgoing-request refusal with the same-pair exclusion, uncommented and wired to its message and errcode (matched % definition(s), expected 1)',
      v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: the cleanup statement in confirm_anniversary_link, with
  -- both of its belt-and-braces conjuncts.
  --
  -- FALSIFIABLE: drop `status = 'pending'` or `id <> p_link_id` (neither of
  -- which a live check here can see, since either alone spares the confirmed
  -- link), or comment out any line, and the count drops to 0. NOT caught:
  -- the statement moved outside the function's main block.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*delete from public\.anniversary_links$'
        || E'\n' || '\s*where status = ''pending''$'
        || E'\n' || '\s*and id <> p_link_id$'
        || E'\n' || '\s*and \(user_a in \(v_link\.user_a, v_link\.user_b\)$'
        || E'\n' || '\s*or user_b in \(v_link\.user_a, v_link\.user_b\)\);$');
  if v_count <> 1 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link no longer contains its pending-link cleanup with both the status and id conjuncts (matched % definition(s), expected 1)',
      v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11 (2 checks): block-comment floor beneath assertions 8-10.
  -- Line anchoring stops a `--` comment, not a `/* ... */` one, which leaves
  -- every line byte-identical and merely brackets it.
  --
  -- FALSIFIABLE: wrap any guarded statement in `/* ... */` and that
  -- function's check fails. NOT caught: nothing in the direction that
  -- matters -- any `/*` at all fails closed.
  ---------------------------------------------------------------------------
  select position('/*' in pg_get_functiondef(p.oid)) into v_pos
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure;
  if v_pos <> 0 then
    raise exception
      'GUARD FAIL: request_anniversary_link''s definition contains a /* block comment starting at character %',
      v_pos;
  end if;
  v_checks := v_checks + 1;

  select position('/*' in pg_get_functiondef(p.oid)) into v_pos
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure;
  if v_pos <> 0 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link''s definition contains a /* block comment starting at character %',
      v_pos;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 13 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 13', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_21_anniversary_request_rules');
end $$;

select token as result from _harness_result;
