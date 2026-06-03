-- ============================================================
-- MIGRATION 00008: Stabilization — security + IST timezone fixes
-- ============================================================
-- WHAT CHANGES:
--
--   SECURITY: Several SECURITY DEFINER RPCs were callable by any
--   authenticated user (including articles) directly via supabase.rpc().
--   This migration adds explicit role checks inside each sensitive
--   function so articles cannot access firm-wide reports, GPS data,
--   or other users' attendance information.
--
--   IST TIMEZONE: Dashboard date queries used `current_date` (UTC).
--   For IST (UTC+5:30), this gives the wrong date between midnight
--   and 05:30 AM IST. All date-sensitive queries now use:
--     (current_timestamp at time zone 'Asia/Kolkata')::date
--
--   MIGRATION SAFETY: This migration drops all five affected functions
--   before recreating them, avoiding the PostgreSQL restriction that
--   prevents CREATE OR REPLACE from changing TABLE return column sets.
--   Safe to run even if 00007 previously failed or was partially applied.
--
-- FUNCTIONS UPDATED:
--   1. get_dashboard_summary      — IST date + elevated-only access
--   2. get_live_activity          — IST date + elevated-only access
--   3. get_workload_distribution  — elevated-only access
--   4. get_attendance_export      — elevated-only access
--   5. get_assignment_activity_export — elevated-only access
-- ============================================================


-- ============================================================
-- Helper: is the current caller an elevated role?
-- Used inside security definer functions where auth.uid() is valid.
-- ============================================================
create or replace function public.is_elevated_caller()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'manager', 'partner')
      and status = 'active'
  )
$$;


-- ============================================================
-- Drop all affected functions before recreating (migration safety).
-- Required because TABLE return-column changes need a full DROP.
-- ============================================================
drop function if exists public.get_dashboard_summary();
drop function if exists public.get_live_activity();
drop function if exists public.get_workload_distribution();
drop function if exists public.get_attendance_export(date, date, uuid);
drop function if exists public.get_assignment_activity_export();


