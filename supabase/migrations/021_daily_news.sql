-- ============================================================
-- 021  Daily Tech-News brief persistence (Analysis page)
-- ------------------------------------------------------------
-- The Telegram brief (NotificationAgent.sendDailyNewsBrief) was
-- previously send-only — nothing was stored, so there was no
-- history to browse in the web app. These two tables persist the
-- structured brief so the Analysis page can render it and let the
-- user browse previous days.
--
-- The brief is generated PER USER (holdings-aware), so each
-- `daily_news` row carries the user_id it was generated for.
--   • daily_news        — one row per story (holdings + market)
--   • daily_news_impact — per-user "ผลต่อ position" line for
--                         holdings-related stories (1:1 with the
--                         holdings rows in daily_news)
--
-- WRITE PATH: GAS only (service_role, bypasses RLS). The frontend
-- never writes these — so anon gets read-only, matching news_items.
-- Same anon-read-all pattern as the rest of the app (frontend
-- filters by user_id in JS).
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_news (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  news_date          date NOT NULL,                 -- Bangkok date of the brief
  emoji              text,
  ticker             text,                           -- nullable (broad/macro stories)
  headline           text NOT NULL,                  -- same text shown in Telegram
  sentiment          text NOT NULL DEFAULT 'neutral' -- derived from emoji at insert
                       CHECK (sentiment IN ('positive','negative','neutral')),
  is_holding_related boolean NOT NULL DEFAULT false,
  sources            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- array of source names
  sort_order         int  NOT NULL DEFAULT 0,        -- preserve order within section
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_news_user_date
  ON daily_news(user_id, news_date DESC);

CREATE TABLE IF NOT EXISTS daily_news_impact (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  news_id     uuid NOT NULL REFERENCES daily_news(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  impact      text NOT NULL,                         -- "ผลต่อ position ของคุณ: …"
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_news_impact_news ON daily_news_impact(news_id);

-- RLS — read-only for anon (writes happen via GAS service_role only)
ALTER TABLE daily_news        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_news_impact ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_all" ON daily_news
  FOR SELECT USING (true);

CREATE POLICY "anon_read_all" ON daily_news_impact
  FOR SELECT USING (true);
