-- ============================================================
-- TRIGGER: Auto-create profile when a new Google SSO user signs in
-- ============================================================
-- Note: explicit public. prefix on both the function name and the trigger
-- reference is required for Supabase. supabase_auth_admin (the role that
-- inserts into auth.users) resolves unqualified names from the auth schema
-- first. The GRANT below ensures that role can call this function.
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

grant execute on function public.handle_new_user() to supabase_auth_admin;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- TRIGGER: Keep updated_at current on mutations
-- ============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on profiles
  for each row execute procedure set_updated_at();

create trigger set_assignments_updated_at
  before update on assignments
  for each row execute procedure set_updated_at();

create trigger set_attendance_updated_at
  before update on attendance_records
  for each row execute procedure set_updated_at();

-- ============================================================
-- RPC: get_dashboard_summary
-- Single fast call returning all dashboard metrics as JSON.
-- Called from the dashboard page via supabase.rpc()
-- ============================================================
create or replace function get_dashboard_summary()
returns json
language plpgsql
security definer
stable
as $$
declare
  result json;
  today  date := current_date;
begin
  select json_build_object(
    'active_assignments',
    (
      select count(*) from assignments where status = 'active'
    ),

    'active_cycles',
    (
      select count(*) from assignment_cycles where status = 'active'
    ),

    'active_articles_today',
    (
      select count(distinct article_id)
      from attendance_records
      where attendance_date = today
        and checked_in_at is not null
    ),

    'free_articles_today',
    (
      select count(*)
      from profiles p
      where p.role = 'article'
        and p.status = 'active'
        and p.id not in (
          select distinct article_id
          from attendance_records
          where attendance_date = today
        )
        and p.id not in (
          select article_id from leave_records where leave_date = today
        )
    ),

    'on_leave_today',
    (
      select count(*) from leave_records where leave_date = today
    ),

    'flagged_attendance',
    (
      select count(*)
      from attendance_records
      where flagged_for_review = true
        and reviewed_at is null
    ),

    'inactive_cycle_alerts',
    (
      select count(*) from inactivity_alerts where dismissed = false
    ),

    'open_checkins',
    (
      select count(*)
      from attendance_records
      where attendance_date = today
        and checked_in_at is not null
        and checked_out_at is null
    )
  ) into result;

  return result;
end;
$$;

-- ============================================================
-- RPC: get_live_activity
-- Articles currently checked in, for the dashboard live panel.
-- ============================================================
create or replace function get_live_activity()
returns table (
  article_id    uuid,
  article_name  text,
  assignment_id uuid,
  client_name   text,
  work_type     work_type,
  checked_in_at timestamptz,
  duration_mins integer,
  record_id     uuid
)
language sql
security definer
stable
as $$
  select
    p.id                                                         as article_id,
    p.full_name                                                  as article_name,
    a.id                                                         as assignment_id,
    coalesce(a.client_name, 'Others')                            as client_name,
    a.work_type,
    ar.checked_in_at,
    extract(epoch from (now() - ar.checked_in_at))::integer / 60 as duration_mins,
    ar.id                                                        as record_id
  from attendance_records ar
  join profiles p on p.id = ar.article_id
  left join assignments a on a.id = ar.assignment_id
  where ar.attendance_date = current_date
    and ar.checked_in_at is not null
    and ar.checked_out_at is null
  order by ar.checked_in_at;
$$;

-- ============================================================
-- RPC: get_workload_distribution
-- Per-assignment summary for the dashboard workload table.
-- ============================================================
create or replace function get_workload_distribution()
returns table (
  assignment_id     uuid,
  client_name       text,
  work_type         work_type,
  cycle_id          uuid,
  cycle_started_at  timestamptz,
  cycle_days        integer,
  attendance_days   bigint,
  total_hours       numeric,
  articles_involved bigint,
  last_activity     date
)
language sql
security definer
stable
as $$
  select
    a.id                                                              as assignment_id,
    a.client_name,
    a.work_type,
    ac.id                                                             as cycle_id,
    ac.started_at                                                     as cycle_started_at,
    extract(day from now() - ac.started_at)::integer                  as cycle_days,
    count(distinct ar.attendance_date)                                 as attendance_days,
    coalesce(
      round(
        sum(
          extract(epoch from (ar.checked_out_at - ar.checked_in_at))
        ) / 3600.0,
        2
      ),
      0
    )                                                                  as total_hours,
    count(distinct ar.article_id)                                      as articles_involved,
    max(ar.attendance_date)                                            as last_activity
  from assignments a
  join assignment_cycles ac
    on ac.assignment_id = a.id
    and ac.status = 'active'
  left join attendance_records ar
    on ar.cycle_id = ac.id
    and ar.checked_out_at is not null
  where a.status = 'active'
  group by a.id, a.client_name, a.work_type, ac.id, ac.started_at
  order by last_activity desc nulls last;
$$;

-- ============================================================
-- RPC: check_cycle_inactivity
-- Called daily by cron. Creates inactivity alerts for cycles
-- with no attendance in the last 7 days. Never auto-closes.
-- Returns the number of alerts created.
-- ============================================================
create or replace function check_cycle_inactivity()
returns integer
language plpgsql
security definer
as $$
declare
  alert_count integer := 0;
  rec         record;
  last_act    date;
  days_in     integer;
