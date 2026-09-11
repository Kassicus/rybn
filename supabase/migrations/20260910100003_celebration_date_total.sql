-- =============================================================================
-- rybn: gift-giving occasions -- make celebration_date_in_year total
-- =============================================================================
--
-- 20260910100002_occasions_derivation.sql's celebration_date_in_year() claims,
-- in its own header comment, to "return NULL rather than raising on anything
-- malformed." That was false. Its guard is a SYNTACTIC regex,
-- ^\d{4}-\d{2}-\d{2}$, which admits calendar-invalid month-days --
-- 1990-06-31, 1990-04-31, 1990-02-30, 1990-13-01 -- and only Feb 29 gets a
-- semantic check. Everything else falls through to the bare cast and raises
-- SQLSTATE 22008. Confirmed on production before this migration:
--
--   select public.celebration_date_in_year('1990-06-31', 2026);
--   ERROR:  22008: date/time field value out of range: "2026-06-31"
--   CONTEXT:  PL/pgSQL function celebration_date_in_year(text,integer) line 18 at RETURN
--
-- That is the exact SQLSTATE this whole feature exists to eliminate from the
-- reminder path, and the exposure is real, not theoretical:
--   - profile_info.field_value is bare text with no CHECK constraint
--     (baseline:174);
--   - the app's only date validation is a browser type="date" widget
--     (components/profile/sections/DatesSection.tsx); the Zod schema
--     (lib/schemas/profile.ts:40) accepts any string;
--   - writes reach profile_info over PostgREST under `authenticated`, so any
--     signed-in user can PATCH a calendar-invalid date into their own row;
--   - get_upcoming_dates_for_notifications (and now get_upcoming_occasions)
--     evaluate this function across every dates row, so ONE bad row breaks
--     the query for every caller, not just its owner;
--   - the cron swallows the error silently (lib/actions/date-reminders.ts).
--
-- Fix: wrap the final cast in its own subtransaction and catch the raise.
-- This is a plpgsql EXCEPTION block, which costs a subtransaction per call --
-- acceptable here because profile_info is small and only 'dates' rows ever
-- reach a date cast in this function. The Feb-29 clamp stays ABOVE the
-- handler and is otherwise unchanged, so leap-day birthdays still land on
-- Feb 28 in a common year rather than becoming NULL.
--
-- Ships as its own migration per the reviewer's ruling, rather than editing
-- 20260910100002_occasions_derivation.sql in place: that file already
-- reached production, and a migration is the historical record of what
-- actually ran.
-- =============================================================================
create or replace function public.celebration_date_in_year(
  p_field_value text,
  p_target_year integer
)
returns date
language plpgsql
immutable
as $$
declare
  v_md text;
begin
  if p_field_value is null or p_field_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  v_md := substring(p_field_value from 6 for 5);

  if v_md = '02-29' and not (
    (p_target_year % 4 = 0 and p_target_year % 100 <> 0)
    or p_target_year % 400 = 0
  ) then
    return (p_target_year || '-02-28')::date;
  end if;

  -- Anything the regex admits but the calendar rejects -- 06-31, 02-30,
  -- 13-01 -- reaches here. A bare cast raises 22008, and this function is
  -- evaluated in the WHERE clause of the reminder cron across every dates
  -- row, so one bad row would break the run for every user. The handler is
  -- what makes the contract above ("returns NULL rather than raising") true.
  -- It costs a plpgsql subtransaction per call; profile_info is small and
  -- only 'dates' rows reach here, so that is the right trade.
  begin
    return (p_target_year || '-' || v_md)::date;
  exception when others then
    return null;
  end;
end;
$$;
