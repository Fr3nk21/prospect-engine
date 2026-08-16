-- ============================================================
-- Migration 007 — Unsubscribe link (Spam Act 2003) + re-engagement
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ---------- Unsubscribe ----------
-- Stateless opt-out: no extra table, the token is an HMAC-SHA256 of the
-- contact id (see lib/unsubscribe-token.ts). unsubscribed_at is the
-- durable record that the recontact cron must never override.
alter table contacts
  add column unsubscribed_at timestamptz;

-- ---------- Re-engagement ----------
-- 'To recontact': Not interested contacts idle long enough (see
-- recontact_months below) get a second chance, unless they unsubscribed.
alter table contacts
  drop constraint contacts_status_check;

alter table contacts
  add constraint contacts_status_check
  check (status in ('To contact','Contacted','No reply','In conversation','Not interested','To recontact'));

insert into settings (key, value) values
  ('recontact_months', '9')
on conflict (key) do nothing;
