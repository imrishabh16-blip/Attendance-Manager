import { createClient } from '@/lib/supabase/server'
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

  // Parallel across the 4 distinct queries (unchanged concurrency shape) —
  // each one now pages internally via fetchAllPages so none of them can be
  // silently truncated by the PostgREST row cap. This is bounded, sequential
  // pagination per query (ceil(rowCount / PAGE_SIZE) requests), not N+1 —
  // there is no per-row query multiplication.
  const [exportRes, articlesRes, leaveRes, attendedRes] = await Promise.all([
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
    fetchAllPages<{ id: string; full_name: string }>((from, to) =>
      (articleId
        ? supabase.from('profiles').select('id, full_name').eq('id', articleId).in('role', ARTICLE_ROLES).eq('status', 'active').order('id').range(from, to)
        : supabase.from('profiles').select('id, full_name').in('role', ARTICLE_ROLES).eq('status', 'active').order('full_name').order('id').range(from, to)
      )
    ),
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
  if (articlesRes.error) return NextResponse.json({ error: articlesRes.error.message }, { status: 500 })
  if (leaveRes.error)    return NextResponse.json({ error: leaveRes.error.message },    { status: 500 })
  if (attendedRes.error) return NextResponse.json({ error: attendedRes.error.message }, { status: 500 })

  const articles = articlesRes.data ?? []
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

  // Generate synthetic On Leave and AWOL rows for dates with no attendance
  const syntheticRows: AttendanceExportRow[] = []
  const dateRange = generateDateRange(startDate, endDate)

  for (const date of dateRange) {
    for (const article of articles) {
      const key = `${article.id}:${date}`
      if (attendedSet.has(key)) continue
      syntheticRows.push(
        makeSyntheticRow(article.full_name, date, leaveSet.has(key) ? 'On Leave' : 'AWOL')
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
