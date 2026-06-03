-- ============================================================
-- MIGRATION 00011: Fix get_live_activity + get_free_articles
-- ============================================================
-- BUG 1 — get_live_activity (error 42804)
--   assignments.work_type is stored as text in this schema, but
--   the RETURNS TABLE declaration said `work_type work_type` (the
--   enum type). PostgreSQL rejects the call with:
--     "Returned type text does not match expected type work_type"
--   Fix: change the return column to `work_type text`.
--
-- BUG 2 — get_free_articles (error 42702)
--   In PL/pgSQL, RETURNS TABLE columns become implicit variables.
--   `article_id` was ambiguous between the return variable and the
--   `attendance_records.article_id` column inside the subquery.
--   Fix: qualify all subquery column references with a table alias.
-- ============================================================


-- ============================================================
-- 1. Fix get_live_activity — work_type text, not enum
-- ============================================================
drop function if exists public.get_live_activity();

create or replace function public.get_live_activity()
returns table (
  article_id      uuid,
  article_name    text,
  assignment_id   uuid,
  client_name     text,
  work_type       text,
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
    a.work_type::text                                                  as work_type,
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
-- 2. Fix get_free_articles — qualify subquery column references
-- ============================================================
drop function if exists public.get_free_articles();

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
      select distinct ar.article_id
      from attendance_records ar
      where ar.attendance_date = today
        and ar.checked_in_at is not null
    )
    and p.id not in (
      select lr.article_id from leave_records lr where lr.leave_date = today
    )
  order by p.full_name;
end;
$$;
