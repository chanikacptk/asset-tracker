-- ============================================================
-- 023  Loan partial payments + payment timestamp
-- ------------------------------------------------------------
-- Adds partial-payment support to the Loan page's installment
-- schedule (loan_payments).
--
-- NOTE on `amount_paid`: the existing `paid_amount` column (added in
-- migration 022) is REUSED as the cumulative amount paid on an
-- installment (the running tally), so no separate `amount_paid`
-- column is added — that would duplicate it. A row is "fully paid"
-- when paid_amount >= expected_amount, "partial" when
-- 0 < paid_amount < expected_amount (the UI derives this live).
-- `due_date` is already editable per-row; only the UI needed to
-- expose it — no schema change required for editable due dates.
--
-- This migration only adds `paid_at` (when a payment was last
-- recorded), distinct from `paid_date` (the date the borrower paid,
-- user-editable).
-- ============================================================

ALTER TABLE loan_payments
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
