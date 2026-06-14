-- Migration 012: Make mutual_fund_holdings.fund_code optional
-- Fund name is now the primary identifier; fund code is linked by background SEC API match.

-- Drop NOT NULL so new holdings can be saved without a fund code
ALTER TABLE mutual_fund_holdings ALTER COLUMN fund_code DROP NOT NULL;

-- The existing UNIQUE (user_id, fund_code) constraint is preserved.
-- PostgreSQL treats NULLs as distinct in UNIQUE constraints, so multiple
-- unlinked holdings per user (all fund_code = NULL) are allowed.
