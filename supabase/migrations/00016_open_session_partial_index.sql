-- ============================================================
-- MIGRATION 00016: Partial index for open-session lookups
-- ============================================================
-- At check-in the application queries:
--
--   SELECT id, attendance_date
--   FROM   attendance_records
--   WHERE  article_id     = $1
--     AND  checked_in_at  IS NOT NULL
--     AND  checked_out_at IS NULL
--   LIMIT  1;
--
-- The existing idx_attendance_article_id covers article_id but
-- includes every historical record, requiring a heap scan that
-- grows linearly with attendance history.
--
-- This partial index contains only open sessions — rows where
-- checked_in_at IS NOT NULL and checked_out_at IS NULL. At any
-- point in time that is at most one row per active article, so
-- the index stays small regardless of how large the table grows.
-- PostgreSQL automatically drops a row from the index when
-- checked_out_at is set (i.e. when the session is closed).
--
-- No behaviour change: same queries, same results, faster lookup.
-- ============================================================

create index if not exists idx_attendance_open_sessions
  on attendance_records(article_id)
  where checked_in_at  is not null
    and checked_out_at is null;
