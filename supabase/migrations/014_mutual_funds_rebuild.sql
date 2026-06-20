-- Migration 014: Mutual Funds rebuild (Phase 1)
-- Insert-only holdings with manual NAV — no external API, never blocks a save.
-- Mirrors the thai_bonds RLS pattern: anon read all + anon insert/update/delete.
-- Run in Supabase SQL Editor. See CLAUDE.md "Mutual Funds — rebuild plan".

CREATE TABLE IF NOT EXISTS mutual_fund_holdings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fund_name       text NOT NULL,
  category        text CHECK (category IN ('Onshore','Offshore','RMF','ESG','SSF','Other')),
  units           numeric(18, 4) NOT NULL DEFAULT 0,
  avg_cost_thb    numeric(14, 4) NOT NULL DEFAULT 0,   -- cost per unit (THB)
  current_nav_thb numeric(14, 4),                       -- latest NAV per unit (THB), manual; nullable
  nav_updated_at  timestamptz,                          -- when current_nav_thb was last set; nullable
  buy_date        date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mf_holdings_user ON mutual_fund_holdings(user_id);

ALTER TABLE mutual_fund_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutual_fund_holdings FORCE ROW LEVEL SECURITY;

-- Frontend (anon key) reads all + writes own rows; JS filters by user_id.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mutual_fund_holdings' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON mutual_fund_holdings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mutual_fund_holdings' AND policyname='anon_insert_mutual_fund_holdings') THEN
    CREATE POLICY "anon_insert_mutual_fund_holdings" ON mutual_fund_holdings FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mutual_fund_holdings' AND policyname='anon_update_mutual_fund_holdings') THEN
    CREATE POLICY "anon_update_mutual_fund_holdings" ON mutual_fund_holdings FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mutual_fund_holdings' AND policyname='anon_delete_mutual_fund_holdings') THEN
    CREATE POLICY "anon_delete_mutual_fund_holdings" ON mutual_fund_holdings FOR DELETE USING (true);
  END IF;
END $$;
