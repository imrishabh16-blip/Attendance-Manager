-- ============================================================================
-- MIGRATION 00021: Security hardening (RLS write policies + SECURITY DEFINER search_path)
-- ============================================================================
-- From the final production security audit. No application behavior changes.
--
-- Context: all attendance and leave WRITES go through the server-side
-- service-role API (createAdminClient), which bypasses RLS. The Article-facing
-- INSERT/UPDATE/DELETE RLS policies below were therefore unnecessary AND let an
-- authenticated Article write directly via the browser anon client, bypassing
-- the server-side check-in/check-out/leave business rules (GPS required,
-- one-open-session, leave-conflict, IST date). Removing them closes that path.
--
-- The Article SELECT policies are intentionally KEPT so the /attend UI can
-- still read the user's own attendance/leave (today's log + the
-- post-network-failure verification). Check-in, check-out, and leave continue
-- to work because those routes use the service-role client, not RLS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. attendance_records — remove Article direct INSERT/UPDATE policies
--    (writes are performed exclusively by the service-role check-in/checkout API)
-- ----------------------------------------------------------------------------
drop policy if exists "attendance: articles insert own"        on attendance_records;
drop policy if exists "attendance: articles update open record" on attendance_records;

-- ----------------------------------------------------------------------------
-- 2. leave_records — remove Article direct INSERT/DELETE policies
--    (writes are performed exclusively by the service-role leave API)
-- ----------------------------------------------------------------------------
drop policy if exists "leave: articles insert own"  on leave_records;
drop policy if exists "leave: articles delete own"  on leave_records;

-- Kept intentionally (read paths the UI still needs):
--   attendance_records: "attendance: articles see own", "attendance: elevated see all",
--                       "attendance: elevated update"
--   leave_records:      "leave: articles see own", "leave: elevated see all"


-- ----------------------------------------------------------------------------
-- 3. Pin search_path = public on every SECURITY DEFINER function.
--    Uses ALTER FUNCTION (config only) — the function bodies/logic are NOT
--    touched. Discovered dynamically from pg_proc so it applies to exactly the
--    SECURITY DEFINER functions that currently exist (handles functions dropped
--    in earlier migrations without erroring).
--
--    Expected functions affected:
--      public.current_user_role()
--      public.current_user_status()
--      public.is_elevated()
--      public.is_elevated_caller()
--      public.handle_new_user()                      -- already pinned; reaffirmed
--      public.get_dashboard_summary()
--      public.get_live_activity()
--      public.get_on_leave_articles()
--      public.get_awol_articles()
--      public.get_attendance_export(date, date, uuid)
-- ----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname                                   as schema_name,
           p.proname                                   as func_name,
           pg_get_function_identity_arguments(p.oid)   as arg_list
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public',
      fn.schema_name, fn.func_name, fn.arg_list
    );
    raise notice 'search_path pinned: %.%(%)', fn.schema_name, fn.func_name, fn.arg_list;
  end loop;
end;
$$;
