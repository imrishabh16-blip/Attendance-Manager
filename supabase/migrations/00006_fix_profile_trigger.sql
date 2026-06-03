-- ============================================================
-- FIX: Profile creation trigger
--
-- ROOT CAUSE (three issues in original 00003_functions.sql):
--
--   1. handle_new_user() was defined without explicit schema prefix.
--      Supabase's SQL editor creates it in 'public', but the binding
--      is session-search_path-dependent and not guaranteed.
--
--   2. The trigger referenced the function without schema prefix:
--        execute procedure handle_new_user()
--      When auth.users is written to, the trigger fires under the
--      context of supabase_auth_admin (Supabase's internal auth role).
--      That role resolves unqualified names from the auth schema first,
--      not public — so the function lookup fails silently.
--
--   3. supabase_auth_admin was never explicitly granted EXECUTE on the
--      function. Supabase modifies default privileges on hosted projects,
--      so the implicit PUBLIC grant cannot be relied upon.
--
-- WHY auth.users HAS the row but profiles does NOT:
--   Supabase's auth service catches trigger errors internally and
--   continues the sign-in flow rather than rolling back. The user
--   lands in auth.users but the profile is never created.
-- ============================================================


-- ============================================================
-- STEP 1: Drop old trigger and function (clean slate)
-- ============================================================
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();


-- ============================================================
-- STEP 2: Recreate function with explicit public. schema prefix
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    'article',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ============================================================
-- STEP 3: Grant EXECUTE explicitly to supabase_auth_admin
-- This role fires the trigger when inserting into auth.users.
-- Without this grant the function call fails silently on
-- Supabase hosted projects.
-- ============================================================
grant execute on function public.handle_new_user() to supabase_auth_admin;


-- ============================================================
-- STEP 4: Recreate trigger with fully-qualified function reference
--
-- Key changes vs original:
--   - DROP + CREATE instead of CREATE OR REPLACE (more reliable)
--   - EXECUTE FUNCTION (modern syntax, replaces EXECUTE PROCEDURE)
--   - public.handle_new_user() — explicit schema, no ambiguity
-- ============================================================
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- STEP 5: Repair — create profiles for any auth.users rows
-- that were created before this fix and have no profile row.
--
-- Safe to run multiple times — ON CONFLICT DO NOTHING means
-- existing profiles are never overwritten.
-- ============================================================
insert into public.profiles (id, email, full_name, role, status)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  'article',
  'pending'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
  and u.email is not null;


-- ============================================================
-- STEP 6: Verify — run these SELECT statements to confirm
-- everything is now in order. Expected results are noted.
-- ============================================================

-- Should return 1 row: on_auth_user_created
select tgname, tgenabled
from pg_trigger
where tgname = 'on_auth_user_created';

-- Should return 1 row with proname = handle_new_user
select proname, prosecdef, proowner::regrole
from pg_proc
where proname = 'handle_new_user'
  and pronamespace = 'public'::regnamespace;

-- Should return 0 rows (no auth.users without a profile)
select u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
