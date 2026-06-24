-- 017_mf_fund_code.sql
-- Mutual Fund NAV — Tier-2 fallback source (Finnomena), keyed by plain fund code.
--
-- Some Thai funds (e.g. ES-FIXEDRMF / Eastspring General Fixed Income RMF) are absent
-- from SEC's general-info/profiles dataset, so they can never be assigned a sec_proj_id
-- and SEC NAV auto-refresh can never serve them. Finnomena's public NAV API IS keyed by
-- the plain fund code and returns these funds:
--   GET https://www.finnomena.com/fn3/api/fund/v2/public/funds/{fund_code}/nav/q?range=1M
--
-- refreshMFNav() now does: Tier 1 SEC (by sec_proj_id) → Tier 2 Finnomena (by fund_code)
-- → Tier 3 manual. fund_code is the key for Tier 2. Optional/nullable; manual-only
-- holdings simply leave it blank.

ALTER TABLE mutual_fund_holdings
  ADD COLUMN IF NOT EXISTS fund_code text;

COMMENT ON COLUMN mutual_fund_holdings.fund_code IS
  'Plain fund code (e.g. ES-FIXEDRMF). Used for Finnomena NAV fallback when no sec_proj_id. Nullable.';
