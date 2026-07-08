-- ============================================================
-- 026  Google OAuth — link Google identity onto existing users
-- ------------------------------------------------------------
-- Adding "Sign in with Google" alongside the existing name-tap
-- login. Design decision: KEEP each user's existing users.id as
-- the canonical user_id everywhere, and just ATTACH the Google
-- identity to that row. This means NO migration of user_id across
-- holdings / cash_accounts / gold_holdings / ... (the risky part
-- of the original plan is avoided entirely).
--
-- Flow after a Google login (client side):
--   • getSession() → google email + auth uid
--   • find users row by auth_uid (already linked) or email (auto-link)
--     → set state.userId = users.id, stamp auth_uid/email, enter app
--   • no match → name-picker fallback → stamp email + auth_uid
--
-- Changes:
--   • users — add email (unique, case-insensitive) + auth_uid
--     (FK → auth.users, the Supabase identity). Seed the current
--     user's email so auto-link works on her first Google login.
--   • RLS — users had SELECT only; the client now writes auth_uid/
--     email during linking, so add an UPDATE policy. Mirrors the
--     app's existing "trusted client" model (all other tables use
--     USING(true)); scoped so a row can only be stamped with the
--     caller's own auth uid + email once authenticated.
-- ============================================================

-- ── columns ──────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_uid uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

-- one Google account per profile, one profile per email (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_uid_key    ON users (auth_uid);

-- ── seed the current user's email (Chelsea = chanika.cptk@gmail.com) ──
-- Partner's email intentionally NOT seeded yet — the partner will hit the
-- name-picker fallback on first Google login, which stamps their email.
UPDATE users
   SET email = 'chanika.cptk@gmail.com'
 WHERE id = '00000000-0000-0000-0000-000000000001'
   AND email IS NULL;

-- ── RLS: allow the authenticated client to stamp the link ────
-- After Google OAuth the client's role is `authenticated`; let it link a
-- profile to ITS OWN uid/email. A row is claimable when it's still unlinked
-- (auth_uid IS NULL — the name-picker fallback) or already belongs to this
-- caller (email/uid match — re-stamping on subsequent logins). WITH CHECK
-- forces the stamped auth_uid to equal the caller's real uid, so one user
-- can never point a profile at someone else's identity.
DROP POLICY IF EXISTS "auth_link_users" ON users;
CREATE POLICY "auth_link_users" ON users
  FOR UPDATE TO authenticated
  USING (
    auth_uid IS NULL
    OR auth_uid = auth.uid()
    OR lower(email) = lower(auth.jwt() ->> 'email')
  )
  WITH CHECK (
    auth_uid = auth.uid()
  );
