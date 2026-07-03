-- ============================================================
-- 025  Multi-portfolio DCA plans + manual execution tracking
-- ------------------------------------------------------------
-- The DCA Plan page is being expanded from a single Growth-only,
-- GAS-generated plan into a per-portfolio planner the user drives
-- by hand (one plan per portfolio per month, filled in after
-- consulting Claude chat, with planned/actual/done tracking).
--
-- Changes:
--   • dca_plans   — add portfolio_id (one plan PER portfolio PER
--                   month); relax total_budget_usd (blank by default,
--                   user sets it); widen status to the execution
--                   lifecycle (draft → in_progress → completed);
--                   swap the (user, month) unique for (user,
--                   portfolio, month). Frontend now WRITES these rows,
--                   so add anon insert/update RLS.
--   • dca_plan_items — suggested is now optional (blank until the
--                   user hits Refresh); add planned_amount_usd,
--                   actual_amount_usd, is_done. Frontend now INSERTs
--                   and DELETEs item rows (Refresh rebuilds them), so
--                   add anon insert/delete RLS (update already exists).
--
-- RLS pattern mirrors loans / thai_bonds: anon read-all + anon
-- writes scoped to a valid owner (plans → users, items → plans).
-- ============================================================

-- ── dca_plans ────────────────────────────────────────────────
ALTER TABLE dca_plans ADD COLUMN IF NOT EXISTS portfolio_id uuid
  REFERENCES portfolios(id) ON DELETE CASCADE;

ALTER TABLE dca_plans ALTER COLUMN total_budget_usd DROP NOT NULL;
ALTER TABLE dca_plans ALTER COLUMN total_budget_usd SET DEFAULT 0;

-- widen the status lifecycle (keep legacy approved/executed for old rows)
ALTER TABLE dca_plans DROP CONSTRAINT IF EXISTS dca_plans_status_check;
ALTER TABLE dca_plans ADD CONSTRAINT dca_plans_status_check
  CHECK (status IN ('draft','in_progress','completed','approved','executed'));

-- one plan per (user, portfolio, month); drop the old (user, month) unique
ALTER TABLE dca_plans DROP CONSTRAINT IF EXISTS dca_plans_user_id_month_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS dca_plans_user_port_month
  ON dca_plans(user_id, portfolio_id, month_year);

-- ── dca_plan_items ───────────────────────────────────────────
ALTER TABLE dca_plan_items ALTER COLUMN suggested_amount_usd DROP NOT NULL;
ALTER TABLE dca_plan_items ALTER COLUMN suggested_amount_usd SET DEFAULT 0;
ALTER TABLE dca_plan_items ADD COLUMN IF NOT EXISTS planned_amount_usd numeric(12, 2);
ALTER TABLE dca_plan_items ADD COLUMN IF NOT EXISTS actual_amount_usd  numeric(12, 2);
ALTER TABLE dca_plan_items ADD COLUMN IF NOT EXISTS is_done boolean NOT NULL DEFAULT false;

-- ── RLS: frontend now writes both tables ─────────────────────
-- dca_plans: anon insert/update scoped to a valid owner
DROP POLICY IF EXISTS "anon_insert_dca_plans" ON dca_plans;
CREATE POLICY "anon_insert_dca_plans" ON dca_plans
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));
DROP POLICY IF EXISTS "anon_update_dca_plans" ON dca_plans;
CREATE POLICY "anon_update_dca_plans" ON dca_plans
  FOR UPDATE USING (user_id IN (SELECT id FROM users))
            WITH CHECK (user_id IN (SELECT id FROM users));

-- dca_plan_items: anon insert/delete scoped to an existing parent plan
-- (anon_update_dca_items already created in migration 017)
DROP POLICY IF EXISTS "anon_insert_dca_items" ON dca_plan_items;
CREATE POLICY "anon_insert_dca_items" ON dca_plan_items
  FOR INSERT WITH CHECK (plan_id IN (SELECT id FROM dca_plans));
DROP POLICY IF EXISTS "anon_delete_dca_items" ON dca_plan_items;
CREATE POLICY "anon_delete_dca_items" ON dca_plan_items
  FOR DELETE USING (plan_id IN (SELECT id FROM dca_plans));
