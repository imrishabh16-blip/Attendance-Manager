-- ============================================================
-- MIGRATION 00014: Production Schema Alignment
-- ============================================================
-- Fixes six schema-drift issues from iterative development.
-- Every statement is idempotent — safe to re-run on an
-- existing dev database or apply to a fresh production one.
--
-- CHANGES:
--   1. Add 'unallocated' to attendance_type enum
--   2. Change assignments.work_type from enum to text
--   3. Create clients table
--   4. Create work_types table + seed data
--   5. Enable RLS + policies for clients and work_types
--   6. Add leave_records to Supabase Realtime publication
-- ============================================================


-- ============================================================
-- 1. Add 'unallocated' to attendance_type enum
-- ============================================================
alter type attendance_type add value if not exists 'unallocated';


-- ============================================================
-- 2. Change assignments.work_type from enum to text
-- ============================================================
-- Skipped if the column is already text (handles re-runs and
-- databases where this was applied manually).
do $$
begin
  if exists (
    select 1
    from   information_schema.columns
    where  table_schema = 'public'
      and  table_name   = 'assignments'
      and  column_name  = 'work_type'
      and  data_type   != 'text'
  ) then
    alter table assignments
      alter column work_type type text using work_type::text;
  end if;
end;
$$;


-- ============================================================
-- 3. Create clients table
-- ============================================================
create table if not exists clients (
  id         uuid        primary key default uuid_generate_v4(),
  name       text        not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_clients_name on clients(name);

-- Ensure a unique index exists whether the table was just created
-- or already existed without one. ON CONFLICT (name) resolves
-- against unique indexes the same as unique constraints.
create unique index if not exists clients_name_key on clients(name);


-- ============================================================
-- 4. Create work_types table + seed data
-- ============================================================
create table if not exists work_types (
  id         uuid        primary key default uuid_generate_v4(),
  name       text        not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_work_types_name on work_types(name);

-- Ensure a unique index exists on both new and pre-existing tables.
create unique index if not exists work_types_name_key on work_types(name);

-- Seed with original enum values. ON CONFLICT requires the unique
-- constraint above to exist first (guaranteed by the ALTER TABLE above).
insert into work_types (name) values
  ('Internal Audit'),
  ('Statutory Audit'),
  ('Tax Audit'),
  ('GST Compliance'),
  ('GST Litigation'),
  ('Income Tax Compliance'),
  ('Income Tax Litigation'),
  ('Others')
on conflict (name) do nothing;


-- ============================================================
-- 5. Enable RLS and policies for clients and work_types
-- ============================================================
alter table clients    enable row level security;
alter table work_types enable row level security;

drop policy if exists "clients: active users read"    on clients;
drop policy if exists "clients: elevated write"        on clients;
drop policy if exists "work_types: active users read"  on work_types;
drop policy if exists "work_types: elevated write"     on work_types;

create policy "clients: active users read"
  on clients for select
  using (current_user_status() = 'active');

create policy "clients: elevated write"
  on clients for all
  using (is_elevated())
  with check (is_elevated());

create policy "work_types: active users read"
  on work_types for select
  using (current_user_status() = 'active');

create policy "work_types: elevated write"
  on work_types for all
  using (is_elevated())
  with check (is_elevated());


-- ============================================================
-- 6. Add leave_records to Supabase Realtime publication
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table leave_records;
exception when duplicate_object then
  null;
end;
$$;
