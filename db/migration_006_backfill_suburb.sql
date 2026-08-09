-- ============================================================
-- Migration 006 — backfill contacts.suburb with the scrape location
-- Run in: Supabase Dashboard → SQL Editor
--
-- Bug: suburb was populated from the business's own formattedAddress
-- (e.g. "1 Martin Pl", "Abbotsford VIC 3067") instead of the search
-- location entered in the scrape form (e.g. "Sydney, NSW, Australia",
-- "Richmond, VIC"). Fixed for new inserts in scraper-service/main.py;
-- this backfills existing rows.
--
-- scrape_job_items.place_id = contacts.place_id, scrape_job_items.job_id
-- -> scrape_jobs.location. Only 'done' items are joined — a place_id can
-- appear in more than one job's items (skipped_duplicate on repeat
-- scrapes), but exactly one job actually inserted it. Contacts with no
-- matching 'done' item (sheet_import/manual, no place_id) are left
-- untouched, as required.
-- ============================================================

-- Preview before running the update:
-- select c.id, c.name, c.suburb as old_suburb, j.location as new_suburb
-- from contacts c
-- join scrape_job_items i on i.place_id = c.place_id and i.status = 'done'
-- join scrape_jobs j on j.id = i.job_id
-- where c.place_id is not null
--   and c.suburb is distinct from j.location;

update contacts c
set suburb = j.location
from scrape_job_items i
join scrape_jobs j on j.id = i.job_id
where i.place_id = c.place_id
  and i.status = 'done'
  and c.place_id is not null
  and c.suburb is distinct from j.location;
