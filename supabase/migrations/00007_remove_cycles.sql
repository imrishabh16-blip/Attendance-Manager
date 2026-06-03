-- ============================================================
-- MIGRATION 00007: Remove cycle lifecycle from application layer
-- ============================================================
-- WHAT CHANGES:
--   The assignment_cycles, inactivity_alerts tables are KEPT in
--   the database for historical data preservation. They are simply
--   no longer used by the application.
--
-- The attendance model is simplified:
--   attendance_records.cycle_id is already nullable — no schema change.
--   New check-ins will have cycle_id = NULL going forward.
--
-- DATABASE FUNCTIONS UPDATED:
--   1. get_dashboard_summary      — remove active_cycles, inactive_cycle_alerts
--   2. get_workload_distribution  — base on attendance_records directly (no cycles)
--   3. get_attendance_export      — remove cycle_id column
--   4. get_assignment_activity_export — simplify without cycles
--
-- DATABASE FUNCTIONS DROPPED:
--   5. check_cycle_inactivity     — no longer called
-- ============================================================


-- ============================================================
-- 1. get_dashboard_summary (remove cycle metrics)
-- ============================================================
create or replace function get_dashboard_summary()
returns json
language plpgsql
security definer
stable
as $$
declare
  result json;
  today  date := current_date;
begin
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
-- 2. get_workload_distribution (attendance-based, no cycles)
-- ============================================================
-- Must DROP first: return columns changed from 00003 version.
-- CREATE OR REPLACE cannot change TABLE return type signatures.
drop function if exists public.get_workload_distribution();
create or replace function get_workload_distribution()
returns table (
  assignment_id     uuid,
  client_name       text,
  work_type         work_type,
  total_days        bigint,
  total_hours       numeric,
  articles_involved bigint,
  last_activity     date
)
language sql
security definer
stable
as $$
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
$$;


-- ============================================================
-- 3. get_attendance_export (remove cycle_id column)
-- ============================================================
-- Must DROP first: cycle_id column removed from TABLE return type.
drop function if exists public.get_attendance_export(date, date, uuid);
create or replace function get_attendance_export(
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
language sql
security definer
stable
as $$
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
$$;


-- ============================================================
-- 4. get_assignment_activity_export (simplified, no cycles)
-- ============================================================
-- Must DROP first: TABLE return columns changed from 00003 version.
drop function if exists public.get_assignment_activity_export();
create or replace function get_assignment_activity_export()
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
language sql
security definer
stable
as $$
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
$$;


-- ============================================================
-- 5. Drop check_cycle_inactivity (no longer needed)
-- ============================================================
drop function if exists check_cycle_inactivity();


-- ============================================================
-- NOTES ON PRESERVED TABLES
-- The following tables are intentionally kept for data history:
--   - assignment_cycles     (historical cycle records)
--   - inactivity_alerts     (historical alert records)
-- They are no longer written to by the application.
-- They may be safely dropped in a future cleanup migration
-- once historical data is no longer needed.
-- ============================================================
