-- Migration 008: extend gold_holdings with name + purchase_date, add frontend write policies
-- Run in Supabase SQL Editor.

ALTER TABLE gold_holdings ADD COLUMN IF NOT EXISTS name          text DEFAULT 'Gold';
ALTER TABLE gold_holdings ADD COLUMN IF NOT EXISTS purchase_date date;

-- Frontend (anon key) CRUD for gold_holdings
CREATE POLICY "anon_insert_gold" ON gold_holdings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update_gold" ON gold_holdings
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_gold" ON gold_holdings
  FOR DELETE USING (true);
