# Anniversary requests are never stranded — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every anniversary request is visible to and answerable by its recipient, no sender waits on a request nobody can see, and nothing reveals whether someone else is already linked.

**Architecture:** One corrective migration re-issues `confirm_anniversary_link` (adds a cleanup of every other pending link of either partner) and `request_anniversary_link` (adds two refusals about the caller's own status). A new server action `getMyAnniversaryLinks()` returns all of the caller's links grouped as `{ confirmed, outgoing, incoming[] }`, replacing the single-row `getMyAnniversaryLink()`. A new shared `AnniversaryRequestCard` renders each incoming request on `/notifications` and on the profile page.

**Tech Stack:** Next.js App Router (this repo's version has breaking changes — read `node_modules/next/dist/docs/` before writing Next code), React client components, Supabase (Postgres + RLS, PL/pgSQL), Clerk, vitest, the repo's own RLS harness (`scripts/test-rls.sh`).

**Spec:** `_planning/2026-10-14-anniversary-requests-design.md`

## Global Constraints

- Branch: `anniversary-requests` (already created; the spec is committed on it). Never commit to `main`.
- Migrations run against the **linked production project** `xomvbdvvrlbxoyqdsstt`, applied only with `npx supabase db push`. **Corrective migrations only — never edit an applied migration.**
- `npx supabase db push` and `npm run test:rls` both touch production. **Get the owner's explicit go-ahead in chat before running either.** Never run `test:rls` concurrently with other database work.
- Read-only production queries use `npx supabase db query "<sql>" --linked`.
- **RLS test harness rules** (enforced by `scripts/test-rls.sh`): every file is declared in `supabase/tests/rls/MANIFEST`; the token is `OK_<filename minus .sql>`; no `exception when` anywhere in a test file (`:274-280`); no `commit`/`rollback`/`abort`; the file ends with exactly `select token as result from _harness_result;`; a `v_checks` floor guard that RAISES sits before the token insert and equals the real increment count; `role` is reset to the captured `current_user` after every impersonated call.
- **Anchored source checks:** every regex carries its own `(?n)`, every line is anchored (`^…$`), `pg_proc` lookups are scoped by exact `::regprocedure`, and each function whose source is matched has a `position('/*' in pg_get_functiondef(...)) = 0` floor.
- **No `/* */` comments inside any function body.** `19_anniversary_link_rpcs.sql` assertion 12 fails on them. Use `--` only.
- `security definer` functions keep `set search_path = public` and pin themselves to `(select public.requesting_user_id())`. No viewer-id parameters.
- Server actions in `lib/actions/anniversary-links.ts` use the **user-scoped** client (`@/lib/supabase/server`), never the admin client, and check `getUserId()` before building a client.
- **Falsifiability:** every test states, in a comment, the change that would make it fail **and** what it would not catch.
- New user-facing copy, verbatim:
  - refusal: `you already share an anniversary with someone; unlink first`
  - refusal: `you already have a request waiting; cancel it first`
  - linked-recipient card: `{name} wants to share an anniversary with you` / `You already share one with {partner}. To accept this, unlink on your profile first.` (on the profile page: `… To accept this, unlink above first.`)
- Gates: `npm test` (vitest), `npm run type-check`, `npm run lint` (**baseline 61 problems — compare, don't count**), `npm run build`, `npm run test:rls` (22 files after Task 1).
- `types/database.ts` is hand-edited, never regenerated. This plan needs no change to it (RPC signatures are unchanged).

## Review Focus

1. **A requester the recipient can no longer see** (they stopped sharing a group, so `user_profiles` RLS hides them) — the card must still render, with the generic name "Someone", not crash or render a blank name. Pinned in Task 2 ("keeps a link whose partner profile is hidden").
2. **More than one outgoing row left over from before the migration** — show the newest, log a warning, never throw. Pinned in Task 2 ("returns the newest outgoing request when two exist").
3. **The caller on the non-canonical side** (`user_b`) of an incoming row — `partnerId` must resolve to the other person, never the caller. Pinned in Task 2 (hidden-case-1 test uses a row where the caller is `user_b`).
4. **The links read failing in the layout or the notifications page** — the bell and page fall back to reminders only, no crash. Pinned in Task 3 (`unreadCount(..., null)` test) plus the unchanged fail-quiet `"data" in result` pattern.
5. **A stale card** (the request was already cleared by a confirm elsewhere, or declined in another tab) — Confirm shows "no anniversary request for you to confirm" inline in that card; Decline returns `{ ok: false }` and just refreshes. Already pinned by the existing `confirmAnniversaryLink` 22023 pass-through and `declineAnniversaryLink` false-return tests in `lib/actions/anniversary-links.test.ts`; Task 3's card must branch on `"error" in result` only.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql` | re-issues `request_anniversary_link` and `confirm_anniversary_link`, plus their `comment on function` pointers | 1 |
| `supabase/tests/rls/21_anniversary_request_rules.sql` | live + anchored checks for the new rules | 1 |
| `supabase/tests/rls/MANIFEST` | declares file 21 | 1 |
| `lib/actions/anniversary-links.ts` | adds `MyAnniversaryLinks` + `getMyAnniversaryLinks()` (Task 2); removes `getMyAnniversaryLink()` (Task 4) | 2, 4 |
| `lib/actions/anniversary-links.test.ts` | tests for the new reader; old reader's block removed | 2, 4 |
| `lib/notifications/unread.ts` + `.test.ts` | `unreadCount(reminders, links)`; `isIncomingAnniversaryRequest` removed | 3 |
| `components/notifications/AnniversaryRequestCard.tsx` | one incoming request: Confirm/Decline, or Decline-only when the viewer is linked | 3 |
| `components/notifications/NotificationsList.tsx` | one card per incoming request above the reminders | 3 |
| `app/(dashboard)/notifications/page.tsx`, `app/(dashboard)/layout.tsx` | read `getMyAnniversaryLinks()`; pass it on | 3 |
| `components/profile/AnniversaryPartner.tsx` | main state from `confirmed`/`outgoing`; incoming cards beneath | 4 |

---

### Task 1: Database rules and their RLS tests

**Files:**
- Create: `supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql`
- Create: `supabase/tests/rls/21_anniversary_request_rules.sql`
- Modify: `supabase/tests/rls/MANIFEST` (append one line)

**Interfaces:**
- Consumes: the live bodies of `request_anniversary_link(text, text)` (`20260912000003_anniversary_link_rpcs.sql:27-88`) and `confirm_anniversary_link(uuid)` (`20260912000014_confirm_link_reconciles_occasion_date.sql:68-208`).
- Produces: unchanged signatures `request_anniversary_link(p_partner_id text, p_date text) returns uuid` and `confirm_anniversary_link(p_link_id uuid) returns void`; two new `22023` messages (see Global Constraints). Later tasks rely on the invariants: **at most one outgoing pending request per person**, and **a confirmed person has no pending row from before their confirm**.

- [ ] **Step 1: Check production for rows that already break the new rules (read-only)**

Run:
```bash
npx supabase db query "select (select count(*) from anniversary_links) as links, (select count(*) from anniversary_links where status = 'pending') as pending, (select count(*) from (select initiated_by from anniversary_links where status = 'pending' group by initiated_by having count(*) > 1) s) as people_with_several_outgoing, (select count(*) from anniversary_links l where l.status = 'pending' and exists (select 1 from anniversary_link_members m where m.user_id in (l.user_a, l.user_b))) as pending_touching_a_linked_person" --linked
```
Expected: one row of counts. Record them in your report. If `people_with_several_outgoing` or `pending_touching_a_linked_person` is non-zero, **stop and tell the owner** — the migration does not touch existing rows, and whether to clear them is the owner's call. Change nothing.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql` with exactly this structure, in this order:

**(a) Header** (write as-is):

```sql
-- Anniversary requests are never stranded.
-- Design: _planning/2026-10-14-anniversary-requests-design.md
--
-- Every surface used to read ONE of the caller's anniversary_links rows, so a
-- request sent to someone already linked, the older of two incoming requests,
-- and the caller's own request once someone asked them were all invisible to
-- somebody who needed to act on them (deferred item F4 and two siblings).
-- The read side is fixed in lib/actions/anniversary-links.ts
-- (getMyAnniversaryLinks). This migration makes two invariants true in the
-- database, so that reader can be honest about them:
--
--   I-out:    a person has at most one outgoing pending request;
--   I-linked: a person in a confirmed link has no outgoing pending request,
--             and no pending request of any kind from before their confirm.
--
-- request_anniversary_link: copied verbatim from 20260912000003, plus two
--   refusals after the existing guards. Both concern the CALLER's own status.
--   Refusing because the PARTNER is already linked would make this function an
--   oracle for other people's relationships, so that request still succeeds.
--
-- confirm_anniversary_link: copied verbatim from 20260912000014 (the live
--   body), plus one statement after the anniversary_link_members insert that
--   deletes every other pending link involving either partner. To each of
--   those senders this is indistinguishable from a decline.
--
-- Corrective migration: 20260912000003 and 20260912000014 are applied and are
-- not edited. Function bodies use `--` comments only;
-- 19_anniversary_link_rpcs.sql assertion 12 fails on a block comment.
```

**(b) `request_anniversary_link`:** copy `20260912000003_anniversary_link_rpcs.sql` lines **27–63** verbatim (from `create or replace function public.request_anniversary_link(` through the `end if;` that closes the `that is not a usable date` guard). Then add this block, verbatim (its
first line is blank):

```sql

  -- The caller's OWN status only. Refusing because the PARTNER is already
  -- linked would make this function an oracle for other people's
  -- relationships (design decision 1), so a request to a linked person
  -- still succeeds below.
  if exists (select 1 from public.anniversary_link_members
              where user_id = v_caller) then
    raise exception 'you already share an anniversary with someone; unlink first'
      using errcode = '22023';
  end if;

  -- At most one outgoing request per person (invariant I-out). Asking the
  -- SAME person again is excluded here and refreshes the existing row
  -- through the upsert below, exactly as before.
  if exists (select 1 from public.anniversary_links
              where status = 'pending'
                and initiated_by = v_caller
                and p_partner_id not in (user_a, user_b)) then
    raise exception 'you already have a request waiting; cancel it first'
      using errcode = '22023';
  end if;
```

Then copy lines **64–88** of the same file verbatim (blank line, `v_a := least(...)` through the closing `$$;`).

**(c) `confirm_anniversary_link`:** copy `20260912000014_confirm_link_reconciles_occasion_date.sql` lines **68–128** verbatim (from `create or replace function public.confirm_anniversary_link(p_link_id uuid)` through `values (v_link.user_a, p_link_id), (v_link.user_b, p_link_id);`). Then add this block, verbatim:

```sql

  -- ---- clear every other pending request of either partner -------------
  -- (design decision 1.) Neither partner can confirm another link now, so a
  -- pending row naming either of them is a request nobody can complete.
  -- Deleting it is exactly what a decline does, so a sender sees nothing a
  -- decline would not already show them -- in particular they never learn
  -- that the person they asked is now linked to somebody else.
  --
  -- `status = 'pending'` alone already spares this link, whose status
  -- flipped above; `id <> p_link_id` keeps it spared if this statement is
  -- ever moved above that update.
  delete from public.anniversary_links
   where status = 'pending'
     and id <> p_link_id
     and (user_a in (v_link.user_a, v_link.user_b)
          or user_b in (v_link.user_a, v_link.user_b));
```

Then copy lines **129–208** of the same file verbatim (blank line, the profile_info adoption, the reconciliation, the `exception … when unique_violation` handler, `end;`, `$$;`).

**(d) Grants and pointers** (write as-is):

```sql

grant execute on function public.request_anniversary_link(text, text) to authenticated, service_role;
grant execute on function public.confirm_anniversary_link(uuid) to authenticated, service_role;

comment on function public.request_anniversary_link(text, text) is
  'Creates or refreshes a PENDING anniversary link from the caller to a co-member. Refuses a caller who is already in a confirmed link, or who already has a pending request out to someone else -- both about the caller''s own status, never the partner''s, so a request to someone already linked still succeeds. Live body: 20261014000000_anniversary_requests_never_stranded.sql (20260912000003''s body plus those two refusals).';

comment on function public.confirm_anniversary_link(uuid) is
  'Confirms a pending anniversary link: flips status, inserts both anniversary_link_members rows, deletes every OTHER pending link involving either partner, adopts agreed_date into BOTH partners'' profile_info, and reconciles already-materialized occasions. Live body: 20261014000000_anniversary_requests_never_stranded.sql, which is 20260912000014_confirm_link_reconciles_occasion_date.sql verbatim plus the pending-link cleanup. Two corrections to that body''s inherited comments still apply, and they live in DIFFERENT files: finding M2 (20260912000014''s header, :25-30, mis-dates the profile/occasion divergence -- it predates 20260912000012, which only made it reachable from either side) and finding M4 (20260912000012:63-65 names BYPASSRLS as the only reason the cross-user profile_info write succeeds; table-owner exemption alone would also suffice, since the definer owner owns profile_info and relforcerowsecurity is false). Both are written up in 20260912000017_comment_corrections.sql. The body''s own comment pointing to 20260912000012''s header for the non-exploitability argument is the uncorrected M4 text, carried verbatim; the argument holds, only its "ONLY because" does not.';
```

- [ ] **Step 3: Prove the re-issued bodies differ from the live ones only by the added blocks**

Run:
```bash
body() { awk -v fn="$2" '$0 ~ "^create or replace function public\\." fn "\\(" {on=1} on {print} on && /^\$\$;/ {exit}' "$1"; }
diff <(body supabase/migrations/20260912000003_anniversary_link_rpcs.sql request_anniversary_link) <(body supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql request_anniversary_link)
diff <(body supabase/migrations/20260912000014_confirm_link_reconciles_occasion_date.sql confirm_anniversary_link) <(body supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql confirm_anniversary_link)
```
Expected: both diffs show **only `>` lines** (additions): the two refusal blocks in the first, the cleanup block in the second. Any `<` line means a live line was changed or dropped — fix it before continuing. Also run `grep -c '/\*' supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql` and expect `0`.

- [ ] **Step 4: Write the RLS test file**

Create `supabase/tests/rls/21_anniversary_request_rules.sql`:

```sql
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
```

Append `21_anniversary_request_rules.sql` as the last line of `supabase/tests/rls/MANIFEST`.

- [ ] **Step 5: Ask the owner, then run the RLS suite to see file 21 fail**

Ask in chat for the go-ahead to run `npm run test:rls` (it writes rolled-back fixtures to production) **and** `npx supabase db push` in the next step. Wait for a clear yes. Then:

Run: `npm run test:rls`
Expected: files 00–20 PASS; `21_anniversary_request_rules` FAILS with `RPC FAIL: cl_a's own outgoing request … still exists after cl_a confirmed another link`. (Before the migration there is no cleanup, and an uncaught raise stops the file at its first failure.) If any of 00–20 fails, stop — that is a pre-existing problem to report, not something to fix here.

- [ ] **Step 6: Apply the migration**

Run: `npx supabase db push`
Expected: it lists and applies exactly `20261014000000_anniversary_requests_never_stranded.sql`.

Then run: `npx supabase migration list --linked`
Expected: every version has local == remote, including `20261014000000`, with no gaps.

- [ ] **Step 7: Run the RLS suite again**

Run: `npm run test:rls`
Expected: all 22 files PASS, including `19_anniversary_link_rpcs` (its anchored checks on `confirm`'s existing lines still match) and `21_anniversary_request_rules`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261014000000_anniversary_requests_never_stranded.sql supabase/tests/rls/21_anniversary_request_rules.sql supabase/tests/rls/MANIFEST
git commit -m "feat(anniversaries): clear stranded requests on confirm, refuse a second outgoing request"
```
(End the message with the session's `Co-Authored-By` line.)

---

### Task 2: `getMyAnniversaryLinks()` — read every link, grouped

**Files:**
- Modify: `lib/actions/anniversary-links.ts` (add after `getMyAnniversaryLink`, which stays until Task 4)
- Test: `lib/actions/anniversary-links.test.ts` (add a new `describe` block; leave the old one)

**Interfaces:**
- Consumes: `AnniversaryLink` (unchanged, `lib/actions/anniversary-links.ts:38-77`); Task 1's invariant "at most one outgoing pending request per person".
- Produces:
  ```ts
  export type MyAnniversaryLinks = {
    confirmed: AnniversaryLink | null;
    outgoing: AnniversaryLink | null;
    incoming: AnniversaryLink[]; // newest first
  };
  export async function getMyAnniversaryLinks(): Promise<
    { data: MyAnniversaryLinks } | { error: string }
  >;
  ```
  Error message for a failed links or profiles read: `"Failed to load your anniversary links. Please try again."`

- [ ] **Step 1: Write the failing tests**

In `lib/actions/anniversary-links.test.ts`, add `getMyAnniversaryLinks` to the destructured import list (after `getMyAnniversaryLink`), then add this block after the existing `describe("getMyAnniversaryLink", …)` block:

```ts
describe("getMyAnniversaryLinks", () => {
  // The caller is "user_a_123" (beforeEach). Ids keep canonical order
  // (user_a < user_b) so the fixtures look like real rows; "user_0_999"
  // sorts before the caller, putting the caller on the user_b side.
  const row = (overrides: Record<string, unknown>) => ({
    id: "link-x",
    user_a: "user_a_123",
    user_b: "user_b_456",
    status: "pending",
    initiated_by: "user_b_456",
    agreed_date: "2020-06-01",
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  });

  const profile = (id: string, name: string) => ({
    id,
    username: name.toLowerCase(),
    display_name: name,
  });

  const profileLookups = () =>
    inSpy.mock.calls.filter(([table]) => table === "user_profiles");

  // Falsifiability: hidden case 1 (F4). Reintroduce `.limit(1)` and this
  // fails -- only the newer incoming row survives the limit, so `confirmed`
  // comes back null. Hardcode `partnerId = row.user_b` and it fails too:
  // the incoming row puts the caller on the user_b side. NOT caught: a
  // reader that returned the right groups from a different query shape.
  it("returns a confirmed link AND a newer incoming request", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({
              id: "link-confirmed",
              status: "confirmed",
              initiated_by: "user_a_123",
              created_at: "2026-09-01T00:00:00Z",
            }),
            row({
              id: "link-incoming",
              user_a: "user_0_999",
              user_b: "user_a_123",
              initiated_by: "user_0_999",
              agreed_date: "2018-03-03",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Partner"), profile("user_0_999", "Asker")],
          error: null,
        },
      ],
      profile_info: [
        { data: [{ user_id: "user_a_123", field_value: "2019-05-05" }], error: null },
      ],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      data: {
        confirmed: {
          id: "link-confirmed",
          partnerId: "user_b_456",
          partnerUsername: "partner",
          partnerDisplayName: "Partner",
          status: "confirmed",
          agreedDate: "2020-06-01",
          sharedDate: "2019-05-05",
          initiatedByMe: true,
        },
        outgoing: null,
        incoming: [
          {
            id: "link-incoming",
            partnerId: "user_0_999",
            partnerUsername: "asker",
            partnerDisplayName: "Asker",
            status: "pending",
            agreedDate: "2018-03-03",
            sharedDate: null,
            initiatedByMe: false,
          },
        ],
      },
    });
    // One profile lookup covering every partner, not one per row.
    expect(profileLookups()).toHaveLength(1);
    expect([...(profileLookups()[0][2] as string[])].sort()).toEqual([
      "user_0_999",
      "user_b_456",
    ]);
  });

  // Falsifiability: hidden case 2. Reintroduce `.limit(1)` and only one
  // request comes back. Drop the `.order("created_at", ...)` call and the
  // fixture's own oldest-first order leaks through, so the ids come back
  // reversed (the mock sorts only by the clauses actually requested). NOT
  // caught: ties on created_at, which real rows do not have.
  it("returns every incoming request, newest first", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({ id: "link-older", created_at: "2026-10-01T00:00:00Z" }),
            row({
              id: "link-newer",
              user_b: "user_c_789",
              initiated_by: "user_c_789",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Bea"), profile("user_c_789", "Cal")],
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.incoming.map((l) => l.id)).toEqual([
      "link-newer",
      "link-older",
    ]);
    expect(result.data.confirmed).toBeNull();
    expect(result.data.outgoing).toBeNull();
  });

  // Falsifiability: hidden case 3. Reintroduce `.limit(1)` and the caller's
  // own (older) request disappears behind the newer incoming one. Classify
  // on status alone (ignoring initiated_by) and the outgoing row lands in
  // `incoming`. NOT caught: which of two outgoing rows wins -- see the next
  // test.
  it("keeps the caller's own request when someone asks them later", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({
              id: "link-mine",
              initiated_by: "user_a_123",
              created_at: "2026-10-01T00:00:00Z",
            }),
            row({
              id: "link-theirs",
              user_b: "user_c_789",
              initiated_by: "user_c_789",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Bea"), profile("user_c_789", "Cal")],
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.outgoing?.id).toBe("link-mine");
    expect(result.data.outgoing?.initiatedByMe).toBe(true);
    expect(result.data.incoming.map((l) => l.id)).toEqual(["link-theirs"]);
  });

  // Review focus 2. Two outgoing rows can only predate the I-out refusal.
  // Falsifiability: take the LAST outgoing row instead of the first and the
  // older one wins; drop the warning and the spy assertion fails. NOT
  // caught: what the UI does with the dropped row -- nothing, by design.
  it("returns the newest outgoing request when two exist, and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({
              id: "link-old-mine",
              initiated_by: "user_a_123",
              created_at: "2026-10-01T00:00:00Z",
            }),
            row({
              id: "link-new-mine",
              user_b: "user_c_789",
              initiated_by: "user_a_123",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [
        {
          data: [profile("user_b_456", "Bea"), profile("user_c_789", "Cal")],
          error: null,
        },
      ],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.outgoing?.id).toBe("link-new-mine");
    expect(result.data.incoming).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // Review focus 1. A requester who no longer shares a group with the
  // caller is hidden by user_profiles' RLS. Falsifiability: index the
  // profile lookup by position instead of by id and the wrong name lands on
  // the wrong row; throw on a missing profile and this rejects. NOT caught:
  // what label the UI shows -- the card's "Someone" fallback.
  it("keeps a link whose partner profile is hidden", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [
            row({ id: "link-hidden", created_at: "2026-10-01T00:00:00Z" }),
            row({
              id: "link-visible",
              user_b: "user_c_789",
              initiated_by: "user_c_789",
              created_at: "2026-10-05T00:00:00Z",
            }),
          ],
          error: null,
        },
      ],
      user_profiles: [{ data: [profile("user_c_789", "Cal")], error: null }],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    const [visible, hidden] = result.data.incoming;
    expect(visible).toMatchObject({ id: "link-visible", partnerDisplayName: "Cal" });
    expect(hidden).toMatchObject({
      id: "link-hidden",
      partnerId: "user_b_456",
      partnerUsername: null,
      partnerDisplayName: null,
    });
  });

  // Falsifiability: look up profiles (or profile_info) when there are no
  // rows and the unscripted table throws "No scripted Supabase response".
  // NOT caught: an extra query on a NON-empty result -- the other tests
  // script exactly the tables they expect.
  it("returns empty groups without further queries when there are no links", async () => {
    supabase = createSupabaseMock({
      anniversary_links: [{ data: [], error: null }],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      data: { confirmed: null, outgoing: null, incoming: [] },
    });
  });

  // Falsifiability: return `{ data: { ... } }` on a failed read and the
  // error shape assertion fails. NOT caught: the exact log text.
  it("returns an error when the links read fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      error: "Failed to load your anniversary links. Please try again.",
    });
    error.mockRestore();
  });

  it("returns an error when the partner profile lookup fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [{ data: [row({ id: "link-1" })], error: null }],
      user_profiles: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({
      error: "Failed to load your anniversary links. Please try again.",
    });
    error.mockRestore();
  });

  // Falsifiability: surface the shared-date failure as `{ error }` and this
  // fails. NOT caught: whether the fallback date is the right one -- the
  // component falls back to agreedDate, as before.
  it("falls back to a null shared date when that lookup fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({
      anniversary_links: [
        {
          data: [row({ id: "link-c", status: "confirmed", initiated_by: "user_a_123" })],
          error: null,
        },
      ],
      user_profiles: [{ data: [profile("user_b_456", "Bea")], error: null }],
      profile_info: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getMyAnniversaryLinks();

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data.confirmed).toMatchObject({ id: "link-c", sharedDate: null });
    error.mockRestore();
  });

  // Falsifiability: build the client before checking getUserId() and the
  // empty mock throws on the first from(). NOT caught: a signed-out caller
  // reaching an RPC -- this action calls none.
  it("returns Not authenticated when signed out, without querying", async () => {
    getUserId.mockResolvedValue(null);
    supabase = createSupabaseMock({});

    const result = await getMyAnniversaryLinks();

    expect(result).toEqual({ error: "Not authenticated" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/actions/anniversary-links.test.ts`
Expected: the new block FAILS with `getMyAnniversaryLinks is not a function`; every existing test still passes.

- [ ] **Step 3: Implement `getMyAnniversaryLinks()`**

In `lib/actions/anniversary-links.ts`, add immediately after `getMyAnniversaryLink()` (before the `AnniversaryPartnerCandidate` type):

```ts
/**
 * Every anniversary link the caller is part of, grouped by what the caller
 * can do about it.
 *
 * Replaces getMyAnniversaryLink(), whose `.limit(1)` hid three kinds of row
 * from someone who needed to act on them: a request sent to a person already
 * linked (deferred item F4), the older of two incoming requests, and the
 * caller's own request once someone asked them
 * (_planning/2026-10-14-anniversary-requests-design.md).
 *
 * `confirmed` is at most one row: anniversary_link_members' primary key.
 * `outgoing` is at most one row: request_anniversary_link refuses a second
 * (20261014000000). A second outgoing row can only predate that refusal; the
 * newest wins and the rest are logged rather than silently dropped.
 * `incoming` is every pending request sent to the caller, newest first.
 *
 * Same user-scoped client and same RLS reliance as getMyAnniversaryLink():
 * the participant-only SELECT policy is what limits the read to the caller's
 * rows, and user_profiles' own policy decides which partner names come back.
 */
export type MyAnniversaryLinks = {
  confirmed: AnniversaryLink | null;
  outgoing: AnniversaryLink | null;
  incoming: AnniversaryLink[];
};

export async function getMyAnniversaryLinks(): Promise<
  { data: MyAnniversaryLinks } | { error: string }
> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("anniversary_links")
    .select("id, user_a, user_b, status, initiated_by, agreed_date, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getMyAnniversaryLinks: select failed", error);
    return { error: "Failed to load your anniversary links. Please try again." };
  }

  const links = rows ?? [];
  if (links.length === 0) {
    return { data: { confirmed: null, outgoing: null, incoming: [] } };
  }

  const partnerOf = (row: { user_a: string; user_b: string }) =>
    row.user_a === userId ? row.user_b : row.user_a;

  // One lookup for every partner. A partner the caller no longer shares a
  // group with is filtered out by user_profiles' RLS; their link still comes
  // back, with null name fields, and the UI falls back to a generic label.
  const { data: profiles, error: profilesError } = await supabase
    .from("user_profiles")
    .select("id, username, display_name")
    .in("id", [...new Set(links.map(partnerOf))]);

  if (profilesError) {
    console.error(
      "getMyAnniversaryLinks: partner profile lookup failed",
      profilesError
    );
    return { error: "Failed to load your anniversary links. Please try again." };
  }

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p] as const));

  const toLink = (
    row: (typeof links)[number],
    sharedDate: string | null
  ): AnniversaryLink => {
    const partnerId = partnerOf(row);
    const partner = profileById.get(partnerId);
    return {
      id: row.id,
      partnerId,
      partnerUsername: partner?.username ?? null,
      partnerDisplayName: partner?.display_name ?? null,
      status: row.status as "pending" | "confirmed",
      agreedDate: row.agreed_date,
      sharedDate,
      initiatedByMe: row.initiated_by === userId,
    };
  };

  const confirmedRow = links.find((r) => r.status === "confirmed");
  const outgoingRows = links.filter(
    (r) => r.status === "pending" && r.initiated_by === userId
  );
  const incomingRows = links.filter(
    (r) => r.status === "pending" && r.initiated_by !== userId
  );

  if (outgoingRows.length > 1) {
    console.warn(
      "getMyAnniversaryLinks: more than one outgoing request; showing the newest",
      outgoingRows.map((r) => r.id)
    );
  }

  // The couple's LIVE date, for the confirmed link only -- the same lookup
  // and the same canonical-first resolution as getMyAnniversaryLink() (see
  // AnniversaryLink.sharedDate, finding I4). A failure falls back to null
  // rather than failing the whole read.
  let sharedDate: string | null = null;
  if (confirmedRow) {
    const { data: dateRows, error: dateError } = await supabase
      .from("profile_info")
      .select("user_id, field_value")
      .in("user_id", [confirmedRow.user_a, confirmedRow.user_b])
      .eq("category", "dates")
      .eq("field_name", "anniversary");

    if (dateError) {
      console.error(
        "getMyAnniversaryLinks: shared date lookup failed",
        dateError
      );
    }

    const byUser = new Map(
      (dateRows ?? []).map((r) => [r.user_id, r.field_value] as const)
    );
    sharedDate = byUser.get(confirmedRow.user_a) ?? byUser.get(userId) ?? null;
  }

  return {
    data: {
      confirmed: confirmedRow ? toLink(confirmedRow, sharedDate) : null,
      outgoing: outgoingRows[0] ? toLink(outgoingRows[0], null) : null,
      incoming: incomingRows.map((r) => toLink(r, null)),
    },
  };
}
```

The shared-date block duplicates `getMyAnniversaryLink()`'s for the length of one task; Task 4 deletes the old function.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/actions/anniversary-links.test.ts`
Expected: all PASS.

