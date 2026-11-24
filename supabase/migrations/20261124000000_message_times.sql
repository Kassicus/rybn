-- =============================================================================
-- rybn: a message's time is the database's own
--       (rybn-mobile docs/2026-11-20-mobile-group-gifts-design.md §7.2, §13)
-- =============================================================================
--
-- A message of a group gift's chat carries the moment it was written
-- (messages.created_at), and the database is what says when that was,
-- whoever writes:
--
--   1. Every message has a time: messages.created_at is not null. A message
--      that had no time, or a time later than the moment this migration
--      runs, takes that moment as its time.
--   2. A new message's time is the moment its row is written
--      (clock_timestamp()), whatever time the writer sent, or none
--      (keep_message_time, before insert).
--   3. A message's time never changes: an update keeps the time the row
--      had, whatever the writer sent (keep_message_time, before update).
--   4. No API role (anon, authenticated or service_role) may execute the
--      trigger function; the trigger runs it without that privilege.
--
-- Rules 2 and 3 are one trigger, so they hold for every role that writes
-- messages, the service role included. Neither refuses a write: the time the
-- writer sent is left out, and the rest of the row is written as sent.
--
-- The chat is read in the order of these times, and a page of it starts from
-- one message's time (lib/actions/messages.ts), so the order of a chat is
-- the database's own too.
--
-- Safe to apply before the code that reads through it, and with the site as
-- it runs: the site never sends a message's time, on insert or on update.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Every message has a time
-- -----------------------------------------------------------------------------
-- Before the trigger of rule 3 exists, which would keep each row's time as it
-- is: a message with no time, or with one later than now, takes now as its
-- time. Then the column is not null.
update public.messages
   set created_at = now()
 where created_at is null
    or created_at > now();

alter table public.messages alter column created_at set not null;


-- -----------------------------------------------------------------------------
-- 2 and 3. The time is set when the row is written, and kept after
-- -----------------------------------------------------------------------------
-- Before a message is inserted, its time becomes the moment the row is
-- written; before one is updated, its time becomes the time the row already
-- had. The row's other columns are untouched, so the write goes on to the
-- row's own policy with the time settled.
--
-- clock_timestamp(), not now(): now() is when the transaction began, so every
-- row of one transaction would carry one time. clock_timestamp() is the
-- moment the row is written, so messages written one after another are timed
-- in that order.
create or replace function public.keep_message_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
  else
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

create trigger keep_message_time
  before insert or update on public.messages
  for each row execute function public.keep_message_time();


-- -----------------------------------------------------------------------------
-- 4. Grants and comments
-- -----------------------------------------------------------------------------
revoke execute on function public.keep_message_time() from public, anon, authenticated, service_role;

comment on function public.keep_message_time() is
  'Trigger function of keep_message_time, before insert or update on messages: on insert a message''s created_at becomes the moment the row is written (clock_timestamp()), whatever the writer sent; on update it stays the time the row had. It refuses nothing and touches no other column. It holds for every role that writes messages, the service role included. No API role (anon, authenticated, service_role) may execute it; the trigger runs it without that privilege. Added by 20261124000000_message_times.sql.';

comment on column public.messages.created_at is
  'When the message was written, by the database''s clock: set by keep_message_time on insert, whatever the writer sent, and kept by it on every update. Never null. The chat is read in this order.';
