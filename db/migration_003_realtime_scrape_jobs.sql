-- Module 2.5: enables Supabase Realtime on scrape_jobs so the frontend can
-- subscribe to UPDATE events (progress bar) filtered by job id.
alter table scrape_jobs replica identity full;
alter publication supabase_realtime add table scrape_jobs;
