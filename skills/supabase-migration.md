# Skill: Supabase Migration

Template and checklist for adding new tables or altering existing ones.

---

## File naming

```
supabase/migrations/NNN_short_description.sql
```

Where `NNN` is the next sequential number (currently at `009`). Check existing files to confirm the next number.

---

## New table template

```sql
-- Migration NNN: <description>
-- Run in Supabase SQL Editor.

CREATE TABLE <table_name> (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL,
  -- your columns here
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;

-- Frontend reads all rows; JS filters by user_id in code
CREATE POLICY "anon_read_all" ON <table_name>
  FOR SELECT USING (true);

-- Add write policies only if the frontend (anon key) needs to write:
CREATE POLICY "anon_insert_<table_name>" ON <table_name>
  FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update_<table_name>" ON <table_name>
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_<table_name>" ON <table_name>
  FOR DELETE USING (true);
```

**GAS uses the `service_role` key** — it bypasses RLS entirely. Only the frontend (anon key) needs explicit policies.

---

## Adding columns to existing tables

```sql
-- Migration NNN: add columns to <table>

ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> <type> DEFAULT <val>;
```

Use `IF NOT EXISTS` — it makes the migration safe to re-run if it fails partway.

---

## Adding policies to existing tables (idempotent guard)

Wrap new policies in a `DO $$ BEGIN ... END $$` block with an existence check, as done in migration 009:

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = '<table>' AND policyname = '<policy_name>'
  ) THEN
    CREATE POLICY "<policy_name>" ON <table> FOR SELECT USING (true);
  END IF;
END $$;
```

Or use `DROP POLICY IF EXISTS` + `CREATE POLICY` (cleaner when idempotency matters less):

```sql
DROP POLICY IF EXISTS "<old_policy>" ON <table>;
CREATE POLICY "<new_policy>" ON <table> FOR INSERT WITH CHECK (...);
```

---

## Auth / RLS note for this project

This app uses **PIN auth + the Supabase anon key**, not Supabase Auth. `auth.uid()` is always `NULL` for anon requests, so `USING (user_id = auth.uid())` policies silently deny everything. User-scoping is done in JavaScript, not in RLS.

All `USING` / `WITH CHECK` clauses must use `true` (open) or a non-auth condition (e.g., `key = 'gas_web_app_url'`).

---

## How to run

1. Save the file to `supabase/migrations/NNN_name.sql`.
2. Open Supabase dashboard → **SQL Editor**.
3. Paste the full file contents and click **Run**.
4. Verify: no errors in the output; check the table appears under **Table Editor**.
5. Update `CLAUDE.md` → "Migrations applied" list.

Do **not** use the Supabase CLI (`supabase db push`) — this project manages migrations manually via the SQL Editor.

---

## Checklist before running

- [ ] Migration file saved to `supabase/migrations/`
- [ ] `ENABLE ROW LEVEL SECURITY` present
- [ ] `FORCE ROW LEVEL SECURITY` present
- [ ] `anon_read_all` SELECT policy present (frontend always reads)
- [ ] Write policies added only for tables the frontend writes
- [ ] No `auth.uid()` in `USING`/`WITH CHECK` (PIN auth, not Supabase Auth)
- [ ] `IF NOT EXISTS` / `DROP IF EXISTS` guards on any idempotent operations
- [ ] `CLAUDE.md` migration list updated after successful run
