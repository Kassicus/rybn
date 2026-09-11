-- =============================================================================
-- rybn: constrain occasions.partner_id now, not when Task 4 starts writing it
-- =============================================================================
--
-- occasions.partner_id (20260912000002_occasion_partner.sql) is inert on
-- every row that exists today: group_date_shape already forces celebrant_id
-- NULL on group-date rows, and the celebrated SELECT policy excludes rows
-- with celebrant_id NULL outright. But the column itself is not gated by
-- anything -- the INSERT/UPDATE with_check clauses on this table pin
-- `kind = 'group_date'` and never mention partner_id or celebrant_id, so a
-- caller could set partner_id on a group-date row today, before Task 4 ever
-- writes to this column for real. Two invariants close that:
--
--   partner_id requires celebrant_id -- a partner without a celebrant is
--   meaningless (there is no couple to be the "other half" of).
--
--   partner_id <> celebrant_id -- a row cannot name someone as their own
--   partner. This is independent of the first constraint and matters on its
--   own: Task 4's materialization is about to start writing this column for
--   real, and a self-referencing row would be a genuine data bug, not merely
--   an inert one.
alter table public.occasions
  add constraint occasions_partner_requires_celebrant
    check (partner_id is null or celebrant_id is not null),
  add constraint occasions_partner_not_self
    check (partner_id is null or partner_id <> celebrant_id);