Then prove the `.limit(1)` falsifiability claim: temporarily add `.limit(1)` after the `.order(...)` call, re-run, and confirm at least the three hidden-case tests fail. Remove it and re-run to green.

- [ ] **Step 5: Type-check and commit**

Run: `npm run type-check`
Expected: exit 0.

```bash
git add lib/actions/anniversary-links.ts lib/actions/anniversary-links.test.ts
git commit -m "feat(anniversaries): read every link, grouped as confirmed, outgoing and incoming"
```

---

### Task 3: Notifications — one card per incoming request, and an honest count

**Files:**
- Modify: `lib/notifications/unread.ts`, `lib/notifications/unread.test.ts`
- Create: `components/notifications/AnniversaryRequestCard.tsx`
- Modify: `components/notifications/NotificationsList.tsx`
- Modify: `app/(dashboard)/notifications/page.tsx`, `app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `MyAnniversaryLinks`, `getMyAnniversaryLinks()` (Task 2); `confirmAnniversaryLink(linkId): Promise<{ ok: true } | { error: string }>`, `declineAnniversaryLink(linkId): Promise<{ ok: boolean } | { error: string }>` (unchanged).
- Produces:
  ```ts
  // lib/notifications/unread.ts
  export function unreadCount(
    reminders: Array<{ banner_dismissed: boolean }> | null | undefined,
    links?: MyAnniversaryLinks | null,
  ): number;
  // components/notifications/AnniversaryRequestCard.tsx
  export function AnniversaryRequestCard(props: {
    request: AnniversaryLink;
    myConfirmedLink: AnniversaryLink | null;
    onProfilePage?: boolean;
    onChanged?: () => void | Promise<void>;
  }): JSX.Element;
  // components/notifications/NotificationsList.tsx -- prop renamed
  //   anniversaryLink?: AnniversaryLink | null   ->   links?: MyAnniversaryLinks | null
  ```
  `isIncomingAnniversaryRequest` is removed.

- [ ] **Step 1: Write the failing unread tests**

In `lib/notifications/unread.test.ts`:
- Change the import line to `import { unreadCount, unreadReminders } from "./unread";` and add `import type { MyAnniversaryLinks } from "@/lib/actions/anniversary-links";` (keep the `AnniversaryLink` type import).
- Below the `anniversaryLink` fixture helper, add:
  ```ts
  const links = (
    overrides: Partial<MyAnniversaryLinks> = {},
  ): MyAnniversaryLinks => ({
    confirmed: null,
    outgoing: null,
    incoming: [],
    ...overrides,
  });
  ```
- Delete the four tests that pass a single `AnniversaryLink` (`adds one for an incoming pending anniversary request`, `does not count a pending request the caller sent themselves`, `does not count a confirmed link -- nothing left to act on`, `does not count when there is no link at all`) and the whole `describe("isIncomingAnniversaryRequest", …)` block.
- Add these inside `describe("unreadCount", …)`:
  ```ts
  // Falsifiability: count `incoming.length > 0 ? 1 : 0` (the old one-row
  // behaviour) and the first expectation fails -- two people asking is two
  // things to answer. NOT caught: whether incoming holds the right rows;
  // getMyAnniversaryLinks' own tests pin that.
  it("adds one per incoming anniversary request", () => {
    expect(
      unreadCount(
        [],
        links({ incoming: [anniversaryLink({ id: "l1" }), anniversaryLink({ id: "l2" })] }),
      ),
    ).toBe(2);
    expect(
      unreadCount([reminder(false)], links({ incoming: [anniversaryLink()] })),
    ).toBe(2);
  });

  // Falsifiability: count `outgoing` or `confirmed` too and this fails --
  // neither is something the caller still has to answer.
  it("does not count the caller's own request or confirmed link", () => {
    expect(
      unreadCount(
        [],
        links({
          outgoing: anniversaryLink({ initiatedByMe: true }),
          confirmed: anniversaryLink({ status: "confirmed" }),
        }),
      ),
    ).toBe(0);
  });

  // Review focus 4: the layout and page pass null when the links read
  // failed. Falsifiability: dereference `links.incoming` without a guard
  // and this throws.
  it("treats missing links as none", () => {
    expect(unreadCount([reminder(false)], null)).toBe(1);
    expect(unreadCount([reminder(false)], undefined)).toBe(1);
    expect(unreadCount([])).toBe(0);
  });
  ```

Run: `npx vitest run lib/notifications/unread.test.ts`
Expected: FAIL — `unreadCount` still takes a single `AnniversaryLink`, so the first new test returns 0 (or the type mismatch is reported).

- [ ] **Step 2: Change `unreadCount`**

In `lib/notifications/unread.ts`:
- Replace the import with `import type { MyAnniversaryLinks } from "@/lib/actions/anniversary-links";`.
- Replace the last paragraph of the header comment ("Task 9 adds a second source of unread: …") with:
  ```ts
   * A second source of unread is every INCOMING anniversary request
   * (getMyAnniversaryLinks().incoming) -- one each, because each is a separate
   * person waiting on an answer. The caller's own request and their confirmed
   * link are not counted: neither has anything left for them to answer. Both
   * the bell (the dashboard layout) and the page (/notifications) go through
   * unreadCount() below, the same one-shared-filter reasoning this module
   * already existed for.
  ```
- Delete `isIncomingAnniversaryRequest` entirely.
- Replace `unreadCount` with:
  ```ts
  export function unreadCount(
    reminders: Array<{ banner_dismissed: boolean }> | null | undefined,
    links?: MyAnniversaryLinks | null,
  ): number {
    return (
      unreadReminders(reminders ?? []).length + (links?.incoming.length ?? 0)
    );
  }
  ```

Run: `npx vitest run lib/notifications/unread.test.ts`
Expected: PASS.

- [ ] **Step 3: Create the request card**

Create `components/notifications/AnniversaryRequestCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { Text } from "@/components/ui/text";
import {
  confirmAnniversaryLink,
  declineAnniversaryLink,
  type AnniversaryLink,
} from "@/lib/actions/anniversary-links";
import { formatMonthDay } from "@/lib/utils/dates";

