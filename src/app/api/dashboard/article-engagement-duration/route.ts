import { createClient } from '@/lib/supabase/server'
import { deriveArticleEngagementDuration, type ArticleEngagementRow } from '@/lib/workDuration'
import { fetchAllPages, toSessionRecords, SESSION_RECORD_SELECT, type RawAttendanceRow } from '@/lib/attendanceRecords'
import { buildArticleEngagementExcel } from '@/lib/export'
import { NextRequest, NextResponse } from 'next/server'
import { isArticleRole } from '@/types/app'

function isValidDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

// GET /api/dashboard/article-engagement-duration?start_date=YYYY-MM-DD —
// Client Engagement ribbon
//
// start_date is required: the Dashboard calls this only when the user picks a
// Start Date and clicks Generate. The database bounds the query to
// attendance_date between start_date and today (IST), so history before that
// date is never read, and the browser only ever receives one aggregated row
// per article. Intentionally NOT part of the Dashboard's realtime RPC bundle
// (useRealtimeDashboard) — same as /api/dashboard/today-sessions.
//
// ?format=xlsx  optional — returns the .xlsx export instead of { rows }.
//               ?q=<text>  optional, only applies with format=xlsx — the same
//               case-insensitive Article Name / Last Punched Client substring
//               match the modal's search box applies client-side, so the
//               export always matches what's currently filtered on screen.
//               Both paths call deriveArticleEngagementDuration() and then
//               filter its output the same way — no separate calculation for
//               Excel.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!viewer || viewer.status !== 'active' || isArticleRole(viewer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('start_date')
  if (!isValidDate(startDate)) {
    return NextResponse.json({ error: 'start_date (YYYY-MM-DD) is required' }, { status: 400 })
  }

  // IST date — UTC split gives the wrong date between midnight and 05:30 IST.
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  // Paginated and joined with profiles — no N+1. The !inner assignments join
  // in SESSION_RECORD_SELECT excludes Others/unallocated punches (no
  // validated client identity), same boundary Client Work Duration uses.
  // .order('id') is a deterministic tiebreaker for attendance_date, required
  // for stable offset pagination.
  const { data: rawRecords, error: recordsError } = await fetchAllPages<RawAttendanceRow>((from, to) =>
    supabase
      .from('attendance_records')
      .select(SESSION_RECORD_SELECT)
      .gte('attendance_date', startDate)
      .lte('attendance_date', todayIST)
      .not('checked_in_at', 'is', null)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const rows: ArticleEngagementRow[] = deriveArticleEngagementDuration(toSessionRecords(rawRecords))

  if (searchParams.get('format') !== 'xlsx') {
    return NextResponse.json({ rows })
  }

  const query      = (searchParams.get('q') ?? '').trim().toLowerCase()
  const exportRows = query
    ? rows.filter(r =>
        r.article_name.toLowerCase().includes(query) ||
        r.last_punched_client.toLowerCase().includes(query)
      )
    : rows

  const buffer   = await buildArticleEngagementExcel(exportRows)
  const filename = `client_engagement_${startDate}_to_${todayIST}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
