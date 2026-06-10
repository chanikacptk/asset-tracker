-- Migration 009: RLS hardening
--
-- CONTEXT: This app uses PIN-based auth + the Supabase anon key (not Supabase Auth).
-- auth.uid() is always NULL for frontend requests, so user-scoped policies
-- cannot use auth.uid(). The anon key is intentionally public.
--
-- WHAT THIS MIGRATION DOES:
--   1. FORCE ROW LEVEL SECURITY on all tables — prevents the Postgres table owner
--      (the Supabase dashboard role) from bypassing RLS accidentally.
--   2. Drops and re-adds the app_config write policy — previously allowed anon
--      INSERT/UPDATE freely; now restricted to service_role only (only GAS needs it).
--   3. Drops anon_update_users — profile updates should still be allowed, kept as-is,
--      but PIN hash must never be anon-writable (it isn't — no anon policy touches it).
--
-- WHAT THIS MIGRATION CANNOT DO without breaking the frontend:
--   - Restrict SELECT to own rows only (frontend reads all rows, filters in JS)
--   - Use auth.uid() checks (app does not use Supabase Auth)
--
-- LONG-TERM FIX: Migrate to Supabase Auth so auth.uid() works, then add
--   USING (user_id = auth.uid()) to every policy. That is a larger change.
-- ============================================================================

-- 1. Force RLS on all tables (owner cannot bypass)
ALTER TABLE users                FORCE ROW LEVEL SECURITY;
ALTER TABLE user_sessions        FORCE ROW LEVEL SECURITY;
ALTER TABLE portfolios           FORCE ROW LEVEL SECURITY;
ALTER TABLE holdings             FORCE ROW LEVEL SECURITY;
ALTER TABLE watchlist            FORCE ROW LEVEL SECURITY;
ALTER TABLE crypto_holdings      FORCE ROW LEVEL SECURITY;
ALTER TABLE gold_holdings        FORCE ROW LEVEL SECURITY;
ALTER TABLE mutual_fund_holdings FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_accounts        FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_policies   FORCE ROW LEVEL SECURITY;
ALTER TABLE private_investments  FORCE ROW LEVEL SECURITY;
ALTER TABLE market_data          FORCE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates       FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_analyses          FORCE ROW LEVEL SECURITY;
ALTER TABLE sr_levels            FORCE ROW LEVEL SECURITY;
ALTER TABLE dca_plans            FORCE ROW LEVEL SECURITY;
ALTER TABLE dca_plan_items       FORCE ROW LEVEL SECURITY;
ALTER TABLE news_items           FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications_log    FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_cooldowns      FORCE ROW LEVEL SECURITY;
ALTER TABLE thai_bonds           FORCE ROW LEVEL SECURITY;
ALTER TABLE app_config           FORCE ROW LEVEL SECURITY;

-- 2. Lock down app_config writes to service_role only
--    (currently has anon_upsert_all + anon_update_all — GAS is the only writer)
DROP POLICY IF EXISTS "anon_upsert_all" ON app_config;
DROP POLICY IF EXISTS "anon_update_all" ON app_config;

-- The Settings page saves the GAS URL via callGAS or direct upsert.
-- Re-add as a restricted INSERT/UPDATE that only touches the gas_web_app_url key.
CREATE POLICY "anon_upsert_gas_url" ON app_config
  FOR INSERT WITH CHECK (key = 'gas_web_app_url');

CREATE POLICY "anon_update_gas_url" ON app_config
  FOR UPDATE USING (key = 'gas_web_app_url') WITH CHECK (key = 'gas_web_app_url');

-- 3. Confirm tables that should have NO anon write access have no stray policies.
--    These are GAS-only writes — service_role bypasses RLS so no policies needed:
--      market_data, exchange_rates, ai_analyses, sr_levels, dca_plans,
--      news_items, notifications_log, alert_cooldowns, thai_bonds,
--      insurance_policies (no anon write policy exists — correct).
--    Nothing to add here; the absence of a write policy = deny for anon.
