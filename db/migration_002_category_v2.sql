-- ============================================================
-- Migration 002 — Category logic v2
-- Run in: Supabase Dashboard → SQL Editor
-- Changes:
--   1. New column contacts.is_new_venue (independent signal:
--      high rating + few reviews = likely recently opened)
--   2. Website is no longer a requirement for High/Medium —
--      category now measures prospect value only; contactability
--      (email/website) is visible as its own data in the list.
--   3. One-time recalculation of category + flag for existing rows.
-- ============================================================

-- 1. New column
alter table contacts
  add column if not exists is_new_venue boolean not null default false;

comment on column contacts.is_new_venue is
  'Rating >= 4.5 and 10-100 reviews: likely recently opened venue. Orthogonal to category.';

create index if not exists idx_contacts_new_venue
  on contacts (is_new_venue) where is_new_venue = true;

-- 2. One-time recalculation on existing contacts.
--    Category v2 rules:
--      High   = rating >= 4.5 AND reviews > 200
--      Medium = (4.0 <= rating < 4.5) OR (100 <= reviews <= 200)
--      Low    = everything else
--    New venue flag: rating >= 4.5 AND 10 <= reviews <= 100
update contacts
set
  category = case
    when coalesce(rating, 0) >= 4.5 and coalesce(review_count, 0) > 200 then 'High'
    when (coalesce(rating, 0) >= 4.0 and coalesce(rating, 0) < 4.5)
      or (coalesce(review_count, 0) between 100 and 200) then 'Medium'
    else 'Low'
  end,
  is_new_venue = (
    coalesce(rating, 0) >= 4.5
    and coalesce(review_count, 0) between 10 and 100
  );

-- 3. Sanity check — run after the update and eyeball the distribution:
-- select category, is_new_venue, count(*)
-- from contacts
-- group by category, is_new_venue
-- order by category, is_new_venue;
