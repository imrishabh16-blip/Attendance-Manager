-- ============================================================
-- MIGRATION 00018: Add leave_type to leave_records
-- ============================================================
-- WHAT CHANGES:
--
--   1. ADD leave_type column — full_day | first_half | second_half
--      Existing rows receive 'full_day' automatically via DEFAULT.
--      UNIQUE(article_id, leave_date) constraint preserved.
--
--   2. DROP + CREATE get_on_leave_articles()
--      Return signature changes (adds leave_type column).
--      CREATE OR REPLACE cannot change return type, so DROP first.
-- ============================================================


-- ============================================================
-- 1. Add leave_type column
-- ============================================================
alter table public.leave_records
  add column if not exists leave_type text not null default 'full_day'
  constraint leave_records_leave_type_check
  check (leave_type in ('full_day', 'first_half', 'second_half'));


-- ============================================================
-- 2. Update get_on_leave_articles() to return leave_type
-- ============================================================
drop function if exists public.get_on_leave_articles();

create function public.get_on_leave_articles()
returns table (
  article_id   uuid,
  article_name text,
  leave_type   text
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
    p.id          as article_id,
    p.full_name   as article_name,
    lr.leave_type as leave_type
  from profiles p
  join leave_records lr on lr.article_id = p.id
  where lr.leave_date = today
    and p.status = 'active'
  order by p.full_name;
end;
$$;
