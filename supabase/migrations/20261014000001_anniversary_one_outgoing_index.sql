-- One outgoing anniversary request per person, enforced by the table itself.
-- Design: _planning/2026-10-14-anniversary-requests-design.md (invariant I-out).
--
-- 20261014000000 added request_anniversary_link's refusal "you already have a
-- request waiting; cancel it first", an `exists` check. Two requests from the
-- same caller in the same instant (two tabs, a double submit) can both pass it
-- before either commits, leaving that person with two outgoing requests: the
-- reader then shows them only the newest, and they cannot cancel the older
-- one. This partial unique index closes that window. It keys on the caller's
-- own id, so nothing about it can tell anyone about another person.
--
-- It does not conflict with the request upsert's row flip (a recipient
-- answering a request with their own): that keeps ONE pending row and only
-- changes who initiated it, and the refusal above has already confirmed the
-- new initiator has no other pending row.
--
-- The race's loser now gets a unique_violation, which requestAnniversaryLink
-- maps to its generic "Failed to send that request. Please try again." On
-- retry they get the precise refusal. The owner chose that over re-issuing the
-- function body with a translating handler.
--
-- Production had 0 anniversary_links rows when this was written, so the index
-- builds over nothing. Also corrects two function comments (see below).
-- Corrective migration: nothing applied is edited.

create unique index anniversary_links_one_outgoing
  on public.anniversary_links (initiated_by)
  where status = 'pending';

comment on index public.anniversary_links_one_outgoing is
  'At most one PENDING anniversary request per sender (invariant I-out). Backstop for request_anniversary_link''s "you already have a request waiting" refusal, which a same-instant double request can slip past. 20261014000001_anniversary_one_outgoing_index.sql.';

comment on function public.request_anniversary_link(text, text) is
  'Creates or refreshes a PENDING anniversary link from the caller to a co-member. Refuses a caller who is already in a confirmed link, or who already has a pending request out to someone else -- both about the caller''s own status, never the partner''s, so a request to someone already linked still succeeds. The second refusal is backstopped by the unique index anniversary_links_one_outgoing (20261014000001); a same-instant double request that slips past it raises unique_violation instead of the refusal''s message. Live body: 20261014000000_anniversary_requests_never_stranded.sql (20260912000003''s body plus those two refusals).';

comment on function public.confirm_anniversary_link(uuid) is
  'Confirms a pending anniversary link: flips status, inserts both anniversary_link_members rows, deletes every OTHER pending link involving either partner, adopts agreed_date into BOTH partners'' profile_info, and reconciles already-materialized occasions. Live body: 20261014000000_anniversary_requests_never_stranded.sql, which is 20260912000014_confirm_link_reconciles_occasion_date.sql verbatim plus the pending-link cleanup. Every comment inside the body that says "this migration" or "this migration''s header" was written in, and means, 20260912000014 -- the occasion_date fix and its reproduction are in that file''s header, not in 20261014000000''s. The body''s race comment is also incomplete: besides the unique_violation it translates, two confirms that share a partner can now deadlock on the cleanup, and the loser sees the generic "Failed to confirm that request" message (40P01). Two corrections to the inherited comments still apply, and they live in DIFFERENT files: finding M2 (20260912000014''s header, :25-30, mis-dates the profile/occasion divergence -- it predates 20260912000012, which only made it reachable from either side) and finding M4 (20260912000012:63-65 names BYPASSRLS as the only reason the cross-user profile_info write succeeds; table-owner exemption alone would also suffice, since the definer owner owns profile_info and relforcerowsecurity is false). Both are written up in 20260912000017_comment_corrections.sql. The body''s own comment pointing to 20260912000012''s header for the non-exploitability argument is the uncorrected M4 text, carried verbatim; the argument holds, only its "ONLY because" does not.';
