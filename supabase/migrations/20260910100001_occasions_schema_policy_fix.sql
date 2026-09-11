-- =============================================================================
-- rybn: gift-giving occasions -- close a group-repoint hole, wrap claim reads
-- =============================================================================
--
-- Fixes two defects in 20260910100000_occasions_schema.sql, found in review
-- before any application code read this table (occasions was empty and
-- unread in production at the time).
--
-- DEFECT 1 (CRITICAL, a live hole on production) -- the UPDATE policy's WITH
-- CHECK was:
--
--   kind = 'group_date'
--   and (created_by = requesting_user_id()
--        or is_group_admin(group_id, requesting_user_id()))
--
-- The creator branch is an OR and never tests the NEW group_id. Exploit,
-- entirely within the shipped policies:
--
--   1. Alice is a member of G1. She inserts a group_date occasion in G1 (the
--      INSERT policy passes: she is a member, created_by = alice).
--   2. Alice leaves G1, or simply never joins G2. She runs
--        update occasions set group_id = '<G2 uuid>' where id = ...;
--      USING passes (created_by = alice). WITH CHECK passes on the SAME
--      branch -- is_group_admin() is never reached, because created_by is
--      still alice and the OR short-circuits before it. group_date_shape
--      does not care which group the row points at.
--   3. The row is now visible to every member of G2, via "Members can view
--      their groups' occasions" -- and Alice keeps permanent UPDATE and
--      DELETE rights over it, in a group she may never have belonged to.
--
-- Group UUIDs are not secret (they appear in the app's URLs), and
-- `grant update on public.occasions to authenticated` means PostgREST
-- exposes this today. The fix ANDs an unconditional membership test against
-- the NEW group_id ahead of the creator-or-admin OR, so the creator branch
-- can no longer short-circuit past it. This is the same shape the house
-- pattern already uses on two structurally identical tables:
-- group_gifts_update (baseline:1635-1641) and "Creators can update gift
-- exchanges" (baseline:1722-1728) both conjoin membership with AND rather
-- than folding it into the ownership OR.
--
-- DEFECT 1b (Important, a ruling from review) -- the DELETE policy gets the
-- same membership conjunct, but this is a deliberate product decision, not
-- only a security fix, and it deliberately diverges from group_gifts_delete
-- (baseline:1643-1645, creator-only, no membership test). A group date
-- belongs to the GROUP, not to whoever happened to create it: an ex-member
-- deleting the family's "Christmas 2026" is a worse outcome than an author
-- losing delete rights on an occasion they leave behind. group_gifts is a
-- personal surprise scoped to its creator; occasions is shared group state
-- from the moment it exists.
--
-- DEFECT 2 (Important) -- none of the five policies wrapped
-- requesting_user_id() in a scalar subselect. baseline:23-27 documents why
-- that wrapper is load-bearing: "the select wrapper is not decoration -- it
-- lets the planner evaluate the claim once per query instead of once per
-- row." The baseline uses the wrapped form 119 times and the bare form in a
-- policy zero times; the occasions migration used the bare form exclusively.
-- On the celebrated-occasion SELECT this compounds, since the call sits
-- inside an EXISTS re-evaluated per candidate row. All five policies are
-- corrected here; logic is otherwise unchanged except where DEFECT 1/1b add
-- the membership conjunct.
--
-- ALTER POLICY, not DROP + CREATE: it rewrites USING/WITH CHECK/roles in
-- place with no window where the table has no policy for that command.
--
-- This ships as its own migration, per review ruling, rather than editing
-- 20260910100000_occasions_schema.sql in place: that file already reached
-- production, and a migration is the historical record of what actually
-- ran, not a draft to rewrite. Only the comment above the UPDATE policy in
-- that file was corrected, in the same review round, because a comment
-- carries no schema and cannot drift production out from under a rewritten
-- migration.
-- =============================================================================

-- SELECT: group dates. Logic unchanged; wraps the claim lookup.
alter policy "Members can view their groups' occasions"
  on public.occasions
  using (
    group_id is not null
    and public.is_group_member(group_id, (select public.requesting_user_id()))
  );

-- SELECT: celebrated occasions. Logic unchanged; wraps the claim lookup,
-- which sits inside an EXISTS re-evaluated per candidate row.
alter policy "Celebrated occasions follow the underlying date's privacy"
  on public.occasions
  using (
    celebrant_id is not null
    and exists (
      select 1 from public.profile_info pi
      where pi.user_id = occasions.celebrant_id
        and pi.category = 'dates'
        and pi.field_name = occasions.kind::text
        and public.can_view_field(
          pi.user_id, (select public.requesting_user_id()), pi.privacy_settings)
    )
  );

-- INSERT: group dates. Logic unchanged; wraps both claim lookups.
alter policy "Group members can create group dates"
  on public.occasions
  with check (
    kind = 'group_date'
    and group_id is not null
    and public.is_group_member(group_id, (select public.requesting_user_id()))
    and created_by = (select public.requesting_user_id())
  );

-- UPDATE: the actual fix. USING is unchanged (it still gates who may touch
-- the row at all); WITH CHECK gains an unconditional membership test against
-- the NEW group_id, ANDed in ahead of the creator-or-admin OR so the
-- creator's own branch can no longer short-circuit past it.
alter policy "Creator or group admin can update group dates"
  on public.occasions
  using (
    kind = 'group_date'
    and (created_by = (select public.requesting_user_id())
         or public.is_group_admin(group_id, (select public.requesting_user_id())))
  )
  with check (
    kind = 'group_date'
    -- Membership in the NEW group, unconditionally. This is the conjunct the
    -- original policy was missing: with it inside the OR, a creator's own
    -- branch short-circuited before any membership test, so the row could be
    -- moved into any group whose UUID the creator knew.
    and public.is_group_member(group_id, (select public.requesting_user_id()))
    and (created_by = (select public.requesting_user_id())
         or public.is_group_admin(group_id, (select public.requesting_user_id())))
  );

-- DELETE: gains the same membership requirement as UPDATE, but as the
-- deliberate product decision in DEFECT 1b above, not only a security fix.
-- Without it, an ex-member who created a group date keeps the power to
-- delete it from a group they no longer belong to.
alter policy "Creator or group admin can delete group dates"
  on public.occasions
  using (
    kind = 'group_date'
    and public.is_group_member(group_id, (select public.requesting_user_id()))
    and (created_by = (select public.requesting_user_id())
         or public.is_group_admin(group_id, (select public.requesting_user_id())))
  );
