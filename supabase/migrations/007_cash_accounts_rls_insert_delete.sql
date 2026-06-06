-- Migration 007: Add INSERT and DELETE policies for cash_accounts
-- The table had SELECT + UPDATE but frontend insert/delete were blocked.

CREATE POLICY "anon_insert_cash_accounts" ON cash_accounts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_delete_cash_accounts" ON cash_accounts
  FOR DELETE USING (true);