interface AnniversaryRequestCardProps {
  /** One INCOMING pending request: somebody else asked the viewer. */
  request: AnniversaryLink;
  /**
   * The viewer's own confirmed link, if any. When set, Confirm is not offered
   * -- confirm_anniversary_link would refuse it -- and the card says why,
   * naming only the viewer's OWN partner. Nothing here depends on the
   * requester's status, so the card discloses nothing about them.
   */
  myConfirmedLink: AnniversaryLink | null;
  /**
   * On the profile page the confirmed card sits directly above, so the hint
   * points there instead of linking to the page the viewer is already on.
   */
  onProfilePage?: boolean;
  /** Runs after a successful action, before router.refresh(). */
  onChanged?: () => void | Promise<void>;
}

const nameOf = (link: AnniversaryLink, fallback: string) =>
  link.partnerDisplayName || link.partnerUsername || fallback;

/**
 * One incoming anniversary request, shared by /notifications and the profile
 * page so the consent copy lives in one place.
 *
 * Each card owns its loading and error state: acting on one request must not
 * disable or mislabel the others (a viewer can now hold several -- see
 * getMyAnniversaryLinks). Every handler branches on `"error" in result`
 * alone, so a legitimate `{ ok: false }` from decline (the request was
 * already gone) falls through to a refresh rather than an error.
 */