begin
  for rec in
    select
      ac.id              as cycle_id,
      ac.assignment_id,
      ac.started_at      as cycle_started_at,
      max(ar.attendance_date) as last_activity
    from assignment_cycles ac
    left join attendance_records ar on ar.cycle_id = ac.id
    where ac.status = 'active'
    group by ac.id, ac.assignment_id, ac.started_at
  loop
    -- Fallback to cycle start date when no attendance has ever been recorded.
    -- Previously used cycle_id::text::date which always throws a runtime error.
    last_act := coalesce(rec.last_activity, rec.cycle_started_at::date);
    days_in  := extract(day from now() - last_act::timestamptz)::integer;

    continue when days_in < 7;

    -- Only insert if no undismissed alert already exists for this cycle
    if not exists (
      select 1 from inactivity_alerts
      where cycle_id = rec.cycle_id and dismissed = false
    ) then
      insert into inactivity_alerts (
        cycle_id,
        assignment_id,
        last_activity_date,
        days_inactive
      ) values (
        rec.cycle_id,
        rec.assignment_id,
        last_act,
        days_in
      );
      alert_count := alert_count + 1;
    end if;
  end loop;

  return alert_count;
end;
$$;

-- ============================================================
-- RPC: get_attendance_export
-- Returns full attendance data for Excel export.
-- p_article_id = null means all articles.
-- ============================================================
create or replace function get_attendance_export(
  p_start_date date,
  p_end_date   date,
  p_article_id uuid default null
)
returns table (
  article_name          text,
  assignment_label      text,
  work_type_label       text,
  cycle_id              uuid,
  attendance_date       date,
  checked_in_at         timestamptz,
  checked_out_at        timestamptz,
  duration_hours        numeric,
  check_in_lat          numeric,
  check_in_lng          numeric,
  check_out_lat         numeric,
  check_out_lng         numeric,
  maps_link_in          text,
  maps_link_out         text,
  note                  text,
  attendance_type_label text,
  others_client_name    text,
  regularized           boolean
)
language sql
security definer
stable
as $$
  select
    p.full_name                                                         as article_name,
    coalesce(a.client_name || ' — ' || a.work_type::text, 'Others')    as assignment_label,
    coalesce(a.work_type::text, 'N/A')                                  as work_type_label,
    ar.cycle_id,
    ar.attendance_date,
    ar.checked_in_at,
    ar.checked_out_at,
    case
      when ar.checked_in_at is not null and ar.checked_out_at is not null
      then round(
        extract(epoch from (ar.checked_out_at - ar.checked_in_at)) / 3600.0,
        2
      )
      else null
    end                                                                  as duration_hours,
    ar.checked_in_lat                                                    as check_in_lat,
    ar.checked_in_lng                                                    as check_in_lng,
    ar.checked_out_lat                                                   as check_out_lat,
    ar.checked_out_lng                                                   as check_out_lng,
    case
      when ar.checked_in_lat is not null
      then 'https://maps.google.com/?q='
           || ar.checked_in_lat::text || ',' || ar.checked_in_lng::text
      else null
    end                                                                  as maps_link_in,
    case
      when ar.checked_out_lat is not null
      then 'https://maps.google.com/?q='
           || ar.checked_out_lat::text || ',' || ar.checked_out_lng::text
      else null
    end                                                                  as maps_link_out,
    ar.note,
    ar.attendance_type::text                                             as attendance_type_label,
    ar.others_client_name,
    ar.regularized
  from attendance_records ar
  join profiles p on p.id = ar.article_id
  left join assignments a on a.id = ar.assignment_id
  where ar.attendance_date between p_start_date and p_end_date
    and (p_article_id is null or ar.article_id = p_article_id)
  order by ar.attendance_date, p.full_name, ar.checked_in_at;
$$;

-- ============================================================
-- RPC: get_assignment_activity_export
-- Returns assignment-level summary for Excel export.
-- ============================================================
create or replace function get_assignment_activity_export()
returns table (
  client_name       text,
  work_type_label   text,
  cycle_id          uuid,
  cycle_started_at  timestamptz,
  cycle_ended_at    timestamptz,
  cycle_status      text,
  cycle_days        integer,
  attendance_days   bigint,
  total_hours       numeric,
  articles_involved bigint,
  last_activity     date,
  assignment_status text
)
language sql
security definer
stable
as $$
  select
    a.client_name,
    a.work_type::text                                              as work_type_label,
    ac.id                                                          as cycle_id,
    ac.started_at                                                  as cycle_started_at,
    ac.ended_at                                                    as cycle_ended_at,
    ac.status::text                                                as cycle_status,
    coalesce(
      extract(day from coalesce(ac.ended_at, now()) - ac.started_at)::integer,
      0
    )                                                              as cycle_days,
    count(distinct ar.attendance_date)                              as attendance_days,
    coalesce(
      round(
        sum(
          extract(epoch from (ar.checked_out_at - ar.checked_in_at))
        ) / 3600.0,
        2
      ),
      0
    )                                                              as total_hours,
    count(distinct ar.article_id)                                   as articles_involved,
    max(ar.attendance_date)                                         as last_activity,
    a.status::text                                                 as assignment_status
  from assignments a
  join assignment_cycles ac on ac.assignment_id = a.id
  left join attendance_records ar
    on ar.cycle_id = ac.id
    and ar.checked_out_at is not null
  group by a.client_name, a.work_type, ac.id, ac.started_at, ac.ended_at, ac.status, a.status
  order by a.client_name, ac.started_at desc;
$$;
