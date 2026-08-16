-- ============================================================
-- Migration 008 — configurable sector context for Claude Vision analysis
-- Run in: Supabase Dashboard → SQL Editor
--
-- The SYSTEM_PROMPT in scraper-service/prospect_vision.py was hardcoded to
-- hospitality. This extracts just the sector-description sentence into
-- settings so Francesco can retarget the tool at a different industry
-- (barbershop, cleaning company, ...) from the UI, no deploy needed.
-- Default value below is byte-for-byte what was already hardcoded, so
-- existing analyses are unaffected until this is edited.
-- ============================================================

insert into settings (key, value) values
  ('analysis_context', '"a videography and photography studio in Melbourne specialising in hospitality content"')
on conflict (key) do nothing;
