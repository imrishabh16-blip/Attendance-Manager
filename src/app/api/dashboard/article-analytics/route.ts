import { createClient } from '@/lib/supabase/server'
import { deriveArticleAnalytics } from '@/lib/workDuration'
import { fetchAllPages, toSessionRecords, SESSION_RECORD_SELECT, type RawAttendanceRow } from '@/lib/attendanceRecords'
import { NextRequest, NextResponse } from 'next/server'
import { isArticleRole } from '@/types/app'

function isValidDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

// GET /api/dashboard/article-analytics?start_date=YYYY-MM-DD — Article Analytics
//
// Article-wise engagement from start_date onward. start_date is required: the
// Dashboard only calls this once the user has picked a date, and the database
// (not the client) bounds the query to attendance_date >= start_date, so the
// historical dataset before that date is never read.
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

  const startDate = new URL(req.url).searchParams.get('start_date')
  if (!isValidDate(startDate)) {
    return NextResponse.json({ error: 'start_date (YYYY-MM-DD) is required' }, { status: 400 })
  }

  // Paginated and joined with profiles — no N+1. .order('id') is a
  // deterministic tiebreaker for attendance_date, required for stable offset
  // pagination.
  const { data: rawRecords, error } = await fetchAllPages<RawAttendanceRow>((from, to) =>
    supabase
      .from('attendance_records')
      .select(SESSION_RECORD_SELECT)
      .gte('attendance_date', startDate)
      .not('checked_in_at', 'is', null)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rows: deriveArticleAnalytics(toSessionRecords(rawRecords)) })
}
