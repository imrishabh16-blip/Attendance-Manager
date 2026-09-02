-- ============================================================================
-- MIGRATION 00025: Reporting Manager moves to the attendance session
-- ============================================================================
-- Supersedes the administratively-maintained relationship introduced in
-- migration 00024 (reporting_relationships), which modeled Reporting Manager
-- as a standing roster link between profiles. That is the wrong shape: an
-- Article/Intern may report to a different person on different check-ins, so
-- Reporting Manager belongs to the attendance session being created, not
-- permanently to the person.
--
-- 00024 is left in place unedited (migration history is not rewritten). Its
-- effect is reversed here with `drop table if exists ... cascade`, which is
-- safe to run whether or not a given environment ever actually applied it —
-- verified against this project's own production database that it was
-- never applied there (reporting_relationships does not exist), so this is
-- a clean removal with no data-loss risk in this environment.
--
-- WHAT CHANGES:
--   1. attendance_records gets a new nullable reporting_manager_id column —
--      existing rows are untouched (NULL), matching how assignment_id
--      already behaves for historical "unallocated" rows.
--   2. get_live_activity() is extended (drop+recreate, required because
--      CREATE OR REPLACE cannot change a RETURNS TABLE shape — same
--      constraint this project already worked around in 00008/00010/00011)
--      to also expose the reporting manager for each live session.
--   3. A new is_active_caller() helper + get_reporting_manager_candidates()
--      RPC let an Article/Intern see who they can select at check-in.
--      Reporting Manager is explicitly not role-restricted: any ACTIVE
--      profile (any role) other than the caller themselves qualifies. This
--      mirrors is_elevated_caller()'s existing shape, minus the role filter.
--      The candidate list returns only id + full_name — role is not needed
--      by the check-in UI and is not exposed to Article/Intern callers.
--   4. reporting_relationships and its RLS policy are dropped.
--
-- SECURITY DEFINER hardening: every function created or recreated below has
-- its search_path pinned via `alter function ... set search_path = public`,
-- immediately after its definition — the same convention 00021_security_
-- hardening.sql established for every pre-existing SECURITY DEFINER
-- function. This is required here independently of 00021: dropping and
-- recreating get_live_activity() discards whatever config a prior ALTER
-- FUNCTION had set on the old function object, and the two brand-new
-- functions have never had it set at all.
-- ============================================================================

-- ============================================================================
-- 1. attendance_records: reporting_manager_id
-- ============================================================================
alter table attendance_records
  add column reporting_manager_id uuid references profiles(id) on delete restrict;

create index idx_attendance_reporting_manager on attendance_records(reporting_manager_id);


-- ============================================================================
-- 2. get_live_activity — extended with reporting manager info
-- ============================================================================
drop function if exists public.get_live_activity();

create or replace function public.get_live_activity()
returns table (
  article_id              uuid,
  article_name            text,
  assignment_id           uuid,
  client_name             text,
  work_type               text,
  checked_in_at           timestamptz,
  duration_mins           integer,
  record_id               uuid,
  attendance_type         attendance_type,
  reporting_manager_id    uuid,
  reporting_manager_name  text
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
    ar.attendance_type,
    rm.id                                                             as reporting_manager_id,
    rm.full_name                                                      as reporting_manager_name
  from attendance_records ar
  join profiles p on p.id = ar.article_id
  left join assignments a on a.id = ar.assignment_id
  left join profiles rm on rm.id = ar.reporting_manager_id
  where ar.attendance_date = (current_timestamp at time zone 'Asia/Kolkata')::date
    and ar.checked_in_at is not null
    and ar.checked_out_at is null
  order by ar.checked_in_at;
end;
$$;

alter function public.get_live_activity() set search_path = public;


-- ============================================================================
-- 3. Reporting Manager candidate list for check-in — role-agnostic on purpose
-- ============================================================================
create or replace function public.is_active_caller()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
  )
$$;

alter function public.is_active_caller() set search_path = public;

-- Returns only id + full_name — role is deliberately not exposed here (data
-- minimization; the check-in UI has no use for it) and, separately, is never
-- filtered on: any active profile other than the caller is eligible
-- regardless of role. Eligibility is enforced by the WHERE clause below and
-- re-validated independently by the check-in API at submission time — never
-- by what this list happens to contain.
create or replace function public.get_reporting_manager_candidates()
returns table (
  id        uuid,
  full_name text
)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_active_caller() then
    raise exception 'Access denied: active account required';
  end if;

  return query
  select p.id, p.full_name
  from profiles p
  where p.status = 'active'
    and p.id != auth.uid()
  order by p.full_name;
end;
$$;

alter function public.get_reporting_manager_candidates() set search_path = public;


-- ============================================================================
-- 4. Remove the superseded administrative relationship (see header note)
-- ============================================================================
drop table if exists reporting_relationships cascade;
