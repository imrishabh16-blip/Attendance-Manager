-- ============================================================
-- SEED DATA (development only)
-- Run after migrations to populate test data.
-- DO NOT run on production.
-- ============================================================

-- NOTE: Profiles are normally created via Google SSO trigger.
-- For local dev, insert directly using known test UUIDs.

-- Insert a test admin profile (replace UUID with your actual Supabase auth user id)
-- insert into profiles (id, email, full_name, role, status)
-- values (
--   '00000000-0000-0000-0000-000000000001',
--   'admin@example.com',
--   'Admin User',
--   'admin',
--   'active'
-- );

-- Sample assignments
insert into assignments (id, client_name, work_type, status, created_by)
select
  uuid_generate_v4(),
  client_name,
  work_type::work_type,
  'active',
  (select id from profiles where role = 'admin' limit 1)
from (values
  ('ABC Pvt Ltd',    'GST Compliance'),
  ('XYZ Ltd',        'Internal Audit'),
  ('Sunrise Traders','Tax Audit'),
  ('Metro Corp',     'Statutory Audit'),
  ('Nexus Solutions','Income Tax Compliance')
) as t(client_name, work_type)
where exists (select 1 from profiles where role = 'admin');
