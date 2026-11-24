-- =============================================================================
-- rybn: a wishlist item carries a short list of details, shaped by the
--       database
--       (rybn-mobile docs/2026-11-24-item-details-design.md)
-- =============================================================================
--
-- An item's details are a list of short labelled lines (Size, Color, Style,
-- Version or model, Brand, or a label of the owner's own, each with a line of
-- text). After this file:
--
--   1. wishlist_items.details is jsonb, not null, and defaults to the empty
--      list: every item has a list, and a row written without one has none.
--   2. The list is shaped by the check constraint valid_item_details, which
--      runs valid_item_details(). A list is stored only if it is an array of
--      at most 10 entries, and each entry is an object with exactly these
--      keys and no others:
--        - kind: one of size, color, style, version, brand or other;
--        - value: text of 1 to 100 characters;
--        - label: present only when kind is other, and then text of 1 to 30
--          characters.
--      A named kind (every kind but other) appears at most once in a list,
--      and other at most 5 times. Characters are counted by char_length.
--      A list that does not have this shape is refused by the constraint,
--      whoever writes it, the service role included.
--   3. valid_item_details() answers false, never an error, for anything that
--      is not a list of this shape (null, an object, text, a number, an array
--      of anything else). It reads no table. authenticated and service_role
--      may execute it, which a check constraint needs: it runs as the role
--      that writes the row. anon may not.
--   4. authenticated can select details. A signed-in person's client can
--      select only the columns granted to it (20261115000001_private_columns.sql),
--      so this grant is what lets it read the column, and row-level security
--      still decides which items it reaches: whoever can see an item reads
--      its details. Who may write them is the same as for the item's
--      other fields: the owner (pin_wishlist_item_owner_fields).
--   5. An item's updated_at moves, to now(), when an update writes details,
--      as it does for the item's other own columns: update_wishlist_items_updated_at
--      now fires before an update of title, description, url, price,
--      image_url, priority, category, privacy_settings, updated_at and
--      details. A giver's mark still leaves it as it was.
--
-- Safe to apply before the code that uses it is deployed, and with the site
-- as it runs today: the site never reads or writes the column, and every
-- insert it makes takes the default, the empty list, which the constraint
-- accepts. The trigger fires for the same writes as before, plus any that
-- name details, and the site names none.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The check the constraint of section 2 runs
-- -----------------------------------------------------------------------------
-- The function comes first, since the constraint runs it. It is immutable
-- and reads no table, only its argument, so the constraint's answer for a
-- list never changes. It checks in this order and answers false at the first
-- thing wrong; each test is written so that a value of the wrong type
-- answers false rather than raising: jsonb_typeof of a missing key is null,
-- and null is tested with is distinct from.
--
--   a. The argument is an array of at most 10 entries.
--   b. Each entry is an object whose keys are among kind, value and label.
--   c. Its kind is text, and its value is text of 1 to 100 characters.
--   d. If its kind is other, it has a label of 1 to 30 characters, and no
--      more than 5 entries are other.
--   e. If its kind is one of the five named kinds, it has no label, and the
--      kind has not been seen earlier in the list.
--   f. Any other kind is refused.
create or replace function public.valid_item_details(p_details jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_entry  jsonb;
  v_kind   text;
  v_seen   text[] := '{}';
  v_others int := 0;
begin
  if p_details is null or jsonb_typeof(p_details) is distinct from 'array' then
    return false;
  end if;

  if jsonb_array_length(p_details) > 10 then
    return false;
  end if;

  for v_entry in select e.value from jsonb_array_elements(p_details) as e loop
    if jsonb_typeof(v_entry) is distinct from 'object' then
      return false;
    end if;

    if exists (select 1
                 from jsonb_object_keys(v_entry) as k
                where k.k not in ('kind', 'value', 'label')) then
      return false;
    end if;

    if jsonb_typeof(v_entry -> 'kind') is distinct from 'string'
       or jsonb_typeof(v_entry -> 'value') is distinct from 'string' then
      return false;
    end if;

    if char_length(v_entry ->> 'value') not between 1 and 100 then
      return false;
    end if;

    v_kind := v_entry ->> 'kind';

    if v_kind = 'other' then
      if jsonb_typeof(v_entry -> 'label') is distinct from 'string'
         or char_length(v_entry ->> 'label') not between 1 and 30 then
        return false;
      end if;

      v_others := v_others + 1;
      if v_others > 5 then
        return false;
      end if;
    elsif v_kind in ('size', 'color', 'style', 'version', 'brand') then
      if v_entry ? 'label' or v_kind = any(v_seen) then
        return false;
      end if;

      v_seen := v_seen || v_kind;
    else
      return false;
    end if;
  end loop;

  return true;
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. The column, its constraint, the grants and the trigger
-- -----------------------------------------------------------------------------
-- One block, so the steps land whole or not at all however the tool that
-- applies the file runs it.
--
--   a. The column. A column with a constant default is added without
--      rewriting the table, and every existing item reads as the empty list.
--   b. The constraint, which checks the rows already there (all the empty
--      list) and every row written after.
--   c. valid_item_details() is executable by the roles that write the table
--      (the constraint runs it as the writer) and by no one else. A new
--      function is executable by public, and may be by anon besides, so both
--      are revoked.
--   d. authenticated can select the column. The table-level select was
--      revoked in 20261115000001, so a column is readable only once granted.
--   e. update_wishlist_items_updated_at is dropped and created again exactly
--      as 20261115000001 made it, with details added at the end of its
--      column list, so a write of details moves updated_at like a write of
--      any other of the item's own columns. pin_wishlist_item_owner_fields
--      sorts before it by name, so the pin still runs first.
--   f. The table's comment is rewritten with the thirteenth selectable column
--      and the ninth that moves updated_at, and the column and the function
--      get theirs.
do $$
begin
  alter table public.wishlist_items
    add column details jsonb not null default '[]'::jsonb;

  alter table public.wishlist_items
    add constraint valid_item_details check (public.valid_item_details(details));

  revoke execute on function public.valid_item_details(jsonb) from public, anon;
  grant execute on function public.valid_item_details(jsonb) to authenticated, service_role;

  grant select (details) on public.wishlist_items to authenticated;

  drop trigger update_wishlist_items_updated_at on public.wishlist_items;
  create trigger update_wishlist_items_updated_at
    before update of title, description, url, price, image_url, priority, category, privacy_settings, updated_at, details
    on public.wishlist_items
    for each row execute function public.update_updated_at_column();

  comment on table public.wishlist_items is
    'Wishlist items. Claims live in wishlist_claims as of 20260911100003; the "Users can claim visible wishlist items" policy now governs purchased/out_of_stock only, the marks a giver writes. authenticated can select id, user_id, title, description, details, url, price, image_url, priority, category, privacy_settings, created_at and updated_at; the marks are read through visible_item_marks(), which answers only for items the caller can see and does not own. updated_at moves, to now(), only when an update writes one of the nine columns title, description, details, url, price, image_url, priority, category and privacy_settings, or updated_at itself. Column grants and trigger as of 20261124000001_item_details.sql.';

  comment on column public.wishlist_items.details is
    'The item''s details: a list of at most 10 entries, each {"kind": ..., "value": ...} with a label added only when the kind is other. kind is size, color, style, version, brand or other; value is 1 to 100 characters; the label of an other entry is 1 to 30 characters; each named kind appears at most once and other at most 5 times. Shaped by the constraint valid_item_details, which runs valid_item_details(). Not null, default the empty list. Readable by authenticated like the item''s other columns; written by the owner only (pin_wishlist_item_owner_fields). Added by 20261124000001_item_details.sql.';

  comment on function public.valid_item_details(jsonb) is
    'Whether a jsonb value is a valid list of item details: an array of at most 10 objects whose keys are kind, value and label only, with a kind of size, color, style, version, brand or other, a value of 1 to 100 characters (char_length), a label of 1 to 30 characters on an other entry and no label on any other, each named kind at most once and other at most 5 times. It answers false, and never raises, for anything else, null included. Immutable; reads no table. The check behind the constraint valid_item_details, so authenticated and service_role may execute it and anon may not. Added by 20261124000001_item_details.sql.';
end $$;
