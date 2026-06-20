-- Migration 015: Mutual Funds Phase 2 — optional SEC NAV link per fund
-- Lets the user paste the SEC Open Data proj_id + exact fund_class_name once
-- (e.g. proj_id M0209_2554 + class "KKP CorePath Balanced") so the daily NAV
-- refresh job can target the fund directly. Both nullable: funds without them
-- stay manual-NAV-only. One proj_id can have several classes (…-ES, …-SSF),
-- each with a different NAV, so the class name is required to disambiguate.
-- Run in Supabase SQL Editor.

ALTER TABLE mutual_fund_holdings ADD COLUMN IF NOT EXISTS sec_proj_id         text;
ALTER TABLE mutual_fund_holdings ADD COLUMN IF NOT EXISTS sec_fund_class_name text;
