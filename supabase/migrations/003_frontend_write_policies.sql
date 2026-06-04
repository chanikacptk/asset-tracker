-- Migration 003: frontend write policies for holdings + portfolios
-- The frontend (anon key) now writes holdings and portfolios directly.
-- Run in Supabase SQL Editor.

-- Holdings: full CRUD from frontend
CREATE POLICY "anon_insert_holdings" ON holdings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update_holdings" ON holdings
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_holdings" ON holdings
  FOR DELETE USING (true);

-- Portfolios: frontend can create new sub-portfolios
CREATE POLICY "anon_insert_portfolios" ON portfolios
  FOR INSERT WITH CHECK (true);

-- Watchlist: frontend can manage watchlist entries
CREATE POLICY "anon_insert_watchlist" ON watchlist
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_delete_watchlist" ON watchlist
  FOR DELETE USING (true);
