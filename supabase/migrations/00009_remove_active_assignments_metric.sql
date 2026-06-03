-- ============================================================
-- MIGRATION 00009: Remove active_assignments metric
-- ============================================================
-- The "active_assignments" key is removed from get_dashboard_summary.
-- Assignments are permanent reusable entities — the count of
-- non-archived assignments is operationally meaningless as a KPI.
--
-- get_dashboard_summary returns json (not TABLE), so
-- CREATE OR REPLACE FUNCTION works without a DROP.
-- ============================================================

create or replace function public.get_dashboard_summary()
returns json
language plpgsql
security definer
stable
as $$
declare
  result json;
  today  date;
begin
  if not public.is_elevated_caller() then
    raise exception 'Access denied: elevated role required';
  end if;

  today := (current_timestamp at time zone 'Asia/Kolkata')::date;

  select json_build_object(
    'active_articles_today',
    (
      select count(distinct article_id)
      from attendance_records
      where attendance_date = today
        and checked_in_at is not null
    ),

    'free_articles_today',
    (
      select count(*)
      from profiles p
      where p.role = 'article'
        and p.status = 'active'
        and p.id not in (
          select distinct article_id
          from attendance_records
          where attendance_date = today
        )
        and p.id not in (
          select article_id from leave_records where leave_date = today
        )
    ),

    'on_leave_today',
    (
      select count(*) from leave_records where leave_date = today
    ),

    'flagged_attendance',
    (
      select count(*)
      from attendance_records
      where flagged_for_review = true
        and reviewed_at is null
    ),

    'open_checkins',
    (
      select count(*)
      from attendance_records
      where attendance_date = today
        and checked_in_at is not null
        and checked_out_at is null
    )
  ) into result;

  return result;
end;
$$;
