-- ============================================================================
-- MIGRATION 00027: Correct bad Reporting Manager data (article/intern gap)
-- ============================================================================
-- Between migration 00025 (attendance_records.reporting_manager_id, with
-- get_reporting_manager_candidates() deliberately role-agnostic) and
-- migration 00026 (which excluded article/intern from that candidate list),
-- the check-in UI and API allowed an Article/Intern to be selected as
-- someone else's Reporting Manager. This produced a small number of
-- attendance_records rows on 2026-09-02 whose reporting_manager_id points
-- to a profile with role = 'article' or 'intern' — confirmed by direct
-- inspection before writing this migration: 4 rows matched (all role =
-- 'article'; none 'intern'), out of 46 rows that day with a non-null
-- reporting_manager_id. The other 42 correctly reference a manager/
-- partner/admin and must NOT be touched.
--
-- Scope is therefore by ROLE, not by date alone: only rows whose
-- reporting_manager_id resolves to an article/intern profile are cleared,
-- so a legitimate reporting-manager association is never wiped by
-- mistake, and no other historical attendance data (check-in/out times,
-- GPS, assignment/client/work info, notes, attendance_type, or any other
-- column) is touched — only reporting_manager_id is set to NULL.
--
-- Idempotent: a row already corrected has reporting_manager_id = NULL,
-- which can never match the `IN (...)` subquery below (NULL IN (...) is
-- never true), so re-running this migration finds zero rows on any
-- subsequent run.
--
-- 00025/00026 are left unmodified (migration history is append-only) —
-- this is a forward-only data correction, not a schema change. The
-- existing set_attendance_updated_at trigger will bump updated_at on the
-- affected rows, same as any other UPDATE to this table.
-- ============================================================================

update attendance_records
set reporting_manager_id = null
where attendance_date = '2026-09-02'
  and reporting_manager_id in (
    select id from profiles where role in ('article', 'intern')
  );
