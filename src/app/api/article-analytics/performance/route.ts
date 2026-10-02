import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/attendanceRecords'
import { deriveArticlePerformance, type PerformanceSession } from '@/lib/articlePerformance'
import { fetchRosterEvents, isLeaveCountable } from '@/lib/rosterEligibility'
import { NextRequest, NextResponse } from 'next/server'
import { isArticleRole } from '@/types/app'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/article-analytics/performance?article_id=<uuid> — Article
// Performance (month-wise Present / Half Day / Leave / Unallocated days)
//
// article_id is required: the page calls this only after an article is
// selected. Every query is filtered to that one article in the database
// (idx_attendance_article_date / idx_leave_article_id / audit target_id) and
// the browser only ever receives the aggregated month rows — never the
// article's sessions. Day classification lives in lib/articlePerformance.ts
// (built on the Attendance Report's computeStatus); leave eligibility is the
// Attendance Report's own (lib/rosterEligibility.ts), so the two reconcile.
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

  const articleId = new URL(req.url).searchParams.get('article_id')
  if (!articleId || !UUID_RE.test(articleId)) {
    return NextResponse.json({ error: 'article_id is required' }, { status: 400 })
  }

  // IST date — UTC split gives the wrong date between midnight and 05:30 IST.
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  // Later admin actions can't affect past eligibility, so lifecycle events are
  // bounded to the end of today (IST), as the Attendance Report bounds them to
  // the end of its range.
  const endOfTodayIST = new Date(`${todayIST}T23:59:59.999+05:30`).toISOString()

  // Read via the service-role client for the audit log, as the Attendance
  // Report does: audit_log's RLS only lets role='admin' SELECT it, and this
  // page is also open to partner/manager, for whom the session client would
  // silently return zero rows and wrongly drop every leave day. article_id is
  // UUID-validated above.
  const admin = createAdminClient()

  // Real sessions only (checked_in_at present), same as every other
  // attendance read. .order('id') is a deterministic tiebreaker for
  // attendance_date, required for stable offset pagination. Leave dates are
  // capped at today: planned future leave has not been "taken" yet.
  const [sessionsRes, leavesRes, eventsRes] = await Promise.all([
    fetchAllPages<PerformanceSession>((from, to) =>
      supabase
        .from('attendance_records')
        .select('attendance_date, attendance_type, checked_in_at, checked_out_at')
        .eq('article_id', articleId)
        .not('checked_in_at', 'is', null)
        .order('attendance_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllPages<{ leave_date: string }>((from, to) =>
      supabase
        .from('leave_records')
        .select('leave_date')
        .eq('article_id', articleId)
        .lte('leave_date', todayIST)
        .order('leave_date', { ascending: true })
        .range(from, to)
    ),
    fetchRosterEvents(admin, endOfTodayIST, articleId),
  ])

  if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 })
  if (leavesRes.error)   return NextResponse.json({ error: leavesRes.error.message },   { status: 500 })
  if (eventsRes.error)   return NextResponse.json({ error: eventsRes.error.message },   { status: 500 })

  // Same gate the Attendance Report applies before it shows an On Leave row.
  // (Attendance precedence is applied inside deriveArticlePerformance.)
  const leaveDates = leavesRes.data
    .map(l => l.leave_date)
    .filter(date => isLeaveCountable(eventsRes.data, date))

  return NextResponse.json({ rows: deriveArticlePerformance(sessionsRes.data, leaveDates) })
}
