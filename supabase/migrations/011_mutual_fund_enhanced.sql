-- Migration 011: Thai Mutual Fund — enhanced holdings, master cache, NAV history
-- Run in Supabase SQL Editor.

-- 1. Add notes column to mutual_fund_holdings
ALTER TABLE mutual_fund_holdings ADD COLUMN IF NOT EXISTS notes text;

-- 2. Expand category values (Onshore / Offshore / RMF / ESG / SSF)
ALTER TABLE mutual_fund_holdings DROP CONSTRAINT IF EXISTS mutual_fund_holdings_category_check;
UPDATE mutual_fund_holdings SET category = 'Onshore' WHERE category = 'other';
ALTER TABLE mutual_fund_holdings
  ADD CONSTRAINT mutual_fund_holdings_category_check
  CHECK (category IN ('Onshore','Offshore','RMF','ESG','SSF'));

-- 3. mutual_fund_master: fund metadata cache (GAS populates from SEC Open Data)
CREATE TABLE IF NOT EXISTS mutual_fund_master (
  fund_code    text PRIMARY KEY,
  fund_name    text,
  fund_name_th text,
  category     text,
  amc          text,
  sec_proj_id  text,
  scraped_at   timestamptz DEFAULT now()
);
ALTER TABLE mutual_fund_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutual_fund_master FORCE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_all" ON mutual_fund_master FOR SELECT USING (true);

-- 4. mutual_fund_nav: daily NAV history (GAS writes via service_role)
CREATE TABLE IF NOT EXISTS mutual_fund_nav (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_code  text NOT NULL,
  nav_date   date NOT NULL,
  nav_price  numeric(14, 4) NOT NULL,
  UNIQUE (fund_code, nav_date)
);
ALTER TABLE mutual_fund_nav ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutual_fund_nav FORCE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_all" ON mutual_fund_nav FOR SELECT USING (true);

-- 5. Write RLS for mutual_fund_holdings (idempotent)
DO $$ BEGIN
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
