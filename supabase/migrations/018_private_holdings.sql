-- ============================================================
-- 018  Private Investment page rebuild
-- ------------------------------------------------------------
-- New `private_holdings` table backing the redesigned Private
-- Investment page. Supports two investment types via `inv_type`:
--   • 'company' — Private Company Investment (principal + annual
--                 interest, term, maturity, active/matured/withdrawn)
--   • 'govbond' — Government Bond (principal + coupon, maturity,
--                 active/matured)
--
-- All money is THB (`principal_thb`). This SUPERSEDES the old
-- `private_investments` table for the page + net-worth wiring;
-- the old table is left in place (untouched) for safety.
-- Same RLS pattern as thai_bonds / mutual_fund_holdings:
-- anon read-all + anon insert/update/delete scoped to valid user_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS private_holdings (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inv_type       text NOT NULL CHECK (inv_type IN ('company','govbond')),
  name           text NOT NULL,
  principal_thb  numeric(18, 4) NOT NULL DEFAULT 0,
  rate_pct       numeric(8, 4),                       -- annual interest % (company) / coupon % (govbond)
  start_date     date,                                -- investment date / purchase date
  term_value     numeric(8, 2),                       -- company only
  term_unit      text CHECK (term_unit IN ('months','years')),  -- company only
  maturity_date  date,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','matured','withdrawn')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_private_holdings_user ON private_holdings(user_id);

-- RLS — same pattern as thai_bonds
ALTER TABLE private_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_all" ON private_holdings
  FOR SELECT USING (true);

CREATE POLICY "anon_insert_private_holdings" ON private_holdings
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_update_private_holdings" ON private_holdings
  FOR UPDATE
  USING (user_id IN (SELECT id FROM users))
  WITH CHECK (user_id IN (SELECT id FROM users));

CREATE POLICY "anon_delete_private_holdings" ON private_holdings
  FOR DELETE USING (user_id IN (SELECT id FROM users));
