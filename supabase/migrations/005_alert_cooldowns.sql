-- 005_alert_cooldowns.sql
-- Persistent 24-hour cooldown tracking for realtime alerts (crypto, gold, S/R proximity).
-- Prevents the same alert from firing more than once per day per user+ticker+type.
-- GAS writes via service_role (bypasses RLS). RLS enabled with open policy for forward-compat.

CREATE TABLE IF NOT EXISTS alert_cooldowns (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker       text         NOT NULL,
  alert_type   text         NOT NULL,  -- 'crypto_alert' | 'gold_alert' | 'sr_alert'
  last_sent_at timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, ticker, alert_type)
);

ALTER TABLE alert_cooldowns ENABLE ROW LEVEL SECURITY;

-- GAS uses service_role which bypasses RLS; this policy covers any future anon reads
CREATE POLICY "anon_read_alert_cooldowns"
  ON alert_cooldowns FOR SELECT USING (true);
