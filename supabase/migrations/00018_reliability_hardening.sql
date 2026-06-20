-- Pre-flight checks passed (2026-06-20): no duplicate open sessions, no duplicate active assignments.

-- 1. Replace the non-unique performance index with a unique partial index.
--    This enforces that each article can have at most one open attendance session at a time.
DROP INDEX IF EXISTS idx_attendance_open_sessions;
CREATE UNIQUE INDEX idx_attendance_one_open_session_per_article
  ON attendance_records(article_id)
  WHERE checked_in_at IS NOT NULL AND checked_out_at IS NULL;

-- 2. Enforce that (client_name, work_type) is unique among active assignments.
--    Archived assignments are unaffected — the same pair can be re-created after archival.
CREATE UNIQUE INDEX idx_assignments_one_active_per_client_work
  ON assignments(client_name, work_type)
  WHERE status = 'active';
