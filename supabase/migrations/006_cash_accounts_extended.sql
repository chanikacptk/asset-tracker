-- Migration 006: Extend cash_accounts with full FD / FCD fields

ALTER TABLE cash_accounts
  ADD COLUMN IF NOT EXISTS account_number   text,
  ADD COLUMN IF NOT EXISTS start_date       date,
  ADD COLUMN IF NOT EXISTS duration_months  integer,
  ADD COLUMN IF NOT EXISTS status           text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS fcd_amount       numeric(18, 4),
  ADD COLUMN IF NOT EXISTS fcd_purchase_rate numeric(12, 4);

-- Optional: constrain status values (run only if no existing NULL rows)
-- ALTER TABLE cash_accounts ADD CONSTRAINT cash_status_check CHECK (status IN ('active','matured'));
