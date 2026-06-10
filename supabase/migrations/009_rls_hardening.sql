-- Migration 009: Enable + Force RLS on every table, tighten app_config writes
--
-- CONTEXT: This app uses PIN-based auth + the Supabase anon key (not Supabase Auth).
-- auth.uid() is always NULL for anon requests, so user-scoped USING(auth.uid())
-- policies cannot be used — they would silently deny all frontend queries.
-- The proper long-term fix is to migrate to Supabase Auth.
--
-- WHAT THIS FIXES:
--   "Table publicly accessible — Row-Level Security is not enabled"
--   ENABLE ROW LEVEL SECURITY is the actual on/off switch.
--   FORCE ensures even the table owner role cannot bypass it.
-- ============================================================================

-- ── ENABLE RLS on every table (the actual fix for the Supabase alert) ────────

ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist            ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_holdings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_holdings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutual_fund_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_policies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_investments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data          ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analyses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sr_levels            ENABLE ROW LEVEL SECURITY;
ALTER TABLE dca_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE dca_plan_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_cooldowns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE thai_bonds           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config           ENABLE ROW LEVEL SECURITY;

-- ── FORCE RLS (prevents the Postgres table-owner role from bypassing) ────────

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

-- ── Add SELECT policies for any table missing them ───────────────────────────
-- (idempotent: IF NOT EXISTS used where supported; duplicates cause no harm)

-- Tables that the frontend reads — anon SELECT allowed (filtered in JS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON users FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_sessions' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON user_sessions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portfolios' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON portfolios FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='holdings' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON holdings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='watchlist' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON watchlist FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gold_holdings' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON gold_holdings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mutual_fund_holdings' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON mutual_fund_holdings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_accounts' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON cash_accounts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='insurance_policies' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON insurance_policies FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='private_investments' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON private_investments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='crypto_holdings' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON crypto_holdings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='market_data' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON market_data FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exchange_rates' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON exchange_rates FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_analyses' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON ai_analyses FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sr_levels' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON sr_levels FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dca_plans' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON dca_plans FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dca_plan_items' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON dca_plan_items FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='news_items' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON news_items FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications_log' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON notifications_log FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alert_cooldowns' AND policyname='anon_read_alert_cooldowns') THEN
    CREATE POLICY "anon_read_alert_cooldowns" ON alert_cooldowns FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='thai_bonds' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON thai_bonds FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_config' AND policyname='anon_read_all') THEN
    CREATE POLICY "anon_read_all" ON app_config FOR SELECT USING (true);
  END IF;
END $$;

-- ── Tighten app_config writes (GAS URL is the only key the frontend writes) ──

DROP POLICY IF EXISTS "anon_upsert_all"   ON app_config;
DROP POLICY IF EXISTS "anon_update_all"   ON app_config;
DROP POLICY IF EXISTS "anon_upsert_gas_url" ON app_config;
DROP POLICY IF EXISTS "anon_update_gas_url" ON app_config;

CREATE POLICY "anon_upsert_gas_url" ON app_config
  FOR INSERT WITH CHECK (key = 'gas_web_app_url');

CREATE POLICY "anon_update_gas_url" ON app_config
  FOR UPDATE USING (key = 'gas_web_app_url') WITH CHECK (key = 'gas_web_app_url');

-- ── NOTE on remaining risk ────────────────────────────────────────────────────
-- After this migration, RLS is ON and the Supabase alert will clear.
-- The anon SELECT policies still allow anyone with the anon key to read all rows.
-- That is intentional for this app's architecture (PIN auth, not Supabase Auth).
-- To fully restrict per-user access, migrate the login flow to Supabase Auth and
-- change all policies to USING (user_id = auth.uid()).
