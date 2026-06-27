-- ============================================================
-- 022  Loans (receivables) — money the user lends to others
-- ------------------------------------------------------------
-- Two tables backing the new Loan page (under the Asset hub):
--   • loans          — one row per loan (borrower + terms)
--   • loan_payments  — installment schedule, one row per installment
--                      (FK → loans, cascade delete)
--
-- All money is THB. Loan totals are DELIBERATELY EXCLUDED from the
-- net-worth / Total Asset summary — they are shown only on the Loan
-- page's own summary. (The frontend simply never adds these into
-- calcUserData / the donut / loadMore's asset subtotal.)
--
-- Statuses are largely DERIVED in the UI (a loan is "completed" when
-- every installment is paid, "overdue" when an unpaid installment is
-- past due, else "active"; a payment is "overdue" when unpaid past its
-- due date). The stored `status` columns hold the persisted baseline
-- ('active' / 'pending') and are kept for querying; the UI recomputes
-- the live status from the payment rows + today's date.
--
-- RLS: same pattern as thai_bonds / private_holdings —
-- anon read-all + anon insert/update/delete scoped to a valid owner.
-- ============================================================

CREATE TABLE IF NOT EXISTS loans (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  borrower_name      text NOT NULL,
  principal_thb      numeric(18, 4) NOT NULL DEFAULT 0,
  interest_rate      numeric(8, 4),                          -- annual % (nullable — some loans are interest-free)
  loan_date          date,
  frequency          text NOT NULL DEFAULT 'monthly'
                       CHECK (frequency IN ('monthly','quarterly','custom')),
  custom_interval_months int,                               -- months between installments when frequency = 'custom'
  installment_amount numeric(18, 4) NOT NULL DEFAULT 0,      -- expected amount per installment
  num_installments   int NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','overdue')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);

CREATE TABLE IF NOT EXISTS loan_payments (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id            uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_number int  NOT NULL,
  due_date           date,
  expected_amount    numeric(18, 4) NOT NULL DEFAULT 0,
  paid_amount        numeric(18, 4),                         -- nullable until marked paid
  paid_date          date,                                   -- nullable until marked paid
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_payments ENABLE ROW LEVEL SECURITY;

-- loans: scoped to a valid owner
CREATE POLICY "anon_read_all" ON loans
  FOR SELECT USING (true);
CREATE POLICY "anon_insert_loans" ON loans
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM users));
CREATE POLICY "anon_update_loans" ON loans
  FOR UPDATE USING (user_id IN (SELECT id FROM users))
            WITH CHECK (user_id IN (SELECT id FROM users));
CREATE POLICY "anon_delete_loans" ON loans
  FOR DELETE USING (user_id IN (SELECT id FROM users));

-- loan_payments: scoped to an existing parent loan
CREATE POLICY "anon_read_all" ON loan_payments
  FOR SELECT USING (true);
CREATE POLICY "anon_insert_loan_payments" ON loan_payments
  FOR INSERT WITH CHECK (loan_id IN (SELECT id FROM loans));
CREATE POLICY "anon_update_loan_payments" ON loan_payments
  FOR UPDATE USING (loan_id IN (SELECT id FROM loans))
            WITH CHECK (loan_id IN (SELECT id FROM loans));
CREATE POLICY "anon_delete_loan_payments" ON loan_payments
  FOR DELETE USING (loan_id IN (SELECT id FROM loans));
