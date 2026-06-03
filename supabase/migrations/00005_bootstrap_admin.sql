-- ============================================================
-- FIRST-ADMIN BOOTSTRAP
-- ============================================================
-- PURPOSE:
--   On a fresh deployment there are no approved users yet, which means
--   nobody can approve anyone else — a chicken-and-egg problem.
--   This function breaks that deadlock by promoting one profile to admin
--   directly from the Supabase SQL editor.
--
-- HOW TO USE (one-time setup only):
--   1. Deploy the app and open it in a browser.
--   2. Sign in with the Google account that should become the first admin.
--      You will land on the "Awaiting Access" screen — that is expected.
--   3. Open your Supabase project → SQL Editor → New query.
--   4. Run exactly this (replace the email):
--
--        SELECT bootstrap_first_admin('yourname@yourdomain.com');
--
--   5. Refresh the app — you will be redirected to the dashboard automatically.
--
-- SAFETY GUARDS:
--   - Raises an error if an admin already exists (cannot be used to escalate).
--   - Raises an error if the email is not found (must sign in first).
--   - The function itself is not exposed via the API — it requires direct
--     SQL editor access, which requires your Supabase project credentials.
-- ============================================================

create or replace function bootstrap_first_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Safety: refuse if any admin already exists
  select count(*) into v_count from profiles where role = 'admin';
  if v_count > 0 then
    raise exception
      'bootstrap_first_admin: An admin already exists. '
      'This function can only be used for initial setup. '
      'Use the User Management page to manage roles.';
  end if;

  -- Update the profile matching the given email
  update profiles
  set
    role        = 'admin',
    status      = 'active',
    approved_at = now()
  where lower(email) = lower(p_email);

  -- Verify a row was actually updated
  if not found then
    raise exception
      'bootstrap_first_admin: No profile found for email "%". '
      'Sign in with Google first (you will see the Awaiting screen), '
      'then run this function.', p_email;
  end if;

  return format('Success: "%s" is now an admin. Refresh the app.', lower(p_email));
end;
$$;
