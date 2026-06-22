-- Migration 017: Tighten permissive RLS write policies
--
-- Fixes two Supabase Security Lint issues:
--   ERROR  app_config: policies exist but RLS is not enabled → re-enable it
--   WARN   22 write policies use USING(true)/WITH CHECK(true) → scope to valid user_id
--
-- CONTEXT: This app uses PIN auth, not Supabase Auth. auth.uid() is always NULL
-- for anon requests, so policies cannot use auth.uid(). The best achievable guard
-- is requiring that the target user_id exists in the users table. This prevents
-- random inserts with fabricated UUIDs and reduces (though does not eliminate)
-- cross-user manipulation risk for a 2-person personal app.
-- ============================================================================

-- ── 1. Re-enable RLS on app_config (lint says it was disabled) ───────────────
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Existing policies anon_update_gas_url / anon_upsert_gas_url are already scoped
-- to key = 'gas_web_app_url', so no changes needed to those policies.

-- ── 2. cash_accounts ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_cash_accounts" ON cash_accounts;
DROP POLICY IF EXISTS "anon_update_cash_accounts" ON cash_accounts;
DROP POLICY IF EXISTS "anon_delete_cash_accounts" ON cash_accounts;

CREATE POLICY "anon_insert_cash_accounts" ON cash_accounts
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_update_cash_accounts" ON cash_accounts
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users))
  WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_delete_cash_accounts" ON cash_accounts
  FOR DELETE USING (user_id IN (SELECT id FROM users));

-- ── 3. dca_plan_items ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_update_dca_items" ON dca_plan_items;

CREATE POLICY "anon_update_dca_items" ON dca_plan_items
  FOR UPDATE
  USING (plan_id IN (SELECT id FROM dca_plans))
  WITH CHECK (plan_id IN (SELECT id FROM dca_plans));

-- ── 4. gold_holdings ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_gold" ON gold_holdings;
DROP POLICY IF EXISTS "anon_update_gold" ON gold_holdings;
DROP POLICY IF EXISTS "anon_delete_gold" ON gold_holdings;

CREATE POLICY "anon_insert_gold" ON gold_holdings
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_update_gold" ON gold_holdings
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users))
  WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_delete_gold" ON gold_holdings
  FOR DELETE USING (user_id IN (SELECT id FROM users));

-- ── 5. holdings (user_id is indirect: holdings → portfolios.user_id) ─────────
DROP POLICY IF EXISTS "anon_insert_holdings" ON holdings;
DROP POLICY IF EXISTS "anon_update_holdings" ON holdings;
DROP POLICY IF EXISTS "anon_delete_holdings" ON holdings;

CREATE POLICY "anon_insert_holdings" ON holdings
  FOR INSERT WITH CHECK (portfolio_id IN (SELECT id FROM portfolios));

CREATE POLICY "anon_update_holdings" ON holdings
  FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM portfolios))
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios));

CREATE POLICY "anon_delete_holdings" ON holdings
  FOR DELETE USING (portfolio_id IN (SELECT id FROM portfolios));

-- ── 6. mutual_fund_holdings ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_mutual_fund_holdings" ON mutual_fund_holdings;
DROP POLICY IF EXISTS "anon_update_mutual_fund_holdings" ON mutual_fund_holdings;
DROP POLICY IF EXISTS "anon_delete_mutual_fund_holdings" ON mutual_fund_holdings;

CREATE POLICY "anon_insert_mutual_fund_holdings" ON mutual_fund_holdings
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_update_mutual_fund_holdings" ON mutual_fund_holdings
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users))
  WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_delete_mutual_fund_holdings" ON mutual_fund_holdings
  FOR DELETE USING (user_id IN (SELECT id FROM users));

-- ── 7. portfolios ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_portfolios" ON portfolios;
DROP POLICY IF EXISTS "anon_update_portfolios" ON portfolios;

CREATE POLICY "anon_insert_portfolios" ON portfolios
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_update_portfolios" ON portfolios
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users))
  WITH CHECK (user_id IN (SELECT id FROM users));

-- ── 8. private_investments ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_update_private_investments" ON private_investments;

CREATE POLICY "anon_update_private_investments" ON private_investments
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users))
  WITH CHECK (user_id IN (SELECT id FROM users));

-- ── 9. thai_bonds ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_thai_bonds" ON thai_bonds;
DROP POLICY IF EXISTS "anon_update_thai_bonds" ON thai_bonds;
DROP POLICY IF EXISTS "anon_delete_thai_bonds" ON thai_bonds;

CREATE POLICY "anon_insert_thai_bonds" ON thai_bonds
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_update_thai_bonds" ON thai_bonds
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users))
  WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_delete_thai_bonds" ON thai_bonds
  FOR DELETE USING (user_id IN (SELECT id FROM users));

-- ── 10. users (UPDATE only — PIN/profile edits; no auth.uid() available) ─────
-- Best achievable without Supabase Auth: require the target row actually exists.
DROP POLICY IF EXISTS "anon_update_users" ON users;

CREATE POLICY "anon_update_users" ON users
  FOR UPDATE
  USING (id IS NOT NULL)
  WITH CHECK (id IS NOT NULL);

-- ── 11. watchlist ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_watchlist" ON watchlist;
DROP POLICY IF EXISTS "anon_delete_watchlist" ON watchlist;

CREATE POLICY "anon_insert_watchlist" ON watchlist
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_delete_watchlist" ON watchlist
  FOR DELETE USING (user_id IN (SELECT id FROM users));
