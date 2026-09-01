-- ============================================================================
-- MIGRATION 00024: Reporting Managers
-- ============================================================================
-- Introduces the "Reporting Manager" organisational relationship: a
-- many-to-many, self-referencing link between profiles, independent of both
-- role and assignments. A Reporting Manager can be any existing role
-- (article/intern/manager/partner/admin) — this is deliberately NOT a role
-- and is NOT restricted by role at the database level; the relationship
-- represents people, not roles.
--
-- The people being reported on are expected to be articles/interns, but that
-- is enforced at the application layer (ARTICLE_ROLES) rather than here:
-- profiles.role is mutable over time, and a DB constraint checked only at
-- insert time would go stale the moment someone's role later changes —
-- which is exactly the history-preservation behaviour we want (see below).
--
-- Lifecycle: relationships are never auto-deleted on deactivation or role
-- change in either direction — organisational history is preserved. The
-- "currently active" Reporting Wise count filters by CURRENT
-- profiles.status/role at query time instead of relying on row deletion.
--
-- Writes happen exclusively via service-role in the API route (which
-- validates actor role and rejects self-reporting) — no client-side write
-- policy, mirroring audit_log's existing "inserts happen exclusively via
-- service-role" convention.
-- ============================================================================

create table reporting_relationships (
  id                   uuid primary key default uuid_generate_v4(),
  article_id           uuid not null references profiles(id) on delete restrict,
  reporting_manager_id uuid not null references profiles(id) on delete restrict,
  created_at           timestamptz not null default now(),
  created_by           uuid not null references profiles(id),
  unique (article_id, reporting_manager_id)
);

create index idx_reporting_rel_article on reporting_relationships(article_id);
create index idx_reporting_rel_manager on reporting_relationships(reporting_manager_id);

alter table reporting_relationships enable row level security;

-- Elevated roles can read all relationships (organisational reporting) —
-- mirrors "assignments: elevated read all" / "profiles: elevated read all".
create policy "reporting_relationships: elevated read all"
  on reporting_relationships for select
  using (is_elevated());

-- No insert/update/delete policy intentionally — writes go exclusively
-- through the service-role API route, matching audit_log's convention.
