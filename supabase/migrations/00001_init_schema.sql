-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
-- pg_trgm must be created here, before the trigram index on assignments.client_name
create extension if not exists "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================
create type user_role as enum ('article', 'manager', 'partner', 'admin');

create type user_status as enum ('pending', 'active', 'deactivated');

create type work_type as enum (
  'Internal Audit',
  'Statutory Audit',
  'Tax Audit',
  'GST Compliance',
  'GST Litigation',
  'Income Tax Compliance',
  'Income Tax Litigation',
  'Others'
);

create type assignment_status as enum ('active', 'archived');

create type cycle_status as enum ('active', 'closed');

create type attendance_type as enum ('regular', 'others');

-- ============================================================
-- PROFILES
-- Auto-created via trigger when a new Google SSO user signs in.
-- 1:1 with auth.users.
-- ============================================================
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique,
  full_name      text not null,
  role           user_role not null default 'article',
  status         user_status not null default 'pending',
  approved_by    uuid references profiles(id),
  approved_at    timestamptz,
  deactivated_by uuid references profiles(id),
  deactivated_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_profiles_status on profiles(status);
create index idx_profiles_role   on profiles(role);
create index idx_profiles_email  on profiles(email);

-- ============================================================
-- ASSIGNMENTS
-- Persistent client/work entities — archived, never deleted.
-- ============================================================
create table assignments (
  id           uuid primary key default uuid_generate_v4(),
  client_name  text not null,
  work_type    work_type not null,
  status       assignment_status not null default 'active',
  notes        text,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles(id)
);

create index idx_assignments_status    on assignments(status);
create index idx_assignments_work_type on assignments(work_type);
-- Supports the assignment search typeahead (ILIKE queries)
create index idx_assignments_client_trgm on assignments using gin (client_name gin_trgm_ops);

-- ============================================================
-- ASSIGNMENT CYCLES
-- One active cycle per assignment enforced by partial unique index.
-- ============================================================
create table assignment_cycles (
  id            uuid primary key default uuid_generate_v4(),
  assignment_id uuid not null references assignments(id) on delete restrict,
  status        cycle_status not null default 'active',
  started_at    timestamptz not null default now(),
  started_by    uuid not null references profiles(id),
  ended_at      timestamptz,
  ended_by      uuid references profiles(id),
  notes         text,
  created_at    timestamptz not null default now()
);

-- This is the critical constraint: exactly one active cycle per assignment
create unique index idx_cycles_one_active_per_assignment
  on assignment_cycles(assignment_id)
  where status = 'active';

create index idx_cycles_assignment_id on assignment_cycles(assignment_id);
create index idx_cycles_status        on assignment_cycles(status);
create index idx_cycles_started_at    on assignment_cycles(started_at);

-- ============================================================
-- ATTENDANCE RECORDS
-- Each row represents one check-in/check-out session.
-- An article can have multiple rows per day.
-- ============================================================
create table attendance_records (
  id                    uuid primary key default uuid_generate_v4(),
  article_id            uuid not null references profiles(id) on delete restrict,
  assignment_id         uuid references assignments(id) on delete restrict,
  cycle_id              uuid references assignment_cycles(id) on delete restrict,
  attendance_date       date not null default current_date,
  checked_in_at         timestamptz,
  checked_in_lat        numeric(10, 7),
  checked_in_lng        numeric(10, 7),
  checked_out_at        timestamptz,
  checked_out_lat       numeric(10, 7),
  checked_out_lng       numeric(10, 7),
  note                  text,
  attendance_type       attendance_type not null default 'regular',
  others_client_name    text,
  flagged_for_review    boolean not null default false,
  reviewed_by           uuid references profiles(id),
  reviewed_at           timestamptz,
  regularized           boolean not null default false,
  regularized_by        uuid references profiles(id),
  regularized_at        timestamptz,
  regularization_note   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_attendance_article_id    on attendance_records(article_id);
create index idx_attendance_date          on attendance_records(attendance_date);
create index idx_attendance_assignment_id on attendance_records(assignment_id);
create index idx_attendance_cycle_id      on attendance_records(cycle_id);
create index idx_attendance_flagged       on attendance_records(flagged_for_review)
  where flagged_for_review = true;
-- Most common dashboard sub-query pattern
create index idx_attendance_article_date
  on attendance_records(article_id, attendance_date desc);

-- ============================================================
-- LEAVE RECORDS
-- Simple: one row per article per leave date.
-- ============================================================
create table leave_records (
  id          uuid primary key default uuid_generate_v4(),
  article_id  uuid not null references profiles(id) on delete restrict,
  leave_date  date not null,
  note        text,
  created_at  timestamptz not null default now(),
  unique(article_id, leave_date)
);

create index idx_leave_article_id on leave_records(article_id);
create index idx_leave_date       on leave_records(leave_date);

-- ============================================================
-- INACTIVITY ALERTS
-- System-generated suggestions for admin when a cycle has had
-- no attendance for 7+ days. Never triggers auto-close.
-- ============================================================
create table inactivity_alerts (
  id                 uuid primary key default uuid_generate_v4(),
  cycle_id           uuid not null references assignment_cycles(id) on delete cascade,
  assignment_id      uuid not null references assignments(id) on delete cascade,
  last_activity_date date not null,
  days_inactive      integer not null,
  dismissed          boolean not null default false,
  dismissed_by       uuid references profiles(id),
  dismissed_at       timestamptz,
  created_at         timestamptz not null default now()
);

create index idx_alerts_cycle_id  on inactivity_alerts(cycle_id);
create index idx_alerts_dismissed on inactivity_alerts(dismissed)
  where dismissed = false;

-- ============================================================
-- AUDIT LOG
-- Immutable append-only log. No RLS update/delete policies.
-- ============================================================
create table audit_log (
  id          uuid primary key default uuid_generate_v4(),
  actor_id    uuid not null references profiles(id),
  action      text not null,
  target_type text,
  target_id   uuid,
  payload     jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index idx_audit_actor   on audit_log(actor_id);
create index idx_audit_action  on audit_log(action);
create index idx_audit_target  on audit_log(target_type, target_id);
create index idx_audit_created on audit_log(created_at desc);
