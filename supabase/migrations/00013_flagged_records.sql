-- ============================================================
-- MIGRATION 00013: Flagged Records Review RPC
-- ============================================================
-- Adds get_flagged_records() — returns all attendance records
-- that are currently flagged (pending) or were previously
-- resolved (reviewed_at IS NOT NULL), with joined context:
-- article name, assignment details, reviewer name.
--
-- Security: elevated role only (admin / partner / manager).
-- ============================================================

create or replace function public.get_flagged_records()
returns table (
  record_id          uuid,
  article_id         uuid,
  article_name       text,
  attendance_date    date,
  checked_in_at      timestamptz,
  checked_out_at     timestamptz,
  attendance_type    attendance_type,
  others_client_name text,
  assignment_id      uuid,
  client_name        text,
  work_type          text,
  flagged_for_review boolean,
  reviewed_at        timestamptz,
  reviewed_by_name   text
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
    ar.id                 as record_id,
    ar.article_id,
    p.full_name           as article_name,
    ar.attendance_date,
    ar.checked_in_at,
    ar.checked_out_at,
    ar.attendance_type,
    ar.others_client_name,
    ar.assignment_id,
    a.client_name,
    a.work_type::text      as work_type,
    ar.flagged_for_review,
    ar.reviewed_at,
    rp.full_name          as reviewed_by_name
  from attendance_records ar
  join  profiles p   on p.id  = ar.article_id
  left join assignments a   on a.id  = ar.assignment_id
  left join profiles rp     on rp.id = ar.reviewed_by
  where ar.flagged_for_review = true
     or ar.reviewed_at is not null
  order by
    ar.flagged_for_review desc,
    ar.attendance_date    desc,
    ar.checked_in_at      desc;
end;
$$;
