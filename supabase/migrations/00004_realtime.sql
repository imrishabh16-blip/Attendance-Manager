-- ============================================================
-- REALTIME
-- Enable realtime publication on tables used by the dashboard
-- and the article awaiting-approval polling.
-- ============================================================

-- Profiles: needed for the awaiting page to detect approval
alter publication supabase_realtime add table profiles;

-- Attendance records: live activity panel on dashboard
alter publication supabase_realtime add table attendance_records;

-- Cycles: workload distribution updates
alter publication supabase_realtime add table assignment_cycles;

-- Alerts: inactivity alert panel on dashboard
alter publication supabase_realtime add table inactivity_alerts;
