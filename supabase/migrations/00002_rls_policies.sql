-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
alter table profiles            enable row level security;
alter table assignments         enable row level security;
alter table assignment_cycles   enable row level security;
alter table attendance_records  enable row level security;
alter table leave_records       enable row level security;
alter table inactivity_alerts   enable row level security;
alter table audit_log           enable row level security;

-- ============================================================
-- HELPER FUNCTIONS
-- security definer + stable = cached per transaction, fast
-- ============================================================
create or replace function current_user_role()
returns user_role
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function current_user_status()
returns user_status
language sql
security definer
stable
as $$
  select status from profiles where id = auth.uid()
$$;

create or replace function is_elevated()
returns boolean
language sql
security definer
stable
as $$
  select current_user_role() in ('admin', 'partner', 'manager')
$$;

-- ============================================================
-- PROFILES POLICIES
-- ============================================================

-- Any authenticated user can read their own profile (status polling)
create policy "profiles: self read"
  on profiles for select
  using (id = auth.uid());

-- Elevated users can read all profiles (dashboard, user management)
create policy "profiles: elevated read all"
  on profiles for select
  using (is_elevated());

-- Admin can update any profile (approve, deactivate, change role)
create policy "profiles: admin update"
  on profiles for update
  using (current_user_role() = 'admin');

-- ============================================================
-- ASSIGNMENTS POLICIES
-- ============================================================

-- Active users can search and select active assignments at check-in
create policy "assignments: active users read active"
  on assignments for select
  using (
    current_user_status() = 'active'
    and status = 'active'
  );

-- Elevated users can read everything including archived
create policy "assignments: elevated read all"
  on assignments for select
  using (is_elevated());

create policy "assignments: elevated insert"
  on assignments for insert
  with check (is_elevated());

create policy "assignments: elevated update"
  on assignments for update
  using (is_elevated());

-- No delete policy — archive via status='archived' only

-- ============================================================
-- ASSIGNMENT CYCLES POLICIES
-- ============================================================

-- Active users can read all cycles (needed to check if active cycle exists)
create policy "cycles: active users read"
  on assignment_cycles for select
  using (current_user_status() = 'active');

-- Active articles (and elevated) can start new cycles
create policy "cycles: active users insert"
  on assignment_cycles for insert
  with check (
    current_user_status() = 'active'
    and started_by = auth.uid()
    and status = 'active'
  );

-- Only elevated roles can close cycles (update status to 'closed')
create policy "cycles: elevated update (close)"
  on assignment_cycles for update
  using (is_elevated());

-- ============================================================
-- ATTENDANCE RECORDS POLICIES
-- ============================================================

-- Articles see only their own records
create policy "attendance: articles see own"
  on attendance_records for select
  using (article_id = auth.uid());

-- Elevated see everything
create policy "attendance: elevated see all"
  on attendance_records for select
  using (is_elevated());

-- Active articles can insert their own records
create policy "attendance: articles insert own"
  on attendance_records for insert
  with check (
    article_id = auth.uid()
    and current_user_status() = 'active'
  );

-- Articles can update their own still-open record (checkout, add note)
create policy "attendance: articles update open record"
  on attendance_records for update
  using (
    article_id = auth.uid()
    and checked_out_at is null
  )
  with check (article_id = auth.uid());

-- Elevated can update any record (regularization, flagged review)
create policy "attendance: elevated update"
  on attendance_records for update
  using (is_elevated());

-- ============================================================
-- LEAVE RECORDS POLICIES
-- ============================================================

create policy "leave: articles see own"
  on leave_records for select
  using (article_id = auth.uid());

create policy "leave: elevated see all"
  on leave_records for select
  using (is_elevated());

create policy "leave: articles insert own"
  on leave_records for insert
  with check (
    article_id = auth.uid()
    and current_user_status() = 'active'
  );

-- Articles can cancel their own leave by deleting the record
create policy "leave: articles delete own"
  on leave_records for delete
  using (article_id = auth.uid());

-- ============================================================
-- INACTIVITY ALERTS POLICIES
-- ============================================================

-- Only elevated roles interact with alerts
create policy "alerts: elevated full access"
  on inactivity_alerts for all
  using (is_elevated())
  with check (is_elevated());

-- ============================================================
-- AUDIT LOG POLICIES
-- ============================================================

-- Admin can read audit log; no one can update/delete via client
create policy "audit: admin read"
  on audit_log for select
  using (current_user_role() = 'admin');

-- Inserts happen exclusively via service-role in API routes
-- No client-side insert policy intentionally
