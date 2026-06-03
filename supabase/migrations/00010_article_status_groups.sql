-- ============================================================
-- MIGRATION 00010: Article Status Groups
-- ============================================================
-- WHAT CHANGES:
--
--   1. DROP get_workload_distribution — no longer used by the dashboard.
--      The Assignment Activity widget (workload aggregation) is replaced by
--      a per-article status widget (ASSIGNED / UNALLOCATED / FREE).
--
--   2. REPLACE get_live_activity — adds `attendance_type` column so the
--      frontend can categorise rows into ASSIGNED vs UNALLOCATED without
--      a second query. Return type changes require a DROP + recreate.
--
--   3. ADD get_free_articles — returns active articles not checked in
--      and not on leave today (IST). Drives the FREE column of the widget.
-- ============================================================


-- ============================================================
-- 1. Drop obsolete workload distribution function
-- ============================================================
drop function if exists public.get_workload_distribution();


-- ============================================================
-- 2. Recreate get_live_activity with attendance_type column
--    (TABLE return type change requires DROP before recreate)
-- ============================================================
drop function if exists public.get_live_activity();

create or replace function public.get_live_activity()
returns table (
  article_id      uuid,
  article_name    text,
  assignment_id   uuid,
  client_name     text,
  work_type       work_type,
  checked_in_at   timestamptz,
  duration_mins   integer,
  record_id       uuid,
  attendance_type attendance_type
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
    ar.id                                                             as record_id,
    ar.attendance_type
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
-- 3. Add get_free_articles
--    Returns active articles not checked in and not on leave today (IST).
-- ============================================================
create or replace function public.get_free_articles()
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
  where p.role = 'article'
    and p.status = 'active'
    and p.id not in (
      select distinct article_id
      from attendance_records
      where attendance_date = today
        and checked_in_at is not null
    )
    and p.id not in (
      select article_id from leave_records where leave_date = today
    )
  order by p.full_name;
end;
$$;
