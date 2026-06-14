-- ============================================================
-- MIGRATION 00015: Add get_awol_articles
-- ============================================================
-- Returns active article users who have not checked in and
-- have not marked leave for today (IST). Used by the AWOL
-- dashboard section. Mirrors get_on_leave_articles pattern.
-- ============================================================

create or replace function public.get_awol_articles()
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
    -- Exclude anyone who checked in today (even if already checked out)
    and p.id not in (
      select distinct ar.article_id
      from attendance_records ar
      where ar.attendance_date = today
        and ar.checked_in_at is not null
    )
    -- Exclude anyone on leave today
    and p.id not in (
      select lr.article_id from leave_records lr where lr.leave_date = today
    )
  order by p.full_name;
end;
$$;
