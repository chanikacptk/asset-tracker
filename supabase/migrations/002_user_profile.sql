-- Migration 002: user profile fields + flexible portfolio types
-- Run in Supabase SQL Editor

-- Add avatar (emoji) column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text DEFAULT '😊';

-- Allow frontend (anon key) to update own profile
CREATE POLICY "anon_update_users" ON users
  FOR UPDATE USING (true) WITH CHECK (true);

-- Drop the fixed type CHECK on portfolios so users can create custom sub-portfolios
ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_type_check;

-- Clear seeded holdings so user starts fresh (keep the portfolio row + seed exchange rate)
DELETE FROM holdings WHERE portfolio_id = '10000000-0000-0000-0000-000000000001';
