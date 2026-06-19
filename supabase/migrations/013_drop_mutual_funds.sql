-- Migration 013: Drop all Mutual Fund tables — starting fresh
--
-- Removes the mutual fund feature entirely (UI + GAS code already removed).
-- A future migration will reintroduce MF tables with a cleaner NAV-fetch design.
--
-- Run once in the Supabase SQL editor. CASCADE drops dependent policies/constraints.
-- WARNING: destructive — all mutual fund holdings + NAV history are permanently deleted.

DROP TABLE IF EXISTS mutual_fund_nav     CASCADE;
DROP TABLE IF EXISTS mutual_fund_holdings CASCADE;
DROP TABLE IF EXISTS mutual_fund_master  CASCADE;
