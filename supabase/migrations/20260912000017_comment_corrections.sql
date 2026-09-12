-- =============================================================================
-- rybn: comment corrections -- one retracted justification still LIVE in the
--       database, and four inaccurate claims in applied migration headers
-- =============================================================================
--
-- This migration exists because of a practice this branch used three times
-- and has now stopped using: correcting an ALREADY-APPLIED migration by
-- editing it in place. Finding M1 below is what that practice produced -- a
-- correction that reached the file, was reviewed, was recorded as done, and
-- never reached the database. Every object on the live project matches its
-- migrations byte-for-byte except the one corrected that way.
--
-- So: corrections ship as migrations from here on, even comment-only ones.
-- A header correction in a NEW file is weaker than an in-place edit for a
-- reader who opens the OLD file -- that cost is real and is accepted, because
-- the alternative is a database and a replay that disagree. Where a
-- correction can be made durable IN the database rather than only in a file,
-- it is: this migration and its two siblings (20260912000015, ...0016) attach
-- `comment on function` pointers naming each function's live body, which a
-- reader reaches with \df+ or obj_description() no matter which migration
-- file they opened first.
--
-- -----------------------------------------------------------------------------
-- M1 -- THE ONE THAT IS LIVE IN THE DATABASE, and the only executable change
-- in this file.
-- -----------------------------------------------------------------------------
--
-- 20260912000005_anniversary_link_rpc_corrections.sql's round-2 review
-- retracted the justification inside unlink_anniversary's occasion UPDATE
-- comment. The retraction was applied by editing 20260912000005 IN PLACE,
-- after it had already been pushed -- so the file reads correctly and the
-- deployed function does not. Read back from the live project:
--
--   "... See this migration's header for the full reproduction.
--    anniversary_links_pair permits at most one row per (user_a, user_b), so
--    this link's own user_b can never coincide with a different couple's
--    actual partner_id, which is what makes this scoping complete rather
--    than merely narrower."
--
-- That reasoning is wrong and was withdrawn: anniversary_links_pair forbids
-- only a SECOND row for the exact same (user_a, user_b) tuple, which says
-- nothing about whether one celebrant could hold confirmed relationships
-- with two DIFFERENT partners. The property actually comes from
-- anniversary_links_one_confirmed_a (20260912000000): at most one CONFIRMED
-- row may ever name a given person as user_a, so a celebrant's
-- occasions.partner_id can only reflect the one confirmed relationship they
-- currently hold. Any other link sharing that celebrant necessarily names a
-- different partner, which `and partner_id = v_link.user_b` excludes on
-- plain inequality rather than on any constraint at all.
--
-- Fix: re-issue unlink_anniversary with the corrected comment, so production
-- stops asserting a retracted mechanism and a fresh replay reproduces what
-- production holds. The executable logic is byte-identical to what is live
-- -- confirmed-only, scoped to `celebrant_id = v_link.user_a and partner_id =
-- v_link.user_b` -- and only the comment text changes.
--
-- -----------------------------------------------------------------------------
-- M2 -- 20260912000014:25-30, a fresh false causal claim inside a comment
-- explaining a fix for this same defect class.
-- -----------------------------------------------------------------------------
--
-- It reads: "this divergence did not exist before that migration, because
-- before it NEITHER partner's profile_info reliably changed at confirm time."
--
-- BOTH halves are false, and both were reproduced false on a pre-migration-12
-- replay.
--
--   - The CONFIRMER's profile_info row always changed at confirm time. That
--     is 20260912000003_anniversary_link_rpcs.sql's own date adoption, which
--     predates ...0012 by nine migrations and is the behaviour design
--     decision 4 specified from the start.
--   - Therefore the divergence between a profile_info date and an
--     ALREADY-MATERIALIZED occasion row reproduces on the pre-...0012 body
--     whenever the CANONICAL partner is the one confirming -- half of all
--     confirms, by construction.
--
-- What ...0012 changed is that the divergence became reachable from EITHER
-- side rather than only when the canonical partner confirmed. The bug
-- predates migration 12; ...0012's header mis-dates its own origin. The fix
-- ...0014 ships is correct and unaffected -- only its account of when the
-- problem began is wrong.
--
-- -----------------------------------------------------------------------------
-- M3 -- 20260912000013:84, an inverted reading of the derivation's exclusion.
-- -----------------------------------------------------------------------------
--
-- It reads: "both conjuncts must hold simultaneously for this row to
-- survive."
--
-- Backwards. The exclusion is `not (exists ...)`, so a row SURVIVES when the
-- exists() is FALSE. When both visibility conjuncts hold, the exists() is
-- true and the row is REMOVED -- which is the whole purpose of the exclusion
-- (the couple arm emits the merged row in its place). The true statement is:
-- both conjuncts hold exactly when the exclusion FIRES.
--
-- The inline comment at the exclusion itself, inside the function body, is
-- correct; only ...0013's header is inverted. The implemented behaviour is
-- right in both, so nothing executable changes.
--
-- -----------------------------------------------------------------------------
-- M4 -- 20260912000012:63, one of two mechanisms named as if it were the only
-- one.
-- -----------------------------------------------------------------------------
--
-- It reads that confirm_anniversary_link can write the OTHER partner's
-- profile_info row "ONLY because this function is security definer and
-- therefore runs with its owner's privileges, which include BYPASSRLS."
--
-- Substance true, mechanism under-counted. Verified on the live project:
--
--   fn_owner postgres | owner_bypassrls true | table_owner postgres
--   profile_info: rowsecurity true, forcerowsecurity FALSE
--
-- TWO independent mechanisms each suffice, and both are present:
--
--   1. TABLE-OWNER EXEMPTION. The definer owner (postgres) also owns
--      public.profile_info, and relforcerowsecurity is false -- so RLS is
--      not applied to that role on that table at all, regardless of any role
--      attribute.
--   2. rolbypassrls. The same role carries BYPASSRLS, which exempts it from
--      RLS on every table whether or not it owns them.
--
-- Either alone would make the cross-user write work, which is why a reviewer
-- experiment that stripped only BYPASSRLS still succeeded and the comment's
-- claim still appeared to hold. Naming one mechanism as "the" reason invites
-- the wrong conclusion from a future reader who changes the other.
--
-- -----------------------------------------------------------------------------
-- M5 -- 20260912000000:62, renumbering residue.
-- -----------------------------------------------------------------------------
--
-- It reads "Writes go through the SECURITY DEFINER RPCs in 20260912000002."
-- The RPCs are in 20260912000003_anniversary_link_rpcs.sql. 20260912000002 is
-- occasion_partner. The plan's numbering shifted by one when
-- anniversary_link_members took 20260912000001, and this pointer was not
-- moved with it.
--
-- -----------------------------------------------------------------------------
-- FOLD-IN -- contradictory "live body" pointers.
-- -----------------------------------------------------------------------------
--
-- 20260912000008:48-49 says "THIS file is the live body a reader following a
-- 'see the resolution's header' pointer will open"; 20260912000010:36-38 says
-- "THIS IS NOW THE LIVE BODY ... not 20260912000008 or 20260912000007". Both
-- shipped, in adjacent migrations, so a reader landing on ...0008 is told it
-- is current when it holds the superseded CASE.
--
-- Both are stale now in any case: 20260912000016 is the live body of
-- get_or_create_celebrated_occasion. Rather than add a third file-level
-- claim for the next migration to falsify, that function -- and
-- get_or_create_occasion, confirm_anniversary_link, get_upcoming_occasions
-- and unlink_anniversary below -- now carry a `comment on function` naming
-- their live body, shipped in the same statement batch as the body itself,
-- so the pointer cannot drift from what was actually deployed.

