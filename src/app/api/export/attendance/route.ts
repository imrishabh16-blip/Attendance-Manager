import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildAttendanceExcel } from '@/lib/export'
import type { AttendanceExportRow } from '@/lib/export'
import { NextRequest, NextResponse } from 'next/server'
import { ARTICLE_ROLES } from '@/types/app'
import type { PostgrestError } from '@supabase/supabase-js'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

// Supabase/PostgREST caps any single response at this many rows (the
// project's default Max Rows setting). This firm's attendance volume already
// exceeds it for a single month (1,087 real rows confirmed for August 2026
// across 60 active articles/interns), so every query below that scales with
// firm size or date-range length must page through the full result instead
// of trusting one response — otherwise rows past the cutoff are silently
// dropped with no error, which is exactly what caused real attendance to be
// misreported as AWOL.
const PAGE_SIZE = 1000

// Fetches every row of a query in PAGE_SIZE batches via .range(), regardless
// of how many rows exist in total. Terminates only when a page comes back
// shorter than PAGE_SIZE (the true end of the result set) or a page errors —
// it can never silently stop at exactly PAGE_SIZE rows while more remain,
// because a full page always triggers one more request.
//
// Requires the underlying query to have a deterministic ORDER BY: Postgrest
// pagination is only guaranteed stable (no duplicate or skipped rows across
// page boundaries) when row order doesn't change between requests.
async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) return { data: rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { data: rows, error: null }
    from += PAGE_SIZE
  }
}

type RosterEventRow = {
  target_id:  string
  action:     string
  payload:    unknown
  created_at: string
}

function toISTDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

type RosterState = { status: string; role: string }

// Starting state mirrors the signup trigger's default (pending article).
const INITIAL_ROSTER_STATE: RosterState = { status: 'pending', role: 'article' }

// Applies one lifecycle event's payload to a roster state. Shared by
// isEligibleAsOf and eligibilityChangedOnDate so both replay the exact same
// state-transition rules.
function applyRosterEvent(state: RosterState, ev: RosterEventRow): RosterState {
  const payload = ev.payload as { status?: string; role?: string } | null
  let { status, role } = state

  if (ev.action === 'user.change_role') {
    if (payload?.role) role = payload.role
  } else {
    // user.approve | user.deactivate | user.reactivate
    if (payload?.status) status = payload.status
    if (ev.action === 'user.approve' && payload?.role) role = payload.role
  }

  return { status, role }
}

function isRosterEligible(state: RosterState): boolean {
  return state.status === 'active' && (ARTICLE_ROLES as readonly string[]).includes(state.role)
}

// Replays a person's approve/deactivate/reactivate/change_role history
// (events pre-sorted ascending by created_at) to determine whether they were
// an active article/intern as of IST date `dateIST` — instead of trusting
// their CURRENT profiles.role/status, which has no history of its own and
// silently erases past eligibility after a later promotion or deactivation.
// A person with no event on or before dateIST has never been approved as of
// that date and is never eligible — this also means a person with NO
// history at all (an audit_log gap) is conservatively excluded rather than
// assumed eligible.
function isEligibleAsOf(events: RosterEventRow[], dateIST: string): boolean {
  let state    = INITIAL_ROSTER_STATE
  let sawEvent = false

  for (const ev of events) {
    if (toISTDate(ev.created_at) > dateIST) break
    sawEvent = true
    state = applyRosterEvent(state, ev)
  }

  if (!sawEvent) return false
  return isRosterEligible(state)
}

