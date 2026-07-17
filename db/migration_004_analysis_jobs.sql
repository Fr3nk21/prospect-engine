-- ============================================================
-- Migration 004 — Module 3.2: analysis_jobs (async Claude Vision analysis)
-- Run in: Supabase Dashboard → SQL Editor
-- Same pattern as scrape_jobs (Module 2.5): the scraper-service creates the
-- row, runs the job in background, the frontend follows it via Realtime.
-- ============================================================

create table analysis_jobs (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued','running','completed','failed')),
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);

create index idx_analysis_jobs_contact on analysis_jobs (contact_id, created_at desc);

alter table analysis_jobs enable row level security;

create policy "authenticated full access" on analysis_jobs
  for all to authenticated using (true) with check (true);

alter table analysis_jobs replica identity full;
alter publication supabase_realtime add table analysis_jobs;
