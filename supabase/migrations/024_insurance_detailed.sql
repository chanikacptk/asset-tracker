-- ============================================================
-- 024  Insurance — detailed policy tracking
-- ------------------------------------------------------------
-- Extends insurance_policies into a full policy record (matching
-- the fields shown in the AIA app: policy type/number, insured
-- name, status, dates, sum assured, premium mode + amount,
-- payment method, next due + latest payment), and adds the
-- frontend (anon) write policies so the page can CRUD.
--
-- IMPORTANT — insurance is now INFORMATIONAL ONLY and is
-- DELIBERATELY EXCLUDED from net worth / Total Asset. No policy
-- value (sum assured, surrender value, premium) is ever folded
-- into calcUserData / the home donut / the Asset-hub subtotal.
-- (legacy columns annual_premium_thb + surrender_value_thb are
-- left in place but no longer read by the app.)
--
-- product name reuses the existing NOT NULL policy_name column.
-- ============================================================

ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS policy_type            text;     -- Endowment / Unit Linked / Whole Life / Other
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS policy_number          text;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS insured_name           text;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS status                 text NOT NULL DEFAULT 'in_force'
                                          CHECK (status IN ('in_force','lapsed','matured'));
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS policy_date            date;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS premium_mode           text NOT NULL DEFAULT 'annually'
                                          CHECK (premium_mode IN ('annually','semi-annually','quarterly','monthly'));
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS premium_amount_thb     numeric(14, 2) NOT NULL DEFAULT 0;  -- per payment (per premium_mode)
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS payment_method         text;     -- Self-payment / Auto-deduct / Credit Card
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS next_due_date          date;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS last_payment_date      date;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS last_payment_amount_thb numeric(14, 2);
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS last_payment_method    text;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS notes                  text;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS created_at             timestamptz NOT NULL DEFAULT now();

-- ── Frontend (anon key) CRUD — scoped to a valid owner ──────
CREATE POLICY "anon_insert_insurance" ON insurance_policies
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));
CREATE POLICY "anon_update_insurance" ON insurance_policies
  FOR UPDATE USING (user_id IN (SELECT id FROM users))
            WITH CHECK (user_id IN (SELECT id FROM users));
CREATE POLICY "anon_delete_insurance" ON insurance_policies
  FOR DELETE USING (user_id IN (SELECT id FROM users));
