-- Smart Me Asset Tracker — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL,
  pin_hash      text NOT NULL,
  salt          text NOT NULL,
  telegram_chat_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- US PORTFOLIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS portfolios (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  type           text NOT NULL CHECK (type IN ('growth', 'dividend', 'etf')),
  dca_budget_usd numeric(12, 2),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holdings (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  portfolio_id  uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker        text NOT NULL,
  target_pct    numeric(5, 2),          -- nullable; targets need not sum to 100
  shares        numeric(18, 8) NOT NULL DEFAULT 0,
  avg_cost_usd  numeric(12, 4) NOT NULL DEFAULT 0,
  added_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, ticker)
);

CREATE TABLE IF NOT EXISTS watchlist (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker   text NOT NULL,
  notes    text,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ticker)
);

-- ============================================================
-- CRYPTO
-- ============================================================

CREATE TABLE IF NOT EXISTS crypto_holdings (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coin_id       text NOT NULL,          -- CoinGecko coin id (e.g. "bitcoin")
  symbol        text NOT NULL,          -- e.g. "BTC"
  name          text NOT NULL,
  quantity      numeric(28, 10) NOT NULL DEFAULT 0,
  avg_cost_usd  numeric(18, 6) NOT NULL DEFAULT 0,
  UNIQUE (user_id, coin_id)
);

-- ============================================================
-- GOLD
-- ============================================================

CREATE TABLE IF NOT EXISTS gold_holdings (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  troy_oz      numeric(14, 6) NOT NULL DEFAULT 0,
  avg_cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
  notes        text
);

-- ============================================================
-- THAI MUTUAL FUNDS
-- ============================================================
-- Removed 2026-06-19 (migration 013): mutual fund feature dropped to be
-- rebuilt from scratch. Tables will be reintroduced by a future migration.

-- ============================================================
-- CASH
-- ============================================================

CREATE TABLE IF NOT EXISTS cash_accounts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  sub_type        text NOT NULL CHECK (sub_type IN ('saving', 'fixed_deposit', 'fcd')),
  bank            text,
  currency        text NOT NULL DEFAULT 'THB',   -- original currency (FCD: USD/JPY/etc.)
  balance         numeric(18, 4) NOT NULL DEFAULT 0,
  interest_rate   numeric(6, 4),                  -- annual %, nullable
  maturity_date   date,                            -- for fixed deposits
  cash_on_hand_thb numeric(14, 2) NOT NULL DEFAULT 0
);

-- ============================================================
-- INSURANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS insurance_policies (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_name        text NOT NULL,
  insurer            text,
  annual_premium_thb numeric(14, 2) NOT NULL DEFAULT 0,
  sum_assured_thb    numeric(16, 2) NOT NULL DEFAULT 0,
  surrender_value_thb numeric(14, 2) NOT NULL DEFAULT 0,
  start_date         date,
  maturity_date      date
);

-- ============================================================
-- PRIVATE INVESTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS private_investments (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               text NOT NULL,
  invested_amount    numeric(18, 4) NOT NULL DEFAULT 0,
  current_valuation  numeric(18, 4) NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'THB',
  last_updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- MARKET DATA CACHE
-- ============================================================

CREATE TABLE IF NOT EXISTS market_data (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol     text NOT NULL,
  asset_type text NOT NULL,   -- 'stock','etf','crypto','gold','index','forex'
  price      numeric(20, 8) NOT NULL,
  currency   text NOT NULL DEFAULT 'USD',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_data_symbol_time ON market_data (symbol, fetched_at DESC);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_currency text NOT NULL,
  to_currency   text NOT NULL,
  rate          numeric(18, 8) NOT NULL,
  date          date NOT NULL,
  UNIQUE (from_currency, to_currency, date)
);

-- ============================================================
-- AI ANALYSIS & DCA
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_analyses (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker          text NOT NULL,
  portfolio_id    uuid REFERENCES portfolios(id) ON DELETE SET NULL,
  signal          text NOT NULL CHECK (signal IN ('BUY', 'SELL', 'HOLD', 'TRIM')),
  reasoning       text,
  support_level   numeric(14, 4),
  resistance_level numeric(14, 4),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_analyses_ticker_time ON ai_analyses (ticker, created_at DESC);

CREATE TABLE IF NOT EXISTS sr_levels (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker     text NOT NULL,
  support    numeric(14, 4),
  resistance numeric(14, 4),
  timeframe  text NOT NULL DEFAULT 'weekly',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dca_plans (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_year       text NOT NULL,   -- 'YYYY-MM'
  status           text NOT NULL CHECK (status IN ('draft', 'approved', 'executed')) DEFAULT 'draft',
  total_budget_usd numeric(12, 2) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month_year)
);

CREATE TABLE IF NOT EXISTS dca_plan_items (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id              uuid NOT NULL REFERENCES dca_plans(id) ON DELETE CASCADE,
  ticker               text NOT NULL,
  suggested_amount_usd numeric(12, 2) NOT NULL,
  adjusted_amount_usd  numeric(12, 2),     -- user-edited value; null = use suggested
  reasoning            text,
  is_approved          boolean NOT NULL DEFAULT false
);

-- ============================================================
-- NEWS & NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS news_items (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker       text NOT NULL,
  title        text NOT NULL,
  source_name  text,
  url          text,
  published_at timestamptz,
  is_high_impact boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_news_ticker_time ON news_items (ticker, published_at DESC);

CREATE TABLE IF NOT EXISTS notifications_log (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,   -- 'daily_review','weekly_review','dca_ready','realtime_alert','breaking_news'
  message           text,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'sent'   -- 'sent','failed'
);

-- ============================================================
-- PHASE 2 — THAI BONDS (schema only, no UI in Phase 1)
-- ============================================================

CREATE TABLE IF NOT EXISTS thai_bonds (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bond_name        text NOT NULL,
  issuer           text,
  face_value_thb   numeric(14, 2) NOT NULL DEFAULT 0,
  coupon_rate      numeric(6, 4),       -- annual %
  purchase_date    date,
  maturity_date    date,
  purchase_price_thb numeric(14, 2) NOT NULL DEFAULT 0
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Note: Supabase uses its own auth.uid(). Because we handle auth manually
-- (PIN hash in users table, not Supabase Auth), we use the service role key
-- in GAS for all writes and anon key + user_id filtering in the frontend.
-- RLS is enabled as a defence-in-depth layer.

ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist            ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_holdings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_holdings        ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE thai_bonds           ENABLE ROW LEVEL SECURITY;

-- Allow anon/authenticated roles to read all rows (app enforces user_id filtering)
-- GAS uses service role (bypasses RLS) for all writes
CREATE POLICY "anon_read_all" ON users            FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON user_sessions    FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON portfolios       FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON holdings         FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON watchlist        FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON crypto_holdings  FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON gold_holdings    FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON cash_accounts    FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON insurance_policies   FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON private_investments  FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON market_data      FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON exchange_rates   FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON ai_analyses      FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON sr_levels        FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON dca_plans        FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON dca_plan_items   FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON news_items       FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON notifications_log FOR SELECT USING (true);
CREATE POLICY "anon_read_all" ON thai_bonds       FOR SELECT USING (true);

-- Frontend writes (anon key): only own DCA plan approvals and valuation updates
-- Everything else written by GAS (service role, bypasses RLS)
CREATE POLICY "anon_update_dca_items" ON dca_plan_items
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon_update_private_investments" ON private_investments
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon_update_cash_accounts" ON cash_accounts
  FOR UPDATE USING (true) WITH CHECK (true);
