-- ============================================================
-- 019  private_holdings.plan_name
-- ------------------------------------------------------------
-- Private Company investments are made into a specific plan
-- within a company (e.g. company "GET venture", plan "GET 1").
-- Adds an optional plan_name shown below the company name.
-- Company-only in the UI; left null for government bonds.
-- ============================================================

ALTER TABLE private_holdings
  ADD COLUMN IF NOT EXISTS plan_name text;
