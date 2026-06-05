-- Migration 004: add target_pct to portfolios + allow frontend to update it
-- Run in Supabase SQL Editor.

ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS target_pct numeric(5,2);

-- Allow the frontend (anon key) to update portfolio target_pct
CREATE POLICY "anon_update_portfolios" ON portfolios
  FOR UPDATE USING (true) WITH CHECK (true);
