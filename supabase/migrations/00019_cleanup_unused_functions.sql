-- Migration 00019: Drop unused database functions
--
-- get_assignment_experience(uuid):
--   Replaced by server-side JS session derivation in assignments/[id]/page.tsx (commit 441f9ad).
--   Zero callers in src/.
--
-- get_assignment_activity_export():
--   Replaced by JS-based session derivation in api/export/assignments/route.ts (commit 441f9ad).
--   Zero callers in src/.
--
-- bootstrap_first_admin(text):
--   One-time deployment utility, fulfilled on initial setup.
--   The production instance has an admin. Keeping a SECURITY DEFINER function with
--   superuser write access to profiles is unnecessary surface after first use.
--   Zero callers in src/.

DROP FUNCTION IF EXISTS public.get_assignment_experience(uuid);
DROP FUNCTION IF EXISTS public.get_assignment_activity_export();
DROP FUNCTION IF EXISTS public.bootstrap_first_admin(text);
