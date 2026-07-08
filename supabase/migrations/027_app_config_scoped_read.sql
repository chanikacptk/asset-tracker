-- Migration 027: Scope anon read on app_config to the GAS URL key only
--
-- CONTEXT: The GAS Web App URL is stored in app_config (key = 'gas_web_app_url')
-- so it persists across localStorage clears, cache wipes, and device switches
-- (fixes the "app keeps asking for the GAS URL on mobile" bug). The frontend
-- loads it on init via a direct anon SELECT.
--
-- Migration 009 gave app_config a broad `anon_read_all USING (true)` SELECT
-- policy, which exposes EVERY key to anyone holding the (publishable) anon key.
-- The GAS URL is non-sensitive, but nothing else in this table should be anon-
-- readable, so we narrow the read to that one key. Writes still go exclusively
-- through GAS with the service_role key (which bypasses RLS); the frontend never
-- writes app_config directly.
-- ============================================================================

-- Replace the blanket read with a key-scoped, read-only policy.
DROP POLICY IF EXISTS "anon_read_all"      ON app_config;
DROP POLICY IF EXISTS "anon_read_gas_url"  ON app_config;

CREATE POLICY "anon_read_gas_url" ON app_config
  FOR SELECT
  USING (key = 'gas_web_app_url');

-- Note: the existing write policies remain as-is —
--   anon_upsert_gas_url / anon_update_gas_url  (scoped to key = 'gas_web_app_url')
-- were added in migration 009. Direct anon writes are not used by the app; the
-- Settings page saves via GAS `saveConfig` (service_role), but these scoped
-- policies are harmless and kept for backward compatibility.
