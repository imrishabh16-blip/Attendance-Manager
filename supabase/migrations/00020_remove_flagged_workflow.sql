-- Migration 00020: Remove the Flagged Records review workflow
--
-- Business process change: the "Others" check-in option has been removed.
-- Articles now select only existing clients; missing clients are added by
-- HR/Admin out-of-band. Nothing gets flagged anymore, so the review workflow
-- and its supporting database objects are obsolete.
--
-- IMPORTANT — this migration touches DEFINITIONS ONLY. It performs no
-- UPDATE/DELETE and does not alter any table or column. Historical attendance
-- rows (including attendance_type = 'others', others_client_name,
-- flagged_for_review, reviewed_*, regularized_*) remain intact and readable.
--
-- Intentionally NOT changed:
--   * get_dashboard_summary() — left as-is; its unused flagged_attendance
--     field stays in the returned JSON (optimizing for stability).
--   * attendance_type enum — the 'others' value is retained for historical rows.
--   * All attendance_records columns — retained for historical data.

-- 1. Drop the flagged-records review RPC (added in 00013). Its only caller,
--    the /flagged admin page, has been removed.
DROP FUNCTION IF EXISTS public.get_flagged_records();

-- 2. Drop the partial index that only accelerated flagged-record queries
--    (added in 00001). No remaining query filters on flagged_for_review.
DROP INDEX IF EXISTS idx_attendance_flagged;
