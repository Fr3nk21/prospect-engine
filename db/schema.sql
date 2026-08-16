-- ============================================================
-- UnFocus Prospect Engine — Supabase schema v1
-- Run in: Supabase Dashboard → SQL Editor (or `supabase db push`)
-- ============================================================

-- ---------- CONTACTS ----------
create table contacts (
  id                uuid primary key default gen_random_uuid(),
  place_id          text unique,                -- Google Maps place_id; null for sheet imports/manual
  name              text not null,
  address           text,
  suburb            text,                       -- e.g. "Richmond, VIC" (search area)
  phone             text,
  website           text,
  email             text,
  instagram         text,
  business_type     text,                       -- Restaurant / Cafe / Bar / Marketing Agency / ...
  rating            numeric(2,1),
  review_count      integer,
  category          text not null default 'Low'
                    check (category in ('High','Medium','Low')),
  is_new_venue      boolean not null default false,   -- rating >= 4.5 and 10-100 reviews; orthogonal to category
  status            text not null default 'To contact'
                    check (status in ('To contact','Contacted','No reply','In conversation','Not interested','To recontact')),
  last_contact_date date,
  unsubscribed_at   timestamptz,        -- set by /api/unsubscribe; recontact cron must never touch these rows

  -- Claude analysis (persisted even after screenshots are deleted)
  priority_score    integer check (priority_score between 1 and 10),
  score_breakdown   jsonb,                      -- {visual_quality, content_consistency, ...}
  analysis          text,
  email_technical   text,
  email_warm        text,
  email_followup    text,

  -- Gmail integration (Module 4)
  gmail_thread_id   text,
  gmail_message_id  text,             -- RFC Message-ID of the last email sent;
                                       -- needed to thread a follow-up (In-Reply-To/References)

  source            text not null default 'scraper'
                    check (source in ('scraper','sheet_import','manual')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_contacts_status        on contacts (status);
create index idx_contacts_category      on contacts (category);
create index idx_contacts_last_contact  on contacts (last_contact_date);
create index idx_contacts_business_type on contacts (business_type);
create index idx_contacts_suburb        on contacts (suburb);
create index idx_contacts_new_venue     on contacts (is_new_venue) where is_new_venue = true;

-- ---------- CONTACT EVENTS (audit trail / history) ----------
create table contact_events (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  type          text not null
                check (type in ('status_change','note','email_sent','email_reply','analysis','import','system')),
  old_status    text,                           -- for status_change
  new_status    text,                           -- for status_change
  email_variant text
                check (email_variant in ('technical','warm','followup')),
  body          text,                           -- note text / email snapshot / description
  created_at    timestamptz not null default now()
);

create index idx_events_contact on contact_events (contact_id, created_at desc);
create index idx_events_type    on contact_events (type, created_at desc);

-- Trigger: every status change is logged automatically, no app code can forget it.
create or replace function log_status_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into contact_events (contact_id, type, old_status, new_status, body)
    values (new.id, 'status_change', old.status, new.status,
            'Status changed: ' || old.status || ' → ' || new.status);
    new.last_contact_date := current_date;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger trg_contacts_status
  before update on contacts
  for each row execute function log_status_change();

-- ---------- SCRAPE JOBS ----------
create table scrape_jobs (
  id            uuid primary key default gen_random_uuid(),
  location      text not null,
  business_type text not null,
  status        text not null default 'queued'
                check (status in ('queued','running','completed','failed')),
  total         integer,                        -- known after Maps search phase
  processed     integer not null default 0,
  new_contacts  integer not null default 0,
  skipped       integer not null default 0,     -- duplicates + blocklist
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Per-item tracking: enables resume after crash and precise progress.
create table scrape_job_items (
  job_id     uuid not null references scrape_jobs(id) on delete cascade,
  place_id   text not null,
  name       text,
  status     text not null default 'pending'
             check (status in ('pending','done','skipped_duplicate','skipped_blocklist','error')),
  error      text,
  primary key (job_id, place_id)
);

-- ---------- ANALYSIS JOBS (Module 3.2 — async Claude Vision analysis) ----------
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

-- ---------- SCREENSHOTS (auto-deleted after 5 days by cron) ----------
create table screenshots (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references contacts(id) on delete cascade,
  storage_path text not null,                   -- path in Supabase Storage bucket 'screenshots'
  created_at   timestamptz not null default now()
);

create index idx_screenshots_created on screenshots (created_at);

-- ---------- BLOCKLIST ----------
-- "Not interested" contacts land here; future scrapes skip these place_ids.
create table blocklist (
  place_id   text primary key,
  name       text,
  reason     text default 'not_interested',
  created_at timestamptz not null default now()
);

-- ---------- SETTINGS (single-row key/value) ----------
create table settings (
  key   text primary key,
  value jsonb not null
);

insert into settings (key, value) values
  ('status_reset_months', '6'),        -- "No reply" → "To contact" after N months
  ('screenshot_ttl_days', '5'),
  ('recontact_months', '9'),           -- "Not interested" → "To recontact" after N months (unless unsubscribed)
  ('analysis_context', '"a videography and photography studio in Melbourne specialising in hospitality content"');
                                       -- sector description injected into prospect_vision.SYSTEM_PROMPT

-- ============================================================
-- ROW LEVEL SECURITY
-- The Next.js app uses the anon key + authenticated user → policies below.
-- The FastAPI service uses the service_role key → bypasses RLS by design.
-- ============================================================
alter table contacts         enable row level security;
alter table contact_events   enable row level security;
alter table scrape_jobs      enable row level security;
alter table scrape_job_items enable row level security;
alter table analysis_jobs    enable row level security;
alter table screenshots      enable row level security;
alter table blocklist        enable row level security;
alter table settings         enable row level security;

-- Single-user app: any authenticated user has full access. No anon access.
create policy "authenticated full access" on contacts
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on contact_events
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on scrape_jobs
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on scrape_job_items
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on analysis_jobs
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on screenshots
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on blocklist
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on settings
  for all to authenticated using (true) with check (true);

-- ============================================================
-- STORAGE (run after creating the bucket, or create bucket via SQL):
-- ============================================================
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false);

create policy "authenticated read screenshots" on storage.objects
  for select to authenticated using (bucket_id = 'screenshots');
create policy "authenticated write screenshots" on storage.objects
  for insert to authenticated with check (bucket_id = 'screenshots');
create policy "authenticated delete screenshots" on storage.objects
  for delete to authenticated using (bucket_id = 'screenshots');