create or replace function public.unlink_anniversary(p_link_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_link    record;
  v_deleted int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- CONFIRMED only -- a pending row is decline_anniversary_link's job, not
  -- this one's (see 20260912000005's header for the ruling). This also
  -- means a link that is not (yet, or no longer) confirmed is simply
  -- invisible to this function: v_link stays null and the guard below
  -- returns false for it exactly as it would for a link the caller has
  -- nothing to do with.
  select * into v_link from public.anniversary_links
   where id = p_link_id and status = 'confirmed';

  if v_link is null or v_caller not in (v_link.user_a, v_link.user_b) then
    return false;
  end if;

  delete from public.anniversary_links where id = p_link_id;
  get diagnostics v_deleted = row_count;

  -- The occasion row survives with its tags and claims intact and simply
  -- stops being shared. Splitting those between the two people would be
  -- guesswork about which gift was for whom.
  --
  -- CRITICAL FIX: scoped to `partner_id = v_link.user_b` as well as
  -- `celebrant_id = v_link.user_a`. Without the partner_id conjunct, EVERY
  -- link naming this v_link.user_a as its canonical id -- including an
  -- entirely unrelated one the caller is a participant in, sharing nothing
  -- with the couple whose occasion this is -- resolved to the same
  -- celebrant_id and cleared the real couple's partner_id. See
  -- 20260912000005's header for the full reproduction.
  --
  -- CORRECTED (finding M1, this migration): the mechanism that makes this
  -- scoping COMPLETE rather than merely narrower is
  -- anniversary_links_one_confirmed_a (20260912000000), NOT
  -- anniversary_links_pair. The retracted wording -- still deployed until
  -- this migration, because its correction was made by editing an applied
  -- migration in place -- argued from anniversary_links_pair, which forbids
  -- only a second row for the exact same (user_a, user_b) tuple and says
  -- nothing about a celebrant holding confirmed relationships with two
  -- DIFFERENT partners. one_confirmed_a is what forbids that: at most one
  -- CONFIRMED row may name a given person as user_a, so this celebrant's
  -- partner_id is never ambiguous between two simultaneously-confirmed
  -- couples. Any OTHER link sharing this celebrant necessarily names a
  -- different partner, which `partner_id = v_link.user_b` excludes on plain
  -- inequality, not on any constraint at all.
  update public.occasions
     set partner_id = null
   where kind = 'anniversary'
     and celebrant_id = v_link.user_a
     and partner_id = v_link.user_b;

  -- anniversary_link_members needs no explicit cleanup here: its link_id FK
  -- is ON DELETE CASCADE, so deleting the anniversary_links row above
  -- already removed both membership rows.
  return v_deleted > 0;
