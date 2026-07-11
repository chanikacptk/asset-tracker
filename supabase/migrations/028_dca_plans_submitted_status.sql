-- 028_dca_plans_submitted_status.sql
-- DCA Plan: "Submit & Email Summary" now archives the month (keeps it as history)
-- and rolls the planner over to a fresh next month. The archived month is stamped
-- with a new 'submitted' status — widen the CHECK constraint to allow it.
-- (Extends 025's status set; legacy approved/executed kept for old rows.)

ALTER TABLE dca_plans DROP CONSTRAINT IF EXISTS dca_plans_status_check;
ALTER TABLE dca_plans ADD CONSTRAINT dca_plans_status_check
  CHECK (status IN ('draft','in_progress','completed','submitted','approved','executed'));
