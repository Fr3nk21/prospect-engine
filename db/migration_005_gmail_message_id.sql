-- ============================================================
-- Migration 005 — Module 4.2 refinement: follow-up threading
-- Run in: Supabase Dashboard → SQL Editor
-- gmail_thread_id alone isn't enough to reply inside the same Gmail thread:
-- the outgoing follow-up needs In-Reply-To/References headers pointing at
-- the RFC Message-ID of the last message sent to that contact.
-- ============================================================

alter table contacts
  add column gmail_message_id text;
