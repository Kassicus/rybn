-- =============================================================================
-- rybn: fix a cross-user data-corruption path in unlink_anniversary, and
-- reconcile decline/unlink's authorization rules
-- =============================================================================
--
-- CORRECTIVE MIGRATION for 20260912000003_anniversary_link_rpcs.sql, which
-- already reached production -- a migration is the historical record of what
-- actually ran, so that file is not edited in place; this one supersedes two
-- of its four function bodies with `create or replace`.
--
-- CRITICAL: unlink_anniversary let an unrelated third party silently
-- un-share a confirmed couple's occasion, through granted RPCs alone, no
-- fixtures or privileged access required. Reproduced end-to-end:
--
--   1. A and B become a couple (request_anniversary_link + confirm).
--   2. C -- who merely shares a GROUP with A, and has no relationship to the
--      A-B link at all -- calls request_anniversary_link naming A, creating
--      an unrelated PENDING C-A row. request_anniversary_link's only
--      precondition is a shared group (its own guard, 20260912000003:55-58),
--      so this step needs no special access.
--   3. C calls unlink_anniversary on THAT pending row -- their own, entirely
--      legitimate to attempt on its face.
--
-- The bug: unlink_anniversary's occasion UPDATE was scoped only by
-- `celebrant_id = v_link.user_a`, with no `partner_id` check at all. Every
-- link naming A as its canonical (smaller) id resolves to the SAME
-- `v_link.user_a = A`, whether it is the real confirmed A-B link or C's
-- unrelated pending one -- so step 3 cleared partner_id on the REAL couple's
-- occasion, through a link C was never part of, while the A-B
-- anniversary_links row and both anniversary_link_members rows stayed
-- untouched: the couple is left CONFIRMED, holding two membership rows, with
-- an occasion that has silently stopped being shared. B -- and anyone whose
-- access to that occasion came through B's privacy settings via the
-- `partner_id` branch of the occasions SELECT policy -- loses it with no
-- error anywhere.
--
-- Latent today (0 partnered occasions on the live project), but Task 4
-- starts writing partner_id for real, so this is fixed now rather than
-- deferred. Fix: scope the clear to the SPECIFIC pair this link named,
-- `and partner_id = v_link.user_b`. This is complete, not merely
-- narrowed: anniversary_links_pair permits at most one row per
-- (user_a, user_b) pair, so a link's own user_b can never coincide with a
-- DIFFERENT couple's actual partner_id -- there is no second link through
-- which the same (user_a, wrong partner_id) combination could still slip
-- through.
--
-- IMPORTANT, ruled on separately: unlink_anniversary carried no `status`
-- filter, so an INITIATOR of a still-pending request -- deliberately denied
-- by decline_anniversary_link's own exclusion -- reached the identical "make
-- my own pending request disappear" end state through the sibling RPC
-- instead. Ruling: one function per status, both callable by EITHER
-- participant --
--
--   decline_anniversary_link handles PENDING rows, either participant.
--   Recipient declines, initiator cancels: same operation, same end state,
--   and Task 9's UI shows a pending request with "who was asked, WITH
--   CANCEL", so the initiator must be able to withdraw. The initiator
--   exclusion is dropped.
--
--   unlink_anniversary handles CONFIRMED links only, either participant.
--   Adding `and status = 'confirmed'` also independently closes the
--   reproduction above at its root -- C's link was never confirmed, so it
--   is no longer reachable by unlink_anniversary AT ALL -- but the
--   partner_id scoping above is kept regardless, since it is what actually
--   makes the occasion UPDATE correct for the couple it is scoped to, not
--   merely a side effect of which rows unlink_anniversary happens to reach
--   today.
--
-- Also corrects an over-claim in 20260912000001_anniversary_link_members.sql
-- (not edited in place, for the same historical-record reason): its header
-- states the PRIMARY KEY on anniversary_link_members makes a second
-- confirmed link per person impossible "including for service_role". That
-- overstates it. The primary key constrains ONLY anniversary_link_members
-- itself; nothing ties anniversary_links.status = 'confirmed' to a row
-- existing here. A service_role UPDATE that flips anniversary_links.status
-- directly -- bypassing confirm_anniversary_link, and therefore never
-- inserting into anniversary_link_members -- is not caught by this
-- constraint at all. What actually holds, correctly stated in this file's
-- own header above: the invariant is enforced for `authenticated` callers
-- going through confirm_anniversary_link, because that RPC is the only
-- authenticated-reachable writer of anniversary_links.status and it always
-- populates anniversary_link_members in the same transaction as the flip.
-- It is not, and was never claimed correctly to be, a constraint that
-- reaches every possible writer of anniversary_links regardless of path.

create or replace function public.decline_anniversary_link(p_link_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_deleted int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Either participant may remove a pending row -- recipient declines,
  -- initiator cancels, same end state (see this migration's header for the
  -- ruling). Only a PENDING row: a confirmed link is unlink_anniversary's
  -- job, not this one's. Returns false rather than raising when there is
  -- nothing to decline: declining something already gone is not an error,
  -- and a DELETE filtered to zero rows is expressible in the RLS harness
  -- where a raise is not.
  delete from public.anniversary_links
   where id = p_link_id
     and status = 'pending'
     and v_caller in (user_a, user_b);

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

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
  -- this one's (see this migration's header for the ruling). This also
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
  -- celebrant_id and cleared the real couple's partner_id. See this
  -- migration's header for the full reproduction. anniversary_links_pair
  -- permits at most one row per (user_a, user_b), so this link's own
  -- user_b can never coincide with a different couple's actual partner_id,
  -- which is what makes this scoping complete rather than merely narrower.
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

grant execute on function public.decline_anniversary_link(uuid) to authenticated, service_role;
grant execute on function public.unlink_anniversary(uuid) to authenticated, service_role;
