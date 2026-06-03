-- Migration 001: app_config table
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Anyone can read config (anon key is fine — no secrets stored here)
CREATE POLICY "anon_read_all" ON app_config FOR SELECT USING (true);

-- Anyone can upsert (2-person personal app; GAS URL is not sensitive)
CREATE POLICY "anon_upsert_all" ON app_config FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_all" ON app_config FOR UPDATE USING (true) WITH CHECK (true);
