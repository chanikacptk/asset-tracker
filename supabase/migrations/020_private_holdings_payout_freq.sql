-- ============================================================
-- 020  private_holdings.payout_freq
-- ------------------------------------------------------------
-- When a private investment pays interest/coupon periodically,
-- store the payout frequency (same vocabulary as thai_bonds
-- coupon_type). NULL = lump sum at maturity (no periodic payout).
-- Used to compute the next payout date + amount, mirroring the
-- Thai Bond "Next Coupon" display.
-- ============================================================

ALTER TABLE private_holdings
  ADD COLUMN IF NOT EXISTS payout_freq text
    CHECK (payout_freq IN ('monthly','quarterly','semi-annually','annually'));