// True if this person's AWOL-roster eligibility (active article/intern, or
// not) flips at any point during dateIST — e.g. approved, deactivated,
// reactivated, or promoted/demoted across the article/intern boundary that
// same day. Collapsing an exact-timestamp transition onto a whole calendar
// day can't faithfully represent a partial-day eligibility window, so dates
// where it changed mid-day are skipped for synthetic rows entirely rather
// than guessed at. An article<->intern change_role never flips the boolean
// (both are in ARTICLE_ROLES), so it never triggers exclusion here — that
// falls out of comparing the actual eligibility predicate before/after each
// event, not from special-casing role values.
function eligibilityChangedOnDate(events: RosterEventRow[], dateIST: string): boolean {
  let state = INITIAL_ROSTER_STATE

  for (const ev of events) {
    const evDate = toISTDate(ev.created_at)
    if (evDate > dateIST) break
    if (evDate < dateIST) {
      state = applyRosterEvent(state, ev)
      continue
    }
    const before = isRosterEligible(state)
    state = applyRosterEvent(state, ev)
    if (isRosterEligible(state) !== before) return true
  }

  return false
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const current = new Date(Date.UTC(sy, sm - 1, sd))
  const last    = new Date(Date.UTC(ey, em - 1, ed))
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

function computeStatus(attendanceTypeLabel: string, durationHours: number | null): string {
  if (attendanceTypeLabel === 'others' || attendanceTypeLabel === 'unallocated') {
    return 'Unallocated'
  }
  if (durationHours !== null && durationHours < 4) {
    return 'Half Day'
  }
  return 'Completed'
}

function makeSyntheticRow(articleName: string, date: string, status: string): AttendanceExportRow {
  return {
    article_name:          articleName,
    assignment_label:      '',
    work_type_label:       '',
    attendance_date:       date,
    checked_in_at:         null,
    checked_out_at:        null,
    duration_hours:        null,
    check_in_lat:          null,
    check_in_lng:          null,
    check_out_lat:         null,
    check_out_lng:         null,
    maps_link_in:          null,
    maps_link_out:         null,
    note:                  null,
    attendance_type_label: '',
    others_client_name:    null,
    regularized:           false,
    status,
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active' || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('start_date')
  const endDate   = searchParams.get('end_date')
  const articleId = searchParams.get('article_id') ?? undefined

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'start_date and end_date required' }, { status: 400 })
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be on or before end_date' }, { status: 400 })
  }
  const daySpan = Math.round(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000
  )
  if (daySpan > 365) {
    return NextResponse.json({ error: 'Date range cannot exceed 365 days' }, { status: 400 })
  }

  // IST end-of-range boundary — audit events after this can never affect
  // eligibility for any date in the requested range.
  const endOfRangeIST = new Date(`${endDate}T23:59:59.999+05:30`).toISOString()
  const admin = createAdminClient()

  // Parallel across the 4 distinct queries (unchanged concurrency shape) —
  // each one now pages internally via fetchAllPages so none of them can be
  // silently truncated by the PostgREST row cap. This is bounded, sequential
  // pagination per query (ceil(rowCount / PAGE_SIZE) requests), not N+1 —
  // there is no per-row query multiplication.
  const [exportRes, auditRes, leaveRes, attendedRes] = await Promise.all([
    // get_attendance_export already has a deterministic ORDER BY baked into
    // its own SQL (attendance_date, full_name, checked_in_at) — see
    // supabase/migrations/00008_stabilization.sql — so no extra .order() is
    // needed here to make pagination stable.
    fetchAllPages<Omit<AttendanceExportRow, 'status'>>((from, to) =>
      supabase.rpc('get_attendance_export', {
        p_start_date: startDate,
        p_end_date:   endDate,
        p_article_id: articleId ?? null,
      }).range(from, to)
    ),
    // Full profile lifecycle history (bounded to events up to the end of the
    // requested range — later admin actions can't affect past eligibility).
    // Read via the service-role client: audit_log's RLS policy only allows
    // role='admin' to SELECT it directly, but this report is also permitted
    // for partner/manager — the session client would silently return zero
    // rows (RLS filters, it doesn't error) for those two roles.
    fetchAllPages<RosterEventRow>((from, to) => {
      let query = admin
        .from('audit_log')
        .select('target_id, action, payload, created_at')
        .eq('target_type', 'profiles')
        .in('action', ['user.approve', 'user.deactivate', 'user.reactivate', 'user.change_role'])
        .lte('created_at', endOfRangeIST)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })

      if (articleId) {
        query = query.eq('target_id', articleId)
      }

      return query.range(from, to)
    }),
    fetchAllPages<{ article_id: string; leave_date: string }>((from, to) =>
      (articleId
        ? supabase.from('leave_records').select('article_id, leave_date').gte('leave_date', startDate).lte('leave_date', endDate).eq('article_id', articleId).order('article_id').order('leave_date').range(from, to)
        : supabase.from('leave_records').select('article_id, leave_date').gte('leave_date', startDate).lte('leave_date', endDate).order('article_id').order('leave_date').range(from, to)
      )
    ),
    fetchAllPages<{ article_id: string; attendance_date: string }>((from, to) =>
      (articleId
        ? supabase.from('attendance_records').select('article_id, attendance_date').gte('attendance_date', startDate).lte('attendance_date', endDate).eq('article_id', articleId).not('checked_in_at', 'is', null).order('id').range(from, to)
        : supabase.from('attendance_records').select('article_id, attendance_date').gte('attendance_date', startDate).lte('attendance_date', endDate).not('checked_in_at', 'is', null).order('id').range(from, to)
      )
    ),
  ])

  if (exportRes.error)   return NextResponse.json({ error: exportRes.error.message },   { status: 500 })
  if (auditRes.error)    return NextResponse.json({ error: auditRes.error.message },    { status: 500 })
  if (leaveRes.error)    return NextResponse.json({ error: leaveRes.error.message },    { status: 500 })
  if (attendedRes.error) return NextResponse.json({ error: attendedRes.error.message }, { status: 500 })

  // Group each candidate's lifecycle events (already ascending by created_at
  // from the query's own ORDER BY — no re-sort needed).
  const eventsByPerson = new Map<string, RosterEventRow[]>()
  for (const ev of auditRes.data) {
    const list = eventsByPerson.get(ev.target_id) ?? []
    list.push(ev)
    eventsByPerson.set(ev.target_id, list)
  }
  const candidateIds = [...eventsByPerson.keys()]

  // Names for the roster — a separate lookup because audit_log doesn't store
  // full_name. Bounded by total people ever administered, not attendance
  // volume, but still paginated defensively for consistency with every other
  // query in this route.
  const { data: nameRows, error: nameError } = candidateIds.length > 0
    ? await fetchAllPages<{ id: string; full_name: string }>((from, to) =>
        supabase.from('profiles').select('id, full_name').in('id', candidateIds).range(from, to)
      )
    : { data: [] as { id: string; full_name: string }[], error: null }

  if (nameError) return NextResponse.json({ error: nameError.message }, { status: 500 })
  const nameById = new Map(nameRows.map(p => [p.id, p.full_name]))

  const leaveSet = new Set(
    (leaveRes.data ?? []).map((l: { article_id: string; leave_date: string }) => `${l.article_id}:${l.leave_date}`)
  )
  const attendedSet = new Set(
    (attendedRes.data ?? []).map((a: { article_id: string; attendance_date: string }) => `${a.article_id}:${a.attendance_date}`)
  )

  // Add status to each attendance row (attendance always wins over leave)
  const attendanceRows: AttendanceExportRow[] = (exportRes.data ?? []).map((row: Omit<AttendanceExportRow, 'status'>) => ({
    ...row,
    status: computeStatus(row.attendance_type_label, row.duration_hours),
  }))

  // Generate synthetic On Leave and AWOL rows for dates with no attendance.
  // Order matters: real attendance wins first, then dates whose eligibility
  // actually changed mid-day are skipped entirely (a whole-day AWOL/Leave
  // label can't faithfully represent a partial-day transition), then the
  // remaining candidates are evaluated for historical eligibility as of that
  // date, and only then does the existing Leave/AWOL distinction apply.
  const syntheticRows: AttendanceExportRow[] = []
  const dateRange = generateDateRange(startDate, endDate)

  for (const date of dateRange) {
    for (const personId of candidateIds) {
      const key = `${personId}:${date}`
      if (attendedSet.has(key)) continue
      const events = eventsByPerson.get(personId) ?? []
      if (eligibilityChangedOnDate(events, date)) continue
      if (!isEligibleAsOf(events, date)) continue
      const name = nameById.get(personId) ?? '—'
      syntheticRows.push(
        makeSyntheticRow(name, date, leaveSet.has(key) ? 'On Leave' : 'AWOL')
      )
    }
  }

  // Merge and sort: date ASC → article_name ASC → attendance before synthetic
  const allRows = [...attendanceRows, ...syntheticRows].sort((a, b) => {
    if (a.attendance_date !== b.attendance_date) {
      return a.attendance_date < b.attendance_date ? -1 : 1
    }
    if (a.article_name !== b.article_name) {
      return a.article_name < b.article_name ? -1 : 1
    }
    if (a.checked_in_at && !b.checked_in_at) return -1
    if (!a.checked_in_at && b.checked_in_at) return 1
    if (a.checked_in_at && b.checked_in_at) {
      return a.checked_in_at < b.checked_in_at ? -1 : 1
    }
    return 0
  })

  const buffer = await buildAttendanceExcel(allRows)
  const filename = `attendance_${startDate}_to_${endDate}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
