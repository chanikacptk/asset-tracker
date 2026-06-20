-- Migration 016: add nav_date to mutual_fund_holdings
-- Stores the SEC valuation date separately from nav_updated_at (the last-checked
-- timestamp), so the UI can show "NAV as of 15 Jun · checked 20 Jun" instead of
-- a misleading single timestamp.
ALTER TABLE mutual_fund_holdings ADD COLUMN IF NOT EXISTS nav_date date;
