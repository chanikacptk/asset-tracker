-- Migration 010: Bond Portfolio — extend thai_bonds + add bond_master cache
-- Run in Supabase SQL Editor.

-- Extend existing thai_bonds with columns needed for the Bond Portfolio page
ALTER TABLE thai_bonds ADD COLUMN IF NOT EXISTS bond_code          text;
ALTER TABLE thai_bonds ADD COLUMN IF NOT EXISTS credit_rating      text;
ALTER TABLE thai_bonds ADD COLUMN IF NOT EXISTS units              numeric(12, 2) DEFAULT 0;
ALTER TABLE thai_bonds ADD COLUMN IF NOT EXISTS coupon_type        text DEFAULT 'semi-annually';
ALTER TABLE thai_bonds ADD COLUMN IF NOT EXISTS issued_date        date;
ALTER TABLE thai_bonds ADD COLUMN IF NOT EXISTS notes              text;
ALTER TABLE thai_bonds ADD COLUMN IF NOT EXISTS price_per_unit_thb numeric(14, 2) DEFAULT 1000;

-- bond_master: cached bond metadata scraped from ThaiBMA (keyed by bond_code)
CREATE TABLE IF NOT EXISTS bond_master (
  bond_code     text PRIMARY KEY,
  bond_name     text,
  issuer        text,
  credit_rating text,
  coupon_rate   numeric(6, 4),
  coupon_type   text,
  issued_date   date,
  maturity_date date,
  scraped_at    timestamptz DEFAULT now()
);

ALTER TABLE bond_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE bond_master FORCE ROW LEVEL SECURITY;

-- Frontend reads bond_master (GAS writes it via service_role which bypasses RLS)
CREATE POLICY "anon_read_all" ON bond_master FOR SELECT USING (true);

-- Frontend write policies for thai_bonds
-- (SELECT policy already exists from schema + migration 009)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='thai_bonds' AND policyname='anon_insert_thai_bonds') THEN
    CREATE POLICY "anon_insert_thai_bonds" ON thai_bonds FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='thai_bonds' AND policyname='anon_update_thai_bonds') THEN
    CREATE POLICY "anon_update_thai_bonds" ON thai_bonds FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='thai_bonds' AND policyname='anon_delete_thai_bonds') THEN
    CREATE POLICY "anon_delete_thai_bonds" ON thai_bonds FOR DELETE USING (true);
  END IF;
END $$;