export function AnniversaryRequestCard({
  request,
  myConfirmedLink,
  onProfilePage = false,
  onChanged,
}: AnniversaryRequestCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requester = nameOf(request, "Someone");

  const run = async (
    action: (linkId: string) => Promise<{ ok: boolean } | { error: string }>
  ) => {
    setLoading(true);
    setError(null);
    const result = await action(request.id);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    await onChanged?.();
    router.refresh();
  };

  return (
    // Stacks below sm: for the same reason the group member cards do
    // (76c1214): a sentence plus two buttons cannot share a row at 375px.
    // min-w-0 on the text block, shrink-0 on the icon well.
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-primary-200 bg-primary-50 sm:flex-row sm:items-start">
      <div className="shrink-0 w-10 h-10 rounded-full bg-white flex items-center justify-center">
        <HeartHandshake className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {/* No truncate: the name is embedded in a full sentence, so there is
            no fixed-length token to clip -- it wraps instead. */}
        <Text>
          <span className="font-medium">{requester}</span> wants to share an
          anniversary with you
        </Text>
        {myConfirmedLink ? (
          <Text size="sm">
            You already share one with{" "}
            {nameOf(myConfirmedLink, "your partner")}. To accept this,{" "}
            {onProfilePage ? (
              "unlink above first."
            ) : (
              <>
                unlink on <Link href="/profile/edit">your profile</Link> first.
              </>
            )}
          </Text>
        ) : (
          // Load-bearing, not decoration: confirming OVERWRITES the
          // accepting partner's own anniversary date, so the consequence is
          // stated outright, naming the date, before either button is
          // pressable.
          <Text size="sm">
            {requester} says your shared anniversary is{" "}
            {formatMonthDay(request.agreedDate)}. Confirming will set your
            anniversary to that date.
          </Text>
        )}
        {error && (
          <Text size="sm" className="text-error">
            {error}
          </Text>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!myConfirmedLink && (
            <Button
              size="small"
              onClick={() => run(confirmAnniversaryLink)}
              loading={loading}
            >
              <Check className="w-4 h-4" />
              Confirm
            </Button>
          )}
          <Button
            variant="tertiary"
            size="small"
            onClick={() => run(declineAnniversaryLink)}
            loading={loading}
          >
            <X className="w-4 h-4" />
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render the cards in `NotificationsList`**

In `components/notifications/NotificationsList.tsx`:
- Imports: change the lucide import to `import { Cake, Heart, Check, BellOff } from "lucide-react";`; replace the `confirmAnniversaryLink, declineAnniversaryLink, type AnniversaryLink` import with `import type { MyAnniversaryLinks } from "@/lib/actions/anniversary-links";`; change the unread import to `import type { DateReminder } from "@/lib/notifications/unread";`; add `import { AnniversaryRequestCard } from "@/components/notifications/AnniversaryRequestCard";`.
- Replace the `anniversaryLink` prop and its doc comment with:
  ```ts
  /**
   * All of the caller's anniversary links. Only `incoming` renders here, one
   * card per request; `confirmed` is passed to each card so it can offer
   * Decline only when the caller is already linked. The caller's own request
   * lives on the profile page (components/profile/AnniversaryPartner.tsx).
   */
  links?: MyAnniversaryLinks | null;
  ```
- In the function signature replace `anniversaryLink = null,` with `links = null,`.
- Delete `linkActionLoading`, `linkActionError` and their `useState` lines, `showRequest`, `partnerLabel`, the comment above `handleConfirmLink`, `handleConfirmLink` and `handleDeclineLink`. Then remove the `useRouter` import and the `const router = useRouter();` line — nothing else in the component uses them.
- Add, where `showRequest` was:
  ```ts
  const incoming = links?.incoming ?? [];
  const myConfirmedLink = links?.confirmed ?? null;
  ```
- Change the empty-state condition to `if (reminders.length === 0 && incoming.length === 0) {`.
- Replace the whole `{showRequest && anniversaryLink && ( … )}` block with:
  ```tsx
  {incoming.map((request) => (
    <AnniversaryRequestCard
      key={request.id}
      request={request}
      myConfirmedLink={myConfirmedLink}
    />
  ))}
  ```

- [ ] **Step 5: Pass the links from the page and the layout**

In `app/(dashboard)/notifications/page.tsx`:
- Import `getMyAnniversaryLinks` instead of `getMyAnniversaryLink`.
- Replace the body's link handling with:
  ```ts
  const [{ data }, linksResult] = await Promise.all([
    getActiveDateReminders(),
    getMyAnniversaryLinks(),
  ]);
  const reminders = (data ?? []) as DateReminder[];
  // Same "no `data` key on the error branch" shape as the dashboard layout's
  // own getMyAnniversaryLinks() call -- an error here just means no requests
  // to show, not zero reminders either.
  const links = "data" in linksResult ? linksResult.data : null;
  const unread = unreadCount(reminders, links);
  ```
- Change the list to `<NotificationsList reminders={reminders} links={links} />`.

In `app/(dashboard)/layout.tsx`:
- Import `getMyAnniversaryLinks` instead of `getMyAnniversaryLink`.
- Replace the `Promise.all` and the `anniversaryLink` lines with:
  ```ts
  // Get active date reminders for the user, and every anniversary link they
  // are part of -- run together since neither depends on the other.
  const [{ data: reminders }, linksResult] = await Promise.all([
    getActiveDateReminders(),
    getMyAnniversaryLinks(),
  ]);
  // getMyAnniversaryLinks()'s error branch carries no `data` key at all (see
  // its own return type), so this cannot be destructured the way reminders
  // above can -- an error here just means "nothing to add to the badge",
  // the same fail-quiet posture getActiveDateReminders() takes on its own
  // error paths.
  const links = "data" in linksResult ? linksResult.data : null;
  ```
- Change the TopBar comment's last line to `anniversary requests, counted through the one shared filter so the` and the prop to `notificationCount={unreadCount(reminders, links)}`.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run type-check && npm run lint`
Expected: vitest all PASS; type-check exit 0; lint reports **61** problems (the baseline). Any new problem is in a file this task touched — fix it.

Run: `grep -rn "isIncomingAnniversaryRequest" app components lib`
Expected: no output.

```bash
git add lib/notifications/unread.ts lib/notifications/unread.test.ts components/notifications/AnniversaryRequestCard.tsx components/notifications/NotificationsList.tsx "app/(dashboard)/notifications/page.tsx" "app/(dashboard)/layout.tsx"
git commit -m "feat(anniversaries): show every incoming request in notifications, one card each"
```

---

### Task 4: Profile card, and retire the single-row reader

**Files:**
- Modify: `components/profile/AnniversaryPartner.tsx`
- Modify: `lib/actions/anniversary-links.ts` (delete `getMyAnniversaryLink`)
- Modify: `lib/actions/anniversary-links.test.ts` (delete its block and import)

**Interfaces:**
- Consumes: `getMyAnniversaryLinks()`, `MyAnniversaryLinks` (Task 2); `AnniversaryRequestCard` with `onProfilePage` and `onChanged` (Task 3).
- Produces: nothing new. After this task no code references `getMyAnniversaryLink(` (singular).

- [ ] **Step 1: Switch the profile card to grouped links**

In `components/profile/AnniversaryPartner.tsx`:

- Imports: in the lucide import drop `Check`; in the actions import drop `confirmAnniversaryLink` and `getMyAnniversaryLink`, add `getMyAnniversaryLinks` and `type MyAnniversaryLinks` (keep `type AnniversaryLink` — `partnerLabel` uses it); add `import { AnniversaryRequestCard } from "@/components/notifications/AnniversaryRequestCard";`.
- Replace the "Three states, driven entirely by getMyAnniversaryLink():" comment list with:
  ```ts
   * Driven by getMyAnniversaryLinks(). The main area shows the caller's OWN
   * state, by priority:
   *   - confirmed           -> partner's name, shared date, + Unlink
   *   - else outgoing        -> who was asked, + Cancel (declineAnniversaryLink
   *                            -- either participant may remove a pending
   *                            link, so "cancel" and "decline" are the same
   *                            call from opposite sides)
   *   - else                 -> partner picker + date + "Ask to share"
   * Beneath it, one AnniversaryRequestCard per INCOMING request -- the same
   * card /notifications renders, so the consent copy lives in one place.
   * An incoming request no longer replaces the picker (design decision 4).
  ```
- Replace `const [link, setLink] = useState<AnniversaryLink | null>(null);` with `const [links, setLinks] = useState<MyAnniversaryLinks | null>(null);`.
- In `load`, call `getMyAnniversaryLinks()` instead of `getMyAnniversaryLink()`, and replace `setLink(linkResult.data);` with `setLinks(linkResult.data);`. Change the comment "which getMyAnniversaryLink's own result already gates" to "which getMyAnniversaryLinks' own result already gates".
- In the `refreshAfterAction` comment, change "computed from this same getMyAnniversaryLink() call" to "computed from getMyAnniversaryLinks() on the server".
- Add, right after `partnerLabel`:
  ```ts
  const confirmed = links?.confirmed ?? null;
  const outgoing = links?.outgoing ?? null;
  const incoming = links?.incoming ?? [];
  ```
- Delete `handleConfirm` entirely.
- In `handleDecline`, replace `if (!link) return;` with `if (!outgoing) return;` and `declineAnniversaryLink(link.id)` with `declineAnniversaryLink(outgoing.id)`.
- In `handleUnlink`, replace `if (!link) return;` with `if (!confirmed) return;` and `unlinkAnniversary(link.id)` with `unlinkAnniversary(confirmed.id)`.
- JSX conditions:
  - picker: `{!isLoading && !loadError && link === null && (` → `{!isLoading && !loadError && !confirmed && !outgoing && (`
  - outgoing: `{!isLoading && !loadError && link !== null && link.status === "pending" && link.initiatedByMe && (` → `{!isLoading && !loadError && !confirmed && outgoing && (`, and inside that block replace every `link` identifier with `outgoing`.
  - delete the whole `{!isLoading && !loadError && link !== null && link.status === "pending" && !link.initiatedByMe && ( … )}` block.
  - confirmed: `{!isLoading && !loadError && link !== null && link.status === "confirmed" && (` → `{!isLoading && !loadError && confirmed && (`, and inside that block replace every `link` identifier with `confirmed`.
- Immediately before `</FormSection>`, add:
  ```tsx
  {!isLoading && !loadError && incoming.length > 0 && (
    <div className="mt-4 space-y-3">
      {incoming.map((request) => (
        <AnniversaryRequestCard
          key={request.id}
          request={request}
          myConfirmedLink={confirmed}
          onProfilePage
          onChanged={load}
        />
      ))}
    </div>
  )}
  ```

Run: `npm run type-check`
Expected: exit 0. A leftover `link` reference shows up here as "Cannot find name 'link'".

- [ ] **Step 2: Delete the single-row reader and its tests**

- In `lib/actions/anniversary-links.ts`, delete `getMyAnniversaryLink()` and the doc comment above it (the block starting "Reads `anniversary_links` through the user-scoped client and relies on Task 1's own-participants-only SELECT policy"). In `getMyAnniversaryLinks()`'s comments, replace "Same user-scoped client and same RLS reliance as getMyAnniversaryLink():" with "User-scoped client:", and "the same lookup and the same canonical-first resolution as getMyAnniversaryLink() (see" with "canonical partner first (see".
- In `lib/actions/anniversary-links.test.ts`, delete the whole `describe("getMyAnniversaryLink", …)` block and `getMyAnniversaryLink,` from the import list. Update the mock's header comment: "getMyAnniversaryLink's multi-row precedence test below" → "getMyAnniversaryLinks' ordering tests below".

Run: `grep -rn "getMyAnniversaryLink\b\|getMyAnniversaryLink(" app components lib`
Expected: no output (only `getMyAnniversaryLinks` remains).

- [ ] **Step 3: Run every gate**

Run: `npm test && npm run type-check && npm run lint && npm run build`
Expected: vitest all PASS; type-check exit 0; lint **61** problems; build exit 0.

- [ ] **Step 4: Commit**

```bash
git add components/profile/AnniversaryPartner.tsx lib/actions/anniversary-links.ts lib/actions/anniversary-links.test.ts
git commit -m "feat(anniversaries): profile card lists incoming requests beneath your own state"
```

- [ ] **Step 5: Record what was not verified**

In the final report, state plainly: the screens were checked by type-check and build only. No browser check was run. A manual check needs three accounts (A asks B while B is linked with C; B sees a Decline-only card on `/notifications` and on the profile page; B declines; A's card returns to the picker) and is the owner's to run.

---

## Self-review notes

- **Spec coverage:** decisions 1–2 → Task 1; decision 3 → Task 3 (card) and Task 4 (profile); decision 4 → Task 4; reader → Task 2; unread count → Task 3; screens → Tasks 3–4; RLS testing → Task 1; vitest → Tasks 2–3; rollout steps 1–3 → Task 1 steps 1, 5–7; gates → Task 4 step 3; out-of-scope items untouched.
- **Spec corrections made while planning** (applied to the spec in the same commit as this plan): the cleanup's two conjuncts are each sufficient on their own to spare the confirmed link, so they are pinned textually (assertion 10), not live; and `request_anniversary_link` had no `comment on function` before, so it gets its first one rather than a re-issued one.
