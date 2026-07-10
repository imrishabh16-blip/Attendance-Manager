-- ============================================================================
-- MIGRATION 00022: Add "intern" role
-- ============================================================================
-- Introduces a new user_role value, "intern", which behaves identically to
-- "article" everywhere in the application. No existing rows are modified —
-- this migration only adds the enum value and updates the one database
-- function that filtered on role = 'article' explicitly.
--
-- WHY ONLY ONE FUNCTION NEEDS CHANGING:
--   get_dashboard_summary, get_live_activity, get_on_leave_articles, and
--   get_attendance_export all count/join attendance_records or leave_records
--   without filtering on profiles.role at all — they already include any
--   role transparently. Only get_awol_articles explicitly filters
--   `where p.role = 'article'`, which would wrongly exclude interns from the
--   AWOL list, so it is redefined below to check both roles.
--
-- NOTE ON TRANSACTION SAFETY: ALTER TYPE ... ADD VALUE cannot be used in the
-- same transaction that also reads/writes that value via a directly-planned
-- query. The CREATE OR REPLACE FUNCTION below only stores the literal
-- 'intern' inside a PL/pgSQL function body — it is not planned/executed until
-- the function is called later, after this migration has committed — so it is
-- safe to include in the same file.
-- ============================================================================

alter type user_role add value if not exists 'intern';


-- ============================================================================
-- Redefine get_awol_articles to include interns alongside articles.
-- Logic unchanged other than the role filter.
-- ============================================================================
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
  where p.role in ('article', 'intern')
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