-- ============================================================
-- 1. get_dashboard_summary
--    - Elevated role only
--    - IST timezone for today's date
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
  -- Security: only admin / manager / partner may call this
  if not public.is_elevated_caller() then
    raise exception 'Access denied: elevated role required';
  end if;

  -- IST date — current_date uses server UTC, wrong for India after midnight
  today := (current_timestamp at time zone 'Asia/Kolkata')::date;

  select json_build_object(
    'active_assignments',
    (
      select count(*) from assignments where status = 'active'
    ),

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


-- ============================================================
-- 2. get_live_activity
--    - Elevated role only
--    - IST timezone for today's date filter
-- ============================================================
create or replace function public.get_live_activity()
returns table (
  article_id    uuid,
  article_name  text,
  assignment_id uuid,
  client_name   text,
  work_type     work_type,
  checked_in_at timestamptz,
  duration_mins integer,
  record_id     uuid
)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_elevated_caller() then
    raise exception 'Access denied: elevated role required';
  end if;

  return query
  select
    p.id                                                              as article_id,
    p.full_name                                                       as article_name,
    a.id                                                              as assignment_id,
    coalesce(a.client_name, 'Others')                                 as client_name,
    a.work_type,
    ar.checked_in_at,
    extract(epoch from (now() - ar.checked_in_at))::integer / 60      as duration_mins,
    ar.id                                                             as record_id
  from attendance_records ar
  join profiles p on p.id = ar.article_id
  left join assignments a on a.id = ar.assignment_id
  where ar.attendance_date = (current_timestamp at time zone 'Asia/Kolkata')::date
    and ar.checked_in_at is not null
    and ar.checked_out_at is null
  order by ar.checked_in_at;
end;
$$;


-- ============================================================
-- 3. get_workload_distribution
--    - Elevated role only
--    - No cycle dependency
-- ============================================================
create or replace function public.get_workload_distribution()
returns table (
  assignment_id     uuid,
  client_name       text,
  work_type         work_type,
  total_days        bigint,
  total_hours       numeric,
  articles_involved bigint,
  last_activity     date
)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_elevated_caller() then
    raise exception 'Access denied: elevated role required';
  end if;

  return query
  select
    a.id                                                              as assignment_id,
    a.client_name,
    a.work_type,
    count(distinct ar.attendance_date)                                 as total_days,
    coalesce(
      round(
        sum(
          extract(epoch from (ar.checked_out_at - ar.checked_in_at))
        ) / 3600.0,
        2
      ),
      0
    )                                                                  as total_hours,
    count(distinct ar.article_id)                                      as articles_involved,
    max(ar.attendance_date)                                            as last_activity
  from assignments a
  left join attendance_records ar
    on ar.assignment_id = a.id
    and ar.checked_out_at is not null
  where a.status = 'active'
  group by a.id, a.client_name, a.work_type
  order by last_activity desc nulls last;
end;
$$;


-- ============================================================
-- 4. get_attendance_export
--    - Elevated role only
--    - No cycle_id column
-- ============================================================
create or replace function public.get_attendance_export(
  p_start_date date,
  p_end_date   date,
  p_article_id uuid default null
)
returns table (
  article_name          text,
  assignment_label      text,
  work_type_label       text,
  attendance_date       date,
  checked_in_at         timestamptz,
  checked_out_at        timestamptz,
  duration_hours        numeric,
  check_in_lat          numeric,
  check_in_lng          numeric,
  check_out_lat         numeric,
  check_out_lng         numeric,
  maps_link_in          text,
  maps_link_out         text,
  note                  text,
  attendance_type_label text,
  others_client_name    text,
  regularized           boolean
)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_elevated_caller() then
    raise exception 'Access denied: elevated role required';
  end if;

  return query
  select
    p.full_name                                                         as article_name,
    coalesce(a.client_name || ' — ' || a.work_type::text, 'Others')    as assignment_label,
    coalesce(a.work_type::text, 'N/A')                                  as work_type_label,
    ar.attendance_date,
    ar.checked_in_at,
    ar.checked_out_at,
    case
      when ar.checked_in_at is not null and ar.checked_out_at is not null
      then round(
        extract(epoch from (ar.checked_out_at - ar.checked_in_at)) / 3600.0,
        2
      )
      else null
    end                                                                  as duration_hours,
    ar.checked_in_lat                                                    as check_in_lat,
    ar.checked_in_lng                                                    as check_in_lng,
    ar.checked_out_lat                                                   as check_out_lat,
    ar.checked_out_lng                                                   as check_out_lng,
    case
      when ar.checked_in_lat is not null
      then 'https://maps.google.com/?q='
           || ar.checked_in_lat::text || ',' || ar.checked_in_lng::text
      else null
    end                                                                  as maps_link_in,
    case
      when ar.checked_out_lat is not null
      then 'https://maps.google.com/?q='
           || ar.checked_out_lat::text || ',' || ar.checked_out_lng::text
      else null
    end                                                                  as maps_link_out,
    ar.note,
    ar.attendance_type::text                                             as attendance_type_label,
    ar.others_client_name,
    ar.regularized
  from attendance_records ar
  join profiles p on p.id = ar.article_id
  left join assignments a on a.id = ar.assignment_id
  where ar.attendance_date between p_start_date and p_end_date
    and (p_article_id is null or ar.article_id = p_article_id)
  order by ar.attendance_date, p.full_name, ar.checked_in_at;
end;
$$;


-- ============================================================
-- 5. get_assignment_activity_export
--    - Elevated role only
--    - No cycle columns
-- ============================================================
create or replace function public.get_assignment_activity_export()
returns table (
  client_name        text,
  work_type_label    text,
  total_days         bigint,
  total_hours        numeric,
  articles_involved  bigint,
  first_attendance   date,
  last_attendance    date,
  assignment_status  text
)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_elevated_caller() then
    raise exception 'Access denied: elevated role required';
  end if;

  return query
  select
    a.client_name,
    a.work_type::text                                              as work_type_label,
    count(distinct ar.attendance_date)                              as total_days,
    coalesce(
      round(
        sum(
          extract(epoch from (ar.checked_out_at - ar.checked_in_at))
        ) / 3600.0,
        2
      ),
      0
    )                                                              as total_hours,
    count(distinct ar.article_id)                                   as articles_involved,
    min(ar.attendance_date)                                         as first_attendance,
    max(ar.attendance_date)                                         as last_attendance,
    a.status::text                                                 as assignment_status
  from assignments a
  left join attendance_records ar
    on ar.assignment_id = a.id
    and ar.checked_out_at is not null
  group by a.id, a.client_name, a.work_type, a.status
  order by a.client_name;
end;
$$;
