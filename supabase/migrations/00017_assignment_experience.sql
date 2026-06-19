-- ============================================================
-- MIGRATION 00017: get_assignment_experience
-- ============================================================
-- Read-only aggregate function. No table or column changes.
-- Returns per-article attendance summary for a given assignment.
-- Used by the Assignment Detail page (Assignment Experience section).
--
-- Query hits:
--   idx_attendance_records_assignment_id (existing)
--   profiles PK (existing)
-- ============================================================

create or replace function public.get_assignment_experience(p_assignment_id uuid)
returns table (
  article_id     uuid,
  full_name      text,
  total_sessions bigint,
  first_worked   date,
  last_worked    date
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
    ar.article_id,
    p.full_name,
    count(*)::bigint        as total_sessions,
    min(ar.attendance_date) as first_worked,
    max(ar.attendance_date) as last_worked
  from attendance_records ar
  join profiles p on p.id = ar.article_id
  where ar.assignment_id = p_assignment_id
    and ar.checked_in_at is not null
  group by ar.article_id, p.full_name
  order by last_worked desc;
end;
$$;
