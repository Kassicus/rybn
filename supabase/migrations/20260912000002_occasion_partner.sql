-- =============================================================================
-- rybn: a celebrated occasion may belong to two people
-- =============================================================================
alter table public.occasions
  add column partner_id text references public.user_profiles(id) on delete set null;

comment on column public.occasions.partner_id is
  'The non-canonical half of a linked couple. Null for every unshared occasion. celebrant_id is always the canonical (lexicographically smaller) partner.';

-- WHY THIS POLICY HAS TO CHANGE, stated because widening a privacy policy is
-- the riskiest thing in this feature.
--
-- A linked couple materializes ONE row, keyed to the canonical partner. Under
-- the old policy a viewer who can see only the OTHER partner's date could
-- create a claim against that row -- claim_wishlist_item gates on the celebrant
-- the caller named, not on the row's storage id -- and then be unable to read
-- it back. The claim would exist and be invisible to them.
--
-- The new branch is guarded on `partner_id is not null`, so an unshared
-- occasion cannot reach it at all: this cannot admit anything the old policy
-- refused.
--
-- CORRECTED (20260912000009): the paragraph above has the mechanism
-- backwards, caught by round-1 review of Task 4. claim_wishlist_item takes
-- no celebrant parameter at all -- it gates directly on the ROW named by
-- p_occasion_id (o.celebrant_id, o.group_id), i.e. exactly "the row's
-- storage id", with no partner branch of any kind. This SELECT-policy
-- widening therefore did not, on its own, close the gap the paragraph above
-- describes: it fixed a partner-side viewer READING the shared row back,
-- but nothing fixed CLAIMING it -- a partner-side viewer could see the
-- occasion and still be refused when claiming against it. Latent until Task
-- 4 started materializing a couple's occasion under one canonical row for
-- real; fixed there by 20260912000009_claim_partner_gate.sql, which adds
-- the missing partner branch to claim_wishlist_item's own gate, mirroring
-- this policy's shape.
drop policy "Celebrated occasions follow the underlying date's privacy"
  on public.occasions;

create policy "Celebrated occasions follow the underlying date's privacy"
  on public.occasions for select to authenticated
  using (
    celebrant_id is not null
    and (
      exists (
        select 1 from public.profile_info pi
        where pi.user_id = occasions.celebrant_id
          and pi.category = 'dates'
          and pi.field_name = occasions.kind::text
          and public.can_view_field(
            pi.user_id, (select public.requesting_user_id()), pi.privacy_settings)
      )
      or (
        partner_id is not null
        and exists (
          select 1 from public.profile_info pi
          where pi.user_id = occasions.partner_id
            and pi.category = 'dates'
            and pi.field_name = occasions.kind::text
            and public.can_view_field(
              pi.user_id, (select public.requesting_user_id()), pi.privacy_settings)
        )
      )
    )
  );
