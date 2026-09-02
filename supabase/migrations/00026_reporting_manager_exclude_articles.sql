-- ============================================================================
-- MIGRATION 00026: Exclude Article/Intern from Reporting Manager candidates
-- ============================================================================
-- Fixes a correctness gap in 00025_attendance_reporting_manager.sql: the
-- candidate RPC (and, until this fix, the check-in API) allowed an
-- Article/Intern to be selected as someone else's Reporting Manager. The
-- corrected eligibility rule is:
--
--   active AND not self AND role is NOT article/intern
--
-- Other active roles (manager, partner, admin) remain eligible — this is
-- not a new role hierarchy, just excluding the two roles this codebase
-- already treats as one group. Confirmed the exact, lowercase enum values
-- directly from the schema before writing this filter:
--   00001_init_schema.sql:  create type user_role as enum
--                            ('article', 'manager', 'partner', 'admin');
--   00022_add_intern_role.sql: alter type user_role add value 'intern';
-- These match src/types/app.ts's ARTICLE_ROLES = ['article', 'intern']
-- exactly (same values already used by isArticleRole() elsewhere).
--
-- 00025 is left unmodified (already applied to production; migration
-- history is append-only) — this is a forward-only correction.
--
-- Only get_reporting_manager_candidates() changes, and only its WHERE
-- clause: the RETURNS TABLE shape (id, full_name) is unchanged, so a plain
-- CREATE OR REPLACE is sufficient — no DROP FUNCTION is needed here, unlike
-- get_live_activity() in 00025, which needed one because its column set
-- changed. SET search_path = public is re-asserted explicitly below
-- regardless of whether CREATE OR REPLACE alone would have preserved it,
-- matching this project's existing convention of never leaving that
-- implicit. is_active_caller() is untouched — it only gates who may call
-- this RPC at all, not which rows it returns.
-- ============================================================================

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
    and p.role not in ('article', 'intern')
  order by p.full_name;
end;
$$;

alter function public.get_reporting_manager_candidates() set search_path = public;