end;
$$;

grant execute on function public.unlink_anniversary(uuid) to authenticated, service_role;

comment on function public.unlink_anniversary(uuid) is
  'Removes a CONFIRMED anniversary link, either participant, and clears partner_id on that specific couple''s occasions. Live body: 20260912000017_comment_corrections.sql (logic unchanged from 20260912000005; that file''s in-place comment correction never reached the database -- finding M1).';

comment on function public.confirm_anniversary_link(uuid) is
  'Confirms a pending anniversary link: flips status, inserts both anniversary_link_members rows, adopts agreed_date into BOTH partners'' profile_info, and reconciles already-materialized occasions. Live body: 20260912000014_confirm_link_reconciles_occasion_date.sql. Its header mis-dates the profile/occasion divergence (finding M2) and names one of two RLS-bypass mechanisms as the only one (finding M4); both corrections are in 20260912000017_comment_corrections.sql.';

comment on function public.get_upcoming_occasions(integer) is
  'Derives the viewer''s upcoming occasions, collapsing a confirmed couple''s anniversary PER VIEWER. Live body: 20260912000013_derivation_window_guard.sql. Its header states the exclusion''s conjunction backwards (finding M3): both visibility conjuncts hold exactly when the exclusion FIRES and the row is removed, not when the row survives. The inline comment at the exclusion itself is correct.';
