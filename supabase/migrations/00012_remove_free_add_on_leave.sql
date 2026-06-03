-- ============================================================
-- MIGRATION 00012: Remove free-state, add on-leave article list
-- ============================================================
-- WHAT CHANGES:
--
--   1. DROP get_free_articles — "free" concept removed entirely.
--
--   2. UPDATE get_dashboard_summary — remove free_articles_today key.
--      Returns json so CREATE OR REPLACE works without a DROP.
--      Remaining keys: active_articles_today, on_leave_today,
--      flagged_attendance, open_checkins.
--
--   3. ADD get_on_leave_articles — returns article names on leave
--      today (IST) for the Article Status ON LEAVE column.
-- ============================================================


-- ============================================================
-- 1. Drop free articles function
-- ============================================================
drop function if exists public.get_free_articles();


-- ============================================================
-- 2. Remove free_articles_today from dashboard summary
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


-- ============================================================
-- 3. Add get_on_leave_articles
--    Returns active articles with a leave record for today (IST).
-- ============================================================
create or replace function public.get_on_leave_articles()
returns table (
  article_id   uuid,
  article_name text
)
language plpgsql
security definer
stable
as $$
declare
  today date;
begin
  if not public.is_elevated_caller() then
    raise exception 'Access denied: elevated role required';
  end if;

  today := (current_timestamp at time zone 'Asia/Kolkata')::date;

  return query
  select
    p.id        as article_id,
    p.full_name as article_name
  from profiles p
  join leave_records lr on lr.article_id = p.id
  where lr.leave_date = today
    and p.status = 'active'
  order by p.full_name;
end;
$$;
